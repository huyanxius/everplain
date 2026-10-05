"""Real 0620 -> 0630 file databases, cascading owners and interrupted DDL."""

import io
import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from legacy_migration_support import seed_conversation
from oauth_legacy_migration_support import LATER, STAMP, seed_account, seed_imports
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from test_oauth_forward_migration import config, copy_database, downgrade, snapshot, upgrade

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period, settle_quota_period
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings

PREVIOUS = "20261005_0620"
CANDIDATE = "20261005_0630"


@pytest.fixture(scope="module")
def federated_baseline(tmp_path_factory):
    path = tmp_path_factory.mktemp("federated-account-migration") / "legacy-0620.db"
    upgrade(config(path), PREVIOUS)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        local = seed_account(connection)
        federated = seed_account(connection, password_hash="!oauth-only")
        linked_local = seed_account(connection)
        unbound = seed_account(connection, password_hash="!oauth-only")
        accounts = [local, federated, linked_local, unbound]
        for account in accounts:
            account["imports"] = seed_imports(connection, account["owner"])
            seed_conversation(connection, UUID(account["owner"]), ["Retained private conversation"])
        for provider, subject, account, created in (
            ("google", "original-signup-subject", federated, STAMP),
            ("github", "later-explicit-binding", federated, LATER),
            ("google", "linked-local-subject", linked_local, STAMP),
        ):
            connection.execute(
                "INSERT INTO federated_identities(provider,subject,user_id,created_at) "
                "VALUES(?,?,?,?)",
                (provider, subject, account["owner"], created),
            )
        assert "login_mode" not in {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
    database = Database(f"sqlite:///{path}")
    try:
        now = datetime.now(UTC)
        with database.engine.connect() as connection:
            connection.execute(text("BEGIN IMMEDIATE"))
            period = ensure_quota_period(connection, federated["owner"], now - timedelta(hours=2))
            settle_quota_period(
                connection, federated["owner"], period["epoch"], 24, "6000000000000", now
            )
            ensure_quota_period(
                connection,
                federated["owner"],
                now,
                reset=True,
                receipt_id="synthetic-federated-reset",
            )
            connection.commit()
    finally:
        database.engine.dispose()
    return {
        "path": path,
        "local": local,
        "federated": federated,
        "linked_local": linked_local,
        "unbound": unbound,
        "snapshot": snapshot(path),
    }


def assert_forward_rows(before, after, seed):
    assert after["rows"].keys() == before["rows"].keys()
    converted = seed["federated"]["owner"]
    for name, values in before["rows"].items():
        if name == "users":
            expected = []
            for row in values:
                changed = list(row)
                if row[0] == converted:
                    changed[1] = None
                expected.append(
                    changed + ["federated" if row[0] == converted else "email_password"]
                )
            actual = {row[0]: row for row in after["rows"][name]}
            assert actual == {row[0]: row for row in expected}
        elif name == "federated_identities":
            expected = [
                row
                + [
                    seed["federated"]["email"]
                    if (row[2] == converted and row[3] == STAMP)
                    else None
                ]
                for row in values
            ]
            assert after["rows"][name] == expected
        elif name == "alembic_version":
            assert after["rows"][name] == [[CANDIDATE]]
        else:
            assert after["rows"][name] == values, name
    for name, definition in before["schema"].items():
        if name not in ("users", "federated_identities"):
            assert after["schema"][name] == definition, name
    assert not after["foreign_key_violations"] and after["integrity"] == "ok"


def test_0620_account_migration_preserves_owners_sessions_grants_quota_and_binary_data(
    federated_baseline, tmp_path
):
    seed = federated_baseline
    path = tmp_path / "candidate.db"
    copy_database(seed["path"], path)
    seen_drop = []

    def inspect_drop(connection, cursor, statement, parameters, context, executemany):
        if (
            str(connection.engine.url.database) == str(path)
            and statement.strip() == "DROP TABLE users"
        ):
            seen_drop.append(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one())
            assert connection.connection.driver_connection.in_transaction
            assert (
                connection.exec_driver_sql("SELECT COUNT(*) FROM user_sessions").scalar_one() == 4
            )

    event.listen(Engine, "before_cursor_execute", inspect_drop)
    try:
        upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, "before_cursor_execute", inspect_drop)
    assert seen_drop == [0]
    after = snapshot(path)
    assert_forward_rows(seed["snapshot"], after, seed)
    graph = ScriptDirectory.from_config(config(path))
    assert len(graph.get_heads()) == 1
    assert graph.get_revision(CANDIDATE).down_revision == PREVIOUS
    upgrade(config(path), CANDIDATE)
    assert snapshot(path) == after
    with pytest.raises(RuntimeError, match="restoring a backup to a new database"):
        downgrade(config(path), PREVIOUS)
    assert snapshot(path) == after
    database = Database(f"sqlite:///{path}")
    try:
        app = create_app(
            settings=Settings(
                _env_file=None, database_url=f"sqlite:///{path}", runtime_mode="mock"
            ),
            database=database,
            require_email_verification=False,
        )
        for name in ("local", "federated", "linked_local", "unbound"):
            account = seed[name]
            with app.state.identity_service_scope() as service:
                current = service.authenticate(account["credential"])
                assert current.user.user_id == UUID(account["owner"])
                assert current.session.session_id == UUID(account["session_id"])
        with database.engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            assert (
                connection.exec_driver_sql(
                    "SELECT SUM(points) FROM credit_ledger WHERE kind='signup_grant'"
                ).scalar_one()
                == 120
            )
            assert (
                connection.exec_driver_sql("SELECT COUNT(*) FROM import_attachments").scalar_one()
                == 12
            )
    finally:
        database.engine.dispose()
    assert snapshot(seed["path"]) == seed["snapshot"]


