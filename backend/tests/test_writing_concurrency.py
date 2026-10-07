from uuid import uuid4

import pytest
from sqlalchemy import select
from test_research_material_api import _authenticate
from test_writing import doc, pipeline, proposal

from qunxue_api.adapters.sqlite.writing import (
    SqliteWritingRepository,
    WritingOperationRow,
    WritingRevisionRow,
)
from qunxue_api.application.writing import WritingApplication
from qunxue_api.modules.writing import WritingConflict


@pytest.mark.parametrize("late_decision", ["accept", "reject"])
def test_cached_pending_revision_cannot_overwrite_committed_rejection(plain_client, late_decision):
    """Interleave two real SQLite sessions after both have observed pending."""
    client = plain_client
    _authenticate(client)
    document = doc(client)
    pipeline(client, ["计划", "共有12个观察点。[^来源]"])
    revision = proposal(client, document).json()
    user_id = client.get("/api/session").json()["user"]["user_id"]
    database = client.app.state.database

    with database.session() as late_session:
        late_repository = SqliteWritingRepository(late_session)
        before = late_repository.get(user_id, document["document_id"])
        cached = late_session.scalar(
            select(WritingRevisionRow).where(
                WritingRevisionRow.revision_id == revision["revision_id"]
            )
        )
        assert cached.status == "pending"
        with database.session() as first_session:
            first_repository = SqliteWritingRepository(first_session)
            WritingApplication(first_repository).resolve_revision(
                user_id, document["document_id"], revision["revision_id"], str(uuid4()),
                {"decision": "reject", "expected_version": 1},
            )
        # The other request committed, but this session still holds its earlier
        # pending observation. An ordinary ORM assignment must not win the race.
        assert cached.status == "pending"
        late_key = str(uuid4())
        with pytest.raises(WritingConflict):
            WritingApplication(late_repository).resolve_revision(
                user_id, document["document_id"], revision["revision_id"], late_key,
                {"decision": late_decision, "expected_version": 1},
            )
        late_session.rollback()

    with database.session() as session:
        repository = SqliteWritingRepository(session)
        assert repository.get(user_id, document["document_id"]) == before
        assert repository.revisions(user_id, document["document_id"])[0]["status"] == "rejected"
        assert session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.request_key == late_key,
        )) is None


@pytest.mark.parametrize("command,fail_at", [
    ("save", "document"), ("accept", "document"),
    ("accept", "revision"), ("reject", "revision"),
    ("save", "complete"), ("accept", "complete"), ("reject", "complete"),
])
def test_command_sql_cas_and_complete_failures_roll_back_every_write(
    plain_client, command, fail_at,
):
    """Real SQLite triggers force zero-row CAS/complete, not mocked repository errors."""
    c = plain_client
    owner = _authenticate(c)["user"]["user_id"]
    document = doc(c, "😀原稿\r\n[[原链接]]\n- [ ] 保留")
    database = c.app.state.database
    key, expired_key = str(uuid4()), str(uuid4())
    with database.session() as session:
        repo = SqliteWritingRepository(session)
        document = repo.get(owner, document["document_id"])
        revision = repo.add_revision(owner, document, action="rewrite",
                                     after_markdown="😀建议\r\n[[原链接]]", warnings=[])
        target = (f"document:update:{document['document_id']}" if command == "save" else
                  f"revision:resolve:{document['document_id']}:{revision['revision_id']}")
        # start's expired-claim cleanup is itself part of the same transaction.
        session.add(WritingOperationRow(
            operation_id=str(uuid4()), user_id=owner, request_key=expired_key,
            request_hash="0" * 64, target=target, status="running", result=None,
            created_at="2020-01-01T00:00:00+00:00",
        ))
        table, column, condition = {
            "document": ("writing_documents", "version", "1"),
            "revision": ("writing_revisions", "status", "NEW.status IN ('accepted', 'rejected')"),
            "complete": ("writing_operations", "status", "NEW.status = 'completed'"),
        }[fail_at]
        session.connection().exec_driver_sql(
            f"CREATE TRIGGER fail_command BEFORE UPDATE OF {column} ON {table} "
            f"WHEN {condition} BEGIN SELECT RAISE(IGNORE); END"
        )
    expected_message = {
        "document": "文稿已更新，请刷新后重试；你的修改没有覆盖原文",
        "revision": "这条修订已处理或过期，请刷新后查看",
        "complete": "生成请求已过期，结果未覆盖原文，请重新生成",
    }[fail_at]
    with pytest.raises(WritingConflict, match=expected_message), c.app.state.writing_scope() as app:
        if command == "save":
            app.save_document(owner, document["document_id"], key,
                              {"expected_version": 1, "markdown": "不能留下的正文"})
        else:
            app.resolve_revision(owner, document["document_id"], revision["revision_id"], key,
                                 {"expected_version": 1, "decision": command})
    with database.session() as session:
        repo = SqliteWritingRepository(session)
        assert repo.get(owner, document["document_id"]) == document
        assert repo.revisions(owner, document["document_id"]) == [revision]
        assert session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.request_key == key,
        )) is None
        expired = session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.request_key == expired_key,
        ))
        assert expired.status == "running" and expired.result is None


