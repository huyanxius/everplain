"""Real 0630 -> 0640 preservation, interrupted DDL and forward-only recovery."""

import hashlib
import io
import sqlite3
import subprocess
import sys
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from legacy_migration_support import seed_conversation
from oauth_legacy_migration_support import STAMP, seed_account, seed_imports, seed_quota_history
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from test_oauth_forward_migration import config, copy_database, downgrade, snapshot, upgrade

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings

PREVIOUS = "20261005_0630"
CANDIDATE = "20261005_0640"
ADDED = {
    "credit_redemption_codes": [("plan_id", "VARCHAR(64)", 0, None),
                                ("action", "VARCHAR(24)", 1, "'bank_reset'")],
    "subscriptions": [("current_period_start", "DATETIME", 0, None)],
}


def old_cell_bytes(path, columns=None):
    """Compare SQLite types and complete text/blob bytes, including embedded NULs."""
    with sqlite3.connect(path) as connection:
        if columns is None:
            columns = {
                name: [row[1] for row in connection.execute(f'PRAGMA table_info("{name}")')]
                for (name,) in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%' AND name!='alembic_version'"
                )
            }
        rows = {}
        for table, names in columns.items():
            projection = ",".join(
                f'typeof("{name}"),hex(CAST("{name}" AS BLOB))' for name in names
            )
            rows[table] = sorted(connection.execute(f'SELECT {projection} FROM "{table}"'))
    return columns, rows


@pytest.fixture(scope="module")
def membership_baseline(tmp_path_factory):
    path = tmp_path_factory.mktemp("membership-voucher-migration") / "legacy-0630.db"
    upgrade(config(path), PREVIOUS)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        owner = seed_account(connection)
        provider = seed_account(connection, password_hash="!oauth-only")
        connection.execute(
            "UPDATE users SET email=NULL,login_mode='federated' WHERE user_id=?",
            (provider["owner"],),
        )
        connection.execute(
            "INSERT INTO federated_identities(provider,subject,user_id,created_at,verified_email) "
            "VALUES ('google','synthetic-subject',?,?,?)",
            (provider["owner"], STAMP, provider["email"]),
        )
        imports = []
        for account in (owner, provider):
            imports.append(seed_imports(connection, account["owner"]))
            seed_conversation(connection, UUID(account["owner"]), ["保留原文\x00\nline two"])
        seed_quota_history(connection, owner["owner"])
        codes = []
        for index, state in enumerate(("unused", "redeemed", "expired")):
            code = str(uuid4())
            codes.append(code)
            connection.execute(
                "INSERT INTO credit_redemption_codes(code_id,code_hash,batch_id,code_index,"
                "created_by_user_id,created_at,expires_at,redeemed_by_user_id,redeemed_at) "
                "VALUES (?,?,'synthetic-old-batch',?,?,?,?,?,?)",
                (code, hashlib.sha256(code.encode()).hexdigest(), index, owner["owner"], STAMP,
                 "2026-10-03" if state == "expired" else "2099-10-05",
                 owner["owner"] if state == "redeemed" else None,
                 STAMP if state == "redeemed" else None),
            )
        for index, (status, plan, end) in enumerate((
            ("active", "historical-pro", "2099-11-02 00:00:00.000000"),
            ("trialing", None, None),
            ("canceled", "historical-basic", "2026-10-01 00:00:00.000000"),
        )):
            connection.execute(
                "INSERT INTO subscriptions(provider_id,user_id,customer_id,plan_id,status,"
                "current_period_end,cancel_at_period_end,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (f"synthetic-sub-{index}", owner["owner"], "synthetic-customer", plan,
                 status, end, int(status == "canceled"), STAMP),
            )
        connection.execute(
            "INSERT INTO subscription_checkouts(key,user_id,plan_id,price_id,success_url,"
            "cancel_url,created_at,session_id,checkout_url) "
            "VALUES ('synthetic-checkout',?,'historical-pro','synthetic-price',"
            "'https://example.test/success','https://example.test/cancel',?,"
            "'synthetic-session','https://example.test/checkout')",
            (owner["owner"], STAMP),
        )
        connection.execute(
            "INSERT INTO subscription_webhook_events(event_id,event_type,processed_at) "
            "VALUES ('synthetic-event','customer.subscription.updated',?)", (STAMP,)
        )
        connection.execute(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,hold_points,"
            "exempt,price_json,credit_pico,original_credit_pico,charged_points,created_at,"
            "updated_at,quota_period_epoch) VALUES ('synthetic-run',?,'old-fingerprint',"
            "'settled',0,0,'{\"original\": true}','6000000000000','6000000000000',6,?,?,1)",
            (owner["owner"], STAMP, STAMP),
        )
        connection.execute(
            "CREATE TRIGGER synthetic_redemption_hook AFTER UPDATE ON credit_redemption_codes "
            "BEGIN SELECT 1; END"
        )
        connection.execute(
            "CREATE INDEX synthetic_subscription_status ON subscriptions(status,current_period_end)"
        )
    before = snapshot(path)
    assert not before["foreign_key_violations"] and before["integrity"] == "ok"
    return {"path": path, "snapshot": before, "cells": old_cell_bytes(path),
            "accounts": [owner, provider], "imports": imports, "codes": codes}


