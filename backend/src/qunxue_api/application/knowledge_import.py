from uuid import UUID, uuid4


class KnowledgeImportApplication:
    def __init__(self, repository, libraries, parser, fetch_text):
        self.repository, self.libraries = repository, libraries
        self.parser, self.fetch_text = parser, fetch_text

    def start(self, user_id, source_type, files, library_id=None):
        items = self.parser(source_type, files)
        if library_id:
            self.libraries.require_manage(user_id, library_id)
        else:
            existing = next(
                (x for x in self.libraries.libraries(user_id) if x.name == "我的资料"), None
            )
            library_id = (
                existing.id
                if existing
                else self.libraries.create(
                    user_id, "我的资料", "从收藏和笔记导入的个人资料", str(uuid4())
                ).id
            )
        return self.repository.create(user_id, library_id, source_type, items)

    def run_once(self):
        item = self.repository.claim()
        self.last_user_id = item["user_id"] if item else None
        if item is None:
            return False
        try:
            self.libraries.require_manage(item["user_id"], item["library_id"])
            existing = self.repository.existing(item)
            if existing:
                self.repository.complete(item, existing, duplicate=True)
                return True
            content = item["content"]
            if not content and item.get("source_url"):
                text = self.fetch_text(item["source_url"])
                if not text:
                    raise ValueError("网页没有可读取的正文")
                content = f"# {item['title']}\n\n来源：{item['source_url']}\n\n{text}".encode()
            if not content:
                raise ValueError("没有可导入的正文")
            doc = self.libraries.upload(
                item["user_id"],
                item["library_id"],
                filename=item["filename"],
                media_type=item["media_type"],
                content=content,
                request_key=f"import:{item['id']}",
            )
            if doc.status != "ready":
                raise ValueError(doc.error_message or "正文解析失败")
            self.repository.complete(item, doc.id)
        except Exception as exc:
            # Persist one item failure; other records continue in separate transactions.
            self.repository.fail(
                item,
                str(exc)
                if isinstance(exc, ValueError)
                else "读取或导入失败，请检查来源是否可访问后重试",
            )
        return True

    def get(self, user_id, batch_id):
        return self.repository.get(user_id, batch_id)

    def list(self, user_id):
        return self.repository.list(user_id)

    def retry(self, user_id, batch_id, item_id):
        batch = self.get(user_id, batch_id)
        self.libraries.require_manage(user_id, UUID(batch["library_id"]))
        return self.repository.retry(user_id, batch_id, item_id)
