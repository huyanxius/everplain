"""Synthetic 0615 -> 0620 preservation and interrupted SQLite-DDL boundaries."""

import base64
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from argon2 import PasswordHasher
from oauth_legacy_migration_support import PASSWORD, seed_account, seed_imports
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period, settle_quota_period

SOURCE = Path(__file__).resolve().parents[2]
PREVIOUS = "20261005_0615"
CANDIDATE = "20261005_0620"
ADDED_TABLES = {"federated_identities", "oauth_transactions"}


def config(path):
    cfg = Config(str(SOURCE / "backend/alembic.ini"))
    cfg.attributes["synthetic_database_url"] = f"sqlite:///{path}"
    return cfg


def upgrade(cfg, target):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setenv("EVERPLAIN_DATABASE_URL", cfg.attributes["synthetic_database_url"])
        command.upgrade(cfg, target)


def downgrade(cfg, target):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setenv("EVERPLAIN_DATABASE_URL", cfg.attributes["synthetic_database_url"])
        command.downgrade(cfg, target)


def encode(value):
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode()}
    return value


def snapshot(path):
    with sqlite3.connect(path) as conn:
        schema = {
            name: {"type": kind, "table": table, "sql": sql}
            for kind, name, table, sql in conn.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
            )
        }
        rows = {}
        for name, definition in schema.items():
            if definition["type"] != "table":
                continue
            values = [
                [encode(value) for value in row] for row in conn.execute(f'SELECT * FROM "{name}"')
            ]
            rows[name] = sorted(values, key=lambda row: json.dumps(row, sort_keys=True))
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    return {
        "schema": schema,
        "rows": rows,
        "foreign_key_violations": violations,
        "integrity": integrity,
    }


def copy_database(source, destination):
    with sqlite3.connect(source) as old, sqlite3.connect(destination) as new:
        old.backup(new)