@pytest.mark.parametrize("decision", ["accept", "reject"])
@pytest.mark.parametrize("run_state", ["running", "cancelled", "expired", "ready", "completed"])
def test_resolution_eligibility_is_checked_after_write_reservation_until_scope_commit(
    plain_client, monkeypatch, decision, run_state,
):
    import sqlite3
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update
    from test_writing_preview_journal import append, body, seed

    from qunxue_api.adapters.sqlite import AgentRunRow

    c = plain_client
    owner, document, run = seed(c)
    database = c.app.state.database
    key = str(uuid4())
    with database.session() as session:
        document = SqliteWritingRepository(session).get(owner, document["document_id"])
    with c.app.state.writing_scope() as app:
        revision = app.propose_agent_edit(
            owner, document["document_id"], run.run_id,
            {"expected_version": 1, "original_text": "重复。", "replacement_text": "**建议😀**",
             "selection_start": 5, "selection_end": 8},
            execution_fence={"run_id": str(run.run_id), "lease_token": run.lease_token},
        )
    if run_state == "ready":
        assert append(c, owner, run, body(
            document, run, state="ready", revision_id=revision["revision_id"],
            replacement_text="**建议😀**",
        )) is not None
    if run_state != "running":
        changes = {
            "cancelled": {"cancel_requested": True},
            "expired": {"lease_expires_at": datetime.now(UTC) - timedelta(seconds=1)},
            "ready": {"status": "interrupted", "cancel_requested": True,
                      "lease_expires_at": datetime.now(UTC) - timedelta(seconds=1)},
            "completed": {"status": "completed", "lease_expires_at": None},
        }[run_state]
        with database.session() as session:
            session.execute(update(AgentRunRow).where(
                AgentRunRow.run_id == str(run.run_id),
            ).values(**changes))
    checked = []
    original = SqliteWritingRepository._abandoned_agent_revision

    def check_reserved(repository, row):
        # SQLite SELECT alone does not acquire this reservation. A second real
        # connection cannot write while the command checks owner/lease/pending.
        connection = repository.session.connection().connection.driver_connection
        assert connection.in_transaction
        claim = repository.session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.request_key == key,
        ))
        assert claim is not None and claim.status == "running"
        other = sqlite3.connect(database.engine.url.database, timeout=0)
        try:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                other.execute("UPDATE writing_operations SET status = status WHERE request_key = ?",
                              (key,))
        finally:
            other.close()
        checked.append(row.revision_id)
        return original(repository, row)

    monkeypatch.setattr(SqliteWritingRepository, "_abandoned_agent_revision", check_reserved)
    allowed = run_state in {"running", "ready", "completed"}
    if allowed:
        with c.app.state.writing_scope() as app:
            result = app.resolve_revision(
                owner, document["document_id"], revision["revision_id"], key,
                {"expected_version": 1, "decision": decision},
            )
            assert result["revision"]["status"] == (
                "accepted" if decision == "accept" else "rejected"
            )
            # complete has run, but none of the command is visible until scope exit.
            with database.session() as observer:
                repo = SqliteWritingRepository(observer)
                assert repo.get(owner, document["document_id"]) == document
                assert repo.revisions(owner, document["document_id"]) == [revision]
                assert observer.scalar(select(WritingOperationRow).where(
                    WritingOperationRow.request_key == key,
                )) is None
    else:
        with (
            pytest.raises(WritingConflict, match="已处理、取消或过期"),
            c.app.state.writing_scope() as app,
        ):
            app.resolve_revision(owner, document["document_id"], revision["revision_id"], key,
                                 {"expected_version": 1, "decision": decision})
    assert checked == [revision["revision_id"]]
    with database.session() as session:
        repo = SqliteWritingRepository(session)
        saved = repo.get(owner, document["document_id"])
        assert saved["markdown"] == (
            revision["after_markdown"] if allowed and decision == "accept" else document["markdown"]
        )
        assert saved["version"] == (2 if allowed and decision == "accept" else 1)
        assert repo.revisions(owner, document["document_id"])[0]["status"] == (
            ("accepted" if decision == "accept" else "rejected") if allowed else "pending"
        )
        receipt = session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.request_key == key,
        ))
        if allowed:
            assert receipt.status == "completed" and receipt.result == result
        else:
            assert receipt is None
