"""Owner- and version-scoped writing tools on the existing Agent registry."""

from qunxue_api.modules.writing import WritingConflict


class WritingAgentTools:
    def __init__(self, application):
        self.application = application
        self.context = None
        self.user_id = None
        self.run_id = None
        self.read_version = None
        self.execution_fence = None
        self.created_revision_ids = set()

    def validate_context(self, *, user_id, context):
        self.application.validate_agent_context(user_id, context)

    def bind(self, *, user_id, agent_run_id, context):
        self.validate_context(user_id=user_id, context=context)
        self.user_id, self.run_id, self.context = user_id, agent_run_id, dict(context)
        self.read_version = None
        self.execution_fence = None
        self.created_revision_ids = set()

    def bind_execution_fence(self, lease_token):
        self.execution_fence = {"run_id": str(self.run_id), "lease_token": lease_token}

    def discard_proposal(self, revision):
        if revision.get("revision_id") not in self.created_revision_ids:
            return False
        return self.application.discard_agent_proposal(
            self.user_id, self.context["document_id"], self.run_id, revision,
            self.execution_fence,
        )

    def read_document(self):
        if self.context is None:
            raise ValueError("当前对话没有绑定写作文稿")
        document = self.application.read_agent_document(self.user_id, self.context)
        self.read_version = document["version"]
        return document

    def preview_target(self, payload, replacement, complete, *, runtime_instructions="",
                       revision=None):
        if self.context is None:
            raise WritingConflict("unbound_preview_context")
        version = payload["expected_version"]
        if version != self.context["document_version"] or self.read_version != version:
            raise WritingConflict("unread_or_stale_preview_context")
        start, end = self.context.get("selection_start"), self.context.get("selection_end")
        return self.application.preview_edit_target(
            self.user_id, self.context["document_id"], payload, replacement, complete,
            runtime_instructions=runtime_instructions,
            selection_scope={"start": start, "end": end} if start is not None else None,
            revision=revision,
        )

    def propose_edit(self, *, expected_version, original_text, replacement_text,
                     selection_start=None, selection_end=None, runtime_instructions=""):
        if self.context is None:
            raise ValueError("当前对话没有绑定写作文稿")
        if expected_version != self.context["document_version"]:
            raise WritingConflict("文稿上下文已过期，请让用户保存后发起新一轮修改")
        if self.read_version != expected_version:
            raise WritingConflict("请先读取本轮文稿及选区，不能根据旧对话猜测正文")
        bound_start, bound_end = (
            self.context.get("selection_start"), self.context.get("selection_end"),
        )
        payload = {
            "expected_version": expected_version, "original_text": original_text,
            "replacement_text": replacement_text, "selection_start": selection_start,
            "selection_end": selection_end,
        }
        return self.application.propose_agent_edit(
            self.user_id, self.context["document_id"], self.run_id, payload,
            runtime_instructions=runtime_instructions,
            execution_fence=self.execution_fence,
            creation_observer=lambda result: self.created_revision_ids.add(result["revision_id"]),
            selection_scope=(
                {"start": bound_start, "end": bound_end} if bound_start is not None else None
            ),
        )