def assert_preserved(seed, path, *, stamped=True):
    before, after = seed["snapshot"], snapshot(path)
    assert before["rows"].keys() == after["rows"].keys()
    assert before["schema"].keys() == after["schema"].keys()
    for name, rows in before["rows"].items():
        if name == "credit_redemption_codes":
            assert after["rows"][name] == [row + [None, "bank_reset"] for row in rows]
        elif name == "subscriptions":
            assert after["rows"][name] == [row + [None] for row in rows]
        elif name == "alembic_version":
            assert after["rows"][name] == [[CANDIDATE if stamped else PREVIOUS]]
        else:
            assert after["rows"][name] == rows, name
    for name, definition in before["schema"].items():
        if name not in ADDED:
            assert after["schema"][name] == definition, name
    assert old_cell_bytes(path, seed["cells"][0]) == seed["cells"]
    assert not after["foreign_key_violations"] and after["integrity"] == "ok"
    with sqlite3.connect(path) as connection:
        for table, added in ADDED.items():
            info = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
            assert [(row[1], row[2], row[3], row[4]) for row in info[-len(added):]] == added
    assert snapshot(seed["path"]) == before


def test_upgrade_retains_old_codes_redemptions_sessions_attachments_and_financial_evidence(
    membership_baseline, tmp_path
):
    seed = membership_baseline
    path = tmp_path / "upgraded.db"
    copy_database(seed["path"], path)
    seen = []

    def inspect_ddl(connection, cursor, statement, parameters, context, executemany):
        if str(connection.engine.url.database) == str(path) and statement.startswith("ALTER TABLE"):
            assert connection.connection.driver_connection.in_transaction
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            seen.append(statement)

    event.listen(Engine, "after_cursor_execute", inspect_ddl)
    try:
        upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, "after_cursor_execute", inspect_ddl)
    assert len(seen) == 3 and all(" ADD COLUMN " in statement for statement in seen)
    assert_preserved(seed, path)
    after = snapshot(path)
    upgrade(config(path), CANDIDATE)
    assert snapshot(path) == after
    with pytest.raises(RuntimeError, match="backup to a new database"):
        downgrade(config(path), PREVIOUS)
    assert snapshot(path) == after
    database = Database(f"sqlite:///{path}")
    try:
        app = create_app(settings=Settings(_env_file=None, database_url=f"sqlite:///{path}",
                                         runtime_mode="mock"), database=database,
                         require_email_verification=False)
        for account in seed["accounts"]:
            with app.state.identity_service_scope() as service:
                authenticated = service.authenticate(account["credential"])
                assert authenticated.user.user_id == UUID(account["owner"])
                assert authenticated.session.session_id == UUID(account["session_id"])
    finally:
        database.engine.dispose()
    assert snapshot(seed["path"]) == seed["snapshot"]


