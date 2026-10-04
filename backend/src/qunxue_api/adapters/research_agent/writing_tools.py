"""Owner- and version-scoped writing tools on the existing Agent registry."""

import json
from hashlib import sha256
from uuid import UUID

from qunxue_api.modules.writing import WritingConflict, utf16_slice


class WritingAgentTools:
    def __init__(self, application):
        self.application = application
        self.context = None
        self.user_id = None
        self.run_id = None
        self.read_version = None

    def validate_context(self, *, user_id, context):
        document_id = UUID(str(context["document_id"]))
        version = context["document_version"]
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ValueError("文稿版本无效")
        document = self.application.repository.get(user_id, document_id)
        # An interrupted run retains its original version. Permit discussion and
        # reading the new document, but never reinterpret its old selection.
        if document["version"] == version:
            utf16_slice(
                document["markdown"], context.get("selection_start"),
                context.get("selection_end"), allow_empty=True,
            )

    def bind(self, *, user_id, agent_run_id, context):
        self.validate_context(user_id=user_id, context=context)
        self.user_id, self.run_id, self.context = user_id, agent_run_id, dict(context)
        self.read_version = None

    def read_document(self):
        if self.context is None:
            raise ValueError("当前对话没有绑定写作文稿")
        document = self.application.repository.get(self.user_id, self.context["document_id"])
        stale = document["version"] != self.context["document_version"]
        selection = None
        if not stale and self.context.get("selection_start") is not None:
            _, text, _ = utf16_slice(
                document["markdown"], self.context["selection_start"],
                self.context["selection_end"], allow_empty=True,
            )
            selection = {
                "start": self.context["selection_start"],
                "end": self.context["selection_end"], "text": text,
            }
        self.read_version = document["version"]
        return {
            **document, "selection": selection, "context_stale": stale,
            **self.application.agent_style_context(
                self.user_id, document, selection["text"] if selection else document["markdown"],
            ),
            "context_version": self.context["document_version"],
            "pending_revision_ids": [
                r["revision_id"] for r in self.application.repository.revisions(
                    self.user_id, self.context["document_id"],
                ) if r["status"] == "pending"
            ],
        }

    def propose_edit(self, *, expected_version, original_text, replacement_text,
                     selection_start=None, selection_end=None):
        if self.context is None:
            raise ValueError("当前对话没有绑定写作文稿")
        if expected_version != self.context["document_version"]:
            raise WritingConflict("文稿上下文已过期，请让用户保存后发起新一轮修改")
        if self.read_version != expected_version:
            raise WritingConflict("请先读取本轮文稿及选区，不能根据旧对话猜测正文")
        # A selected passage is the edit boundary, including insertions. Resolve
        # substring-only requests within it rather than another identical passage.
        bound_start, bound_end = (
            self.context.get("selection_start"), self.context.get("selection_end"),
        )
        if bound_start is not None:
            if selection_start is None and selection_end is None:
                current = self.application.repository.get(
                    self.user_id, self.context["document_id"],
                )
                if current["version"] != expected_version:
                    raise WritingConflict("原文已改变，请保存后重新发起修改")
                _, selected, _ = utf16_slice(
                    current["markdown"], bound_start, bound_end, allow_empty=True,
                )
                position = selected.find(original_text)
                if (
                    not original_text or position < 0
                    or selected.find(original_text, position + 1) >= 0
                ):
                    raise WritingConflict("原文片段在选区内没有唯一匹配，请提供准确范围")
                prefix = selected.partition(original_text)[0]
                selection_start = bound_start + len(prefix.encode("utf-16-le")) // 2
                selection_end = selection_start + len(original_text.encode("utf-16-le")) // 2
            if (
                selection_start is None or selection_end is None
                or not bound_start <= selection_start <= selection_end <= bound_end
            ):
                raise WritingConflict("修改超出本轮用户选区，请仅修改所选文字")
        payload = {
            "expected_version": expected_version, "original_text": original_text,
            "replacement_text": replacement_text, "selection_start": selection_start,
            "selection_end": selection_end,
        }
        # Semantic identity survives model retries with a fresh tool-call ID,
        # reconnects and checkpoint loss, without creating a second revision.
        digest = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        key = f"agent-writing:{self.run_id}:{digest}"
        return self.application.propose_edit(
            self.user_id, self.context["document_id"], key, payload,
        )
