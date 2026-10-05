import importlib.util
import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "migrations/versions/20261005_0590_user_avatar.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("user_avatar_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed_profiles(connection):
    for step in range(5):
        for completed in (0, 1):
            connection.execute(
                text(
                    "INSERT INTO agent_profiles "
                    "(user_id, name, avatar_id, color, speaking_style, setup_step, "
                    "setup_completed, questionnaire, memory_ids, version, soul_text) "
                    "VALUES (:id, '原伙伴', 'nian', '#b8bfa6', 'warm', :step, "
                    ":completed, :questionnaire, :memory_ids, 8, '保留的人格')"
                ),
                {
                    "id": f"owner-{completed}-{step}",
                    "step": step,
                    "completed": completed,
                    "questionnaire": json.dumps({"occupation": "研究者"}, ensure_ascii=False),
                    "memory_ids": '{"occupation":"existing-memory"}',
                },
            )


def _rows(connection):
    return (
        connection.execute(
            text(
                "SELECT user_id, name, avatar_id, color, speaking_style, setup_step, "
                "setup_completed, questionnaire, memory_ids, version, soul_text "
                "FROM agent_profiles ORDER BY user_id"
            )
        )
        .mappings()
        .all()
    )


def _assert_upgraded_profiles(connection, before):
    mapped = {0: 3, 1: 1, 2: 4, 3: 5}
    for old, new in zip(before, _rows(connection), strict=True):
        expected = dict(old)
        if not old["setup_completed"]:
            expected["setup_step"] = mapped.get(old["setup_step"], old["setup_step"])
        assert dict(new) == expected
    column = next(
        c for c in inspect(connection).get_columns("agent_profiles") if c["name"] == "user_avatar"
    )
    assert column["nullable"] is True
    assert (
        connection.execute(
            text("SELECT COUNT(*) FROM agent_profiles WHERE user_avatar IS NOT NULL")
        ).scalar_one()
        == 0
    )


def test_user_avatar_migration_preserves_profiles_and_maps_unfinished_steps(tmp_path):
    # Exercise the revision independently while parallel predecessor migrations
    # are integrated. Full-chain convergence has its own test below.
    engine = create_engine(f"sqlite:///{tmp_path / 'revision.db'}")
    revision = _migration()
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE agent_profiles (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, "
                    "avatar_id TEXT NOT NULL, color TEXT NOT NULL, speaking_style TEXT NOT NULL, "
                    "setup_step INTEGER NOT NULL, setup_completed BOOLEAN NOT NULL, "
                    "questionnaire JSON NOT NULL, memory_ids JSON NOT NULL, "
                    "version INTEGER NOT NULL, soul_text TEXT NOT NULL)"
                )
            )
            _seed_profiles(connection)
            before = _rows(connection)
            with Operations.context(MigrationContext.configure(connection)):
                revision.upgrade()
                _assert_upgraded_profiles(connection, before)
                revision.downgrade()
            assert "user_avatar" not in {
                c["name"] for c in inspect(connection).get_columns("agent_profiles")
            }
            # Every valid unfinished old page and all completed rows round-trip.
            expected = [dict(row) for row in before]
            expected[4]["setup_step"] = 2  # Legacy incomplete completion sentinel.
            assert [dict(row) for row in _rows(connection)] == expected
    finally:
        engine.dispose()


def test_user_avatar_revision_upgrades_from_the_integrated_predecessor(tmp_path, monkeypatch):
    revision = _migration()
    database_url = f"sqlite:///{tmp_path / 'chain.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", database_url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, revision.down_revision)
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            _seed_profiles(connection)
            before = _rows(connection)
            memory_schema = connection.execute(
                text("SELECT name, sql FROM sqlite_master "
                        "WHERE name LIKE '%memor%' ORDER BY name")
            ).all()
        command.upgrade(config, revision.revision)
        with engine.connect() as connection:
            _assert_upgraded_profiles(connection, before)
            assert (
                connection.execute(
                    text(
                        "SELECT name, sql FROM sqlite_master "
                        "WHERE name LIKE '%memor%' ORDER BY name"
                    )
                ).all()
                == memory_schema
            )
        command.downgrade(config, revision.down_revision)
        with engine.connect() as connection:
            assert "user_avatar" not in {
                c["name"] for c in inspect(connection).get_columns("agent_profiles")
            }
    finally:
        engine.dispose()


