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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from qunxue_api.modules.writing import StyleSample, WritingConflict, fingerprint

from .agent_conversation_model import AgentOutputEventRow, AgentRunRow
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
    selection_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    selection_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
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


_REVISION_FIELDS = (
    "revision_id", "document_id", "base_version", "action", "before_markdown",
    "after_markdown", "status", "warnings", "selection_start", "selection_end", "created_at",
)


def revision_dict(row):
    return {key: getattr(row, key) for key in _REVISION_FIELDS}


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

    def _abandoned_agent_revision(self, revision):
        operation = self.session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.user_id == revision.user_id,
            WritingOperationRow.target == f"revision:{revision.document_id}",
            WritingOperationRow.result["revision_id"].as_string() == revision.revision_id,
        ))
        provenance = (operation.result or {}).get("_agent_provenance") if operation else None
        if not isinstance(provenance, dict):
            return False
        run = self.session.get(AgentRunRow, provenance.get("run_id"))
        if run is not None and run.status == "completed":
            return False
        ready = self.session.scalar(select(AgentOutputEventRow.sequence).where(
            AgentOutputEventRow.run_id == provenance["run_id"],
            AgentOutputEventRow.name == "writing_preview",
            AgentOutputEventRow.payload["state"].as_string() == "ready",
            AgentOutputEventRow.payload["revision_id"].as_string() == revision.revision_id,
        ).limit(1))
        if ready is not None:
            return False
        expiry = run.lease_expires_at if run is not None else None
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        return (run is None or run.cancel_requested or run.status != "running"
                or expiry is None or expiry <= datetime.now(UTC))

    def reconcile_abandoned_agent_revisions(self, user_id, document_id):
        # Used only by the read-only HTTP revisions entrypoint, never a model
        # callback or an in-flight business transaction. The independent cleanup
        # cannot accidentally commit another tool's half-written operation.
        self.get(user_id, document_id)
        with Session(self.session.get_bind()) as session:
            repository = SqliteWritingRepository(session)
            # Acquire the SQLite write reservation before reading run/ready
            # proof. Renewal, retry and ready publication cannot interleave with
            # the subsequent pending rejection inside this same transaction.
            session.execute(update(WritingRevisionRow).where(
                WritingRevisionRow.user_id == str(user_id),
                WritingRevisionRow.document_id == str(document_id),
                WritingRevisionRow.status == "pending",
            ).values(status=WritingRevisionRow.status).execution_options(
                synchronize_session=False,
            ))
            pending = session.scalars(select(WritingRevisionRow).where(
                WritingRevisionRow.user_id == str(user_id),
                WritingRevisionRow.document_id == str(document_id),
                WritingRevisionRow.status == "pending",
            )).all()
            for revision in pending:
                if repository._abandoned_agent_revision(revision):
                    session.execute(update(WritingRevisionRow).where(
                        WritingRevisionRow.revision_id == revision.revision_id,
                        WritingRevisionRow.user_id == str(user_id),
                        WritingRevisionRow.status == "pending",
                    ).values(status="rejected"))
            session.commit()

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

    def _pending_revisions(self, user_id, document_id, *columns):
        # Both owners are constrained; no historical bodies or cached ORM state
        # are needed for a live edit eligibility query.
        return select(*columns).join(
            WritingDocumentRow,
            WritingDocumentRow.document_id == WritingRevisionRow.document_id,
        ).where(
            WritingDocumentRow.user_id == str(user_id),
            WritingRevisionRow.user_id == str(user_id),
            WritingRevisionRow.document_id == str(document_id),
            WritingRevisionRow.status == "pending",
        )

    def has_pending_revision(self, user_id, document_id):
        return self.session.scalar(select(self._pending_revisions(
            user_id, document_id, WritingRevisionRow.revision_id,
        ).exists()))

    def pending_revision_ids(self, user_id, document_id):
        return list(self.session.scalars(self._pending_revisions(
            user_id, document_id, WritingRevisionRow.revision_id,
        ).order_by(WritingRevisionRow.created_at.desc())))

    def pending_revision(self, user_id, document_id, revision_id):
        # Column projection deliberately bypasses the Session identity map: a
        # different request may have accepted/rejected this revision meanwhile.
        row = self.session.execute(self._pending_revisions(
            user_id, document_id, *(getattr(WritingRevisionRow, key) for key in _REVISION_FIELDS),
        ).where(WritingRevisionRow.revision_id == str(revision_id))).mappings().first()
        return dict(row) if row is not None else None

    def add_revision(self, user_id, document, *, action, after_markdown, warnings,
                     selection_start=None, selection_end=None):
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
            selection_start=selection_start,
            selection_end=selection_end,
            created_at=now(),
        )
        self.session.add(row)
        self.session.flush()
        return revision_dict(row)

    def require_agent_execution(self, user_id, fence):
        run = self.session.scalar(select(AgentRunRow).where(
            AgentRunRow.run_id == str(fence["run_id"]), AgentRunRow.user_id == str(user_id),
            AgentRunRow.lease_token == fence["lease_token"], AgentRunRow.status == "running",
            AgentRunRow.cancel_requested.is_(False),
            AgentRunRow.lease_expires_at > datetime.now(UTC),
        ).execution_options(populate_existing=True))
        if run is None:
            raise WritingConflict("写作请求已取消或执行租约已失效，未创建修订")

    def discard_agent_revision(self, user_id, document_id, run_id, revision, expected_fence=None):
        # Provenance binds cleanup to the exact revision created by this logical
        # run. A late cleanup cannot reject unrelated or already accepted work.
        self.session.execute(update(WritingRevisionRow).where(
            WritingRevisionRow.user_id == str(user_id),
            WritingRevisionRow.document_id == str(document_id),
            WritingRevisionRow.revision_id == revision.get("revision_id"),
            WritingRevisionRow.status == "pending",
        ).values(status=WritingRevisionRow.status).execution_options(synchronize_session=False))
        if expected_fence is not None:
            current = self.session.scalar(select(AgentRunRow).where(
                AgentRunRow.run_id == str(run_id), AgentRunRow.user_id == str(user_id),
            ).execution_options(populate_existing=True))
            if current is not None and current.lease_token != expected_fence["lease_token"]:
                expiry = current.lease_expires_at
                if expiry is not None and expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=UTC)
                healthy = (current.status == "running" and not current.cancel_requested
                           and expiry is not None and expiry > datetime.now(UTC))
                ready = self.session.scalar(select(AgentOutputEventRow.sequence).where(
                    AgentOutputEventRow.run_id == str(run_id),
                    AgentOutputEventRow.attempt_id != expected_fence["lease_token"],
                    AgentOutputEventRow.name == "writing_preview",
                    AgentOutputEventRow.payload["state"].as_string() == "ready",
                    AgentOutputEventRow.payload["revision_id"].as_string()
                    == revision.get("revision_id"),
                ).limit(1))
                if healthy or ready is not None:
                    self.session.commit()
                    return False
        operation = self.session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.user_id == str(user_id),
            WritingOperationRow.request_key.startswith(f"agent-writing:{run_id}:"),
            WritingOperationRow.target == f"revision:{document_id}",
            WritingOperationRow.result["revision_id"].as_string() == revision.get("revision_id"),
        ))
        if operation is None:
            self.session.commit()
            return False
        changed = self.session.execute(update(WritingRevisionRow).where(
            WritingRevisionRow.user_id == str(user_id),
            WritingRevisionRow.document_id == str(document_id),
            WritingRevisionRow.revision_id == revision.get("revision_id"),
            WritingRevisionRow.status == "pending",
            WritingRevisionRow.base_version == revision.get("base_version"),
            WritingRevisionRow.before_markdown == revision.get("before_markdown"),
            WritingRevisionRow.after_markdown == revision.get("after_markdown"),
        ).values(status="rejected"))
        if changed.rowcount == 1:
            operation.result = {**operation.result, "status": "rejected"}
        self.session.commit()
        return changed.rowcount == 1

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
        if row.status != "pending" or self._abandoned_agent_revision(row):
            raise WritingConflict("这条修订已处理、取消或过期，请刷新后查看")
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
        try:
            self.session.flush()
        except IntegrityError:
            # A concurrent Agent tool retry must leave the shared session usable
            # so the run can report the conflict without losing its checkpoint.
            self.session.rollback()
            raise
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
