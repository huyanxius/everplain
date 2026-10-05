"""Owner-scoped cache and bounded original-message retrieval on existing tables."""

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from qunxue_api.adapters.sqlite.agent_conversation_model import (
    AgentConversationRow,
    AgentMessageRow,
    AgentRunRow,
)
from qunxue_api.adapters.sqlite.agent_conversation_repository import (
    _DELETED_MATERIAL_ANSWER,
    _restore_citation,
    _unavailable_trace_material_ids,
    _utc,
)
from qunxue_api.modules.agent_conversation import ConversationNotFound, excerpt
from qunxue_api.modules.agent_memory import redact_sensitive


class SqliteConversationContextRepository:
    def __init__(self, session: Session):
        self.session = session

    def recent(self, user_id: UUID, *, exclude: UUID | None = None, limit: int = 3) -> list[dict]:
        statement = select(AgentConversationRow).where(
            AgentConversationRow.user_id == str(user_id),
            AgentConversationRow.context_digest != {},
        )
        if exclude:
            statement = statement.where(AgentConversationRow.conversation_id != str(exclude))
        rows = self.session.scalars(
            statement.order_by(
                AgentConversationRow.updated_at.desc(),
                AgentConversationRow.conversation_id.desc(),
            ).limit(min(max(limit, 1), 6))
        )
        return [self._digest(row) for row in rows]

    @staticmethod
    def _digest(row):
        items = row.context_digest.get("items", [])
        return {
            "conversation_id": row.conversation_id,
            "title": excerpt(redact_sensitive(row.title), 120),
            "updated_at": _utc(row.updated_at).isoformat(),
            "kind": "user_excerpt",
            "excerpt": items[-1]["excerpt"] if items else "",
            "source_message_id": items[-1]["message_id"] if items else None,
            "recent_excerpts": items,
        }

    def summary(self, user_id: UUID) -> dict:
        from .conversation_summary_repository import SqliteConversationSummaryRepository

        return SqliteConversationSummaryRepository(self.session).read(user_id)

    def search(self, user_id: UUID, query: str, *, after: int = 0) -> dict:
        # Literal contains, including SQL wildcard escaping. Search authored user
        # messages only: evidence-derived assistant text can later become private.
        query = query.strip()[:200]
        if not query or after < 0 or after > 10000:
            return {"items": [], "next_offset": None}
        rows = self.session.execute(
            select(AgentConversationRow, AgentMessageRow)
            .join(
                AgentMessageRow,
                AgentMessageRow.conversation_id == AgentConversationRow.conversation_id,
            )
            .where(
                AgentConversationRow.user_id == str(user_id),
                AgentMessageRow.role == "user",
                or_(
                    AgentMessageRow.content.icontains(query, autoescape=True),
                    AgentConversationRow.title.icontains(query, autoescape=True),
                ),
            )
            .order_by(
                AgentConversationRow.updated_at.desc(),
                AgentConversationRow.conversation_id,
                AgentMessageRow.sequence,
            )
            .offset(after)
            .limit(6)
        ).all()
        return {
            "items": [
                {
                    "conversation_id": row.conversation_id,
                    "title": excerpt(redact_sensitive(row.title), 120),
                    "message_id": message.message_id,
                    "sequence": message.sequence,
                    "excerpt": excerpt(redact_sensitive(message.content), 200),
                }
                for row, message in rows[:5]
            ],
            "next_offset": after + 5 if len(rows) > 5 else None,
            "scope": "user_messages",
            "untrusted_history": True,
        }

    def read(
        self, user_id: UUID, conversation_id: UUID, *, sequence: int = 0, offset: int = 0
    ) -> dict:
        row = self.session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        if sequence < 0 or offset < 0:
            return {"error": "invalid_cursor"}
        messages = self.session.scalars(
            select(AgentMessageRow)
            .where(
                AgentMessageRow.conversation_id == row.conversation_id,
                AgentMessageRow.sequence >= sequence,
            )
            .order_by(AgentMessageRow.sequence)
            .limit(2)
        ).all()
        if not messages:
            return {"conversation_id": row.conversation_id, "messages": [], "next_cursor": None}
        message = messages[0]
        text = self.source_text(user_id, row, message)
        # Page within a message too; no original text is silently lost to truncation.
        if message.sequence != sequence:
            offset = 0
        content = text[offset : offset + 600]
        end = offset + len(content)
        cursor = (
            {"sequence": message.sequence, "offset": end}
            if end < len(text)
            else {"sequence": messages[1].sequence, "offset": 0}
            if len(messages) > 1
            else None
        )
        return {
            "conversation_id": row.conversation_id,
            "title": excerpt(redact_sensitive(row.title), 120),
            "messages": [
                {
                    "message_id": message.message_id,
                    "role": message.role,
                    "sequence": message.sequence,
                    "offset": offset,
                    "content": content,
                }
            ],
            "next_cursor": cursor,
            "untrusted_history": True,
        }

    def source_text(self, user_id: UUID, row, message) -> str:
        """Share the exact history deletion/access fence with background summaries."""
        if row.user_id != str(user_id) or message.conversation_id != row.conversation_id:
            raise ConversationNotFound(str(row.conversation_id))
        text = message.content
        if message.role == "assistant":
            run = self.session.scalar(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == row.conversation_id,
                    AgentRunRow.turn_id == message.turn_id,
                    AgentRunRow.user_id == str(user_id),
                )
            )
            selected = (
                {
                    str(item["material_id"]): str(item["parse_id"])
                    for item in (run.material_attachments or [])
                }
                if run
                else {}
            )
            task_id = UUID(row.current_research_task_id) if row.current_research_task_id else None
            citations = [
                _restore_citation(
                    item,
                    session=self.session,
                    attachments=selected,
                    user_id=user_id,
                    task_id=task_id,
                )
                for item in message.citations
            ]
            unavailable = (
                _unavailable_trace_material_ids(
                    run.tool_summary or [],
                    attachments=selected,
                    session=self.session,
                    user_id=user_id,
                    task_id=task_id,
                )
                if run
                else set()
            )
            if unavailable or any(item.deleted and item.material_id for item in citations):
                text = _DELETED_MATERIAL_ANSWER
        text = redact_sensitive(text)
        return text
