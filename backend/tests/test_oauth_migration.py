"""Historical 0610 -> 0620 uses real old-schema rows, never current-head ORM."""

import hashlib
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory
from argon2 import PasswordHasher
from oauth_legacy_migration_support import PASSWORD, seed_account


def test_upgrade_from_output_head_preserves_accounts_sessions_and_welcome_grants(
    tmp_path, monkeypatch, alembic_config
):
    path = tmp_path / "oauth-upgrade.db"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{path}")
    command.upgrade(alembic_config, "20261005_0610")
    graph = ScriptDirectory.from_config(alembic_config)
    assert len(graph.get_heads()) == 1
    assert graph.get_revision("20261005_0620").down_revision == "20261005_0615"
    assert graph.get_revision("20261005_0615").down_revision == "20261005_0610"
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        seed = seed_account(connection)
        before = connection.execute("SELECT * FROM users").fetchall()
        sessions = connection.execute("SELECT * FROM user_sessions").fetchall()
        assert connection.execute("SELECT SUM(points) FROM credit_ledger").fetchone() == (30,)
        assert connection.execute("SELECT quota_period_epoch FROM credit_accounts").fetchone() == (
            None,
        )
        assert "login_mode" not in {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
    command.upgrade(alembic_config, "20261005_0620")
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT * FROM users").fetchall() == before
        assert connection.execute("SELECT * FROM user_sessions").fetchall() == sessions
        assert connection.execute("SELECT SUM(points) FROM credit_ledger").fetchone() == (30,)
        for name in ("credit_quota_periods", "federated_identities", "oauth_transactions"):
            assert connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone() == (0,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert PasswordHasher().verify(seed["password_hash"], PASSWORD)
        assert connection.execute(
            "SELECT user_id,session_id FROM user_sessions "
            "WHERE token_digest=? AND revoked_at IS NULL",
            (hashlib.sha256(seed["credential"].encode()).hexdigest(),),
        ).fetchone() == (seed["owner"], seed["session_id"])
