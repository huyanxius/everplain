"""Real pre-receipt 0610 SQL rows survive 0615 without current-head user columns."""

import sqlite3

from alembic import command
from oauth_legacy_migration_support import seed_account, seed_imports
from sqlalchemy import inspect
from test_oauth_forward_migration import snapshot

from qunxue_api.adapters.sqlite.database import Database


def test_import_upgrade_preserves_legacy_batches_items_sources_and_documents(
    tmp_path, monkeypatch, alembic_config
):
    path = tmp_path / "legacy-import.db"
    url = f"sqlite:///{path}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", url)
    command.upgrade(alembic_config, "20261005_0610")
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        owner = seed_account(connection)
        imports = seed_imports(connection, owner["owner"])
        assert "login_mode" not in {
            column[1] for column in connection.execute("PRAGMA table_info(users)")
        }
        assert "request_key" not in {
            column[1] for column in connection.execute("PRAGMA table_info(import_batches)")
        }
        assert not imports["assets"]
    before = snapshot(path)
    command.upgrade(alembic_config, "20261005_0615")
    after = snapshot(path)
    assert not after["foreign_key_violations"] and after["integrity"] == "ok"
    assert after["rows"].keys() - before["rows"].keys() == {"import_attachments"}
    for name, rows in before["rows"].items():
        if name == "alembic_version":
            expected = [["20261005_0615"]]
        elif name == "import_batches":
            expected = [row + [None, None] for row in rows]
        else:
            expected = rows
        assert after["rows"][name] == expected, name
    assert after["rows"]["import_attachments"] == []
    with sqlite3.connect(path) as connection:
        for batch in imports["batches"]:
            assert connection.execute(
                "SELECT status FROM import_items WHERE batch_id=?", (batch["id"],)
            ).fetchone() == (batch["status"],)
    database = Database(url)
    try:
        index = next(
            index
            for index in inspect(database.engine).get_indexes("import_batches")
            if index["name"] == "uq_import_batches_user_request"
        )
        assert index["unique"] and index["column_names"] == ["user_id", "request_key"]
    finally:
        database.engine.dispose()
