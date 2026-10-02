"""Upload target adaptation; the original parser retains source identities and locators."""

import hashlib
from uuid import uuid4

from qunxue_api.modules.research_materials import (
    MaterialFormat,
    MaterialParseError,
    UnsupportedMaterialFormat,
)
from qunxue_api.modules.shared_knowledge import (
    SharedDocument,
    SharedKnowledgeService,
    SharedKnowledgeValidationError,
)


class SharedKnowledgeApplication(SharedKnowledgeService):
    def __init__(
        self,
        repository,
        *,
        parser,
        max_file_bytes=20 * 1024 * 1024,
        max_storage_bytes=500 * 1024 * 1024,
        max_libraries=10,
        max_documents_per_library=100,
        max_document_characters=120000,
    ):
        super().__init__(repository, max_libraries=max_libraries)
        self._parser = parser
        self.max_file_bytes = max_file_bytes
        self.max_storage_bytes = max_storage_bytes
        self.max_documents_per_library = max_documents_per_library
        self.max_document_characters = max_document_characters

    def storage(self, user_id):
        return {
            "used_bytes": self.repository.storage_usage(user_id),
            "max_bytes": self.max_storage_bytes,
            "max_file_bytes": self.max_file_bytes,
            "library_count": sum(kb.owner_user_id == user_id for kb in self.libraries(user_id)),
            "max_libraries": self.max_libraries,
            "max_documents_per_library": self.max_documents_per_library,
            "max_document_characters": self.max_document_characters,
        }

    def upload(self, user_id, kb_id, *, filename, media_type, content, request_key):
        self.require_manage(user_id, kb_id)
        # Retrying an old upload cannot reattach a removed file.
        key = hashlib.sha256(f"{kb_id}:{request_key}".encode()).hexdigest()
        previous = self.repository.find_upload(user_id, key)
        if previous:
            if (
                previous.content_hash != hashlib.sha256(content).hexdigest()
                or previous.filename != filename
            ):
                raise SharedKnowledgeValidationError(
                    "相同请求标识不能上传不同文件，请重新发起上传。"
                )
            return previous
        if len(content) > self.max_file_bytes:
            raise SharedKnowledgeValidationError("文件超过单份上传限制。")
        if self.repository.storage_usage(user_id) + len(content) > self.max_storage_bytes:
            raise SharedKnowledgeValidationError("知识库存储空间不足，请先删除不再需要的资料。")
        if len(self.repository.documents(kb_id)) >= self.max_documents_per_library:
            raise SharedKnowledgeValidationError(
                f"每个知识库最多保存 {self.max_documents_per_library} 份文件。"
            )
        try:
            material_format = MaterialFormat.resolve(filename=filename, media_type=media_type)
        except UnsupportedMaterialFormat as exc:
            raise SharedKnowledgeValidationError("文件格式不支持或与扩展名不一致。") from exc
        if material_format.is_media:
            raise SharedKnowledgeValidationError("知识库支持 PDF、DOCX、PPTX、Markdown 和 TXT。")
        document_id, parse_id = uuid4(), uuid4()
        error, segments, warnings = None, (), ()
        try:
            parsed = self._parser(
                filename=filename,
                media_type=media_type,
                content=content,
                material_id=document_id,
                parse_id=parse_id,
            )
            skipped = parsed.structured_document.get("unreadable_slides", [])
            if skipped:
                pages = "、".join(str(page) for page in skipped)
                warnings = (f"第 {pages} 页未提取到正文，图片内容未识别。",)
            segments = tuple(
                {
                    "segment_id": block.segment_id,
                    "parse_id": str(parse_id),
                    "ordinal": block.ordinal,
                    "kind": block.kind,
                    "text": block.text,
                    "content_hash": block.content_hash,
                    "locator": block.locator.as_dict(),
                }
                for block in parsed.blocks
            )
            if sum(len(segment["text"]) for segment in segments) > self.max_document_characters:
                raise SharedKnowledgeValidationError(
                    f"资料正文超过 {self.max_document_characters:,} 字符，请拆分后上传。"
                )
        except MaterialParseError as exc:
            error = str(exc)
        doc = SharedDocument(
            document_id,
            user_id,
            filename,
            material_format.canonical_media_type,
            hashlib.sha256(content).hexdigest(),
            len(content),
            parse_id,
            "failed" if error else "ready",
            segments,
            error,
            warnings,
        )
        # A synchronous parse and its links commit together. Process failure leaves no stuck job.
        self.repository.quota_guard(user_id)
        self.require_manage(user_id, kb_id)
        previous = self.repository.find_upload(user_id, key)
        if previous:
            if previous.content_hash != doc.content_hash or previous.filename != doc.filename:
                raise SharedKnowledgeValidationError("相同请求标识不能上传不同文件。")
            return previous
        if self.repository.storage_usage(user_id) + len(content) > self.max_storage_bytes:
            raise SharedKnowledgeValidationError("知识库存储空间不足，请先删除不再需要的资料。")
        if len(self.repository.documents(kb_id)) >= self.max_documents_per_library:
            raise SharedKnowledgeValidationError(
                f"每个知识库最多保存 {self.max_documents_per_library} 份文件。"
            )
        saved = self.repository.save_document(doc, content=content, request_key=key, kb_id=kb_id)
        if saved.content_hash != doc.content_hash or saved.filename != doc.filename:
            raise SharedKnowledgeValidationError("相同请求标识不能上传不同文件。")
        self.repository.commit()
        return saved
