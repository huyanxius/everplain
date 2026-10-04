"""Real SQLite 0540/0550 transitions; synthetic data and reset audit schema only."""

import json
import sqlite3
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from test_agent_memory import register
from test_conversation_context import seed

SCHEMA = Path(__file__).parent / "fixtures/billing_reset_schema.sql"


def rows(connection, name):
    return connection.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall()


def protected_objects(connection):
    return connection.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE "
        "name IN ('billing_precision_adjustments','billing_reset_terminal_fence') ORDER BY name"
    ).fetchall()


def test_copy_upgrade_old_write_downgrade_and_reset_fence_survive(
    plain_client,
    tmp_path,
    monkeypatch,
    alembic_config,
):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, ("源对话不会丢失", "最新真实用户问题"))
    source_path = plain_client.app.state.database.engine.url.database
    command.downgrade(alembic_config, "20261003_0540")
    with sqlite3.connect(source_path) as source:
        source.executescript(SCHEMA.read_text())
        source.execute(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,hold_points,"
            "exempt,price_json,credit_pico,created_at,updated_at) "
            "VALUES ('old-op',?,'fixture','success',0,0,'{}','100','2026-10-04','2026-10-04')",
            (str(owner),),
        )
        source.execute(
            "INSERT INTO billing_precision_adjustments VALUES "
            "('synthetic-reset',?,'fixture','100','-100','0',29,1,30,'[\"old-op\"]','2026-10-04')",
            (str(owner),),
        )
        source.commit()
        original = {
            name: rows(source, name)
            for name in (
                "users",
                "agent_messages",
                "billing_operations",
                "credit_accounts",
                "credit_ledger",
                "billing_precision_adjustments",
            )
        }
        objects = protected_objects(source)
        assert (
            source.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261003_0540"
        )
        candidate_path = tmp_path / "candidate.db"
        with sqlite3.connect(candidate_path) as candidate:
            source.backup(candidate)
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{candidate_path}")
    command.upgrade(alembic_config, "20261004_0550")
    with sqlite3.connect(candidate_path) as candidate:
        for name, expected in original.items():
            assert rows(candidate, name) == expected
        assert protected_objects(candidate) == objects
        cached = json.loads(
            candidate.execute(
                "SELECT context_digest FROM agent_conversations WHERE conversation_id=?",
                (str(conversation.conversation_id),),
            ).fetchone()[0]
        )
        assert cached["items"][-1]["excerpt"] == "最新真实用户问题"
        # The exact pre-0550 SQL column contract still inserts/updates without a
        # context_digest field. Old code has no obligation to update a derived cache.
        old_id = str(uuid4())
        candidate.execute(
            "INSERT INTO agent_conversations(conversation_id,user_id,title,version,created_at,"
            "updated_at) VALUES (?,?,'old-writer',1,'2026-10-04','2026-10-04')",
            (old_id, str(owner)),
        )
        candidate.execute(
            "UPDATE agent_conversations SET title='old-writer-updated' WHERE conversation_id=?",
            (old_id,),
        )
        assert (
            candidate.execute(
                "SELECT context_digest FROM agent_conversations WHERE conversation_id=?", (old_id,)
            ).fetchone()[0]
            == "{}"
        )
        candidate.commit()
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute(
                "UPDATE billing_operations SET charged_points=9 WHERE run_id='old-op'"
            )
        assert rows(candidate, "billing_operations") == original["billing_operations"]
    command.downgrade(alembic_config, "20261003_0540")
    with sqlite3.connect(candidate_path) as candidate:
        assert "context_digest" not in {
            row[1] for row in candidate.execute("PRAGMA table_info(agent_conversations)")
        }
        for name, expected in original.items():
            assert rows(candidate, name) == expected
        assert protected_objects(candidate) == objects
        assert (
            candidate.execute(
                "SELECT title FROM agent_conversations WHERE conversation_id=?", (old_id,)
            ).fetchone()[0]
            == "old-writer-updated"
        )
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute("UPDATE billing_operations SET status='error' WHERE run_id='old-op'")
    # The original stopped-writer snapshot was never migrated or overwritten.
    with sqlite3.connect(source_path) as source:
        assert (
            source.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261003_0540"
        )
        for name, expected in original.items():
            assert rows(source, name) == expected
        assert protected_objects(source) == objects
    command.upgrade(alembic_config, "20261004_0550")
    with sqlite3.connect(candidate_path) as candidate:
        assert protected_objects(candidate) == objects
        assert rows(candidate, "agent_messages") == original["agent_messages"]