@pytest.mark.parametrize(
    "statement_prefix",
    [
        "ALTER TABLE federated_identities ADD COLUMN verified_email",
        "UPDATE federated_identities SET verified_email",
        "CREATE TABLE _alembic_tmp_users",
        "INSERT INTO _alembic_tmp_users",
        "DROP TABLE users",
        "ALTER TABLE _alembic_tmp_users RENAME TO users",
        "CREATE INDEX ix_users_role_status",
        "UPDATE users SET email = NULL",
        "COMMIT",
    ],
)
def test_interrupted_reconstruction_rolls_back_and_restores_fk_without_touching_old_copy(
    federated_baseline, tmp_path, statement_prefix
):
    seed = federated_baseline
    path = tmp_path / "interrupted.db"
    copy_database(seed["path"], path)
    restored = []

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        if str(connection.engine.url.database) == str(path) and " ".join(
            statement.split()
        ).startswith(statement_prefix):
            raise RuntimeError("synthetic reconstruction interruption")

    def check_restored(connection, cursor, statement, parameters, context, executemany):
        if (
            str(connection.engine.url.database) == str(path)
            and statement == "PRAGMA foreign_keys=ON"
        ):
            restored.append(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one())

    event.listen(Engine, "before_cursor_execute", interrupt)
    event.listen(Engine, "after_cursor_execute", check_restored)
    try:
        with pytest.raises(RuntimeError, match="synthetic reconstruction interruption"):
            upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, "before_cursor_execute", interrupt)
        event.remove(Engine, "after_cursor_execute", check_restored)
    assert restored == [1]
    assert snapshot(path) == seed["snapshot"]
    assert snapshot(seed["path"]) == seed["snapshot"]
    fresh = tmp_path / "fresh-copy.db"
    copy_database(seed["path"], fresh)
    upgrade(config(fresh), CANDIDATE)
    assert_forward_rows(seed["snapshot"], snapshot(fresh), seed)


def test_version_stamp_failure_retains_committed_schema_and_forbids_in_place_retry(
    federated_baseline, tmp_path
):
    seed = federated_baseline
    path = tmp_path / "stamp-interrupted.db"
    copy_database(seed["path"], path)

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        if str(connection.engine.url.database) == str(path) and statement.startswith(
            "UPDATE alembic_version"
        ):
            raise RuntimeError("synthetic stamp interruption")

    event.listen(Engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="synthetic stamp interruption"):
            upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, "before_cursor_execute", interrupt)
    committed = snapshot(path)
    assert committed["rows"]["alembic_version"] == [[PREVIOUS]]
    expected = dict(committed)
    expected["rows"] = committed["rows"] | {"alembic_version": [[CANDIDATE]]}
    assert_forward_rows(seed["snapshot"], expected, seed)
    from sqlalchemy.exc import OperationalError

    with pytest.raises(OperationalError, match="duplicate column name: verified_email"):
        upgrade(config(path), CANDIDATE)
    assert snapshot(path) == committed
    assert snapshot(seed["path"]) == seed["snapshot"]


