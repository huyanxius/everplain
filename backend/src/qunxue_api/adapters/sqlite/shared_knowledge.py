"""Thin standalone document storage on the existing SQLite database."""

from dataclasses import asdict
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    delete,
    or_,
    select,
)
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.adapters.sqlite.base import Base
from qunxue_api.adapters.sqlite.identity_model import UserRow
from qunxue_api.modules.shared_knowledge import (
    PublicKnowledgePublication,
    SharedDocument,
    SharedKnowledgeBase,
)


class CourseProfileRow(Base):
    __tablename__ = "course_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    guide_dismissed: Mapped[bool] = mapped_column(Boolean, default=False)


class SharedKnowledgeBaseRow(Base):
    __tablename__ = "shared_knowledge_bases"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    request_key: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    share_token: Mapped[str] = mapped_column(String(128), unique=True)
    sharing_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SharedKnowledgePublicationRow(Base):
    __tablename__ = "shared_knowledge_publications"
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("shared_knowledge_bases.id", ondelete="CASCADE"), primary_key=True
    )
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    topics: Mapped[list] = mapped_column(JSON)
    document_ids: Mapped[list] = mapped_column(JSON)
    request_key: Mapped[str] = mapped_column(String(128))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SharedKnowledgePublicationRequestRow(Base):
    __tablename__ = "shared_knowledge_publication_requests"
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("shared_knowledge_bases.id", ondelete="CASCADE"), primary_key=True
    )
    request_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))


class SharedKnowledgeSubscriptionRow(Base):
    __tablename__ = "shared_knowledge_subscriptions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("shared_knowledge_bases.id"), primary_key=True
    )


class SharedDocumentRow(Base):
    __tablename__ = "shared_documents"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    request_key: Mapped[str] = mapped_column(String(128))
    filename: Mapped[str] = mapped_column(String(512))
    media_type: Mapped[str] = mapped_column(String(128))
    content_hash: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    parse_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32))
    segments: Mapped[list] = mapped_column(JSON)
    vectors: Mapped[dict] = mapped_column(JSON, default=dict)
    knowledge_status: Mapped[str] = mapped_column(String(16), default="queued")
    knowledge: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    knowledge_error: Mapped[str | None] = mapped_column(Text)
    knowledge_checkpoints: Mapped[dict] = mapped_column(JSON, default=dict)
    index_status: Mapped[str] = mapped_column(String(16), default="queued")
    index_error: Mapped[str | None] = mapped_column(Text)
    job_token: Mapped[str | None] = mapped_column(String(36))
    job_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SharedKnowledgeDocumentRow(Base):
    __tablename__ = "shared_knowledge_documents"
    knowledge_base_id: Mapped[str] = mapped_column(
        ForeignKey("shared_knowledge_bases.id"), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("shared_documents.id"), primary_key=True, index=True
    )


def _publication(row):
    return PublicKnowledgePublication(
        UUID(row.knowledge_base_id),
        row.title,
        row.description,
        tuple(row.topics),
        tuple(UUID(value) for value in row.document_ids),
        row.request_key,
        row.published_at if row.published_at.tzinfo else row.published_at.replace(tzinfo=UTC),
    )


def _kb(row):
    return SharedKnowledgeBase(
        **{
            key: UUID(getattr(row, key)) if key in {"id", "owner_user_id"} else getattr(row, key)
            for key in SharedKnowledgeBase.__dataclass_fields__
        }
    )


def _document(row):
    return SharedDocument(
        id=UUID(row.id),
        owner_user_id=UUID(row.owner_user_id),
        filename=row.filename,
        media_type=row.media_type,
        content_hash=row.content_hash,
        size_bytes=row.size_bytes,
        parse_id=UUID(row.parse_id),
        status=row.status,
        segments=tuple(row.segments),
        error_message=row.error_message,
        warnings=tuple(row.warnings),
        created_at=row.created_at,
        knowledge_status=row.knowledge_status,
        knowledge=row.knowledge,
        knowledge_error=row.knowledge_error,
        index_status=row.index_status,
        index_error=row.index_error,
    )