@pytest.mark.parametrize("phase,prefix", [
    ("before", "ALTER TABLE credit_redemption_codes ADD COLUMN plan_id"),
    ("after", "ALTER TABLE credit_redemption_codes ADD COLUMN plan_id"),
    ("after", "ALTER TABLE credit_redemption_codes ADD COLUMN action"),
    ("after", "ALTER TABLE subscriptions ADD COLUMN current_period_start"),
    ("before", "PRAGMA foreign_key_check"),
    ("before", "PRAGMA integrity_check"),
    ("before", "COMMIT"),
])
def test_interrupted_ddl_rolls_back_all_columns_and_keeps_source(
    membership_baseline, tmp_path, phase, prefix
):
    seed = membership_baseline
    path = tmp_path / "interrupted.db"
    copy_database(seed["path"], path)

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        if str(connection.engine.url.database) == str(path) and " ".join(
            statement.split()
        ).startswith(prefix):
            assert connection.connection.driver_connection.in_transaction
            raise RuntimeError("synthetic membership interruption")

    event_name = f"{phase}_cursor_execute"
    event.listen(Engine, event_name, interrupt)
    try:
        with pytest.raises(RuntimeError, match="synthetic membership interruption"):
            upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, event_name, interrupt)
    assert snapshot(path) == seed["snapshot"]
    assert snapshot(seed["path"]) == seed["snapshot"]
    fresh = tmp_path / "fresh-candidate.db"
    copy_database(seed["path"], fresh)
    upgrade(config(fresh), CANDIDATE)
    assert_preserved(seed, fresh)


def test_stamp_failure_commits_schema_but_rejects_in_place_blind_retry(
    membership_baseline, tmp_path
):
    seed = membership_baseline
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
    assert_preserved(seed, path, stamped=False)
    committed = snapshot(path)
    with pytest.raises(OperationalError, match="duplicate column name: plan_id"):
        upgrade(config(path), CANDIDATE)
    assert snapshot(path) == committed
    fresh = tmp_path / "fresh-after-stamp.db"
    copy_database(seed["path"], fresh)
    upgrade(config(fresh), CANDIDATE)
    assert_preserved(seed, fresh)


@pytest.mark.parametrize("column", ["plan_id", "action", "current_period_start"])
def test_process_exit_inside_ddl_recovers_old_database(membership_baseline, tmp_path, column):
    seed = membership_baseline
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
    if ' ADD COLUMN ' + sys.argv[3] + ' ' in statement:
        assert connection.connection.driver_connection.in_transaction
        os._exit(23)
event.listen(Engine, 'after_cursor_execute', terminate)
command.upgrade(Config(sys.argv[2]), '20261005_0640')
raise AssertionError('The membership interruption was never reached')
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, str(path), str(Path(__file__).parents[1] / "alembic.ini"),
         column], capture_output=True, text=True, timeout=30,
    )
    assert completed.returncode == 23, completed.stderr
    assert snapshot(path) == seed["snapshot"]
    assert snapshot(seed["path"]) == seed["snapshot"]


def test_existing_fk_violation_rolls_back_new_columns(membership_baseline, tmp_path):
    path = tmp_path / "invalid-existing-fk.db"
    copy_database(membership_baseline["path"], path)
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("UPDATE subscriptions SET user_id='synthetic-missing-user'")
    before = snapshot(path)
    assert before["foreign_key_violations"]
    with pytest.raises(RuntimeError, match="foreign-key violation"):
        upgrade(config(path), CANDIDATE)
    assert snapshot(path) == before


def test_fresh_database_upgrades_to_single_head_and_new_defaults(tmp_path):
    path = tmp_path / "new.db"
    cfg = config(path)
    graph = ScriptDirectory.from_config(cfg)
    assert graph.get_heads() == [CANDIDATE]
    assert graph.get_revision(CANDIDATE).down_revision == PREVIOUS
    upgrade(cfg, "head")
    result = snapshot(path)
    assert result["rows"]["alembic_version"] == [[CANDIDATE]]
    assert not result["foreign_key_violations"] and result["integrity"] == "ok"
    with sqlite3.connect(path) as connection:
        for table, added in ADDED.items():
            info = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
            assert [(row[1], row[2], row[3], row[4]) for row in info[-len(added):]] == added