def test_login_method_constraints_and_unique_optional_emails(federated_baseline, tmp_path):
    seed = federated_baseline
    path = tmp_path / "constraints.db"
    copy_database(seed["path"], path)
    upgrade(config(path), CANDIDATE)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        for query, args in (
            ("UPDATE users SET email=NULL WHERE user_id=?", (seed["local"]["owner"],)),
            ("UPDATE users SET login_mode='invalid' WHERE user_id=?", (seed["local"]["owner"],)),
            ("UPDATE users SET login_mode='federated' WHERE user_id=?", (seed["local"]["owner"],)),
            (
                "UPDATE users SET login_mode='email_password' WHERE user_id=?",
                (seed["federated"]["owner"],),
            ),
            (
                "UPDATE users SET email=? WHERE user_id=?",
                (seed["local"]["email"], seed["linked_local"]["owner"]),
            ),
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(query, args)
        connection.execute(
            "UPDATE users SET email=NULL,login_mode='federated' WHERE user_id=?",
            (seed["unbound"]["owner"],),
        )
        assert connection.execute("SELECT COUNT(*) FROM users WHERE email IS NULL").fetchone() == (
            2,
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_0630_offline_range_fails_closed_without_unverified_reconstruction(tmp_path, monkeypatch):
    path = tmp_path / "never-created.db"
    cfg = config(path)
    output = io.StringIO()
    cfg.output_buffer = output
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{path}")
    with pytest.raises(RuntimeError, match="online SQLite connection"):
        command.upgrade(cfg, f"{PREVIOUS}:{CANDIDATE}", sql=True)
    assert "CREATE TABLE _alembic_tmp_users" not in output.getvalue()
    assert "ALTER TABLE federated_identities" not in output.getvalue()
    assert not path.exists()


def test_process_exit_after_users_drop_recovers_sqlite_transaction(federated_baseline, tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    seed = federated_baseline
    path = tmp_path / "process-interrupted.db"
    copy_database(seed["path"], path)
    script = """
import os, sys
from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.engine import Engine
os.environ['EVERPLAIN_DATABASE_URL'] = 'sqlite:///' + sys.argv[1]
def terminate(connection, cursor, statement, parameters, context, executemany):
    if statement.strip() == 'DROP TABLE users':
        assert connection.connection.driver_connection.in_transaction
        os._exit(23)
event.listen(Engine, 'after_cursor_execute', terminate)
command.upgrade(Config(sys.argv[2]), '20261005_0630')
raise AssertionError('The users drop interruption was never reached')
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, str(path), str(Path(__file__).parents[1] / "alembic.ini")],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode == 23, completed.stderr
    assert snapshot(path) == seed["snapshot"]
    assert snapshot(seed["path"]) == seed["snapshot"]
    fresh = tmp_path / "fresh-after-process-exit.db"
    copy_database(seed["path"], fresh)
    upgrade(config(fresh), CANDIDATE)
    assert_forward_rows(seed["snapshot"], snapshot(fresh), seed)


def test_unreviewed_users_trigger_fails_before_schema_change(federated_baseline, tmp_path):
    path = tmp_path / "unreviewed-trigger.db"
    copy_database(federated_baseline["path"], path)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TRIGGER synthetic_user_hook AFTER UPDATE ON users BEGIN SELECT 1; END"
        )
    before = snapshot(path)
    with pytest.raises(RuntimeError, match="Unreviewed users triggers"):
        upgrade(config(path), CANDIDATE)
    assert snapshot(path) == before


def test_existing_named_user_checks_survive_online_reflection(federated_baseline, tmp_path):
    seed = federated_baseline
    path = tmp_path / "historical-named-checks.db"
    copy_database(seed["path"], path)
    # Some historical installations carry these model-level checks. Prepare
    # that real SQLite variant without enabling cascades during fixture copy.
    with sqlite3.connect(path, isolation_level=None) as connection:
        sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()[0]
        checked = sql.replace("CREATE TABLE users", "CREATE TABLE checked_users", 1)
        checked = checked[:-1] + (
            ", CONSTRAINT ck_users_role CHECK(role IN ('member','admin'))"
            ", CONSTRAINT ck_users_status CHECK(status IN ('active','disabled','deactivated'))"
            ", CONSTRAINT ck_users_version CHECK(version >= 1))"
        )
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(checked)
        connection.execute("INSERT INTO checked_users SELECT * FROM users")
        connection.execute("DROP TABLE users")
        connection.execute("ALTER TABLE checked_users RENAME TO users")
        connection.execute("CREATE INDEX ix_users_role_status ON users (role, status)")
        connection.execute("COMMIT")
        connection.execute("PRAGMA foreign_keys=ON")
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    before = snapshot(path)
    upgrade(config(path), CANDIDATE)
    after = snapshot(path)
    assert_forward_rows(before, after, seed)
    with sqlite3.connect(path) as connection:
        sql = connection.execute("SELECT sql FROM sqlite_master WHERE name='users'").fetchone()[0]
        for name in ("ck_users_role", "ck_users_status", "ck_users_version"):
            assert name in sql
        for assignment in ("role='invalid'", "status='invalid'", "version=0"):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(f"UPDATE users SET {assignment}")


def test_existing_fk_violation_fails_before_any_schema_change(federated_baseline, tmp_path):
    path = tmp_path / "existing-fk-violation.db"
    copy_database(federated_baseline["path"], path)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute(
            "UPDATE user_sessions SET user_id='synthetic-missing-owner' WHERE session_id=?",
            (federated_baseline["local"]["session_id"],),
        )
    before = snapshot(path)
    assert before["foreign_key_violations"]
    with pytest.raises(RuntimeError, match="foreign-key violation"):
        upgrade(config(path), CANDIDATE)
    assert snapshot(path) == before
