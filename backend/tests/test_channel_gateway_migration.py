"""Gateway follows the writing migration without losing writing data on forward/rollback."""

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from qunxue_api.adapters.sqlite.database import Database


def test_writing_then_gateway_is_one_head_and_preserves_existing_data(tmp_path, monkeypatch):
    backend = Path(__file__).parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    assert len(scripts.get_heads()) == 1
    current_head = scripts.get_current_head()
    assert current_head is not None
    gateway_revision = "20261003_0540"
    assert scripts.get_revision(gateway_revision).down_revision == "20261003_0530"
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", url)
    command.upgrade(config, "20261003_0530")
    database = Database(url)
    user_id, document_id = str(uuid4()), str(uuid4())
    now = datetime.now(UTC)
    try:
        assert "channel_bindings" not in inspect(database.engine).get_table_names()
        # This is a real 0530 database; current UserRow has later columns.
        with database.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users(user_id,email,password_hash,role,status,version,"
                    "created_at,updated_at) VALUES (:user,'migration-fixture@example.test',"
                    "'not-a-real-password','member','active',1,:now,:now)"
                ),
                {"user": user_id, "now": now.isoformat()},
            )
        with database.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO writing_documents(document_id,user_id,title,genre,"
                    "markdown,version,created_at,updated_at) VALUES(:id,:user,'Saved',"
                    "'general','Existing writing is preserved',1,:now,:now)"
                ),
                {"id": document_id, "user": user_id, "now": now.isoformat()},
            )
        # Round-trip the gateway revision itself, without crossing later
        # irreversible financial-evidence revisions.
        command.upgrade(config, gateway_revision)
        assert "channel_bindings" in inspect(database.engine).get_table_names()
        with database.engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT markdown FROM writing_documents"))
                == "Existing writing is preserved"
            )
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == gateway_revision
            )
        command.downgrade(config, "20261003_0530")
        assert "channel_bindings" not in inspect(database.engine).get_table_names()
        with database.engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM writing_documents")) == 1
        command.upgrade(config, "head")
        assert "channel_bindings" in inspect(database.engine).get_table_names()
        with database.engine.connect() as connection:
            assert connection.scalar(
                text("SELECT version_num FROM alembic_version")
            ) == current_head
            assert connection.scalar(text("SELECT count(*) FROM writing_documents")) == 1
    finally:
        database.engine.dispose()
