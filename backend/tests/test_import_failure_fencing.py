from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, update
from test_knowledge_import import start
from test_research_material_api import _authenticate

from qunxue_api.adapters.sqlite.knowledge_import import ImportItemRow


@pytest.mark.parametrize("successor_completes", [False, True])
def test_stale_failure_cannot_overwrite_reclaimed_import(plain_client, successor_completes):
    """Interleave takeover immediately before the old worker's failure UPDATE."""
    client = plain_client
    client.app.state.import_worker_enabled = False
    _authenticate(client)
    batch = start(
        client,
        [("bookmarks.html", b'<DL><DT><A HREF="https://example.org/a">A</A></DL>')],
        "chrome",
    )
    item_id = batch["items"][0]["id"]
    calls = 0

    def fetch(_url):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("old worker failed")
        return "Recovered article body."

    client.app.state.import_fetch_text = fetch
    with client.app.state.knowledge_import_scope() as old_worker:
        engine = old_worker.repository.session.get_bind()
        interleaved = False

        def reclaim_before_failure_update(_conn, _cursor, statement, parameters, _ctx, _many):
            nonlocal interleaved
            if interleaved or not statement.startswith("UPDATE import_items SET status=?, error=?"):
                return
            assert parameters[:2] == ("failed", "old worker failed")
            interleaved = True
            # The old implementation has already read its still-valid claim.
            # Another real worker now expires/reclaims it and commits success
            # before the first UPDATE reaches SQLite.
            with client.app.state.knowledge_import_scope() as other_worker:
                other_worker.repository.session.execute(
                    update(ImportItemRow)
                    .where(ImportItemRow.id == item_id)
                    .values(started_at=datetime.now(UTC) - timedelta(minutes=6))
                )
                other_worker.repository.session.commit()
                if successor_completes:
                    assert other_worker.run_once()
                else:
                    claimed = other_worker.repository.claim()
                    assert claimed["id"] == item_id and claimed["attempts"] == 2

        event.listen(engine, "before_cursor_execute", reclaim_before_failure_update)
        try:
            assert old_worker.run_once()
        finally:
            event.remove(engine, "before_cursor_execute", reclaim_before_failure_update)

    assert interleaved and calls == (2 if successor_completes else 1)
    response = client.get("/api/imports/" + batch["id"])
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["attempts"] == 2
    assert item["status"] == ("imported" if successor_completes else "running")
    assert (item["document_id"] is not None) == successor_completes
    assert item["error"] is None
