"""Bounded owner-only snapshots, durable leases and shared memory cost controls."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import aliased

from qunxue_api.modules.agent_conversation import ContextSummaryBatch
from qunxue_api.modules.agent_memory import redact_sensitive

from .agent_conversation_model import AgentConversationRow, AgentMessageRow, AgentRunRow
from .agent_memory_model import (
    ConversationSummaryRow,
    MemoryScopeRow,
    MemoryUsageRow,
    invalidate_conversation_summary,
)
from .agent_memory_repository import SqliteMemoryRepository, utc
from .conversation_context_repository import SqliteConversationContextRepository

# Same daily per-user budget as durable learning. Failed calls retain the reservation.
SUMMARY_RESERVATION = 24000
_SOURCE_BYTES = 16000
_GENERIC_TITLES = {
    "理清下一步",
    "比较可选方案",
    "把想法写清楚",
    "Clarify next steps",
    "Compare options",
    "Put an idea into words",
}


class SqliteConversationSummaryRepository:
    def __init__(self, session):
        self.session = session
        self.memory = SqliteMemoryRepository(session)

    def snapshot(self, user_id):
        scope = self.memory.scope(user_id, None)
        if not scope.use_memory or not scope.learn_memory:
            return None
        conversations = self.session.scalars(
            select(AgentConversationRow)
            .where(
                AgentConversationRow.user_id == str(user_id),
                exists().where(
                    AgentMessageRow.conversation_id == AgentConversationRow.conversation_id,
                    AgentMessageRow.role == "user",
                ),
            )
            .order_by(
                AgentConversationRow.updated_at.desc(), AgentConversationRow.conversation_id.desc()
            )
            .limit(6)
        ).all()
        groups, watermarks, latest = [], [], None
        for conversation in conversations:
            task_id = (
                UUID(conversation.current_research_task_id)
                if conversation.current_research_task_id
                else None
            )
            project = self.memory.scope(user_id, task_id) if task_id else scope
            if not project.use_memory or not project.learn_memory:
                continue
            messages = self.session.scalars(
                select(AgentMessageRow)
                .where(
                    AgentMessageRow.conversation_id == conversation.conversation_id,
                    AgentMessageRow.role.in_(("user", "assistant")),
                )
                .order_by(AgentMessageRow.sequence.desc())
                .limit(12)
            ).all()
            rows = []
            for message in messages:
                if (scope.learn_after and utc(message.created_at) <= scope.learn_after) or (
                    project.learn_after and utc(message.created_at) <= project.learn_after
                ):
                    continue
                content = SqliteConversationContextRepository(self.session).source_text(
                    user_id, conversation, message
                )
                if not content.strip():
                    continue
                rows.append(
                    {
                        "conversation_id": conversation.conversation_id,
                        "message_id": message.message_id,
                        "title": redact_sensitive(conversation.title),
                        "sequence": message.sequence,
                        "role": message.role,
                        "created_at": utc(message.created_at).isoformat(),
                        "content": content,
                    }
                )
                watermarks.append(
                    [
                        conversation.conversation_id,
                        message.message_id,
                        message.role,
                        hashlib.sha256(content.encode()).hexdigest(),
                        project.learn_after.isoformat() if project.learn_after else None,
                        redact_sensitive(conversation.title),
                    ]
                )
                latest = max(latest or utc(message.created_at), utc(message.created_at))
            if rows:
                groups.append(rows)
        fingerprint = hashlib.sha256(
            json.dumps(
                [scope.learn_after.isoformat() if scope.learn_after else None, watermarks],
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        # Round-robin across conversations. Admit whole messages only, never call
        # a substring a summary or silently treat an omitted latest message as read.
        sources, omitted = [], 0
        for index in range(12):
            for group in groups:
                if index >= len(group):
                    continue
                candidate = [*sources, group[index]]
                if len(json.dumps(candidate, ensure_ascii=False).encode()) <= _SOURCE_BYTES:
                    sources.append(group[index])
                else:
                    omitted += 1
        return fingerprint, tuple(sources), latest, omitted

    def read(self, user_id):
        empty = {
            "summary": "",
            "summary_sources": [],
            "cards": [],
            "updated_at": None,
            "scope": "conversation_messages",
            "omitted_messages": 0,
        }
        snapshot = self.snapshot(user_id)
        if snapshot is None:
            return {**empty, "status": "disabled"}
        fingerprint, sources, _, omitted = snapshot
        if not sources:
            return {**empty, "status": "empty", "omitted_messages": omitted}
        row = self.session.get(ConversationSummaryRow, str(user_id))
        if row is None or row.fingerprint != fingerprint:
            if row and row.attempted_fingerprint != fingerprint:
                invalidate_conversation_summary(self.session, user_id)
            failed = row and row.attempted_fingerprint == fingerprint and row.last_error
            return {
                **empty,
                "status": "failed" if failed else "pending",
                "omitted_messages": omitted,
            }
        # Exact source text and permissions are rechecked on EVERY read. A deleted
        # conversation or changed setting invalidates the cache before disclosure.
        output = self.validate(row.summary, sources)
        return {
            **empty,
            **output,
            "status": "ready" if output["summary"] or output["cards"] else "empty",
            "updated_at": utc(row.updated_at).isoformat() if row.updated_at else None,
            "omitted_messages": omitted,
        }

    @staticmethod
    def validate(output, sources):
        lookup = {(s["conversation_id"], s["message_id"]): s for s in sources}

        def references(items):
            result = []
            if not isinstance(items, list):
                return []
            for item in items[:8]:
                if not isinstance(item, dict):
                    return []
                source = lookup.get((str(item.get("conversation_id")), str(item.get("message_id"))))
                quote = item.get("quote", "")
                if (
                    source is None
                    or not isinstance(quote, str)
                    or not quote.strip()
                    or len(quote) > 400
                    or quote not in source["content"]
                    or redact_sensitive(quote) != quote
                ):
                    return []
                result.append(
                    {
                        "conversation_id": source["conversation_id"],
                        "message_id": source["message_id"],
                        "quote": quote,
                        "title": source["title"],
                        "role": source["role"],
                        "sequence": source["sequence"],
                    }
                )
            return result

        def text(value, limit):
            return (
                value.strip()
                if isinstance(value, str)
                and len(value) <= limit
                and redact_sensitive(value) == value
                else ""
            )

        citations = references(output.get("summary_sources", []))
        summary = text(output.get("summary"), 1000) if citations else ""
        cards = []
        for card in output.get("cards", [])[:3]:
            if not isinstance(card, dict):
                continue
            refs = references(card.get("sources", []))
            title = text(card.get("title"), 80)
            description = text(card.get("description"), 240)
            prompt = text(card.get("prompt", "").split("\n参考原对话 ")[0], 1050)
            if (
                refs
                and title
                and title not in _GENERIC_TITLES
                and len(description) >= 12
                and prompt
                and all(c["title"] != title for c in cards)
            ):
                # Retrieval pointers are added server-side, never trusted to model compliance.
                pointer = "; ".join(
                    sorted({f"{r['conversation_id']} sequence={r['sequence']}" for r in refs})
                )
                prompt += f"\n参考原对话 {pointer}；先回读原文确认背景，再继续。"
                cards.append(
                    {"title": title, "description": description, "prompt": prompt, "sources": refs}
                )
        return {"summary": summary, "summary_sources": citations if summary else [], "cards": cards}

    def claim(self, *, idle_seconds, daily_calls, daily_tokens):
        now, day = datetime.now(UTC), datetime.now(UTC).date().isoformat()
        newer_conversation = aliased(AgentConversationRow)
        owners = self.session.scalars(
            select(AgentConversationRow.user_id)
            .outerjoin(
                ConversationSummaryRow,
                ConversationSummaryRow.user_id == AgentConversationRow.user_id,
            )
            .outerjoin(
                MemoryUsageRow,
                and_(
                    MemoryUsageRow.user_id == AgentConversationRow.user_id,
                    MemoryUsageRow.day == day,
                ),
            )
            .outerjoin(
                MemoryScopeRow,
                and_(
                    MemoryScopeRow.user_id == AgentConversationRow.user_id,
                    MemoryScopeRow.scope_key == "user",
                ),
            )
            .where(
                AgentConversationRow.updated_at <= now - timedelta(seconds=idle_seconds),
                or_(
                    MemoryUsageRow.user_id.is_(None),
                    and_(
                        MemoryUsageRow.calls < daily_calls,
                        MemoryUsageRow.budget_tokens + SUMMARY_RESERVATION <= daily_tokens,
                    ),
                ),
                ~exists().where(
                    AgentRunRow.user_id == AgentConversationRow.user_id,
                    AgentRunRow.status == "running",
                ),
                ~exists().where(
                    newer_conversation.user_id == AgentConversationRow.user_id,
                    newer_conversation.updated_at > now - timedelta(seconds=idle_seconds),
                ),
                or_(
                    MemoryScopeRow.user_id.is_(None),
                    and_(MemoryScopeRow.use_memory, MemoryScopeRow.learn_memory),
                ),
                or_(
                    ConversationSummaryRow.user_id.is_(None),
                    ConversationSummaryRow.fingerprint == "",
                    AgentConversationRow.updated_at > ConversationSummaryRow.updated_at,
                ),
                or_(
                    ConversationSummaryRow.lease_until.is_(None),
                    ConversationSummaryRow.lease_until <= now,
                ),
                or_(
                    ConversationSummaryRow.retry_after.is_(None),
                    ConversationSummaryRow.retry_after <= now,
                ),
                or_(ConversationSummaryRow.attempts.is_(None), ConversationSummaryRow.attempts < 3),
            )
            .distinct()
            .limit(64)
        ).all()
        for owner in owners:
            user_id = UUID(owner)
            snapshot = self.snapshot(user_id)
            if snapshot is None:
                continue
            fingerprint, sources, latest, omitted = snapshot
            if not sources:
                # Persist a zero-call no-op watermark so weak/oversized histories
                # cannot monopolize the bounded scheduler scan forever.
                self.session.execute(
                    insert(ConversationSummaryRow)
                    .values(
                        user_id=owner,
                        fingerprint=fingerprint,
                        attempted_fingerprint=fingerprint,
                        summary={},
                        attempts=0,
                        updated_at=now,
                    )
                    .on_conflict_do_update(
                        index_elements=[ConversationSummaryRow.user_id],
                        set_={"fingerprint": fingerprint, "summary": {}, "updated_at": now},
                    )
                )
                continue
            if latest is None or latest > now - timedelta(seconds=idle_seconds):
                continue
            if self.session.scalar(
                select(AgentRunRow.run_id)
                .where(AgentRunRow.user_id == owner, AgentRunRow.status == "running")
                .limit(1)
            ):
                continue
            self.session.execute(
                insert(ConversationSummaryRow)
                .values(
                    user_id=owner,
                    fingerprint="",
                    attempted_fingerprint="",
                    summary={},
                    attempts=0,
                )
                .on_conflict_do_nothing()
            )
            row = self.session.get(ConversationSummaryRow, owner, populate_existing=True)
            same_attempt = row.attempted_fingerprint == fingerprint
            if (
                row.fingerprint == fingerprint
                or (row.lease_until and utc(row.lease_until) > now)
                or (
                    same_attempt
                    and (row.attempts >= 3 or (row.retry_after and utc(row.retry_after) > now))
                )
            ):
                continue
            token = str(uuid4())
            claimed = self.session.execute(
                update(ConversationSummaryRow)
                .where(
                    ConversationSummaryRow.user_id == owner,
                    (
                        ConversationSummaryRow.lease_until.is_(None)
                        | (ConversationSummaryRow.lease_until <= now)
                    ),
                    ConversationSummaryRow.fingerprint != fingerprint,
                )
                .values(
                    lease_token=token,
                    lease_until=now + timedelta(minutes=5),
                    attempted_fingerprint=fingerprint,
                    attempts=row.attempts + 1 if same_attempt else 1,
                    retry_after=None,
                    last_error=None,
                )
                .execution_options(synchronize_session=False)
            )
            if claimed.rowcount != 1:
                continue
            self.session.execute(
                insert(MemoryUsageRow)
                .values(
                    user_id=owner,
                    day=day,
                    calls=0,
                    input_tokens=0,
                    output_tokens=0,
                    budget_tokens=0,
                )
                .on_conflict_do_nothing()
            )
            reserved = self.session.execute(
                update(MemoryUsageRow)
                .where(
                    MemoryUsageRow.user_id == owner,
                    MemoryUsageRow.day == day,
                    MemoryUsageRow.calls < daily_calls,
                    MemoryUsageRow.budget_tokens + SUMMARY_RESERVATION <= daily_tokens,
                )
                .values(
                    calls=MemoryUsageRow.calls + 1,
                    budget_tokens=MemoryUsageRow.budget_tokens + SUMMARY_RESERVATION,
                )
            )
            if reserved.rowcount != 1:
                self.session.execute(
                    update(ConversationSummaryRow)
                    .where(
                        ConversationSummaryRow.user_id == owner,
                        ConversationSummaryRow.lease_token == token,
                    )
                    .values(
                        lease_token=None,
                        lease_until=None,
                        attempts=row.attempts if same_attempt else 0,
                    )
                )
                continue
            return ContextSummaryBatch(user_id, token, fingerprint, sources, day, omitted)
        return None

    def complete(self, batch, output, input_tokens, output_tokens):
        now = datetime.now(UTC)
        snapshot = self.snapshot(batch.user_id)
        if snapshot is None or snapshot[0] != batch.fingerprint:
            return False
        result = self.session.execute(
            update(ConversationSummaryRow)
            .where(
                ConversationSummaryRow.user_id == str(batch.user_id),
                ConversationSummaryRow.lease_token == batch.lease_token,
                ConversationSummaryRow.lease_until > now,
            )
            .values(
                fingerprint=batch.fingerprint,
                summary=self.validate(output, snapshot[1]),
                updated_at=now,
                lease_token=None,
                lease_until=None,
                retry_after=None,
                attempts=0,
                last_error=None,
            )
        )
        if result.rowcount != 1:
            return False
        usage = self.session.get(MemoryUsageRow, (str(batch.user_id), batch.usage_day))
        if usage:
            usage.input_tokens += max(0, input_tokens)
            usage.output_tokens += max(0, output_tokens)
            total = max(0, input_tokens) + max(0, output_tokens)
            if total:
                usage.budget_tokens += total - SUMMARY_RESERVATION
        from qunxue_api.adapters.model.metering import current_operation

        operation = current_operation()
        if operation is not None:
            self.session.flush()
            operation.finish("success", connection=self.session.connection())
        return True

    def failed(self, batch, *, terminal=False, code="summary_failed"):
        self.session.execute(
            update(ConversationSummaryRow)
            .where(
                ConversationSummaryRow.user_id == str(batch.user_id),
                ConversationSummaryRow.lease_token == batch.lease_token,
            )
            .values(
                lease_token=None,
                lease_until=None,
                retry_after=None if terminal else datetime.now(UTC) + timedelta(minutes=15),
                attempts=3 if terminal else ConversationSummaryRow.attempts,
                last_error=code,
            )
        )
