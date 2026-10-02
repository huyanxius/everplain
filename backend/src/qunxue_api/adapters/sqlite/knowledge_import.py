from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    select,
    update,
)
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.knowledge_import import ImportUnavailable, batch_progress

from .base import Base
from .shared_knowledge import SharedDocumentRow, SharedKnowledgeDocumentRow


class ImportBatchRow(Base):
    __tablename__ = "import_batches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    library_id: Mapped[str] = mapped_column(ForeignKey("shared_knowledge_bases.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ImportItemRow(Base):
    __tablename__ = "import_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    source_key: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(512))
    source_url: Mapped[str | None] = mapped_column(Text)
    relative_path: Mapped[str] = mapped_column(Text)
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    media_type: Mapped[str] = mapped_column(String(128))
    details: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36))
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ImportSourceRow(Base):
    __tablename__ = "import_sources"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    source_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("shared_documents.id"))
    relative_path: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON)


def item_view(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "title",
            "filename",
            "source_url",
            "relative_path",
            "status",
            "document_id",
            "error",
            "attempts",
        )
    }


class SqliteImportRepository:
    def __init__(self, session):
        self.session = session

    def create(self, user_id, library_id, source_type, items):
        now = datetime.now(UTC)
        batch = ImportBatchRow(
            id=str(uuid4()),
            user_id=str(user_id),
            library_id=str(library_id),
            source_type=source_type,
            created_at=now,
        )
        self.session.add(batch)
        self.session.flush()
        for item in items:
            self.session.add(
                ImportItemRow(
                    id=str(uuid4()),
                    batch_id=batch.id,
                    user_id=str(user_id),
                    source_key=item["source_key"],
                    title=item["title"][:512],
                    filename=item["filename"][:512],
                    source_url=item.get("source_url"),
                    relative_path=item["relative_path"],
                    content=item["content"],
                    media_type=item["media_type"],
                    details={
                        "wiki_links": item.get("wiki_links", []),
                        "metadata": item.get("metadata", {}),
                    },
                    status="failed" if item.get("error") else "queued",
                    document_id=None,
                    error=item.get("error"),
                    attempts=0,
                    started_at=None,
                    created_at=now,
                )
            )
        self.session.commit()
        return self.get(user_id, batch.id)

    def get(self, user_id, batch_id):
        batch = self.session.get(ImportBatchRow, str(batch_id))
        if batch is None or batch.user_id != str(user_id):
            raise ImportUnavailable("导入批次不存在")
        items = [
            item_view(row)
            for row in self.session.scalars(
                select(ImportItemRow)
                .where(ImportItemRow.batch_id == batch.id)
                .order_by(ImportItemRow.created_at, ImportItemRow.id)
            )
        ]
        return {
            "id": batch.id,
            "library_id": batch.library_id,
            "source_type": batch.source_type,
            "created_at": batch.created_at,
            "items": items,
            **batch_progress(items),
        }

    def list(self, user_id):
        ids = self.session.scalars(
            select(ImportBatchRow.id)
            .where(ImportBatchRow.user_id == str(user_id))
            .order_by(ImportBatchRow.created_at.desc())
            .limit(30)
        )
        return [self.get(user_id, id) for id in ids]

    def retry(self, user_id, batch_id, item_id):
        self.get(user_id, batch_id)
        row = self.session.get(ImportItemRow, str(item_id))
        if row is None or row.batch_id != str(batch_id):
            raise ImportUnavailable("导入条目不存在")
        if row.status == "failed":
            row.status, row.error = "queued", None
            self.session.commit()
        return self.get(user_id, batch_id)

    def claim(self):
        now = datetime.now(UTC)
        self.session.execute(
            update(ImportItemRow)
            .where(
                ImportItemRow.status == "running",
                ImportItemRow.started_at < now - timedelta(minutes=5),
            )
            .values(status="queued")
        )
        id = self.session.scalar(
            select(ImportItemRow.id)
            .where(ImportItemRow.status == "queued")
            .order_by(ImportItemRow.created_at, ImportItemRow.id)
            .limit(1)
        )
        if not id:
            self.session.commit()
            return None
        changed = self.session.execute(
            update(ImportItemRow)
            .where(ImportItemRow.id == id, ImportItemRow.status == "queued")
            .values(status="running", started_at=now, attempts=ImportItemRow.attempts + 1)
        )
        self.session.commit()
        if changed.rowcount != 1:
            return None
        row = self.session.get(ImportItemRow, id, populate_existing=True)
        batch = self.session.get(ImportBatchRow, row.batch_id)
        return {
            **item_view(row),
            "user_id": UUID(row.user_id),
            "library_id": UUID(batch.library_id),
            "source_key": row.source_key,
            "content": row.content,
            "media_type": row.media_type,
            "details": row.details,
            "source_type": batch.source_type,
        }

    def existing(self, item):
        source = self.session.get(ImportSourceRow, (str(item["user_id"]), item["source_key"]))
        doc = self.session.get(SharedDocumentRow, source.document_id) if source else None
        if doc is None or doc.owner_user_id != str(item["user_id"]) or doc.status != "ready":
            return None
        key = (str(item["library_id"]), doc.id)
        if self.session.get(SharedKnowledgeDocumentRow, key) is None:
            self.session.add(
                SharedKnowledgeDocumentRow(knowledge_base_id=key[0], document_id=key[1])
            )
        return doc.id

    def complete(self, item, document_id, duplicate=False):
        row = self.session.get(ImportItemRow, item["id"])
        row.status, row.document_id, row.error, row.content = (
            ("duplicate" if duplicate else "imported"),
            str(document_id),
            None,
            b"",
        )
        self.session.merge(
            ImportSourceRow(
                user_id=str(item["user_id"]),
                source_key=item["source_key"],
                document_id=str(document_id),
                relative_path=item["relative_path"],
                source_url=item["source_url"],
                details=item["details"],
            )
        )
        self.session.commit()

    def fail(self, item, reason):
        self.session.rollback()
        row = self.session.get(ImportItemRow, item["id"])
        row.status, row.error = "failed", reason[:300]
        self.session.commit()
