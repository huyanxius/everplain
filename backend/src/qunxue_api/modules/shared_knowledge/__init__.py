"""Personal libraries; legacy membership never grants access to private knowledge."""

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Protocol
from uuid import UUID, uuid4


class SharedKnowledgeValidationError(ValueError):
    pass


class SharedKnowledgeUnavailable(LookupError):
    def __init__(self, message="知识库或资料不存在，请重新选择知识来源。"):
        super().__init__(message)


class SharedKnowledgeForbidden(PermissionError):
    def __init__(self):
        super().__init__("只有所有者可以管理知识库。")


@dataclass(frozen=True)
class SharedKnowledgeBase:
    id: UUID
    owner_user_id: UUID
    name: str
    description: str
    share_token: str
    sharing_enabled: bool = False
    deleted_at: datetime | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True)
class SharedDocument:
    # Independent document identity is necessary because research materials require a task.
    # Blocks and locators still come from the common parser; collections store only links.
    id: UUID
    owner_user_id: UUID
    filename: str
    media_type: str
    content_hash: str
    size_bytes: int
    parse_id: UUID
    status: str
    segments: tuple[dict, ...] = ()
    error_message: str | None = None
    warnings: tuple[str, ...] = ()
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    knowledge_status: str = "queued"
    knowledge: dict | None = None
    knowledge_error: str | None = None
    index_status: str = "queued"
    index_error: str | None = None


class SharedKnowledgeRepository(Protocol):
    def get(self, kb_id: UUID) -> SharedKnowledgeBase | None: ...
    def save(self, kb: SharedKnowledgeBase, *, request_key: str | None = None) -> None: ...
    def find_request(self, user_id: UUID, key: str) -> SharedKnowledgeBase | None: ...
    def list_for(self, user_id: UUID) -> tuple[SharedKnowledgeBase, ...]: ...
    def find_token(self, token: str) -> SharedKnowledgeBase | None: ...
    def subscribed(self, user_id: UUID, kb_id: UUID) -> bool: ...
    def subscribe(self, user_id: UUID, kb_id: UUID) -> bool: ...
    def unsubscribe(self, user_id: UUID, kb_id: UUID) -> None: ...
    def documents(self, kb_id: UUID) -> tuple[SharedDocument, ...]: ...
    def detach(self, kb_id: UUID, document_id: UUID | None = None) -> None: ...
    def quota_guard(self, user_id: UUID) -> None: ...
    def commit(self) -> None: ...


class SharedKnowledgeService:
    def __init__(self, repository: SharedKnowledgeRepository, *, max_libraries=10):
        self.repository = repository
        self.max_libraries = max_libraries

    def require_read(self, user_id: UUID, kb_id: UUID) -> SharedKnowledgeBase:
        kb = self.repository.get(kb_id)
        if kb is None or kb.deleted_at:
            raise SharedKnowledgeUnavailable()
        if kb.owner_user_id != user_id:
            raise SharedKnowledgeUnavailable()
        return kb

    def require_manage(self, user_id: UUID, kb_id: UUID) -> SharedKnowledgeBase:
        kb = self.require_read(user_id, kb_id)
        if kb.owner_user_id != user_id:
            raise SharedKnowledgeForbidden()
        return kb

    def create(self, user_id: UUID, name: str, description: str, request_key: str):
        self.repository.quota_guard(user_id)
        existing = self.repository.find_request(user_id, request_key)
        if existing:
            return existing
        if len(self.libraries(user_id)) >= self.max_libraries:
            raise SharedKnowledgeValidationError(
                f"最多创建 {self.max_libraries} 个知识库，请先删除不再需要的知识库。"
            )
        if not name.strip() or len(name.strip()) > 100:
            raise SharedKnowledgeValidationError("知识库名称需要 1–100 个字符。")
        kb = SharedKnowledgeBase(
            uuid4(), user_id, name.strip(), description.strip(), token_urlsafe(32)
        )
        self.repository.save(kb, request_key=request_key)
        self.repository.commit()
        return self.repository.find_request(user_id, request_key)

    def update(self, user_id: UUID, kb_id: UUID, **changes):
        kb = self.require_manage(user_id, kb_id)
        if changes.get("sharing_enabled"):
            raise SharedKnowledgeValidationError("个人知识库仅对所有者可见，不支持公开分享。")
        allowed = {
            key: value
            for key, value in changes.items()
            if key in {"name", "description", "sharing_enabled"} and value is not None
        }
        kb = replace(kb, **allowed, updated_at=datetime.now(UTC))
        self.repository.save(kb)
        self.repository.commit()
        return kb

    def delete(self, user_id: UUID, kb_id: UUID):
        kb = self.repository.get(kb_id)
        if kb is None or kb.owner_user_id != user_id:
            raise SharedKnowledgeUnavailable()
        self.repository.save(replace(kb, deleted_at=datetime.now(UTC), sharing_enabled=False))
        self.repository.detach(kb_id)
        self.repository.commit()

    def libraries(self, user_id):
        return tuple(
            kb
            for kb in self.repository.list_for(user_id)
            if kb.owner_user_id == user_id and not kb.deleted_at
        )

    def join(self, user_id: UUID, token: str):
        raise SharedKnowledgeUnavailable("个人知识库不支持通过邀请访问。")

    def leave(self, user_id: UUID, kb_id: UUID):
        self.repository.unsubscribe(user_id, kb_id)
        self.repository.commit()

    def documents(self, user_id: UUID, kb_id: UUID, *, ready_only=False):
        kb = self.require_read(user_id, kb_id)
        return tuple(
            doc
            for doc in self.repository.documents(kb_id)
            if doc.owner_user_id == kb.owner_user_id
            and (not ready_only and user_id == kb.owner_user_id or doc.status == "ready")
        )

    def source(self, user_id: UUID, kb_id: UUID, document_id: UUID, segment_id: str | None = None):
        doc = next(
            (
                doc
                for doc in self.documents(user_id, kb_id)
                if doc.id == document_id and doc.status == "ready"
            ),
            None,
        )
        if doc is None:
            raise SharedKnowledgeUnavailable()
        if segment_id and not any(item["segment_id"] == segment_id for item in doc.segments):
            raise SharedKnowledgeUnavailable()
        return doc

    def detach(self, user_id: UUID, kb_id: UUID, document_id: UUID):
        self.require_manage(user_id, kb_id)
        self.repository.detach(kb_id, document_id)
        self.repository.commit()

    def update_knowledge(self, user_id, kb_id, document_id, value):
        self.repository.quota_guard(user_id)
        self.require_manage(user_id, kb_id)
        document = self.source(user_id, kb_id, document_id)
        if document.knowledge_status in {"queued", "running"}:
            raise SharedKnowledgeValidationError("资料正在整理，请完成后再编辑知识。")
        sources = {segment["segment_id"] for segment in document.segments}
        names = {topic["title"].strip() for topic in value["topics"]}
        if len(names) != len(value["topics"]) or "" in names:
            raise SharedKnowledgeValidationError("知识点名称不能为空或重复。")
        for item in (*value["topics"], *value.get("relations", [])):
            if not item["segment_ids"] or not set(item["segment_ids"]) <= sources:
                raise SharedKnowledgeValidationError("每个知识点和关系必须引用本资料中的有效原文。")
        for relation in value.get("relations", []):
            if relation["source"] not in names or relation["target"] not in names:
                raise SharedKnowledgeValidationError("关系两端必须是本资料中的知识点。")
        result = self.repository.update_knowledge(document_id, value)
        self.repository.commit()
        return result
