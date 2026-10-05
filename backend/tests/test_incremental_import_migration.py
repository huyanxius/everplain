from alembic import command
from sqlalchemy import MetaData, inspect, select, text
from test_knowledge_import import drain, start
from test_research_material_api import _authenticate

from qunxue_api.adapters.sqlite.database import Database


def test_import_upgrade_preserves_legacy_batches_items_sources_and_documents(
    plain_client,
    tmp_path,
    monkeypatch,
    alembic_config,
):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    ready = start(c, [("Vault/A.md", b"# A\noriginal source")], "obsidian")
    drain(c)
    queued = start(c, [("Vault/B.md", b"# B\nqueued source")], "obsidian")
    tables = [
        "users",
        "shared_knowledge_bases",
        "shared_documents",
        "import_batches",
        "import_items",
        "import_sources",
    ]
    snapshot = {}
    with c.app.state.database.engine.connect() as connection:
        metadata = MetaData()
        metadata.reflect(bind=connection, only=tables)
        for name in tables:
            snapshot[name] = [
                dict(row) for row in connection.execute(select(metadata.tables[name])).mappings()
            ]
    legacy_url = f"sqlite:///{tmp_path / 'legacy-import.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", legacy_url)
    command.upgrade(alembic_config, "20261005_0610")
    database = Database(legacy_url)
    try:
        legacy = MetaData()
        legacy.reflect(bind=database.engine, only=tables)
        with database.engine.begin() as connection:
            for name in tables:
                for row in snapshot[name]:
                    old = {key: value for key, value in row.items() if key in legacy.tables[name].c}
                    connection.execute(legacy.tables[name].insert().values(**old))
        command.upgrade(alembic_config, "20261005_0615")
        upgraded = MetaData()
        upgraded.reflect(bind=database.engine, only=tables + ["import_attachments"])
        with database.engine.connect() as connection:
            assert not connection.execute(text("PRAGMA foreign_key_check")).all()
            for name in tables:
                actual = [
                    dict(row)
                    for row in connection.execute(select(upgraded.tables[name])).mappings()
                ]
                expected = snapshot[name]
                if name == "import_batches":
                    expected = [
                        row | {"request_key": None, "fingerprint": None} for row in expected
                    ]
                assert actual == expected, name
            assert connection.execute(select(upgraded.tables["import_attachments"])).all() == []
            assert (
                connection.execute(
                    text("SELECT status FROM import_items WHERE batch_id=:id"), {"id": queued["id"]}
                ).scalar()
                == "queued"
            )
            assert (
                connection.execute(
                    text("SELECT status FROM import_items WHERE batch_id=:id"), {"id": ready["id"]}
                ).scalar()
                == "imported"
            )
        index = next(
            index
            for index in inspect(database.engine).get_indexes("import_batches")
            if index["name"] == "uq_import_batches_user_request"
        )
        assert index["unique"] and index["column_names"] == ["user_id", "request_key"]
    finally:
        database.engine.dispose()
