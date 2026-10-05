import hashlib
import json
import logging
import re
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from qunxue_api.modules.knowledge_import import source_fingerprint

logger = logging.getLogger(__name__)


class KnowledgeImportApplication:
    def __init__(self, repository, libraries, parser, fetch_text, media=None):
        self.repository, self.libraries = repository, libraries
        self.parser, self.fetch_text = parser, fetch_text
        self.media = media

    def start(self, user_id, source_type, files, library_id=None, request_key=None):
        items = self.parser(source_type, files)
        return self.start_items(user_id, source_type, items, library_id, request_key)

    def start_items(self, user_id, source_type, items, library_id=None, request_key=None):
        fingerprint = hashlib.sha256(
            json.dumps(
                [
                    source_type,
                    str(library_id) if library_id else None,
                    sorted((i["source_key"], source_fingerprint(i), i.get("error")) for i in items),
                ],
                sort_keys=True,
            ).encode()
        ).hexdigest()
        previous = self.repository.find_request(user_id, request_key, fingerprint)
        if previous:
            return previous
        storage = self.libraries.storage(user_id)
        retained = self.repository.retained_bytes(user_id)

        def incoming_bytes():
            for item in items:
                item["_unchanged_id"] = self.repository.unchanged(user_id, item)
            return sum(
                len(i["content"]) + sum(len(a["content"]) for a in i.get("attachments", []))
                for i in items
                if not i["_unchanged_id"]
            )

        incoming = incoming_bytes()
        if storage["used_bytes"] + retained + incoming > storage["max_bytes"]:
            raise ValueError("存储空间不足，请先清理不再需要的资料")
        if library_id:
            self.libraries.require_manage(user_id, library_id)
        else:
            existing = next(
                (
                    x
                    for x in self.libraries.libraries(user_id)
                    if x.name == "我的资料" and x.owner_user_id == user_id
                ),
                None,
            )
            library_id = (
                existing.id
                if existing
                else self.libraries.create(
                    user_id, "我的资料", "从收藏和笔记导入的个人资料", str(uuid4())
                ).id
            )
        self.libraries.repository.quota_guard(user_id)
        previous = self.repository.find_request(user_id, request_key, fingerprint)
        if previous:
            return previous
        self.libraries.require_manage(user_id, library_id)
        storage = self.libraries.storage(user_id)
        incoming = incoming_bytes()
        if (
            storage["used_bytes"] + self.repository.retained_bytes(user_id) + incoming
            > storage["max_bytes"]
        ):
            raise ValueError("存储空间不足，请先清理不再需要的资料")
        return self.repository.create(
            user_id,
            library_id,
            source_type,
            items,
            request_key,
            fingerprint,
            self.libraries.max_documents_per_library,
        )

    def start_clip(self, user_id, url, title, html, library_id=None, request_key=None):
        return self.start_items(
            user_id, "chrome", [self.media.clip(url, title, html)], library_id, request_key
        )

    def start_bilibili(self, user_id, uid, library_id=None, request_key=None):
        return self.start_items(
            user_id, "bilibili", [self.media.discovery(uid)], library_id, request_key
        )

    def _require_attachment_capacity(self, item, document_id):
        documents = self.libraries.repository.documents(item["library_id"], include_segments=False)
        if (
            not any(str(doc.id) == document_id for doc in documents)
            and len(documents) >= self.libraries.max_documents_per_library
        ):
            raise ValueError("知识库文件数量已达上限")

    def run_once(self):
        item = self.repository.claim()
        self.last_user_id = item["user_id"] if item else None
        if item is None:
            return False
        try:
            self.libraries.require_manage(item["user_id"], item["library_id"])
            if item["details"].get("metadata", {}).get("enumerate_uid"):
                candidates = self.media.enumerate(item["details"]["metadata"]["enumerate_uid"])
                self.repository.expand(item, candidates)
                return True
            # Compare/link source identity atomically. Release this short lock
            # before any network or model work and recheck after it returns.
            self.libraries.repository.quota_guard(item["user_id"])
            self.repository.assert_claim(item)
            self.libraries.require_manage(item["user_id"], item["library_id"])
            existing = self.repository.existing(item)
            url_only = not item["content"] and item.get("source_url")
            if existing and existing["unchanged"] and not url_only:
                self._require_attachment_capacity(item, existing["id"])
                self.repository.complete(item, existing["id"], duplicate=True)
                return True
            if item["source_type"] in {"chrome", "bilibili", "image"}:
                self.libraries.repository.commit()
            content = item["content"]
            filename, media_type = item["filename"], item["media_type"]
            if item["source_type"] in {"bilibili", "image"}:
                converted = self.media.convert(item)
                content = converted["content"]
                filename, media_type = converted["filename"], converted["media_type"]
                if item["source_type"] == "bilibili":
                    item["details"] = item["details"] | {"metadata": converted["metadata"]}
            fetched_text = None
            if not content and item.get("source_url"):
                text = self.fetch_text(item["source_url"])
                if not text:
                    raise ValueError("网页没有可读取的正文")
                fetched_text = text
                content = f"# {item['title']}\n\n来源：{item['source_url']}\n\n{text}".encode()
            if not content:
                raise ValueError("没有可导入的正文")
            if item["source_type"] == "chrome" and item.get("source_url"):
                title = item["title"]
                if _generic_bookmark_title(filename):
                    title = _web_title(
                        title,
                        fetched_text or content.decode("utf-8", errors="replace"),
                        item["source_url"],
                    )
                    filename = (
                        re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", title).strip(" .")[:120] + ".md"
                    )
                if fetched_text is not None:
                    content = f"# {title}\n\n来源：{item['source_url']}\n\n{fetched_text}".encode()
            self.libraries.repository.quota_guard(item["user_id"])
            self.repository.assert_claim(item)
            self.libraries.require_manage(item["user_id"], item["library_id"])
            existing = self.repository.existing(item)
            # Asset-only changes preserve the current parse and ready index/knowledge.
            if (
                existing
                and existing["content_hash"] == hashlib.sha256(content).hexdigest()
                and existing["filename"] == filename
            ):
                self._require_attachment_capacity(item, existing["id"])
                self.repository.complete(
                    item,
                    existing["id"],
                    duplicate=fetched_text is not None,
                    updated=fetched_text is None,
                )
                return True
            storage = self.libraries.storage(item["user_id"])
            used = storage["used_bytes"] + self.repository.retained_bytes(item["user_id"])
            if (
                used
                - len(item["content"])
                + len(content)
                - (existing["size_bytes"] if existing else 0)
                > storage["max_bytes"]
            ):
                raise ValueError("存储空间不足，请先清理不再需要的资料")
            doc = self.libraries.upload(
                item["user_id"],
                item["library_id"],
                filename=filename,
                media_type=media_type,
                content=content,
                request_key=f"import:{item['id']}",
                replace_document_id=UUID(existing["id"]) if existing else None,
                commit=False,
            )
            if doc.status != "ready":
                raise ValueError(doc.error_message or "正文解析失败")
            self.repository.complete(item, doc.id, updated=existing is not None)
        except Exception as exc:
            logger.warning(
                "Import processing failed item=%s type=%s code=%s",
                item["id"],
                type(exc).__name__,
                getattr(exc, "code", "import_error"),
            )
            # Persist one item failure; other records continue in separate transactions.
            self.repository.fail(
                item,
                str(exc)
                if isinstance(exc, ValueError)
                else "读取或导入失败，请检查来源是否可访问后重试",
            )
        return True

    def asset(self, user_id, document_id, attachment_id=None):
        return self.repository.asset(user_id, document_id, attachment_id)

    def get(self, user_id, batch_id):
        return self.repository.get(user_id, batch_id)

    def list(self, user_id):
        return self.repository.list(user_id)

    def retry(self, user_id, batch_id, item_id):
        batch = self.get(user_id, batch_id)
        self.libraries.require_manage(user_id, UUID(batch["library_id"]))
        return self.repository.retry(user_id, batch_id, item_id)


def _generic_bookmark_title(title):
    return bool(
        re.fullmatch(
            r"(?:bookmark(?:[-_]\d+)?|网页收藏|untitled)(?:\.(?:md|markdown|html?))?",
            title.strip(),
            re.I,
        )
    )


def _web_title(title, text, url):
    if title.strip() and not _generic_bookmark_title(title):
        return title.strip()
    for line in text.splitlines():
        candidate = re.sub(r"^[#*\s]+", "", line).strip()
        if (
            not candidate
            or _generic_bookmark_title(candidate)
            or candidate.startswith(("来源：", "http://", "https://", "---"))
        ):
            continue
        return re.split(r"[。！？]", candidate)[0][:80]
    return urlsplit(url).hostname or "网页收藏"
