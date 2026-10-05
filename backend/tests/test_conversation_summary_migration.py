"""Real copy/upgrade/old-writer/downgrade, preserving reset audit protections."""

import sqlite3
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from test_agent_memory import register
from test_conversation_context import seed

SCHEMA = Path(__file__).parent / "fixtures/billing_reset_schema.sql"


def test_0560_to_0570_copy_upgrade_old_writer_and_downgrade(
    plain_client, tmp_path, monkeypatch, alembic_config
):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner)
    original_path = plain_client.app.state.database.engine.url.database
    command.downgrade(alembic_config, "20261005_0560")
    candidate_path = tmp_path / "candidate.db"
    with sqlite3.connect(original_path) as source:
        source.executescript(SCHEMA.read_text())
        source.execute(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,hold_points,"
            "exempt,price_json,credit_pico,created_at,updated_at) "
            "VALUES ('old-op',?,'fixture','success',0,0,'{}','100','2026-10-05','2026-10-05')",
            (str(owner),),
        )
        source.execute(
            "INSERT INTO billing_precision_adjustments VALUES "
            "('synthetic-reset',?,'fixture','100','-100','0',29,1,30,'[\"old-op\"]','2026-10-05')",
            (str(owner),),
        )
        source.commit()
        names = (
            "users",
            "agent_messages",
            "agent_conversations",
            "billing_operations",
            "billing_attempts",
            "credit_accounts",
            "credit_ledger",
            "billing_precision_adjustments",
        )
        original = {
            name: source.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall() for name in names
        }
        protected = source.execute(
            "SELECT type,name,sql FROM sqlite_master WHERE name IN "
            "('billing_precision_adjustments','billing_reset_terminal_fence') ORDER BY name"
        ).fetchall()
        with sqlite3.connect(candidate_path) as candidate:
            source.backup(candidate)
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{candidate_path}")
    command.upgrade(alembic_config, "20261005_0570")
    with sqlite3.connect(candidate_path) as candidate:
        for name, expected in original.items():
            assert candidate.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall() == expected
        assert candidate.execute("SELECT * FROM agent_conversation_summaries").fetchall() == []
        # The old application never mentions the new derived-cache table and keeps writing.
        candidate.execute(
            "UPDATE agent_conversations SET title='old-writer' WHERE conversation_id=?",
            (str(conversation.conversation_id),),
        )
        new_id = str(uuid4())
        candidate.execute(
            "INSERT INTO agent_conversations(conversation_id,user_id,title,version,created_at,"
            "updated_at) VALUES (?,?,'old-writer-new',1,'2026-10-05','2026-10-05')",
            (new_id, str(owner)),
        )
        candidate.execute(
            "INSERT INTO agent_conversation_summaries(user_id) VALUES (?)", (str(owner),)
        )
        candidate.commit()
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute("UPDATE billing_operations SET status='error' WHERE run_id='old-op'")
    command.downgrade(alembic_config, "20261005_0560")
    with sqlite3.connect(candidate_path) as candidate:
        assert (
            candidate.execute(
                "SELECT name FROM sqlite_master WHERE name='agent_conversation_summaries'"
            ).fetchone()
            is None
        )
        assert (
            candidate.execute(
                "SELECT type,name,sql FROM sqlite_master WHERE name IN "
                "('billing_precision_adjustments','billing_reset_terminal_fence') "
                "ORDER BY name"
            ).fetchall()
            == protected
        )
        for name in names:
            if name != "agent_conversations":
                assert (
                    candidate.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall()
                    == original[name]
                )
        assert (
            candidate.execute(
                "SELECT title FROM agent_conversations WHERE conversation_id=?",
                (str(conversation.conversation_id),),
            ).fetchone()[0]
            == "old-writer"
        )
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute(
                "UPDATE billing_operations SET charged_points=2 WHERE run_id='old-op'"
            )
    with sqlite3.connect(original_path) as source:
        assert (
            source.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261005_0560"
        )
        for name, expected in original.items():
            assert source.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall() == expected
