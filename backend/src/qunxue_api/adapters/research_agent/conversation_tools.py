"""Read-only history tools; identity is server-bound, never model supplied."""

import json
from uuid import UUID

from qunxue_api.modules.agent_conversation import ConversationNotFound
from qunxue_api.modules.agent_conversation.context import render_recent_context


class AgentConversationTools:
    def __init__(self, scope, *, user_id: UUID, conversation_id: UUID):
        self.scope, self.user_id, self.conversation_id = scope, user_id, conversation_id
        self.calls, self.bytes = 0, 0

    def _enabled(self, memory):
        return memory.scope(self.user_id, None).use_memory

    @property
    def context(self):
        # Recheck permissions/deletion for each model request, not a process cache.
        with self.scope() as (repository, memory):
            if not self._enabled(memory):
                return ""
            return render_recent_context(
                repository.recent(self.user_id, exclude=self.conversation_id)
            )

    @property
    def enabled(self):
        with self.scope() as (_, memory):
            return self._enabled(memory)

    def _call(self, operation, **kwargs):
        if self.calls >= 8 or self.bytes >= 24000:
            return {"error": "conversation_read_budget_exhausted"}
        self.calls += 1
        with self.scope() as (repository, memory):
            if not self._enabled(memory):
                return {"error": "conversation_recall_disabled"}
            try:
                result = getattr(repository, operation)(self.user_id, **kwargs)
            except (ConversationNotFound, ValueError):
                return {"error": "conversation_not_found"}
        cost = len(json.dumps(result, ensure_ascii=False).encode())
        if cost > 6000 or self.bytes + cost > 24000:
            return {"error": "conversation_read_budget_exhausted"}
        self.bytes += cost
        return result

    def search(self, query: str, offset: int = 0):
        return self._call("search", query=query, after=offset)

    def read(self, conversation_id: str, sequence: int = 0, offset: int = 0):
        try:
            identifier = UUID(conversation_id)
        except ValueError:
            return {"error": "conversation_not_found"}
        return self._call("read", conversation_id=identifier, sequence=sequence, offset=offset)
