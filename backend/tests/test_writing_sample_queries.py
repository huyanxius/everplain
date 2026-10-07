"""The sample-list use case returns fresh owner-scoped metadata, not sample bodies."""

import sqlite3
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, select, update
from sqlalchemy.orm import Session
from test_research_material_api import _authenticate
from test_writing import post

from qunxue_api.adapters.sqlite.writing import (
    SqliteWritingRepository,
    WritingSampleRow,
    sample_dict,
)
from qunxue_api.api.routes.writing import samples
from qunxue_api.application.writing import WritingApplication


@pytest.fixture
def sample_store(tmp_path):
    returned, statements = [], []

    class CountingCursor(sqlite3.Cursor):
        def execute(self, statement, *args, **kwargs):
            self.measured = statement.lstrip().upper().startswith("SELECT")
            if self.measured:
                statements.append(statement)
            return super().execute(statement, *args, **kwargs)

        def record(self, rows):
            if getattr(self, "measured", False):
                returned.extend(rows)
            return rows

        def fetchall(self):
            return self.record(super().fetchall())

        def fetchmany(self, *args):
            return self.record(super().fetchmany(*args))

        def fetchone(self):
            row = super().fetchone()
            if row is not None:
                self.record([row])
            return row

    class CountingConnection(sqlite3.Connection):
        def cursor(self, *args, **kwargs):
            return super().cursor(*args, factory=CountingCursor, **kwargs)

    engine = create_engine(
        "sqlite://",
        creator=lambda: sqlite3.connect(tmp_path / "samples.db", factory=CountingConnection),
    )
    with engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TABLE writing_samples (
            sample_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
            genre TEXT NOT NULL, text TEXT NOT NULL, content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL)""")
        connection.exec_driver_sql(
            "CREATE INDEX ix_writing_samples_user_id ON writing_samples(user_id)"
        )
    try:
        yield engine, returned, statements
    finally:
        engine.dispose()


def add_sample(session, owner, body, index=0):
    row = WritingSampleRow(
        sample_id=str(uuid4()), user_id=str(owner), title=f"文章 {index}", genre="essay",
        text=body, content_hash=f"{index:064}", created_at=f"2026-10-01T00:00:{index:03}+00:00",
    )
    session.add(row)
    session.flush()
    return row


def test_list_route_and_application_only_need_public_query_contracts():
    owner, calls = uuid4(), []
    expected = {"items": [{"sample_id": "one", "character_count": 100}]}

    class UseCases:
        def list_samples(self, user_id):
            calls.append(user_id)
            return expected

    assert samples(SimpleNamespace(user=SimpleNamespace(user_id=owner)), UseCases()) == expected

    class SampleQueries:
        def sample_summaries(self, user_id):
            calls.append(user_id)
            return expected["items"]

    assert WritingApplication(SampleQueries()).list_samples(owner) == expected
    assert calls == [owner, owner]


@pytest.mark.parametrize("body", [
    "", "ascii\n\t ", "中文。🙂𠮷", "e\u0301\r\n", "\x00", "前\x00中🙂\x00尾", "\x00末",
])
def test_projection_keeps_python_character_count_and_exact_fields(sample_store, body):
    engine, _, _ = sample_store
    owner = uuid4()
    with Session(engine) as session:
        row = add_sample(session, owner, body)
        expected = sample_dict(row)
        assert SqliteWritingRepository(session).sample_summaries(owner) == [expected]
        assert expected["character_count"] == len(body)
        assert set(expected) == {"sample_id", "title", "genre", "character_count", "created_at"}


def test_projection_keeps_owner_order_empty_result_and_freshness(sample_store):
    engine, _, _ = sample_store
    owner, other = uuid4(), uuid4()
    with Session(engine) as session:
        old = add_sample(session, owner, "旧正文", 1)
        new = add_sample(session, owner, "新正文", 2)
        stranger = add_sample(session, other, "其他人的私密正文", 3)
        session.commit()
        repository = SqliteWritingRepository(session)
        assert repository.sample_summaries(owner) == [sample_dict(new), sample_dict(old)]
        assert repository.sample_summaries(other) == [sample_dict(stranger)]
        assert repository.sample_summaries(uuid4()) == []
        # Hold an actual stale ORM row, then change it through a separate session.
        cached = session.scalar(select(WritingSampleRow).where(
            WritingSampleRow.sample_id == old.sample_id,
        ))
        with Session(engine) as writer:
            writer.execute(update(WritingSampleRow).where(
                WritingSampleRow.sample_id == old.sample_id,
            ).values(title="新标题", genre="report", text="新版🙂文字"))
            writer.commit()
        assert cached.title == "文章 1"
        fresh = repository.sample_summaries(owner)[1]
        assert (fresh["title"], fresh["genre"], fresh["character_count"]) == ("新标题", "report", 5)
        with Session(engine) as writer:
            writer.execute(update(WritingSampleRow).where(
                WritingSampleRow.sample_id == old.sample_id,
            ).values(user_id=str(other)))
            writer.execute(delete(WritingSampleRow).where(
                WritingSampleRow.sample_id == new.sample_id,
            ))
            writer.commit()
        # Owner transfer and deletion must take effect on the very next query.
        assert repository.sample_summaries(owner) == []
        assert [row["sample_id"] for row in repository.sample_summaries(other)] == [
            stranger.sample_id, old.sample_id,
        ]


@pytest.mark.parametrize("body_characters", [100, 10000, 100000])
def test_normal_list_transfers_only_metadata_at_max_sample_count(sample_store, body_characters):
    engine, returned, statements = sample_store
    owner, other = uuid4(), uuid4()
    with Session(engine) as session:
        for index in range(100):
            add_sample(session, owner, "文" * body_characters, index)
        add_sample(session, other, "不应读取" * 100000, 101)
        session.commit()
        returned.clear()
        statements.clear()
        result = samples(
            SimpleNamespace(user=SimpleNamespace(user_id=owner)),
            WritingApplication(SqliteWritingRepository(session)),
        )
        assert len(result["items"]) == 100
        assert all(row["character_count"] == body_characters for row in result["items"])
        assert len(statements) == 1
        assert len(returned) == 100
        assert all(len(row) == 6 and row[-1] is None for row in returned)
        text_bytes = sum(len(value.encode()) for row in returned for value in row
                         if isinstance(value, str))
        assert text_bytes < 10000
        assert not any(isinstance(row, WritingSampleRow) for row in session.identity_map.values())


def test_nul_fallback_is_per_row_and_never_exposed(sample_store):
    engine, returned, statements = sample_store
    owner = uuid4()
    body = "文" * 100000
    nul_body = "前\x00" + body + "🙂尾\x00"
    with Session(engine) as session:
        add_sample(session, owner, body, 1)
        nul_row = add_sample(session, owner, nul_body, 2)
        session.commit()
        returned.clear()
        statements.clear()
        result = samples(
            SimpleNamespace(user=SimpleNamespace(user_id=owner)),
            WritingApplication(SqliteWritingRepository(session)),
        )
        assert len(statements) == 1
        assert [row[-1] for row in returned] == [nul_body, None]
        assert result["items"][0] == sample_dict(nul_row)
        assert all("text" not in row and "nul_text" not in row for row in result["items"])


def test_http_samples_keep_auth_contract_owner_and_deletion(plain_client):
    client = plain_client
    assert client.get("/api/writing/samples").status_code == 401
    _authenticate(client)
    body = "正文🙂e\u0301\x00尾" * 30
    created = post(client, "/samples", {"title": "自己的样文", "genre": "essay", "text": body})
    assert created.status_code == 200, created.text
    item = created.json()
    assert item["character_count"] == len(body)
    response = client.get("/api/writing/samples")
    assert response.status_code == 200
    assert response.json() == {"items": [item]}
    assert client.delete(f"/api/writing/samples/{item['sample_id']}").status_code == 204
    assert client.get("/api/writing/samples").json() == {"items": []}
    other_item = post(client, "/samples", {
        "title": "私有", "genre": "report", "text": "不属于后一个账号的正文" * 20,
    }).json()
    _authenticate(client)
    assert client.get("/api/writing/samples").json() == {"items": []}
    assert client.delete(f"/api/writing/samples/{other_item['sample_id']}").status_code == 404