def test_0640_offline_range_rejected_before_any_ddl(tmp_path, monkeypatch):
    path = tmp_path / "never-created.db"
    cfg = config(path)
    output = io.StringIO()
    cfg.output_buffer = output
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{path}")
    with pytest.raises(RuntimeError, match="reviewed online SQLite release path"):
        command.upgrade(cfg, f"{PREVIOUS}:{CANDIDATE}", sql=True)
    assert "ALTER TABLE" not in output.getvalue()
    assert not path.exists()


def test_old_constraints_indexes_foreign_keys_and_new_defaults_survive(
    membership_baseline, tmp_path
):
    path = tmp_path / "constraints.db"
    copy_database(membership_baseline["path"], path)

    def schema_contract():
        with sqlite3.connect(path) as connection:
            return {
                table: {
                    "columns": connection.execute(f'PRAGMA table_info("{table}")').fetchall(),
                    "foreign_keys": connection.execute(
                        f'PRAGMA foreign_key_list("{table}")'
                    ).fetchall(),
                    "indexes": {
                        row[1]: (row, connection.execute(
                            f'PRAGMA index_xinfo("{row[1]}")'
                        ).fetchall())
                        for row in connection.execute(f'PRAGMA index_list("{table}")')
                    },
                }
                for table in ADDED
            }

    before = schema_contract()
    upgrade(config(path), CANDIDATE)
    after = schema_contract()
    for table, contract in before.items():
        assert after[table]["columns"][:len(contract["columns"])] == contract["columns"]
        assert after[table]["foreign_keys"] == contract["foreign_keys"]
        assert after[table]["indexes"] == contract["indexes"]
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        code, used = membership_baseline["codes"][:2]
        owner = membership_baseline["accounts"][0]["owner"]
        for query, arguments in (
            ("UPDATE credit_redemption_codes SET redeemed_by_user_id=? WHERE code_id=?",
             (owner, code)),
            ("UPDATE credit_redemption_codes SET code_hash=(SELECT code_hash "
             "FROM credit_redemption_codes WHERE code_id=?) WHERE code_id=?", (used, code)),
            ("UPDATE credit_redemption_codes SET code_index=1 WHERE code_id=?", (code,)),
            ("UPDATE credit_redemption_codes SET created_by_user_id='missing' WHERE code_id=?",
             (code,)),
            ("UPDATE credit_redemption_codes SET action=NULL WHERE code_id=?", (code,)),
            ("UPDATE subscriptions SET user_id='missing'", ()),
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(query, arguments)
        connection.execute(
            "INSERT INTO credit_redemption_codes(code_id,code_hash,batch_id,code_index,"
            "created_by_user_id,created_at,expires_at) "
            "VALUES ('after-upgrade',?,'after-upgrade',0,?,?,?)",
            (hashlib.sha256(b"after-upgrade").hexdigest(), owner, STAMP, "2099-10-05"),
        )
        assert connection.execute(
            "SELECT plan_id,action FROM credit_redemption_codes WHERE code_id='after-upgrade'"
        ).fetchone() == (None, "bank_reset")
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()


def test_non_ok_integrity_result_rolls_back_all_columns(membership_baseline, tmp_path):
    path = tmp_path / "failed-integrity-check.db"
    copy_database(membership_baseline["path"], path)

    def fail_integrity(connection, cursor, statement, parameters, context, executemany):
        if (
            str(connection.engine.url.database) == str(path)
            and statement == "PRAGMA integrity_check"
        ):
            return "SELECT 'synthetic integrity failure'", parameters
        return statement, parameters

    event.listen(Engine, "before_cursor_execute", fail_integrity, retval=True)
    try:
        with pytest.raises(RuntimeError, match="failed integrity validation"):
            upgrade(config(path), CANDIDATE)
    finally:
        event.remove(Engine, "before_cursor_execute", fail_integrity)
    assert snapshot(path) == membership_baseline["snapshot"]
    assert snapshot(membership_baseline["path"]) == membership_baseline["snapshot"]
