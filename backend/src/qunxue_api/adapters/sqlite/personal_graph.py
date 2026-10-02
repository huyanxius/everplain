from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, select
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.personal_graph import mock_vector

from .agent_profile import SqliteAgentProfileRepository
from .base import Base
from .knowledge_import import ImportSourceRow
from .shared_knowledge import SharedDocumentRow, SharedKnowledgeBaseRow, SharedKnowledgeDocumentRow


class PersonalGraphRow(Base):
    __tablename__ = "personal_graphs"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[dict] = mapped_column(JSON)
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SqlitePersonalGraphRepository:
    def __init__(self, session, *, mock=False):
        self.session, self.mock = session, mock

    def load(self, user_id):
        row = self.session.get(PersonalGraphRow, str(user_id))
        return row.state if row else {"topics": {}, "assignments": {}}

    def save(self, user_id, state, pending):
        self.session.merge(
            PersonalGraphRow(
                user_id=str(user_id), state=state, pending=pending, updated_at=datetime.now(UTC)
            )
        )
        self.session.commit()

    def mark_dirty(self, user_id):
        self.save(user_id, self.load(user_id), True)

    def next_pending(self):
        value = self.session.scalar(
            select(PersonalGraphRow.user_id).where(PersonalGraphRow.pending.is_(True)).limit(1)
        )
        return UUID(value) if value else None

    def profile(self, user_id):
        return SqliteAgentProfileRepository(self.session).get(user_id)

    def documents(self, user_id):
        rows = self.session.execute(
            select(SharedDocumentRow, SharedKnowledgeBaseRow.id)
            .join(
                SharedKnowledgeDocumentRow,
                SharedKnowledgeDocumentRow.document_id == SharedDocumentRow.id,
            )
            .join(
                SharedKnowledgeBaseRow,
                SharedKnowledgeBaseRow.id == SharedKnowledgeDocumentRow.knowledge_base_id,
            )
            .where(
                SharedDocumentRow.owner_user_id == str(user_id),
                SharedDocumentRow.status == "ready",
                SharedKnowledgeBaseRow.owner_user_id == str(user_id),
                SharedKnowledgeBaseRow.deleted_at.is_(None),
            )
            .order_by(SharedDocumentRow.created_at, SharedDocumentRow.id)
        ).all()
        sources = {
            r.document_id: r
            for r in self.session.scalars(
                select(ImportSourceRow).where(ImportSourceRow.user_id == str(user_id))
            )
        }
        result, seen = [], set()
        for doc, library_id in rows:
            if doc.id in seen:
                continue
            seen.add(doc.id)
            text = "\n".join(s["text"] for s in doc.segments)
            source = sources.get(doc.id)
            title = doc.filename.rsplit(".", 1)[0]
            first_heading = next(
                (
                    s["text"].lstrip("# ").strip()
                    for s in doc.segments
                    if s.get("kind") == "heading"
                ),
                None,
            )
            title = first_heading or title
            vectors = [v for model in (doc.vectors or {}).values() for v in model.values() if v]
            vector = (
                [sum(v[i] for v in vectors) / len(vectors) for i in range(len(vectors[0]))]
                if vectors and all(len(v) == len(vectors[0]) for v in vectors)
                else []
            )
            if not vector and self.mock:
                vector = mock_vector(title + "\n" + text[:12000])
            result.append(
                {
                    "id": doc.id,
                    "title": title,
                    "hash": doc.content_hash,
                    "vector": vector,
                    "library_id": library_id,
                    "knowledge": doc.knowledge or {},
                    "source_url": source.source_url if source else None,
                    "relative_path": source.relative_path if source else doc.filename,
                    "wiki_links": source.details.get("wiki_links", []) if source else [],
                }
            )
        return result
