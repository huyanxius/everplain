import pytest
from sqlalchemy import select
from test_research_material_api import _authenticate
from test_writing import doc, pipeline, proposal

from qunxue_api.adapters.sqlite.writing import SqliteWritingRepository, WritingRevisionRow
from qunxue_api.modules.writing import WritingConflict


@pytest.mark.parametrize("late_decision", ["accept", "reject"])
def test_cached_pending_revision_cannot_overwrite_committed_rejection(plain_client, late_decision):
    """Interleave two real SQLite sessions after both have observed pending."""
    client = plain_client
    _authenticate(client)
    document = doc(client)
    pipeline(client, ["计划", "共有12个观察点。[^来源]"])
    revision = proposal(client, document).json()
    user_id = client.get("/api/session").json()["user"]["user_id"]
    database = client.app.state.database

    with database.session() as late_session:
        late_repository = SqliteWritingRepository(late_session)
        before = late_repository.get(user_id, document["document_id"])
        cached = late_session.scalar(
            select(WritingRevisionRow).where(
                WritingRevisionRow.revision_id == revision["revision_id"]
            )
        )
        assert cached.status == "pending"
        with database.session() as first_session:
            first_repository = SqliteWritingRepository(first_session)
            first_repository.resolve(
                user_id, document["document_id"], revision["revision_id"], "reject", 1
            )
        # The other request committed, but this session still holds its earlier
        # pending observation. An ordinary ORM assignment must not win the race.
        assert cached.status == "pending"
        with pytest.raises(WritingConflict):
            late_repository.resolve(
                user_id, document["document_id"], revision["revision_id"], late_decision, 1
            )
        late_session.rollback()

    with database.session() as session:
        repository = SqliteWritingRepository(session)
        assert repository.get(user_id, document["document_id"]) == before
        assert repository.revisions(user_id, document["document_id"])[0]["status"] == "rejected"