@pytest.fixture(scope="module")
def seeded_baseline(tmp_path_factory):
    evidence = tmp_path_factory.mktemp("oauth-forward")
    path = evidence / "synthetic-baseline-0615.db"
    assert not path.exists(), (
        "Run in a fresh evidence directory or remove only your synthetic audit files"
    )
    cfg = config(path)
    upgrade(cfg, PREVIOUS)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        seed = seed_account(connection)
        imports = seed_imports(connection, seed["owner"])
        assert "login_mode" not in {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
    owner = seed["owner"]
    database = Database(f"sqlite:///{path}")
    now = datetime.now(UTC)
    with database.engine.connect() as conn:
        conn.execute(text("BEGIN IMMEDIATE"))
        epoch1 = ensure_quota_period(conn, owner, now - timedelta(hours=2))
        settle_quota_period(
            conn, owner, epoch1["epoch"], 24, "6000000000000", now - timedelta(hours=1)
        )
        epoch2 = ensure_quota_period(
            conn, owner, now, reset=True, receipt_id="synthetic-reset-receipt"
        )
        assert epoch2["epoch"] == 2 and epoch2["balance"] == 30
        conn.commit()
    with database.engine.connect() as conn:
        assert (
            conn.scalar(text("SELECT sum(points) FROM credit_ledger WHERE kind='signup_grant'"))
            == 30
        )
        assert conn.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 3
        assert conn.scalar(text("SELECT count(*) FROM billing_precision_adjustments")) == 2
        assert conn.scalar(text("SELECT count(*) FROM import_attachments")) == 3
        assert conn.scalar(text("SELECT count(*) FROM import_sources")) == 1
    database.engine.dispose()
    old = snapshot(path)
    assert not old["foreign_key_violations"] and old["integrity"] == "ok"
    assert old["rows"]["alembic_version"] == [[PREVIOUS]]
    assert not ADDED_TABLES.intersection(old["rows"])
    return seed | {"path": path, "imports": imports, "snapshot": old}


def test_real_0615_to_0620_preserves_every_old_row_and_schema(seeded_baseline):
    seed = seeded_baseline
    evidence = seed["path"].parent
    path = evidence / "synthetic-upgraded-0620.db"
    copy_database(seed["path"], path)
    cfg = config(path)
    graph = ScriptDirectory.from_config(cfg)
    assert len(graph.get_heads()) == 1
    assert graph.get_revision(CANDIDATE).down_revision == PREVIOUS
    upgrade(cfg, CANDIDATE)
    new = snapshot(path)
    before = seed["snapshot"]
    assert set(new["rows"]) - set(before["rows"]) == ADDED_TABLES
    assert set(before["rows"]) - set(new["rows"]) == set()
    for name, definition in before["schema"].items():
        assert new["schema"][name] == definition, name
    for name, rows in before["rows"].items():
        expected = [[CANDIDATE]] if name == "alembic_version" else rows
        assert new["rows"][name] == expected, name
    assert new["rows"]["federated_identities"] == []
    assert new["rows"]["oauth_transactions"] == []
    assert not new["foreign_key_violations"] and new["integrity"] == "ok"
    upgrade(cfg, CANDIDATE)
    assert snapshot(path) == new
    with pytest.raises(RuntimeError, match="restoring a backup to a new database"):
        downgrade(cfg, PREVIOUS)
    assert snapshot(path) == new
    with sqlite3.connect(path) as connection:
        assert PasswordHasher().verify(seed["password_hash"], PASSWORD)
        assert connection.execute(
            "SELECT user_id,revoked_at FROM user_sessions WHERE session_id=?",
            (seed["session_id"],),
        ).fetchone() == (seed["owner"], None)
        for attachment, content in seed["imports"]["assets"].items():
            assert connection.execute(
                "SELECT content FROM import_attachments WHERE id=?", (attachment,)
            ).fetchone() == (content,)
        assert connection.execute(
            "SELECT status FROM import_items WHERE id=?",
            (seed["imports"]["batches"][1]["item"],),
        ).fetchone() == ("queued",)
    assert snapshot(seed["path"]) == before, "the untouched old baseline must remain unchanged"


@pytest.mark.parametrize(
    "fail_at,expected_added",
    [
        ("before_first_table", set()),
        ("after_identity_table", {"federated_identities"}),
        ("after_identity_index", {"federated_identities"}),
        ("after_oauth_table", ADDED_TABLES),
        ("before_version_stamp", ADDED_TABLES),
    ],
)
def test_failure_boundary_retains_old_data_but_partial_ddl_requires_fresh_copy(
    seeded_baseline, fail_at, expected_added
):
    seed = seeded_baseline
    evidence = seed["path"].parent
    path = evidence / f"synthetic-failure-{fail_at}.db"
    copy_database(seed["path"], path)
    cfg = config(path)
    targets = {
        "before_first_table": "CREATE TABLE federated_identities",
        "after_identity_table": "CREATE INDEX ix_federated_identities_user_id",
        "after_identity_index": "CREATE TABLE oauth_transactions",
        "after_oauth_table": "CREATE INDEX ix_oauth_transactions_expiry",
        "before_version_stamp": "UPDATE alembic_version",
    }

    def inject(conn, cursor, statement, parameters, context, executemany):
        if str(conn.engine.url.database) == str(path) and " ".join(statement.split()).startswith(
            targets[fail_at]
        ):
            raise RuntimeError("synthetic DDL interruption " + fail_at)

    event.listen(Engine, "before_cursor_execute", inject)
    try:
        with pytest.raises(RuntimeError, match="synthetic DDL interruption"):
            upgrade(cfg, CANDIDATE)
    finally:
        event.remove(Engine, "before_cursor_execute", inject)
    actual = snapshot(path)
    old = seed["snapshot"]
    assert set(actual["rows"]) - set(old["rows"]) == expected_added
    for name, rows in old["rows"].items():
        assert actual["rows"][name] == rows, name
    for name, definition in old["schema"].items():
        assert actual["schema"][name] == definition, name
    assert not actual["foreign_key_violations"] and actual["integrity"] == "ok"
    if expected_added:
        with pytest.raises(OperationalError, match="federated_identities already exists"):
            upgrade(cfg, CANDIDATE)
        assert snapshot(path) == actual
    else:
        upgrade(cfg, CANDIDATE)
    assert snapshot(seed["path"]) == old
    fresh = evidence / f"synthetic-retry-fresh-{fail_at}.db"
    copy_database(seed["path"], fresh)
    upgrade(config(fresh), CANDIDATE)
    assert snapshot(fresh)["rows"]["alembic_version"] == [[CANDIDATE]]


def test_new_identity_constraints_match_declared_binding_invariants(seeded_baseline):
    evidence = seeded_baseline["path"].parent
    path = evidence / "synthetic-constraints-0620.db"
    copy_database(seeded_baseline["path"], path)
    upgrade(config(path), CANDIDATE)
    database = Database(f"sqlite:///{path}")
    owner = seeded_baseline["owner"]
    insert = text(
        "INSERT INTO federated_identities(provider,subject,user_id,created_at) "
        "VALUES(:p,:s,:u,:now)"
    )
    with database.engine.begin() as conn:
        conn.execute(
            insert,
            {
                "p": "google",
                "s": "synthetic-google-subject",
                "u": owner,
                "now": "2026-10-05T00:00:00+00:00",
            },
        )
        conn.execute(
            insert,
            {
                "p": "github",
                "s": "synthetic-github-subject",
                "u": owner,
                "now": "2026-10-05T00:00:00+00:00",
            },
        )
    invalid = [
        ("google", "another-subject", owner, "one binding per user/provider"),
        ("google", "synthetic-google-subject", owner, "provider/subject primary key"),
        ("untrusted", "subject", owner, "provider allowlist"),
        ("github", "missing-owner-subject", str(uuid4()), "owner foreign key"),
    ]
    for provider, subject, user_id, _reason in invalid:
        with pytest.raises(IntegrityError), database.engine.begin() as conn:
            conn.execute(
                insert,
                {"p": provider, "s": subject, "u": user_id, "now": "2026-10-05T00:00:00+00:00"},
            )
    with database.engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM federated_identities")) == 2
        assert not conn.execute(text("PRAGMA foreign_key_check")).all()
        assert (
            conn.scalar(
                text("SELECT count(*) FROM sqlite_master WHERE name='ix_oauth_transactions_expiry'")
            )
            == 1
        )
    database.engine.dispose()
