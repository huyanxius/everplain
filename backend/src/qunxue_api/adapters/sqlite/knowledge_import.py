import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.knowledge_import import (
    ImportUnavailable,
    batch_progress,
    source_fingerprint,
)

from .base import Base
from .shared_knowledge import SharedDocumentRow, SharedKnowledgeDocumentRow


class ImportBatchRow(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        Index("uq_import_batches_user_request", "user_id", "request_key", unique=True),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    library_id: Mapped[str] = mapped_column(ForeignKey("shared_knowledge_bases.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(32))
    request_key: Mapped[str | None] = mapped_column(String(64))
    fingerprint: Mapped[str | None] = mapped_column(String(64))
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


class ImportAttachmentRow(Base):
    __tablename__ = "import_attachments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    item_id: Mapped[str] = mapped_column(
        ForeignKey("import_items.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("shared_documents.id", ondelete="CASCADE"), index=True
    )
    relative_path: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(String(512))
    media_type: Mapped[str] = mapped_column(String(128))
    references: Mapped[list] = mapped_column(JSON)
    size_bytes: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


def attachment_view(row):
    return {
        "id": row.id,
        "relative_path": row.relative_path,
        "filename": row.filename,
        "media_type": row.media_type,
        "size_bytes": row.size_bytes,
        "references": row.references,
        "url": f"/api/imports/assets/{row.document_id}/attachments/{row.id}"
        if row.document_id
        else None,
    }


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

    def retained_bytes(self, user_id):
        return self.session.scalar(
            select(func.coalesce(func.sum(func.length(ImportItemRow.content)), 0)).where(
                ImportItemRow.user_id == str(user_id)
            )
        )

    def attachment_bytes(self, user_id):
        return self.session.scalar(
            select(func.coalesce(func.sum(ImportAttachmentRow.size_bytes), 0)).where(
                ImportAttachmentRow.user_id == str(user_id)
            )
        )

    def find_request(self, user_id, request_key, fingerprint):
        if request_key is None:
            return None
        row = self.session.scalar(
            select(ImportBatchRow).where(
                ImportBatchRow.user_id == str(user_id),
                ImportBatchRow.request_key == hashlib.sha256(request_key.encode()).hexdigest(),
            )
        )
        if row is not None:
            if row.fingerprint != fingerprint:
                raise ValueError("相同请求标识不能导入不同内容，请重新发起导入")
            return self.get(user_id, row.id)
        return None

    def asset(self, user_id, document_id, attachment_id=None):
        doc = self.session.get(SharedDocumentRow, str(document_id))
        if not doc or doc.owner_user_id != str(user_id) or not doc.segments:
            raise ImportUnavailable("附件不存在")
        if attachment_id is not None:
            row = self.session.get(ImportAttachmentRow, str(attachment_id))
            if row is None or row.user_id != str(user_id) or row.document_id != str(document_id):
                raise ImportUnavailable("附件不存在")
            return row.content, row.media_type, row.filename
        row = self.session.scalar(
            select(ImportItemRow).where(
                ImportItemRow.user_id == str(user_id),
                ImportItemRow.document_id == str(document_id),
                ImportItemRow.media_type.like("image/%"),
                func.length(ImportItemRow.content) > 0,
            )
        )
        if row is None:
            raise ImportUnavailable("图片不存在")
        return row.content, row.media_type

    def create(
        self,
        user_id,
        library_id,
        source_type,
        items,
        request_key=None,
        fingerprint=None,
        max_documents=None,
    ):
        now = datetime.now(UTC)
        batch = ImportBatchRow(
            id=str(uuid4()),
            user_id=str(user_id),
            library_id=str(library_id),
            source_type=source_type,
            request_key=hashlib.sha256(request_key.encode()).hexdigest() if request_key else None,
            fingerprint=fingerprint,
            created_at=now,
        )
        self.session.add(batch)
        self.session.flush()
        self.add_items(batch.id, user_id, items, library_id, max_documents)
        self.session.commit()
        return self.get(user_id, batch.id)

    def add_items(self, batch_id, user_id, items, library_id=None, max_documents=None):
        now = datetime.now(UTC)
        for item in items:
            item_id = str(uuid4())
            unchanged_id = item.get("_unchanged_id")
            error = item.get("error")
            if unchanged_id:
                attached = self.session.get(
                    SharedKnowledgeDocumentRow, (str(library_id), unchanged_id)
                )
                count = self.session.scalar(
                    select(func.count()).where(
                        SharedKnowledgeDocumentRow.knowledge_base_id == str(library_id)
                    )
                )
                if attached is None and max_documents is not None and count >= max_documents:
                    error = "知识库文件数量已达上限"
                else:
                    self.attach({"library_id": library_id}, unchanged_id)
            self.session.add(
                ImportItemRow(
                    id=item_id,
                    batch_id=batch_id,
                    user_id=str(user_id),
                    source_key=item["source_key"],
                    title=item["title"][:512],
                    filename=item["filename"][:512],
                    source_url=item.get("source_url"),
                    relative_path=item["relative_path"],
                    content=b"" if unchanged_id else item["content"],
                    media_type=item["media_type"],
                    details={
                        "wiki_links": item.get("wiki_links", []),
                        "metadata": item.get("metadata", {}),
                        "fingerprint": source_fingerprint(item),
                    },
                    status="failed" if error else "duplicate" if unchanged_id else "queued",
                    document_id=unchanged_id if not error else None,
                    error=error,
                    attempts=0,
                    started_at=None,
                    created_at=now,
                )
            )
            self.session.flush()
            for asset in () if unchanged_id else item.get("attachments", []):
                self.session.add(
                    ImportAttachmentRow(
                        id=str(uuid4()),
                        item_id=item_id,
                        user_id=str(user_id),
                        document_id=None,
                        relative_path=asset["relative_path"],
                        filename=asset["filename"][:512],
                        media_type=asset["media_type"],
                        references=asset["references"],
                        content=asset["content"],
                        size_bytes=len(asset["content"]),
                    )
                )

    def expand(self, item, items):
        row = self.assert_claim(item)
        self.add_items(row.batch_id, item["user_id"], items)
        self.session.delete(row)
        self.session.commit()

    def get(self, user_id, batch_id):
        batch = self.session.get(ImportBatchRow, str(batch_id))
        if batch is None or batch.user_id != str(user_id):
            raise ImportUnavailable("导入批次不存在")
        items = []
        for row in self.session.scalars(
            select(ImportItemRow)
            .where(ImportItemRow.batch_id == batch.id)
            .order_by(ImportItemRow.created_at, ImportItemRow.id)
        ):
            value = item_view(row)
            assets = self.session.scalars(
                select(ImportAttachmentRow)
                .where(
                    ImportAttachmentRow.document_id == row.document_id
                    if row.document_id
                    else ImportAttachmentRow.item_id == row.id,
                    ImportAttachmentRow.user_id == str(user_id),
                )
                .order_by(ImportAttachmentRow.relative_path)
            )
            value["attachments"] = [attachment_view(asset) for asset in assets]
            items.append(value)
        return {
            "id": batch.id,
            "library_id": batch.library_id,
            "source_type": batch.source_type,
            "created_at": batch.created_at,
            "items": items,
            "attachment_count": sum(len(item["attachments"]) for item in items),
            "attachment_bytes": sum(
                asset["size_bytes"] for item in items for asset in item["attachments"]
            ),
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
            "has_attachments": bool(
                self.session.scalar(
                    select(func.count()).where(ImportAttachmentRow.item_id == row.id)
                )
            ),
        }

    def existing(self, item):
        source = self.session.get(
            ImportSourceRow, (str(item["user_id"]), item["source_key"]), populate_existing=True
        )
        doc = (
            self.session.get(SharedDocumentRow, source.document_id, populate_existing=True)
            if source
            else None
        )
        if (
            doc is None
            or doc.owner_user_id != str(item["user_id"])
            or doc.status != "ready"
            or not doc.segments
        ):
            return None
        fingerprint = source.details.get("fingerprint")
        unchanged = (
            fingerprint == item["details"].get("fingerprint")
            if fingerprint
            else (
                not item["content"]
                or doc.content_hash == hashlib.sha256(item["content"]).hexdigest()
            )
            and not item.get("attachments")
            and not item.get("has_attachments")
        )
        return {
            "id": doc.id,
            "unchanged": unchanged,
            "content_hash": doc.content_hash,
            "filename": doc.filename,
            "size_bytes": doc.size_bytes,
        }

    def unchanged(self, user_id, item):
        if item.get("error") or (not item["content"] and item.get("source_url")):
            # A URL alone says nothing about the current remote body.
            return None
        existing = self.existing(
            {
                **item,
                "user_id": user_id,
                "details": {"fingerprint": source_fingerprint(item)},
            }
        )
        return existing["id"] if existing and existing["unchanged"] else None

    def attach(self, item, document_id):
        key = (str(item["library_id"]), str(document_id))
        if self.session.get(SharedKnowledgeDocumentRow, key) is None:
            self.session.add(
                SharedKnowledgeDocumentRow(knowledge_base_id=key[0], document_id=key[1])
            )

    def assert_claim(self, item):
        row = self.session.get(ImportItemRow, item["id"], populate_existing=True)
        if row is None or row.status != "running" or row.attempts != item["attempts"]:
            raise ImportUnavailable("导入任务已由其他工作进程接续")
        return row

    def complete(self, item, document_id, duplicate=False, updated=False):
        row = self.assert_claim(item)
        self.attach(item, document_id)
        row.status, row.document_id, row.error, row.content = (
            ("duplicate" if duplicate else "updated" if updated else "imported"),
            str(document_id),
            None,
            row.content if item["source_type"] == "image" and not duplicate else b"",
        )
        if duplicate:
            self.session.execute(
                delete(ImportAttachmentRow).where(
                    ImportAttachmentRow.item_id == item["id"],
                    ImportAttachmentRow.document_id.is_(None),
                )
            )
        else:
            # Replacement assets commit with the document and source identity. Failed
            # parses leave the previous ready document and its assets untouched.
            self.session.execute(
                delete(ImportAttachmentRow).where(
                    ImportAttachmentRow.document_id == str(document_id),
                    ImportAttachmentRow.item_id != item["id"],
                )
            )
            self.session.execute(
                update(ImportAttachmentRow)
                .where(
                    ImportAttachmentRow.item_id == item["id"],
                    ImportAttachmentRow.user_id == str(item["user_id"]),
                )
                .values(document_id=str(document_id))
            )
            self.session.execute(
                update(ImportItemRow)
                .where(
                    ImportItemRow.document_id == str(document_id),
                    ImportItemRow.id != item["id"],
                    ImportItemRow.media_type.like("image/%"),
                )
                .values(content=b"")
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
        row = self.session.get(ImportItemRow, item["id"], populate_existing=True)
        if row is None or row.status != "running" or row.attempts != item["attempts"]:
            return
        row.status, row.error = "failed", reason[:300]
        self.session.commit()
