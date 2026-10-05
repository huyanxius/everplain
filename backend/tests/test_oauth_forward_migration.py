"""Synthetic 0615 -> 0620 preservation and interrupted SQLite-DDL boundaries."""

import base64
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period, settle_quota_period
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings

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


def start_import(client, files):
    response = client.post(
        "/api/imports",
        data={"source_type": "obsidian"},
        files=[("files", (name, body, "application/octet-stream")) for name, body in files],
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 202, response.text
    return response.json()


@pytest.fixture(scope="module")
def seeded_baseline(tmp_path_factory):
    evidence = tmp_path_factory.mktemp("oauth-forward")
    path = evidence / "synthetic-baseline-0615.db"
    assert not path.exists(), (
        "Run in a fresh evidence directory or remove only your synthetic audit files"
    )
    cfg = config(path)
    upgrade(cfg, PREVIOUS)
    database = Database(f"sqlite:///{path}")
    settings = Settings(_env_file=None, database_url=f"sqlite:///{path}", runtime_mode="mock")
    app = create_app(settings=settings, database=database, require_email_verification=False)
    app.state.import_worker_enabled = False
    with TestClient(app) as client:
        registered = client.post(
            "/api/session/register",
            json={"email": "migration-owner@example.test", "password": "synthetic-passphrase-only"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert registered.status_code == 201, registered.text
        owner = registered.json()["user"]["user_id"]
        session_id = registered.json()["session_id"]
        credential = client.cookies.get(settings.session_cookie_name)
        ready = start_import(
            client,
            [
                (
                    "Vault/notes/A.md",
                    "# A\n![[图.png]] [report](../assets/report.pdf)\nSynthetic text".encode(),
                ),
                ("Vault/assets/图.png", b"\x89PNG\r\n\x00\xff\xfe"),
                ("Vault/assets/report.pdf", b"%PDF synthetic fixture\x00\xff"),
            ],
        )
        for _ in range(30):
            if not app.state.run_import_once():
                break
        else:
            raise AssertionError("synthetic import queue did not drain")
        ready = client.get("/api/imports/" + ready["id"]).json()
        assert ready["status"] == "completed" and ready["imported"] == 1
        assert ready["attachment_count"] == 2
        asset_urls = [attachment["url"] for attachment in ready["items"][0]["attachments"]]
        asset_bodies = [client.get(url).content for url in asset_urls]
        queued = start_import(
            client,
            [
                ("Vault/notes/B.md", b"# B\n![[queued.png]]\nQueued synthetic text"),
                ("Vault/assets/queued.png", b"\x00queued attachment\xff"),
            ],
        )
        assert queued["status"] == "processing" and queued["attachment_count"] == 1
        assert queued["items"][0]["status"] == "queued"
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
    return {
        "path": path,
        "owner": owner,
        "session_id": session_id,
        "credential": credential,
        "asset_urls": asset_urls,
        "asset_bodies": asset_bodies,
        "queued": queued,
        "snapshot": old,
    }


def test_real_0615_to_0620_preserves_every_old_row_and_schema(seeded_baseline):
    seed = seeded_baseline
    evidence = seed["path"].parent
    path = evidence / "synthetic-upgraded-0620.db"
    copy_database(seed["path"], path)
    cfg = config(path)
    graph = ScriptDirectory.from_config(cfg)
    assert graph.get_heads() == [CANDIDATE]
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
    upgrade(cfg, "head")
    assert snapshot(path) == new
    with pytest.raises(RuntimeError, match="restoring a backup to a new database"):
        downgrade(cfg, PREVIOUS)
    assert snapshot(path) == new
    database = Database(f"sqlite:///{path}")
    settings = Settings(_env_file=None, database_url=f"sqlite:///{path}", runtime_mode="mock")
    app = create_app(settings=settings, database=database, require_email_verification=False)
    app.state.import_worker_enabled = False
    with app.state.identity_service_scope() as service:
        authenticated = service.authenticate(seed["credential"])
        assert authenticated.user.user_id == UUID(seed["owner"])
        assert authenticated.session.session_id == UUID(seed["session_id"])
    with database.engine.connect() as conn:
        password_hash = conn.scalar(
            text("SELECT password_hash FROM users WHERE user_id=:u"), {"u": seed["owner"]}
        )
        assert PasswordHasher().verify(password_hash, "synthetic-passphrase-only")
        assert (
            conn.scalar(
                text("SELECT quota_period_epoch FROM credit_accounts WHERE user_id=:u"),
                {"u": seed["owner"]},
            )
            == 2
        )
        assert (
            conn.scalar(text("SELECT sum(points) FROM credit_ledger WHERE kind='signup_grant'"))
            == 30
        )
    with TestClient(app) as client:
        client.cookies.set(settings.session_cookie_name, seed["credential"])
        for url, body in zip(seed["asset_urls"], seed["asset_bodies"], strict=True):
            assert client.get(url).content == body
        queued = client.get("/api/imports/" + seed["queued"]["id"])
        assert queued.status_code == 200 and queued.json()["status"] == seed["queued"]["status"]
        assert queued.json()["items"][0]["status"] == "queued"
    database.engine.dispose()
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
