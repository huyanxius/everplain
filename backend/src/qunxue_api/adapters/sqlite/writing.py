"""Owner-scoped persistence and optimistic updates for the writing workspace."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import (
    JSON,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    select,
    update,
)
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.writing import StyleSample, WritingConflict, fingerprint

from .base import Base


def now():
    return datetime.now(UTC).isoformat()


class WritingSampleRow(Base):
    __tablename__ = "writing_samples"
    sample_id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    genre: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String)
    __table_args__ = (UniqueConstraint("user_id", "content_hash"),)


class WritingDocumentRow(Base):
    __tablename__ = "writing_documents"
    document_id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    genre: Mapped[str] = mapped_column(String(20))
    markdown: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class WritingRevisionRow(Base):
    __tablename__ = "writing_revisions"
    revision_id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("writing_documents.document_id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    base_version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(20))
    before_markdown: Mapped[str] = mapped_column(Text)
    after_markdown: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20))
    warnings: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String)


class WritingOperationRow(Base):
    __tablename__ = "writing_operations"
    operation_id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    request_key: Mapped[str] = mapped_column(String(200))
    request_hash: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String)
    __table_args__ = (
        UniqueConstraint("user_id", "request_key"),
        Index(
            "uq_writing_running_target",
            "user_id",
            "target",
            unique=True,
            sqlite_where=(status == "running"),
        ),
    )


def document_dict(row):
    return {
        k: getattr(row, k)
        for k in (
            "document_id",
            "title",
            "genre",
            "markdown",
            "version",
            "created_at",
            "updated_at",
        )
    }


def revision_dict(row):
    return {
        k: getattr(row, k)
        for k in (
            "revision_id",
            "document_id",
            "base_version",
            "action",
            "before_markdown",
            "after_markdown",
            "status",
            "warnings",
            "created_at",
        )
    }


def sample_dict(row):
    return {
        "sample_id": row.sample_id,
        "title": row.title,
        "genre": row.genre,
        "character_count": len(row.text),
        "created_at": row.created_at,
    }


class SqliteWritingRepository:
    def __init__(self, session):
        self.session = session

    def commit(self):
        self.session.commit()

    def fail(self, operation):
        self.session.rollback()
        # A stale worker cannot rewrite a newer operation or a completed result.
        self.session.execute(
            update(WritingOperationRow)
            .where(
                WritingOperationRow.operation_id == operation.operation_id,
                WritingOperationRow.status == "running",
            )
            .values(status="failed", result=None)
        )
        self.session.commit()

    def samples(self, user_id):
        return list(
            self.session.scalars(
                select(WritingSampleRow)
                .where(WritingSampleRow.user_id == str(user_id))
                .order_by(WritingSampleRow.created_at.desc())
            )
        )

    def style_samples(self, user_id):
        return [StyleSample(r.sample_id, r.title, r.genre, r.text) for r in self.samples(user_id)]

    def add_sample(self, user_id, *, title, genre, text):
        rows = self.samples(user_id)
        content_hash = fingerprint(text)
        existing = next((r for r in rows if r.content_hash == content_hash), None)
        if existing:
            if existing.genre != genre:
                raise WritingConflict("这篇样文已属于另一文体，请先移除旧样文再重新添加")
            return sample_dict(existing)
        if len(rows) >= 100:
            raise ValueError("最多保留100篇样文，请先移除不再使用的文章")
        row = WritingSampleRow(
            sample_id=str(uuid4()),
            user_id=str(user_id),
            title=title,
            genre=genre,
            text=text,
            content_hash=content_hash,
            created_at=now(),
        )
        self.session.add(row)
        self.session.flush()
        return sample_dict(row)

    def delete_sample(self, user_id, sample_id):
        row = self.session.scalar(
            select(WritingSampleRow).where(
                WritingSampleRow.user_id == str(user_id),
                WritingSampleRow.sample_id == str(sample_id),
            )
        )
        if row is None:
            raise LookupError(sample_id)
        self.session.delete(row)
        self.session.flush()

    def documents(self, user_id):
        return [
            document_dict(r)
            for r in self.session.scalars(
                select(WritingDocumentRow)
                .where(WritingDocumentRow.user_id == str(user_id))
                .order_by(WritingDocumentRow.updated_at.desc())
                .limit(100)
            )
        ]

    def get(self, user_id, document_id):
        row = self.session.scalar(
            select(WritingDocumentRow)
            .where(
                WritingDocumentRow.user_id == str(user_id),
                WritingDocumentRow.document_id == str(document_id),
            )
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise LookupError(document_id)
        return document_dict(row)

    def create(self, user_id, payload):
        timestamp = now()
        row = WritingDocumentRow(
            document_id=str(uuid4()),
            user_id=str(user_id),
            version=1,
            created_at=timestamp,
            updated_at=timestamp,
            **payload,
        )
        self.session.add(row)
        self.session.flush()
        return document_dict(row)

    def update(self, user_id, document_id, expected_version, changes):
        self.get(user_id, document_id)
        result = self.session.execute(
            update(WritingDocumentRow)
            .where(
                WritingDocumentRow.user_id == str(user_id),
                WritingDocumentRow.document_id == str(document_id),
                WritingDocumentRow.version == expected_version,
            )
            .values(**changes, version=expected_version + 1, updated_at=now())
        )
        if result.rowcount != 1:
            raise WritingConflict("文稿已更新，请刷新后重试；你的修改没有覆盖原文")
        self.session.execute(
            update(WritingRevisionRow)
            .where(
                WritingRevisionRow.user_id == str(user_id),
                WritingRevisionRow.document_id == str(document_id),
                WritingRevisionRow.status == "pending",
            )
            .values(status="stale")
        )
        return self.get(user_id, document_id)

    def revisions(self, user_id, document_id):
        self.get(user_id, document_id)
        return [
            revision_dict(r)
            for r in self.session.scalars(
                select(WritingRevisionRow)
                .where(
                    WritingRevisionRow.user_id == str(user_id),
                    WritingRevisionRow.document_id == str(document_id),
                )
                .order_by(WritingRevisionRow.created_at.desc())
            )
        ]

    def add_revision(self, user_id, document, *, action, after_markdown, warnings):
        latest = self.get(user_id, document["document_id"])
        status = "pending" if latest["version"] == document["version"] else "stale"
        row = WritingRevisionRow(
            revision_id=str(uuid4()),
            user_id=str(user_id),
            document_id=document["document_id"],
            base_version=document["version"],
            action=action,
            before_markdown=document["markdown"],
            after_markdown=after_markdown,
            status=status,
            warnings=warnings,
            created_at=now(),
        )
        self.session.add(row)
        self.session.flush()
        return revision_dict(row)

    def resolve(self, user_id, document_id, revision_id, decision, expected_version):
        document = self.get(user_id, document_id)
        row = self.session.scalar(
            select(WritingRevisionRow).where(
                WritingRevisionRow.user_id == str(user_id),
                WritingRevisionRow.document_id == str(document_id),
                WritingRevisionRow.revision_id == str(revision_id),
            )
        )
        if row is None:
            raise LookupError(revision_id)
        if row.status != "pending":
            raise WritingConflict("这条修订已处理或过期，请刷新后查看")
        if document["version"] != expected_version or row.base_version != expected_version:
            raise WritingConflict("原文已改变，请重新生成修订")
        # The in-memory row may have been read before another request resolved
        # this revision. Claim its transition in SQL before touching the draft;
        # a rejected revision must never be reopened by a late acceptance.
        changed = self.session.execute(
            update(WritingRevisionRow)
            .where(
                WritingRevisionRow.user_id == str(user_id),
                WritingRevisionRow.document_id == str(document_id),
                WritingRevisionRow.revision_id == str(revision_id),
                WritingRevisionRow.status == "pending",
                WritingRevisionRow.base_version == expected_version,
            )
            .values(status="accepted" if decision == "accept" else "rejected")
        )
        if changed.rowcount != 1:
            raise WritingConflict("这条修订已处理或过期，请刷新后查看")
        if decision == "accept":
            document = self.update(
                user_id, document_id, expected_version, {"markdown": row.after_markdown}
            )
        self.session.flush()
        self.session.refresh(row)
        return {"document": document, "revision": revision_dict(row)}

    def operation(self, user_id, key, request_hash):
        row = self.session.scalar(
            select(WritingOperationRow).where(
                WritingOperationRow.user_id == str(user_id), WritingOperationRow.request_key == key
            )
        )
        if row is not None:
            if row.request_hash != request_hash:
                raise WritingConflict("同一请求标识不能用于不同内容")
            if row.status == "failed":
                raise WritingConflict("上次生成未完成，原文没有改变；请使用新的请求标识重试")
            if row.status != "completed":
                raise WritingConflict("请求仍在运行或未完成，请检查文稿后使用新的请求标识重试")
        return row

    def start(self, user_id, key, request_hash, target):
        # A crashed process must not lock a document forever. A one-hour lease is
        # deliberately longer than the bounded three-stage normal model budget.
        # Expired generators are fenced by complete() and cannot deliver later.
        self.session.execute(
            update(WritingOperationRow)
            .where(
                WritingOperationRow.user_id == str(user_id),
                WritingOperationRow.target == target,
                WritingOperationRow.status == "running",
                WritingOperationRow.created_at
                < (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
            )
            .values(status="failed")
        )
        row = WritingOperationRow(
            operation_id=str(uuid4()),
            user_id=str(user_id),
            request_key=key,
            request_hash=request_hash,
            target=target,
            status="running",
            result=None,
            created_at=now(),
        )
        self.session.add(row)
        self.session.flush()
        return row

    def complete(self, operation, result):
        saved = self.session.execute(
            update(WritingOperationRow)
            .where(
                WritingOperationRow.operation_id == operation.operation_id,
                WritingOperationRow.status == "running",
            )
            .values(status="completed", result=result)
        )
        if saved.rowcount != 1:
            raise WritingConflict("生成请求已过期，结果未覆盖原文，请重新生成")
        self.session.flush()