def test_0570_to_0590_copy_preserves_old_readers_writers_and_reset_fence(
    tmp_path, monkeypatch, alembic_config
):
    """A candidate-copy upgrade leaves the original DB and legacy columns intact."""
    import sqlite3
    from uuid import uuid4

    import pytest
    from legacy_migration_support import STAMP, create_legacy_database, seed_user

    original_path = tmp_path / "avatar-source-0570.db"
    create_legacy_database(original_path, "20261005_0570", monkeypatch, alembic_config)
    with sqlite3.connect(original_path) as source:
        owner, second_owner = str(seed_user(source)), str(seed_user(source))
        memory = str(uuid4())
        source.execute(
            "INSERT INTO agent_memory_scopes(user_id,scope_key,version,use_memory,learn_memory) "
            "VALUES (?,'',1,1,1)", (owner,),
        )
        source.execute(
            "INSERT INTO agent_memories(memory_id,user_id,scope_key,key,content,origin,version,"
            "created_at,updated_at,deleted) VALUES (?,?,'','occupation','研究者','user',1,?,?,0)",
            (memory, owner, STAMP, STAMP),
        )
        source.execute(
            "INSERT INTO agent_profiles(user_id,name,avatar_id,color,speaking_style,setup_step,"
            "setup_completed,questionnaire,memory_ids,version,soul_text) "
            "VALUES (?,'旧伙伴','nian','#b8bfa6','warm',2,0,?,?,8,'保留的人格')",
            (owner, json.dumps({"occupation": "研究者", "goals": ["整理资料"]}, ensure_ascii=False),
             json.dumps({"occupation": memory})),
        )
    candidate_path = tmp_path / "avatar-candidate.db"
    schema = Path(__file__).parent / "fixtures/billing_reset_schema.sql"
    columns = (
        "user_id",
        "name",
        "avatar_id",
        "color",
        "speaking_style",
        "setup_step",
        "setup_completed",
        "questionnaire",
        "memory_ids",
        "version",
        "soul_text",
    )
    protected_sql = (
        "SELECT type,name,sql FROM sqlite_master WHERE name IN "
        "('billing_precision_adjustments','billing_reset_terminal_fence') ORDER BY name"
    )
    with sqlite3.connect(original_path) as source:
        source.executescript(schema.read_text())
        source.execute(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,hold_points,"
            "exempt,price_json,credit_pico,created_at,updated_at) "
            "VALUES ('old-op',?,'fixture','success',0,0,'{}','100','2026-10-05','2026-10-05')",
            (owner,),
        )
        source.execute(
            "INSERT INTO billing_precision_adjustments VALUES "
            "('synthetic-reset',?,'fixture','100','-100','0',29,1,30,'[\"old-op\"]','2026-10-05')",
            (owner,),
        )
        source.commit()
        tables = (
            "users",
            "agent_memories",
            "agent_conversation_summaries",
            "credit_accounts",
            "credit_ledger",
            "billing_operations",
            "billing_attempts",
            "billing_precision_adjustments",
        )
        snapshots = {
            name: source.execute(f"SELECT * FROM {name} ORDER BY 1").fetchall() for name in tables
        }
        original_profile = source.execute(
            f"SELECT {','.join(columns)} FROM agent_profiles WHERE user_id=?",
            (owner,),
        ).fetchone()
        assert original_profile[5] == 2
        protected = source.execute(protected_sql).fetchall()
        with sqlite3.connect(candidate_path) as candidate:
            source.backup(candidate)
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{candidate_path}")
    command.upgrade(alembic_config, "20261005_0590")
    avatar = {"id": "cat", "hair": "#ffffff", "blush": False}
    with sqlite3.connect(candidate_path) as candidate:
        for table, expected in snapshots.items():
            assert candidate.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() == expected
        legacy = candidate.execute(
            f"SELECT {','.join(columns)} FROM agent_profiles WHERE user_id=?",
            (owner,),
        ).fetchone()
        expected = list(original_profile)
        expected[5] = 4
        assert tuple(expected) == legacy
        assert (
            candidate.execute(
                "SELECT user_avatar FROM agent_profiles WHERE user_id=?",
                (owner,),
            ).fetchone()[0]
            is None
        )
        candidate.execute(
            "UPDATE agent_profiles SET user_avatar=? WHERE user_id=?", (json.dumps(avatar), owner)
        )
        # The old ORM selects and writes only its named columns, never the new avatar.
        values = dict(zip(columns, legacy, strict=True))
        values["name"] = "旧应用仍能保存"
        values["version"] += 1
        candidate.execute(
            "UPDATE agent_profiles SET "
            + ",".join(f"{key}=:{key}" for key in columns[1:])
            + " WHERE user_id=:user_id",
            values,
        )
        assert (
            json.loads(
                candidate.execute(
                    "SELECT user_avatar FROM agent_profiles WHERE user_id=?",
                    (owner,),
                ).fetchone()[0]
            )
            == avatar
        )
        candidate.execute(
            f"INSERT INTO agent_profiles ({','.join(columns)}) "
            f"VALUES ({','.join('?' for _ in columns)})",
            (second_owner, "旧新增", "cheng", "#5d8fe6", "clear", 0, 0, "{}", "{}", 1, ""),
        )
        assert (
            candidate.execute(
                "SELECT user_avatar FROM agent_profiles WHERE user_id=?",
                (second_owner,),
            ).fetchone()[0]
            is None
        )
        candidate.commit()
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute("UPDATE billing_operations SET status='error' WHERE run_id='old-op'")
    command.downgrade(alembic_config, "20261005_0570")
    with sqlite3.connect(candidate_path) as candidate:
        assert "user_avatar" not in {
            row[1] for row in candidate.execute("PRAGMA table_info(agent_profiles)")
        }
        assert candidate.execute(protected_sql).fetchall() == protected
        assert candidate.execute(
            "SELECT name, setup_step, version FROM agent_profiles WHERE user_id=?",
            (owner,),
        ).fetchone() == ("旧应用仍能保存", 2, original_profile[9] + 1)
        for table, expected in snapshots.items():
            assert candidate.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() == expected
        with pytest.raises(sqlite3.IntegrityError, match="predates account reset"):
            candidate.execute(
                "UPDATE billing_operations SET charged_points=2 WHERE run_id='old-op'"
            )
    with sqlite3.connect(original_path) as source:
        assert (
            source.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261005_0570"
        )
        assert (
            source.execute(
                f"SELECT {','.join(columns)} FROM agent_profiles WHERE user_id=?",
                (owner,),
            ).fetchone()
            == original_profile
        )
        for table, expected in snapshots.items():
            assert source.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() == expected
