"""Bounded owner-only snapshots, durable leases and shared memory cost controls."""

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy import text as sql_text
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

# Same daily budget as durable learning. Dispatched/unknown failures retain reservations.
SUMMARY_RESERVATION = 24000
_RESERVATION_AUDIT = "_reservation_release_audit"
_LAST_GOOD = "_last_good"
_PREFLIGHT_FAILURES = {
    "billing_open:phase_policy_missing", "billing_open:billing_runtime_missing",
}
_SOURCE_BYTES = 16000
_MAX_IDLE_WAIT_SECONDS = 300
_GENERIC_TITLES = {
    "理清下一步",
    "比较可选方案",
    "把想法写清楚",
    "Clarify next steps",
    "Compare options",
    "Put an idea into words",
}


class SqliteConversationSummaryRepository:
    def __init__(self, session, *, enabled=True):
        self.session = session
        self.enabled = enabled
        self.memory = SqliteMemoryRepository(session)

    @staticmethod
    def _preserve_reservation_audit(output, previous, *, clear_active=False):
        # Technical audit is never model-provided or exposed by validate/read.
        if isinstance(previous, dict) and _RESERVATION_AUDIT in previous:
            audit = deepcopy(previous[_RESERVATION_AUDIT])
            if clear_active and isinstance(audit, dict):
                audit.pop("active_reservation", None)
            return {**output, _RESERVATION_AUDIT: audit}
        return output

    @staticmethod
    def _last_good(row):
        if row is None or not isinstance(row.summary, dict):
            return None
        cached = row.summary.get(_LAST_GOOD)
        if isinstance(cached, dict) and isinstance(cached.get("output"), dict):
            return deepcopy(cached)
        if row.summary.get("summary") or row.summary.get("cards"):
            return {
                "output": {key: deepcopy(row.summary.get(key, [] if key != "summary" else ""))
                           for key in ("summary", "summary_sources", "cards")},
                "fingerprint": row.fingerprint,
                "updated_at": utc(row.updated_at).isoformat() if row.updated_at else None,
                "usage_status": "known",
            }
        return None

    def _cached_sources(self, user_id, output):
        """Recheck actual cited messages, including ones outside the latest window."""
        scope = self.memory.scope(user_id, None)
        if not scope.use_memory or not scope.learn_memory:
            return ()
        references = list(output.get("summary_sources", []))[:8]
        for card in output.get("cards", [])[:3]:
            if isinstance(card, dict):
                references.extend(card.get("sources", [])[:8])
        pairs = {
            (str(ref.get("conversation_id")), str(ref.get("message_id")))
            for ref in references if isinstance(ref, dict)
        }
        sources = []
        for conversation_id, message_id in pairs:
            conversation = self.session.scalar(select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == conversation_id,
                AgentConversationRow.user_id == str(user_id),
            ))
            message = self.session.get(AgentMessageRow, message_id)
            if (
                conversation is None or message is None
                or message.conversation_id != conversation_id
                or message.role not in {"user", "assistant"}
            ):
                continue
            task_id = UUID(conversation.current_research_task_id) if (
                conversation.current_research_task_id
            ) else None
            project = self.memory.scope(user_id, task_id) if task_id else scope
            if not project.use_memory or not project.learn_memory or any(
                fence.learn_after and utc(message.created_at) <= fence.learn_after
                for fence in (scope, project)
            ):
                continue
            content = SqliteConversationContextRepository(self.session).source_text(
                user_id, conversation, message,
            )
            sources.append({
                "conversation_id": conversation_id, "message_id": message_id,
                "title": redact_sensitive(conversation.title), "sequence": message.sequence,
                "role": message.role, "created_at": utc(message.created_at).isoformat(),
                "content": content,
            })
        return tuple(sources)

    def snapshot(self, user_id):
        if not self.enabled:
            return None
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

    @staticmethod
    def _idle_deadline(sources, latest, row, idle_seconds):
        # Continuous completed turns cannot postpone an unread source forever.
        # Successful-cache time is the watermark; no extra queue/schema is needed.
        uncovered = [
            utc(datetime.fromisoformat(source["created_at"])) for source in sources
            if row is None or row.updated_at is None
            or utc(datetime.fromisoformat(source["created_at"])) > utc(row.updated_at)
        ]
        first = min(uncovered, default=latest)
        return min(
            latest + timedelta(seconds=idle_seconds),
            first + timedelta(seconds=_MAX_IDLE_WAIT_SECONDS),
        )

    @staticmethod
    def _reservation(sources, omitted, estimator):
        reserved = estimator(sources, omitted) if estimator else SUMMARY_RESERVATION
        if type(reserved) is not int or reserved <= 0:
            raise ValueError("invalid_summary_reservation_estimate")
        return reserved

    def read(self, user_id, *, idle_seconds=60, daily_calls=8, daily_tokens=64000,
             reservation_estimator=None):
        empty = {
            "summary": "",
            "summary_sources": [],
            "cards": [],
            "updated_at": None,
            "scope": "conversation_messages",
            "omitted_messages": 0,
            "status_reason": None,
            "retry_at": None,
            "is_stale": False,
            "usage_status": None,
        }
        snapshot = self.snapshot(user_id)
        if snapshot is None:
            return {**empty, "status": "disabled"}
        fingerprint, sources, latest, omitted = snapshot
        row = self.session.get(ConversationSummaryRow, str(user_id))
        cached = self._last_good(row)
        display = self.validate(
            cached["output"], self._cached_sources(user_id, cached["output"]),
        ) if cached else {"summary": "", "summary_sources": [], "cards": []}
        has_cached = bool(display["summary"] or display["cards"])
        old = {
            **display,
            "updated_at": cached.get("updated_at") if cached and has_cached else None,
            "is_stale": has_cached,
            "usage_status": cached.get("usage_status", "known") if cached and has_cached else None,
        }
        if not sources:
            return {**empty, **old, "status": "empty", "omitted_messages": omitted}
        if row is None or row.fingerprint != fingerprint:
            if row and row.attempted_fingerprint != fingerprint:
                invalidate_conversation_summary(self.session, user_id)
            state = self._waiting_state(
                user_id, fingerprint, sources, latest, row,
                idle_seconds=idle_seconds, daily_calls=daily_calls, daily_tokens=daily_tokens,
                reserved_tokens=self._reservation(sources, omitted, reservation_estimator),
            )
            return {
                **empty,
                **old,
                **state,
                "omitted_messages": omitted,
            }
        # Exact source text and permissions are rechecked on EVERY read. A deleted
        # conversation or changed setting invalidates the cache before disclosure.
        output = self.validate(row.summary, sources)
        # Keep real last-good cards even when a newer pass has no useful cards.
        if not output["cards"] and display["cards"]:
            return {**empty, **old, "status": "ready", "omitted_messages": omitted}
        usage_status = cached.get("usage_status", "known") if cached else "known"
        lease_token = cached.get("lease_token") if cached else None
        receipt = row.summary.get(_RESERVATION_AUDIT, {}).get("reservations", {}).get(lease_token)
        if isinstance(receipt, dict) and receipt.get("state") == "known":
            usage_status = "known"
        return {
            **empty,
            **output,
            "status": "ready" if output["summary"] or output["cards"] else "empty",
            "updated_at": utc(row.updated_at).isoformat() if row.updated_at else None,
            "omitted_messages": omitted,
            "usage_status": usage_status,
        }

    def _waiting_state(
        self, user_id, fingerprint, sources, latest, row,
        *, idle_seconds, daily_calls, daily_tokens, reserved_tokens,
    ):
        now = datetime.now(UTC)
        if row and row.lease_until and utc(row.lease_until) > now:
            return {"status": "pending", "status_reason": "generating"}
        if row and row.attempted_fingerprint == fingerprint and row.attempts >= 3:
            return {"status": "failed", "status_reason": "attempt_limit"}
        usage = self.session.get(MemoryUsageRow, (str(user_id), now.date().isoformat()))
        configured = daily_calls > 0 and daily_tokens >= reserved_tokens
        if not configured or usage and (
            usage.calls >= daily_calls or usage.budget_tokens + reserved_tokens > daily_tokens
        ):
            return {
                "status": "failed", "status_reason": "daily_budget",
                "retry_at": (
                    datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), UTC)
                    .isoformat() if configured else None
                ),
            }
        if row and row.attempted_fingerprint == fingerprint:
            if row.retry_after and utc(row.retry_after) > now:
                return {
                    "status": "failed", "status_reason": "retry_wait",
                    "retry_at": utc(row.retry_after).isoformat(),
                }
            if row.last_error and not row.retry_after:
                return {"status": "failed", "status_reason": "generation_failed"}
        if self.session.scalar(
            select(AgentRunRow.run_id).where(
                AgentRunRow.user_id == str(user_id), AgentRunRow.status == "running",
            ).limit(1)
        ):
            return {"status": "pending", "status_reason": "active_run"}
        deadline = self._idle_deadline(sources, latest, row, idle_seconds)
        if deadline > now:
            return {
                "status": "pending", "status_reason": "idle_wait",
                "retry_at": deadline.isoformat(),
            }
        return {"status": "pending", "status_reason": "queued"}

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

    def claim(self, *, idle_seconds, daily_calls, daily_tokens, reservation_estimator=None):
        if not self.enabled:
            return None
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
                or_(
                    MemoryUsageRow.user_id.is_(None),
                    and_(
                        MemoryUsageRow.calls < daily_calls,
                        MemoryUsageRow.budget_tokens < daily_tokens,
                    ),
                ),
                ~exists().where(
                    AgentRunRow.user_id == AgentConversationRow.user_id,
                    AgentRunRow.status == "running",
                ),
                or_(
                    ~exists().where(
                        newer_conversation.user_id == AgentConversationRow.user_id,
                        newer_conversation.updated_at > now - timedelta(seconds=idle_seconds),
                    ),
                    exists().where(
                        AgentMessageRow.conversation_id == AgentConversationRow.conversation_id,
                        AgentMessageRow.created_at
                        <= now - timedelta(seconds=_MAX_IDLE_WAIT_SECONDS),
                        or_(
                            ConversationSummaryRow.updated_at.is_(None),
                            AgentMessageRow.created_at > ConversationSummaryRow.updated_at,
                        ),
                    ),
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
                self._begin_write_transaction()
                previous = self.session.get(ConversationSummaryRow, owner, populate_existing=True)
                empty = self._preserve_reservation_audit({}, previous.summary if previous else {})
                cached = self._last_good(previous)
                if cached:
                    empty[_LAST_GOOD] = cached
                self.session.execute(
                    insert(ConversationSummaryRow)
                    .values(
                        user_id=owner,
                        fingerprint=fingerprint,
                        attempted_fingerprint=fingerprint,
                        summary=empty,
                        attempts=0,
                        updated_at=now,
                    )
                    .on_conflict_do_update(
                        index_elements=[ConversationSummaryRow.user_id],
                        set_={"fingerprint": fingerprint, "summary": empty, "updated_at": now},
                    )
                )
                continue
            reserved_tokens = self._reservation(sources, omitted, reservation_estimator)
            if reserved_tokens > daily_tokens:
                continue
            usage = self.session.get(MemoryUsageRow, (owner, day), populate_existing=True)
            if usage and (
                usage.calls >= daily_calls or usage.budget_tokens + reserved_tokens > daily_tokens
            ):
                continue
            previous = self.session.get(ConversationSummaryRow, owner, populate_existing=True)
            if latest is None or self._idle_deadline(
                sources, latest, previous, idle_seconds
            ) > now:
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
                    MemoryUsageRow.budget_tokens + reserved_tokens <= daily_tokens,
                )
                .values(
                    calls=MemoryUsageRow.calls + 1,
                    budget_tokens=MemoryUsageRow.budget_tokens + reserved_tokens,
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
            previous = row.summary if isinstance(row.summary, dict) else {}
            audit = deepcopy(previous.get(_RESERVATION_AUDIT, {}))
            if not isinstance(audit, dict):
                raise ValueError("invalid_summary_reservation_audit")
            audit["active_reservation"] = {
                "lease_token": token, "day": day, "fingerprint": fingerprint,
                "calls": 1, "budget_tokens": reserved_tokens,
            }
            if reservation_estimator:
                audit["active_reservation"].update(kind="context_estimate", owner=owner)
                receipts = deepcopy(audit.get("reservations", {}))
                if not isinstance(receipts, dict):
                    raise ValueError("invalid_summary_reservation_receipts")
                receipts[token] = {
                    **audit["active_reservation"], "kind": "context_estimate",
                    "owner": owner,
                    "state": "reserved",
                }
                audit["reservations"] = receipts
            self.session.execute(
                update(ConversationSummaryRow).where(
                    ConversationSummaryRow.user_id == owner,
                    ConversationSummaryRow.lease_token == token,
                ).values(summary={**previous, _RESERVATION_AUDIT: audit})
            )
            return ContextSummaryBatch(
                user_id, token, fingerprint, sources, day, omitted, reserved_tokens,
                "context_estimate" if reservation_estimator else "legacy_fixed",
            )
        return None

    def complete(self, batch, output, input_tokens, output_tokens):
        known = all(type(value) is int and value >= 0 for value in (input_tokens, output_tokens))
        if not known:
            input_tokens = output_tokens = None
        self._begin_write_transaction()
        now = datetime.now(UTC)
        snapshot = self.snapshot(batch.user_id)
        if snapshot is None:
            return False
        previous = self.session.get(
            ConversationSummaryRow, str(batch.user_id), populate_existing=True
        )
        supplied = {(source["conversation_id"], source["message_id"]) for source in batch.sources}
        readable = tuple(source for source in self._cached_sources(batch.user_id, output)
                         if (source["conversation_id"], source["message_id"]) in supplied)
        validated = self.validate(output, readable)
        summary = self._preserve_reservation_audit(
            validated, previous.summary if previous else {},
            clear_active=True,
        )
        cached = self._last_good(previous)
        if validated["cards"] or not cached and validated["summary"]:
            cached = {
                "output": deepcopy(validated), "fingerprint": batch.fingerprint,
                "updated_at": now.isoformat(), "lease_token": batch.lease_token,
                "usage_status": "known" if known else "pending",
            }
        if cached:
            summary[_LAST_GOOD] = cached
        owns_live_lease = (
            previous and previous.lease_token == batch.lease_token
            and previous.lease_until and utc(previous.lease_until) > now
        )
        if not owns_live_lease:
            # A genuinely parsed, still-readable result may be useful even when
            # its worker was superseded. Never overwrite a newer current cache
            # or its lease; otherwise retain it only as dated last-good content.
            newer_current = previous and previous.fingerprint == snapshot[0] and (
                self.validate(previous.summary, snapshot[1])["cards"]
            )
            if cached and not newer_current and previous:
                self.session.execute(update(ConversationSummaryRow).where(
                    ConversationSummaryRow.user_id == str(batch.user_id),
                ).values(summary={**previous.summary, _LAST_GOOD: cached})
                  .execution_options(synchronize_session=False))
            return bool(cached or newer_current)
        result = self.session.execute(
            update(ConversationSummaryRow)
            .where(
                ConversationSummaryRow.user_id == str(batch.user_id),
                ConversationSummaryRow.lease_token == batch.lease_token,
                ConversationSummaryRow.lease_until > now,
            )
            .values(
                fingerprint=batch.fingerprint,
                summary=summary,
                updated_at=now,
                lease_token=None,
                lease_until=None,
                retry_after=None,
                attempts=0,
                last_error=None,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            return False
        from qunxue_api.adapters.model.metering import current_operation

        operation = current_operation()
        if batch.reservation_kind == "context_estimate":
            # Publication is committed independently. The worker settles after
            # closing its billing scope; pending usage never rolls valid cards back.
            evidence = None
            if known and operation is None and not self._billing_operation(batch):
                evidence = ("known", input_tokens, output_tokens)
            if evidence is not None:
                self._settle_receipt(batch, evidence)
        elif known:
            # Compatibility for old/injected generators without a request estimator.
            total = max(0, input_tokens) + max(0, output_tokens)
            self.session.execute(update(MemoryUsageRow).where(
                MemoryUsageRow.user_id == str(batch.user_id),
                MemoryUsageRow.day == batch.usage_day,
            ).values(
                input_tokens=MemoryUsageRow.input_tokens + max(0, input_tokens),
                output_tokens=MemoryUsageRow.output_tokens + max(0, output_tokens),
                budget_tokens=MemoryUsageRow.budget_tokens + total - batch.reserved_tokens,
            ))
        return True

    def _billing_operation(self, batch):
        return self.session.execute(sql_text(
            "SELECT user_id,fingerprint,status FROM billing_operations WHERE run_id=:run"
        ), {"run": batch.lease_token}).mappings().first()

    def _billing_usage(self, batch):
        """Complete operation evidence, never an exception/HTTP status guess."""
        operation = self._billing_operation(batch)
        fingerprint = hashlib.sha256(json.dumps(
            {"context_fingerprint": batch.fingerprint}, default=str,
            sort_keys=True, ensure_ascii=False,
        ).encode()).hexdigest()
        if (
            operation is None or operation["user_id"] != str(batch.user_id)
            or operation["fingerprint"] != fingerprint
            or operation["status"] not in {"success", "error", "cancelled", "refunded"}
        ):
            return None
        attempts = self.session.execute(sql_text(
            "SELECT usage_state,dispatch_state,input_tokens,output_tokens,outcome "
            "FROM billing_attempts WHERE run_id=:run"
        ), {"run": batch.lease_token}).mappings().all()
        input_tokens = output_tokens = 0
        sent = False
        for attempt in attempts:
            if (
                attempt["usage_state"] == "not_sent"
                and attempt["dispatch_state"] == "not_sent"
                and attempt["outcome"] == "error"
            ):
                continue
            if (
                attempt["usage_state"] != "known" or attempt["outcome"] == "in_flight"
                or attempt["dispatch_state"] != "usage_confirmed"
                or any(type(attempt[key]) is not int or attempt[key] < 0
                       for key in ("input_tokens", "output_tokens"))
            ):
                return None
            sent = True
            input_tokens += attempt["input_tokens"]
            output_tokens += attempt["output_tokens"]
        return ("known" if sent else "not_sent", input_tokens, output_tokens)

    def reconcile_failed_usage(self, batch):
        # Called only after OperationScope.__exit__ has persisted its terminal state.
        if batch.reservation_kind != "context_estimate":
            return False
        self._begin_write_transaction()
        evidence = self._billing_usage(batch)
        return evidence is not None and self._settle_receipt(batch, evidence)

    def _begin_write_transaction(self):
        connection = self.session.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")

    @staticmethod
    def _prune_receipts(audit):
        receipts = audit.get("reservations", {})
        if not isinstance(receipts, dict):
            return
        closed = sorted(
            ((record.get("settled_at", ""), token) for token, record in receipts.items()
             if isinstance(record, dict) and record.get("state") != "reserved"),
        )
        for _, token in closed[:-64]:
            receipts.pop(token)

    def _settle_receipt(self, batch, evidence):
        """Own lease receipt + atomic usage delta, preserving a replacement lease."""
        self._begin_write_transaction()
        owner = str(batch.user_id)
        row = self.session.get(ConversationSummaryRow, owner, populate_existing=True)
        if row is None or not isinstance(row.summary, dict):
            return False
        previous = deepcopy(row.summary)
        audit = deepcopy(previous.get(_RESERVATION_AUDIT, {}))
        if not isinstance(audit, dict) or not isinstance(audit.get("reservations"), dict):
            return False
        receipt = audit["reservations"].get(batch.lease_token)
        expected = {
            "lease_token": batch.lease_token, "day": batch.usage_day,
            "fingerprint": batch.fingerprint, "calls": 1,
            "budget_tokens": batch.reserved_tokens, "kind": batch.reservation_kind,
            "owner": owner,
            "state": "reserved",
        }
        if receipt != expected or any(
            type(receipt[key]) is not int for key in ("calls", "budget_tokens")
        ):
            return False
        state, input_tokens, output_tokens = evidence
        if state not in {"known", "not_sent"} or any(
            type(value) is not int or value < 0 for value in (input_tokens, output_tokens)
        ) or state == "not_sent" and (input_tokens or output_tokens):
            return False
        audit["reservations"][batch.lease_token] = {
            **receipt, "state": state, "input_tokens": input_tokens,
            "output_tokens": output_tokens, "settled_at": datetime.now(UTC).isoformat(),
        }
        if (audit.get("active_reservation") or {}).get("lease_token") == batch.lease_token:
            audit.pop("active_reservation", None)
        # Retain unresolved reservations; bounded terminal receipts fence old replays.
        self._prune_receipts(audit)
        delta = input_tokens + output_tokens - batch.reserved_tokens
        no_call = state == "not_sent"
        with self.session.begin_nested() as transaction:
            updated = self.session.execute(update(ConversationSummaryRow).where(
                ConversationSummaryRow.user_id == owner,
                ConversationSummaryRow.summary == previous,
            ).values(summary={**previous, _RESERVATION_AUDIT: audit})
              .execution_options(synchronize_session=False))
            if updated.rowcount != 1:
                transaction.rollback()
                return False
            usage = self.session.execute(update(MemoryUsageRow).where(
                MemoryUsageRow.user_id == owner, MemoryUsageRow.day == batch.usage_day,
                MemoryUsageRow.calls >= 1, MemoryUsageRow.budget_tokens >= batch.reserved_tokens,
            ).values(
                calls=MemoryUsageRow.calls - int(no_call),
                input_tokens=MemoryUsageRow.input_tokens + input_tokens,
                output_tokens=MemoryUsageRow.output_tokens + output_tokens,
                budget_tokens=MemoryUsageRow.budget_tokens + delta,
            ).execution_options(synchronize_session=False))
            if usage.rowcount != 1:
                transaction.rollback()
                return False
            if no_call:
                self.session.execute(update(ConversationSummaryRow).where(
                    ConversationSummaryRow.user_id == owner,
                    ConversationSummaryRow.lease_token == batch.lease_token,
                    ConversationSummaryRow.attempted_fingerprint == batch.fingerprint,
                    ConversationSummaryRow.attempts > 0,
                ).values(attempts=ConversationSummaryRow.attempts - 1))
        return True

    def failed(self, batch, *, terminal=False, code="summary_failed", release_reservation=False):
        if release_reservation:
            if terminal or code not in _PREFLIGHT_FAILURES:
                raise ValueError("unproven_summary_reservation_release")
            return self._release_preflight_reservation(batch, code)
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

    def _release_preflight_reservation(self, batch, code):
        """CAS the live lease and refund its exact reservation in one transaction."""
        connection = self.session.connection()
        # sqlite3 legacy transaction mode does not begin on SELECT/SAVEPOINT.
        # Ensure releasing our savepoint cannot commit ahead of the outer scope.
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        now, owner = datetime.now(UTC), str(batch.user_id)
        row = self.session.get(ConversationSummaryRow, owner, populate_existing=True)
        usage = self.session.get(MemoryUsageRow, (owner, batch.usage_day), populate_existing=True)
        if (
            row is None or row.lease_token != batch.lease_token
            or row.attempted_fingerprint != batch.fingerprint
            or row.lease_until is None or utc(row.lease_until) <= now
            or row.attempts < 1 and batch.reservation_kind != "context_estimate"
            or usage is None or usage.calls < 1 or usage.budget_tokens < batch.reserved_tokens
        ):
            return False
        previous = row.summary if isinstance(row.summary, dict) else {}
        audit = deepcopy(previous.get(_RESERVATION_AUDIT, {}))
        if not isinstance(audit, dict):
            return False
        active = audit.get("active_reservation")
        expected_active = {
            "lease_token": batch.lease_token, "day": batch.usage_day,
            "fingerprint": batch.fingerprint, "calls": 1,
            "budget_tokens": batch.reserved_tokens,
        }
        if batch.reservation_kind == "context_estimate":
            expected_active.update(kind="context_estimate", owner=owner)
        if (
            batch.reservation_kind not in {"context_estimate", "legacy_fixed"}
            or active != expected_active
            or any(type(active[key]) is not int for key in ("calls", "budget_tokens"))
        ):
            return False
        released = audit.get("preflight", {})
        if not isinstance(released, dict) or any(
            type(released.get(key, 0)) is not int or released.get(key, 0) < 0
            for key in ("released_calls", "released_budget_tokens")
        ):
            return False
        before = {"calls": usage.calls, "budget_tokens": usage.budget_tokens,
                  "attempts": row.attempts}
        after = {"calls": usage.calls - 1,
                 "budget_tokens": usage.budget_tokens - batch.reserved_tokens,
                 "attempts": max(0, row.attempts - 1)}
        audit["preflight"] = {
            "released_calls": released.get("released_calls", 0) + 1,
            "released_budget_tokens": released.get("released_budget_tokens", 0)
            + batch.reserved_tokens,
            "day": batch.usage_day, "fingerprint": batch.fingerprint,
            "last_lease_token": batch.lease_token, "reason": code,
            "released_at": now.isoformat(), "before": before, "after": after,
        }
        if batch.reservation_kind == "context_estimate":
            receipts = audit.get("reservations", {})
            expected = {
                "lease_token": batch.lease_token, "day": batch.usage_day,
                "fingerprint": batch.fingerprint, "calls": 1,
                "budget_tokens": batch.reserved_tokens, "kind": "context_estimate",
                "owner": owner, "state": "reserved",
            }
            if not isinstance(receipts, dict) or receipts.get(batch.lease_token) != expected:
                return False
            receipts[batch.lease_token] = {
                **expected, "state": "not_sent", "input_tokens": 0, "output_tokens": 0,
                "settled_at": now.isoformat(),
            }
            self._prune_receipts(audit)
        audit.pop("active_reservation")
        # The savepoint prevents partial refund/audit if either conditional write fails.
        with self.session.begin_nested() as transaction:
            changed = self.session.execute(
                update(ConversationSummaryRow).where(
                    ConversationSummaryRow.user_id == owner,
                    ConversationSummaryRow.lease_token == batch.lease_token,
                    ConversationSummaryRow.attempted_fingerprint == batch.fingerprint,
                    ConversationSummaryRow.lease_until > now,
                    ConversationSummaryRow.attempts == before["attempts"],
                ).values(
                    lease_token=None, lease_until=None, attempts=after["attempts"],
                    retry_after=now + timedelta(minutes=15), last_error=code,
                    summary={**previous, _RESERVATION_AUDIT: audit},
                ).execution_options(synchronize_session=False)
            )
            if changed.rowcount != 1:
                transaction.rollback()
                return False
            refunded = self.session.execute(
                update(MemoryUsageRow).where(
                    MemoryUsageRow.user_id == owner, MemoryUsageRow.day == batch.usage_day,
                    MemoryUsageRow.calls >= 1,
                    MemoryUsageRow.budget_tokens >= batch.reserved_tokens,
                ).values(
                    calls=MemoryUsageRow.calls - 1,
                    budget_tokens=MemoryUsageRow.budget_tokens - batch.reserved_tokens,
                ).execution_options(synchronize_session=False)
            )
            if refunded.rowcount != 1:
                transaction.rollback()
                return False
        return True
