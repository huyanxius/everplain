import importlib.util
import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations/versions/20261005_0590_user_avatar.py"
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
    return connection.execute(
        text(
            "SELECT user_id, name, avatar_id, color, speaking_style, setup_step, "
            "setup_completed, questionnaire, memory_ids, version, soul_text "
            "FROM agent_profiles ORDER BY user_id"
        )
    ).mappings().all()


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
    assert connection.execute(
        text("SELECT COUNT(*) FROM agent_profiles WHERE user_avatar IS NOT NULL")
    ).scalar_one() == 0


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
                text("SELECT name, sql FROM sqlite_master WHERE name LIKE '%memor%' ORDER BY name")
            ).all()
        command.upgrade(config, revision.revision)
        with engine.connect() as connection:
            _assert_upgraded_profiles(connection, before)
            assert connection.execute(
                text("SELECT name, sql FROM sqlite_master WHERE name LIKE '%memor%' ORDER BY name")
            ).all() == memory_schema
        command.downgrade(config, revision.down_revision)
        with engine.connect() as connection:
            assert "user_avatar" not in {
                c["name"] for c in inspect(connection).get_columns("agent_profiles")
            }
    finally:
        engine.dispose()
