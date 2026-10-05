"""Real additive SQLite migration and old/new writing contracts on a synthetic copy."""

import runpy
import sqlite3
from hashlib import sha256
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from qunxue_api.adapters.sqlite.writing import WritingRevisionRow

VERSIONS = Path(__file__).parents[1] / "migrations" / "versions"
LEGACY_COLUMNS = (
    "revision_id,user_id,document_id,base_version,action,before_markdown,after_markdown,"
    "status,warnings,created_at"
)


def apply(connection, filename, direction="upgrade"):
    migration = runpy.run_path(str(VERSIONS / filename))
    with Operations.context(MigrationContext.configure(connection)):
        migration[direction]()


def test_scope_expansion_preserves_source_and_legacy_read_write_contract(tmp_path):
    source, candidate = tmp_path / "original.db", tmp_path / "candidate.db"
    original_engine = create_engine(f"sqlite:///{source}")
    with original_engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (user_id VARCHAR PRIMARY KEY)"))
        connection.execute(text("INSERT INTO users VALUES ('synthetic-owner')"))
        apply(connection, "20261003_0530_personal_writing.py")
        connection.execute(text(
            "INSERT INTO writing_documents VALUES "
            "('doc','synthetic-owner','合成测试','essay','😀正文',1,'fixture','fixture')"
        ))
        connection.execute(text(
            f"INSERT INTO writing_revisions ({LEGACY_COLUMNS}) VALUES "
            "('legacy','synthetic-owner','doc',1,'rewrite','😀正文','😀修订',"
            "'pending','[]','fixture')"
        ))
        legacy = connection.execute(text(
            f"SELECT {LEGACY_COLUMNS} FROM writing_revisions"
        )).fetchall()
    original_engine.dispose()
    source_hash = sha256(source.read_bytes()).hexdigest()
    with sqlite3.connect(source) as old, sqlite3.connect(candidate) as copy:
        old.backup(copy)

    engine = create_engine(f"sqlite:///{candidate}")
    with engine.begin() as connection:
        apply(connection, "20261005_0580_writing_revision_scope.py")
        assert connection.execute(text(
            f"SELECT {LEGACY_COLUMNS} FROM writing_revisions"
        )).fetchall() == legacy
        assert connection.execute(text(
            "SELECT selection_start,selection_end FROM writing_revisions WHERE revision_id='legacy'"
        )).one() == (None, None)
        # This is the exact pre-expansion INSERT shape, omitting both nullable fields.
        connection.execute(text(
            f"INSERT INTO writing_revisions ({LEGACY_COLUMNS}) VALUES "
            "('old-writer','synthetic-owner','doc',1,'rewrite','😀正文','旧应用仍可写入',"
            "'pending','[]','fixture')"
        ))
        connection.execute(text(
            "UPDATE writing_revisions SET status='rejected' WHERE revision_id='old-writer'"
        ))
    with Session(engine) as session:
        session.add(WritingRevisionRow(
            revision_id="new-writer", user_id="synthetic-owner", document_id="doc",
            base_version=1, action="rewrite", before_markdown="😀正文", after_markdown="😀修订",
            status="pending", warnings=[], created_at="fixture", selection_start=2, selection_end=4,
        ))
        session.commit()
        session.expire_all()
        restored = session.get(WritingRevisionRow, "new-writer")
        assert (restored.selection_start, restored.selection_end) == (2, 4)
        assert session.get(WritingRevisionRow, "old-writer").selection_start is None
    assert sha256(source.read_bytes()).hexdigest() == source_hash

    # Downgrade is tested only on this disposable copy. Production rollback keeps
    # the additive schema and runs the old compatible application against it.
    with engine.begin() as connection:
        apply(connection, "20261005_0580_writing_revision_scope.py", "downgrade")
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(writing_revisions)"))
        }
        assert "selection_start" not in columns and "selection_end" not in columns
        assert connection.execute(text(
            "SELECT count(*) FROM writing_revisions"
        )).scalar_one() == 3
    engine.dispose()
    assert sha256(source.read_bytes()).hexdigest() == source_hash


def test_scope_is_one_head_and_round_trips_the_published_avatar_parent(tmp_path, monkeypatch):
    backend = Path(__file__).parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == ["20261005_0580"]
    assert scripts.get_revision("20261005_0580").down_revision == "20261005_0590"
    database_url = f"sqlite:///{tmp_path / 'candidate.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", database_url)
    command.upgrade(config, "20261005_0590")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO users (user_id,email,display_name,password_hash,role,"
            "created_at,updated_at) VALUES "
            "('synthetic-owner','scope@example.test','Synthetic','fixture','user',"
            "'fixture','fixture')"
        ))
        connection.execute(text(
            "INSERT INTO writing_documents VALUES "
            "('doc','synthetic-owner','合成测试','essay','😀正文',1,'fixture','fixture')"
        ))
        connection.execute(text(
            f"INSERT INTO writing_revisions ({LEGACY_COLUMNS}) VALUES "
            "('legacy','synthetic-owner','doc',1,'rewrite','😀正文','😀修订',"
            "'pending','[]','fixture')"
        ))
        connection.execute(text(
            "INSERT INTO agent_profiles "
            "(user_id,name,avatar_id,color,speaking_style,setup_step,setup_completed,"
            "questionnaire,memory_ids,version,soul_text,user_avatar) VALUES "
            "('synthetic-owner','合成伙伴','nian','#b8bfa6','warm',6,1,"
            "'{}','{}',8,'合成人格','{\"synthetic\":\"preserve\"}')"
        ))
        profile = connection.execute(text("SELECT * FROM agent_profiles")).fetchall()
        old_revision = connection.execute(text(
            f"SELECT {LEGACY_COLUMNS} FROM writing_revisions"
        )).fetchall()
        billing_schema = connection.execute(text(
            "SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'billing%' "
            "ORDER BY type,name"
        )).fetchall()
    command.upgrade(config, "head")
    with engine.begin() as connection:
        assert connection.execute(text("SELECT * FROM agent_profiles")).fetchall() == profile
        assert connection.execute(text(
            f"SELECT {LEGACY_COLUMNS} FROM writing_revisions"
        )).fetchall() == old_revision
        assert connection.execute(text(
            "SELECT selection_start,selection_end FROM writing_revisions"
        )).one() == (None, None)
        connection.execute(text(
            "UPDATE writing_revisions SET selection_start=2,selection_end=4"
        ))
    # Only this synthetic candidate is downgraded; production rollback retains
    # the additive columns and uses the old compatible application.
    command.downgrade(config, "20261005_0590")
    with engine.begin() as connection:
        assert connection.execute(text("SELECT * FROM agent_profiles")).fetchall() == profile
        assert connection.execute(text(
            f"SELECT {LEGACY_COLUMNS} FROM writing_revisions"
        )).fetchall() == old_revision
        assert connection.execute(text(
            "SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'billing%' "
            "ORDER BY type,name"
        )).fetchall() == billing_schema
    command.upgrade(config, "head")
    with engine.begin() as connection:
        assert connection.execute(text("SELECT * FROM agent_profiles")).fetchall() == profile
        assert connection.execute(text(
            "SELECT selection_start,selection_end FROM writing_revisions"
        )).one() == (None, None)
    engine.dispose()