class SqliteSharedKnowledgeRepository:
    def __init__(self, session):
        self.session = session

    def course_role(self, user_id):
        row = self.session.get(CourseProfileRow, str(user_id))
        return row.role if row else None

    def course_guide_dismissed(self, user_id):
        row = self.session.get(CourseProfileRow, str(user_id))
        return bool(row and row.guide_dismissed)

    def set_course_role(self, user_id, role, guide_dismissed=False):
        self.session.merge(
            CourseProfileRow(user_id=str(user_id), role=role, guide_dismissed=guide_dismissed)
        )
        self.commit()
        return role

    def retry_document(self, document_id):
        row = self.session.get(SharedDocumentRow, str(document_id))
        # Active work is left alone; retries cannot invalidate a running worker lease.
        for stage in ("knowledge", "index"):
            if getattr(row, f"{stage}_status") == "failed":
                setattr(row, f"{stage}_status", "queued")
                setattr(row, f"{stage}_error", None)
        self.commit()
        return _document(row)

    def commit(self):
        self.session.commit()

    def get(self, kb_id):
        row = self.session.get(SharedKnowledgeBaseRow, str(kb_id), populate_existing=True)
        return _kb(row) if row else None

    def save(self, kb, *, request_key=None):
        values = {
            key: str(value) if isinstance(value, UUID) else value
            for key, value in asdict(kb).items()
        }
        if request_key is not None:
            from sqlalchemy.dialects.sqlite import insert

            self.session.execute(
                insert(SharedKnowledgeBaseRow)
                .values(**values, request_key=request_key)
                .on_conflict_do_nothing(index_elements=["owner_user_id", "request_key"])
            )
        else:
            row = self.session.get(SharedKnowledgeBaseRow, str(kb.id))
            for key, value in values.items():
                setattr(row, key, value)
        self.session.flush()

    def find_request(self, user_id, key):
        row = self.session.scalar(
            select(SharedKnowledgeBaseRow).where(
                SharedKnowledgeBaseRow.owner_user_id == str(user_id),
                SharedKnowledgeBaseRow.request_key == key,
            )
        )
        return _kb(row) if row else None

    def list_for(self, user_id):
        rows = self.session.scalars(
            select(SharedKnowledgeBaseRow)
            .where(
                or_(
                    SharedKnowledgeBaseRow.owner_user_id == str(user_id),
                    SharedKnowledgeBaseRow.id.in_(
                        select(SharedKnowledgeSubscriptionRow.knowledge_base_id).where(
                            SharedKnowledgeSubscriptionRow.user_id == str(user_id)
                        )
                    ),
                ),
                SharedKnowledgeBaseRow.deleted_at.is_(None),
            )
            .execution_options(populate_existing=True)
            .order_by(SharedKnowledgeBaseRow.updated_at.desc())
        )
        return tuple(_kb(row) for row in rows)

    def owned_document(self, user_id, document_id):
        row = self.session.execute(
            select(SharedKnowledgeBaseRow, SharedDocumentRow)
            .join(
                SharedKnowledgeDocumentRow,
                SharedKnowledgeDocumentRow.knowledge_base_id == SharedKnowledgeBaseRow.id,
            )
            .join(SharedDocumentRow, SharedDocumentRow.id == SharedKnowledgeDocumentRow.document_id)
            .where(
                SharedKnowledgeBaseRow.owner_user_id == str(user_id),
                SharedKnowledgeBaseRow.deleted_at.is_(None),
                SharedDocumentRow.owner_user_id == str(user_id),
                SharedDocumentRow.id == str(document_id),
                SharedDocumentRow.status == "ready",
            )
        ).first()
        return (_kb(row[0]), _document(row[1])) if row else None

    def quota_guard(self, user_id):
        from sqlalchemy import text

        # Serialize the final quota check with the write, after parsing has finished.
        # SQLite begins a deferred transaction on reads; this no-op takes its write lock.
        self.session.execute(
            text("UPDATE users SET user_id = user_id WHERE user_id = :user_id"),
            {"user_id": str(user_id)},
        )

    def storage_usage(self, user_id):
        from sqlalchemy import func

        # Only attached documents occupy quota; removed content is purged below.
        return self.session.scalar(
            select(func.coalesce(func.sum(SharedDocumentRow.size_bytes), 0)).where(
                SharedDocumentRow.owner_user_id == str(user_id),
                SharedDocumentRow.id.in_(select(SharedKnowledgeDocumentRow.document_id)),
            )
        )

    def update_knowledge(self, document_id, value):
        row = self.session.get(SharedDocumentRow, str(document_id))
        row.knowledge = value
        row.knowledge_status = "ready"
        row.knowledge_error = None
        row.knowledge_checkpoints = {}
        self.session.flush()
        return _document(row)

    def find_token(self, token):
        row = self.session.scalar(
            select(SharedKnowledgeBaseRow).where(SharedKnowledgeBaseRow.share_token == token)
        )
        return _kb(row) if row else None

    def subscribed(self, user_id, kb_id):
        return (
            self.session.scalar(
                select(SharedKnowledgeSubscriptionRow.user_id).where(
                    SharedKnowledgeSubscriptionRow.user_id == str(user_id),
                    SharedKnowledgeSubscriptionRow.knowledge_base_id == str(kb_id),
                )
            )
            is not None
        )

    def owner_active(self, user_id):
        return (
            self.session.scalar(select(UserRow.status).where(UserRow.user_id == str(user_id)))
            == "active"
        )

    def revoke_readers(self, kb_id):
        self.session.execute(
            delete(SharedKnowledgeSubscriptionRow).where(
                SharedKnowledgeSubscriptionRow.knowledge_base_id == str(kb_id)
            )
        )

    def publication(self, kb_id):
        row = self.session.get(SharedKnowledgePublicationRow, str(kb_id), populate_existing=True)
        return _publication(row) if row else None

    def publish(self, publication):
        self.session.merge(
            SharedKnowledgePublicationRow(
                knowledge_base_id=str(publication.knowledge_base_id),
                title=publication.title,
                description=publication.description,
                topics=list(publication.topics),
                document_ids=[str(value) for value in publication.document_ids],
                request_key=publication.request_key,
                published_at=publication.published_at,
            )
        )
        self.session.flush()

    def publication_request(self, kb_id, key):
        return self.session.scalar(
            select(SharedKnowledgePublicationRequestRow.fingerprint).where(
                SharedKnowledgePublicationRequestRow.knowledge_base_id == str(kb_id),
                SharedKnowledgePublicationRequestRow.request_key == key,
            )
        )

    def record_publication_request(self, kb_id, key, fingerprint):
        self.session.add(
            SharedKnowledgePublicationRequestRow(
                knowledge_base_id=str(kb_id),
                request_key=key,
                fingerprint=fingerprint,
            )
        )
        self.session.flush()

    def unpublish(self, kb_id):
        self.session.execute(
            delete(SharedKnowledgePublicationRow).where(
                SharedKnowledgePublicationRow.knowledge_base_id == str(kb_id)
            )
        )

    def public_directory(self, query, limit, offset):
        statement = (
            select(SharedKnowledgePublicationRow)
            .join(SharedKnowledgeBaseRow)
            .join(UserRow, UserRow.user_id == SharedKnowledgeBaseRow.owner_user_id)
            .where(SharedKnowledgeBaseRow.deleted_at.is_(None), UserRow.status == "active")
        )
        if query:
            statement = statement.where(
                or_(
                    SharedKnowledgePublicationRow.title.contains(query, autoescape=True),
                    SharedKnowledgePublicationRow.description.contains(query, autoescape=True),
                )
            )
        return tuple(
            _publication(row)
            for row in self.session.scalars(
                statement.order_by(
                    SharedKnowledgePublicationRow.published_at.desc(),
                    SharedKnowledgePublicationRow.knowledge_base_id,
                )
                .limit(limit)
                .offset(offset)
            )
        )

    def subscribe(self, user_id, kb_id):
        from sqlalchemy.dialects.sqlite import insert

        result = self.session.execute(
            insert(SharedKnowledgeSubscriptionRow)
            .values(user_id=str(user_id), knowledge_base_id=str(kb_id))
            .on_conflict_do_nothing()
        )
        return result.rowcount == 1

    def unsubscribe(self, user_id, kb_id):
        self.session.execute(
            delete(SharedKnowledgeSubscriptionRow).where(
                SharedKnowledgeSubscriptionRow.user_id == str(user_id),
                SharedKnowledgeSubscriptionRow.knowledge_base_id == str(kb_id),
            )
        )

    def documents(self, kb_id):
        return tuple(
            _document(row)
            for row in self.session.scalars(
                select(SharedDocumentRow)
                .join(
                    SharedKnowledgeDocumentRow,
                    SharedKnowledgeDocumentRow.document_id == SharedDocumentRow.id,
                )
                .where(SharedKnowledgeDocumentRow.knowledge_base_id == str(kb_id))
                .execution_options(populate_existing=True)
                .order_by(SharedDocumentRow.created_at.desc())
            )
        )

    def detach(self, kb_id, document_id=None):
        stmt = delete(SharedKnowledgeDocumentRow).where(
            SharedKnowledgeDocumentRow.knowledge_base_id == str(kb_id)
        )
        if document_id:
            stmt = stmt.where(SharedKnowledgeDocumentRow.document_id == str(document_id))
        removed_ids = list(
            self.session.scalars(
                select(SharedKnowledgeDocumentRow.document_id).where(
                    SharedKnowledgeDocumentRow.knowledge_base_id == str(kb_id)
                )
            )
        )
        self.session.execute(stmt)
        if document_id:
            removed_ids = [str(document_id)]
        # Keep an idempotency tombstone, erase source text, vectors and generated knowledge.
        # An old retry cannot resurrect a removed file or leave private bytes retained forever.
        for removed_id in removed_ids:
            if self.session.scalar(
                select(SharedKnowledgeDocumentRow.document_id).where(
                    SharedKnowledgeDocumentRow.document_id == removed_id
                )
            ):
                continue
            row = self.session.get(SharedDocumentRow, removed_id)
            if row is not None:
                from sqlalchemy import update

                from .knowledge_import import ImportItemRow

                self.session.execute(
                    update(ImportItemRow)
                    .where(ImportItemRow.document_id == removed_id)
                    .values(content=b"")
                )
                row.content = b""
                row.segments = []
                row.vectors = {}
                row.knowledge = None
                row.knowledge_checkpoints = {}
                row.knowledge_status = "failed"
                row.index_status = "failed"
                row.knowledge_error = "资料已删除。"
                row.index_error = "资料已删除。"
                row.job_token = None
                row.job_started_at = None

    def find_upload(self, user_id, key):
        row = self.session.scalar(
            select(SharedDocumentRow).where(
                SharedDocumentRow.owner_user_id == str(user_id),
                SharedDocumentRow.request_key == key,
            )
        )
        return _document(row) if row else None

    def save_document(self, doc, *, content, request_key, kb_id):
        from sqlalchemy.dialects.sqlite import insert

        values = {
            "id": str(doc.id),
            "owner_user_id": str(doc.owner_user_id),
            "request_key": request_key,
            "filename": doc.filename,
            "media_type": doc.media_type,
            "content_hash": doc.content_hash,
            "content": content,
            "size_bytes": doc.size_bytes,
            "parse_id": str(doc.parse_id),
            "status": doc.status,
            "segments": list(doc.segments),
            "vectors": {},
            "warnings": list(doc.warnings),
            "error_message": doc.error_message,
            "created_at": doc.created_at,
        }
        result = self.session.execute(
            insert(SharedDocumentRow)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["owner_user_id", "request_key"])
        )
        if result.rowcount == 0:
            return self.find_upload(doc.owner_user_id, request_key)
        self.session.add(
            SharedKnowledgeDocumentRow(knowledge_base_id=str(kb_id), document_id=str(doc.id))
        )
        self.session.flush()
        return doc

    def vector_cache(self, documents):
        return SharedDocumentVectorCache(
            self.session, {str(doc.id): doc.content_hash for doc in documents}
        )


class SharedDocumentVectorCache:
    def __init__(self, session, allowed):
        self.session, self.allowed = session, allowed

    def _row(self, chunk):
        document_id = chunk.chunk_id.split(":", 2)[1]
        if document_id not in self.allowed:
            return None
        row = self.session.get(SharedDocumentRow, document_id)
        return row if row and row.content_hash == self.allowed[document_id] else None

    def get_many(self, chunks, model):
        return [
            (row.vectors.get(model, {}).get(chunk.chunk_id) if (row := self._row(chunk)) else None)
            for chunk in chunks
        ]

    def put_many(self, chunks, model, vectors):
        for chunk, vector in zip(chunks, vectors, strict=True):
            row = self._row(chunk)
            if row is not None:
                row.vectors = {
                    **row.vectors,
                    model: {**row.vectors.get(model, {}), chunk.chunk_id: list(vector)},
                }
        self.session.flush()
