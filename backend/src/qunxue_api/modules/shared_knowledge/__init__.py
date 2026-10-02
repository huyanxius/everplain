"""Private by default; explicitly invited readers have revocable read-only access."""

import hashlib
import json
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
class PublicKnowledgePublication:
    knowledge_base_id: UUID
    title: str
    description: str
    topics: tuple[str, ...]
    document_ids: tuple[UUID, ...] = ()
    request_key: str = ""
    published_at: datetime = field(default_factory=lambda: datetime.now(UTC))


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
    def owner_active(self, user_id: UUID) -> bool: ...
    def revoke_readers(self, kb_id: UUID) -> None: ...
    def publication(self, kb_id: UUID) -> PublicKnowledgePublication | None: ...
    def publish(self, publication: PublicKnowledgePublication) -> None: ...
    def publication_request(self, kb_id: UUID, key: str) -> str | None: ...
    def record_publication_request(self, kb_id: UUID, key: str, fingerprint: str) -> None: ...
    def unpublish(self, kb_id: UUID) -> None: ...
    def public_directory(
        self, query: str, limit: int, offset: int
    ) -> tuple[PublicKnowledgePublication, ...]: ...


class SharedKnowledgeService:
    def __init__(self, repository: SharedKnowledgeRepository, *, max_libraries=10):
        self.repository = repository
        self.max_libraries = max_libraries

    def require_read(self, user_id: UUID, kb_id: UUID) -> SharedKnowledgeBase:
        kb = self.repository.get(kb_id)
        if kb is None or kb.deleted_at or not self.repository.owner_active(kb.owner_user_id):
            raise SharedKnowledgeUnavailable()
        if kb.owner_user_id != user_id and not (
            kb.sharing_enabled and self.repository.subscribed(user_id, kb_id)
        ):
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
        if sum(kb.owner_user_id == user_id for kb in self.libraries(user_id)) >= self.max_libraries:
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
        allowed = {
            key: value
            for key, value in changes.items()
            if key in {"name", "description", "sharing_enabled"} and value is not None
        }
        if "name" in allowed:
            allowed["name"] = allowed["name"].strip()
            if not allowed["name"] or len(allowed["name"]) > 100:
                raise SharedKnowledgeValidationError("知识库名称需要 1–100 个字符。")
        if "sharing_enabled" in allowed and allowed["sharing_enabled"] != kb.sharing_enabled:
            # Old invitations and memberships never come back after re-enabling.
            self.repository.revoke_readers(kb_id)
            allowed["share_token"] = token_urlsafe(32)
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
        self.repository.revoke_readers(kb_id)
        self.repository.unpublish(kb_id)
        self.repository.commit()

    def libraries(self, user_id):
        return tuple(
            kb
            for kb in self.repository.list_for(user_id)
            if not kb.deleted_at
            and self.repository.owner_active(kb.owner_user_id)
            and (
                kb.owner_user_id == user_id
                or (kb.sharing_enabled and self.repository.subscribed(user_id, kb.id))
            )
        )

    def join(self, user_id: UUID, token: str):
        kb = self.repository.find_token(token)
        if (
            kb is None
            or kb.deleted_at
            or not kb.sharing_enabled
            or not self.repository.owner_active(kb.owner_user_id)
        ):
            raise SharedKnowledgeUnavailable("邀请无效或已撤销。")
        added = False if kb.owner_user_id == user_id else self.repository.subscribe(user_id, kb.id)
        self.repository.commit()
        # Recheck after the write so a stale invite cannot survive revocation.
        self.require_read(user_id, kb.id)
        return kb, added

    def publish(
        self,
        user_id: UUID,
        kb_id: UUID,
        *,
        title,
        description,
        topics,
        request_key,
        confirm_public_content=False,
    ):
        self.repository.quota_guard(user_id)
        self.require_manage(user_id, kb_id)
        if confirm_public_content is not True:
            raise SharedKnowledgeValidationError("发布前须明确确认公开当前资料及原文。")
        title, description = title.strip(), description.strip()
        topics = tuple(dict.fromkeys(topic.strip() for topic in topics))
        if (
            not title
            or len(title) > 100
            or len(description) > 1000
            or len(topics) > 12
            or any(not topic or len(topic) > 60 for topic in topics)
        ):
            raise SharedKnowledgeValidationError("请填写有效的公开标题、简介和主题。")
        fingerprint = hashlib.sha256(
            json.dumps(
                [title, description, topics], ensure_ascii=False, separators=(",", ":")
            ).encode()
        ).hexdigest()
        previous = self.repository.publication_request(kb_id, request_key)
        if previous:
            if previous != fingerprint:
                raise SharedKnowledgeValidationError("相同请求标识不能发布不同内容。")
            publication = self.repository.publication(kb_id)
            if publication is None or publication.request_key != request_key:
                raise SharedKnowledgeUnavailable("先前发布已撤销或替换，请重新确认发布。")
            return publication
        publication = PublicKnowledgePublication(
            kb_id,
            title,
            description,
            topics,
            tuple(doc.id for doc in self.documents(user_id, kb_id, ready_only=True)),
            request_key,
        )
        self.repository.record_publication_request(kb_id, request_key, fingerprint)
        self.repository.publish(publication)
        self.repository.commit()
        return publication

    def unpublish(self, user_id: UUID, kb_id: UUID):
        self.require_manage(user_id, kb_id)
        self.repository.unpublish(kb_id)
        self.repository.commit()

    def public_directory(self, *, query="", limit=24, offset=0):
        return self.repository.public_directory(
            query.strip(), max(1, min(limit, 100)), max(0, offset)
        )

    def public_publication(self, kb_id: UUID):
        kb = self.repository.get(kb_id)
        publication = self.repository.publication(kb_id)
        if (
            kb is None
            or kb.deleted_at
            or publication is None
            or not self.repository.owner_active(kb.owner_user_id)
        ):
            raise SharedKnowledgeUnavailable()
        return publication

    def public_documents(self, kb_id: UUID):
        publication = self.public_publication(kb_id)
        kb = self.repository.get(kb_id)
        return tuple(
            doc
            for doc in self.repository.documents(kb_id)
            if doc.id in publication.document_ids
            and doc.status == "ready"
            and doc.owner_user_id == kb.owner_user_id
        )

    def public_source(self, kb_id: UUID, document_id: UUID, segment_id: str | None = None):
        doc = next((doc for doc in self.public_documents(kb_id) if doc.id == document_id), None)
        if doc is None or (
            segment_id and not any(segment["segment_id"] == segment_id for segment in doc.segments)
        ):
            raise SharedKnowledgeUnavailable()
        return doc

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
