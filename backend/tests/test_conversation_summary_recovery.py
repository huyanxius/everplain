"""Offline lifecycle regressions, not evidence of production/live-model success."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from billing_test_support import configure_synthetic_billing
from sqlalchemy import select, update
from streaming_test_support import chat_http_response
from test_agent_memory import register
from test_conversation_context import seed
from test_conversation_summary import worker
from test_conversation_summary_diagnostics import _completion, _wire_summarizer

from qunxue_api.adapters.sqlite.agent_conversation_model import (
    AgentConversationRow,
    AgentMessageRow,
)
from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow, MemoryUsageRow
from qunxue_api.settings import Settings


def test_budget_blocked_new_watermark_reports_failure_without_refunding(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner)
    worker(plain_client)
    with plain_client.app.state.context_summary_scope() as repo:
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
        repo.failed(batch)
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), batch.usage_day))
        usage.calls, usage.budget_tokens = 2, 48000
        row = session.get(AgentConversationRow, str(conversation.conversation_id))
        row.title = "旅行的预算发生了变化"
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and body["status_reason"] == "daily_budget"
    assert body["retry_at"] and body["cards"] == []
    assert not worker(plain_client).run_once()
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), batch.usage_day))
        assert (usage.calls, usage.budget_tokens) == (2, 48000)
        assert usage.input_tokens == usage.output_tokens == 0


def test_retry_backoff_becomes_queued_then_real_worker_publishes(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    current = worker(plain_client)
    with plain_client.app.state.context_summary_scope() as repo:
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
        repo.failed(batch, code="model:http_503")
    failed = plain_client.get("/api/agent/context-summary").json()
    assert failed["status"] == "failed" and failed["status_reason"] == "retry_wait"
    assert failed["retry_at"] and not current.run_once()
    with plain_client.app.state.database.session() as session:
        session.execute(update(ConversationSummaryRow).values(
            retry_after=datetime.now(UTC) - timedelta(seconds=1),
        ))
    queued = plain_client.get("/api/agent/context-summary").json()
    assert queued["status"] == "pending" and queued["status_reason"] == "queued"
    assert current.run_once()
    ready = plain_client.get("/api/agent/context-summary").json()
    assert ready["status"] == "ready" and ready["summary"] and ready["cards"]
    assert ready["status_reason"] is None and ready["retry_at"] is None
    assert not current.run_once()


def test_inflight_lease_is_not_mislabeled_as_exhausted_budget(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    worker(plain_client)
    with plain_client.app.state.context_summary_scope() as repo:
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
    with plain_client.app.state.database.session() as session:
        session.get(MemoryUsageRow, (str(owner), batch.usage_day)).budget_tokens = 64000
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "pending" and body["status_reason"] == "generating"


def test_summary_debounce_is_independent_of_long_term_learning(monkeypatch):
    monkeypatch.setenv("EVERPLAIN_MEMORY_LEARNING_IDLE_SECONDS", "1200")
    monkeypatch.delenv("EVERPLAIN_CONVERSATION_SUMMARY_IDLE_SECONDS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.memory_learning_idle_seconds == 1200
    assert settings.conversation_summary_idle_seconds == 60
    assert settings.memory_learning_daily_calls == 8
    assert settings.memory_learning_daily_tokens == 64000


def test_continuous_completed_activity_has_bounded_idle_wait(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, ("较早的行程预算已经确定", "刚补充了演讲安排"))
    current = worker(plain_client)
    current.idle_seconds = 60
    now = datetime.now(UTC)
    with plain_client.app.state.database.session() as session:
        session.execute(update(AgentMessageRow).where(
            AgentMessageRow.conversation_id == str(conversation.conversation_id),
            AgentMessageRow.sequence < 2,
        ).values(created_at=now - timedelta(minutes=6)))
    queued = plain_client.get("/api/agent/context-summary").json()
    assert queued["status"] == "pending" and queued["status_reason"] == "queued"
    assert current.run_once()  # latest source is fresh; earliest unread source waited >5 min
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "ready"


def test_new_source_waits_without_starting_a_model_from_get(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    current = worker(plain_client)
    current.idle_seconds = 60
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "pending" and body["status_reason"] == "idle_wait"
    assert body["retry_at"]
    assert not current.run_once()
    with plain_client.app.state.database.session() as session:
        assert session.get(ConversationSummaryRow, str(owner)) is None
        assert session.get(
            MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()),
        ) is None


def test_partial_ten_omissions_still_produces_three_cited_cards_through_sdk(
    plain_client, monkeypatch,
):
    owner = UUID(register(plain_client))
    seed(plain_client, owner, tuple("超长完整消息" * 2000 for _ in range(5)),
         answer="超长完整回答" * 2000)
    a = seed(plain_client, owner, ("杭州周末交通预算为五百元", "我需要比较杭州高铁和大巴"))
    b = seed(plain_client, owner, ("读书会演讲只有五分钟，需要保留对照例子",))
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")
    batches, errors = [], []

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        assert payload["omitted_messages"] == 10
        sources = [s for s in payload["sources"] if s["role"] == "user"]
        assert {s["conversation_id"] for s in sources} == {
            str(a.conversation_id), str(b.conversation_id),
        }
        assert all("超长完整" not in s["content"] for s in payload["sources"])
        wire, _ = _completion(body, batches[0])
        refs = [{"conversation_id": s["conversation_id"], "message_id": s["message_id"],
                 "quote": s["content"]} for s in sources]
        generated = {
            "summary": "你最近在讨论杭州周末交通预算和五分钟读书会演讲。",
            "summary_sources": refs,
            "cards": [{"title": s["content"],
                       "description": f"最近的对话具体提到：{s['content']}。",
                       "prompt": f"请先回读来源，再一起讨论{s['content']}的安排。",
                       "sources": [ref]} for s, ref in zip(sources, refs, strict=True)],
        }
        assert len(generated["cards"]) == 3
        wire["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = json.dumps(
            generated, ensure_ascii=False,
        )
        return chat_http_response(wire, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)

    def generate(batch):
        batches.append(batch)
        try:
            return summarizer(batch)
        except Exception as error:
            errors.append(error.__cause__ or error)
            raise

    current = worker(plain_client)
    current.generate = generate
    current.billing = plain_client.app.state.billing_operations
    assert current.run_once()
    assert not errors, errors
    ready = plain_client.get("/api/agent/context-summary").json()
    assert ready["status"] == "ready" and ready["omitted_messages"] == 10
    assert len(ready["cards"]) == 3 and len(requests) == 1
    assert ready["summary"] and ready["summary_sources"]
    assert not current.run_once()
    assert plain_client.get("/api/agent/context-summary").json() == ready
    with plain_client.app.state.database.session() as session:
        usage = session.scalar(select(MemoryUsageRow).where(MemoryUsageRow.user_id == str(owner)))
        assert usage.calls == 1 and usage.budget_tokens == 100


def test_terminal_attempts_are_failed_and_have_no_automatic_retry(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    worker(plain_client)
    with plain_client.app.state.context_summary_scope() as repo:
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
        repo.failed(batch, terminal=True, code="model:budget_exceeded")
    with plain_client.app.state.database.session() as session:
        session.get(MemoryUsageRow, (str(owner), batch.usage_day)).budget_tokens = 48000
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and body["status_reason"] == "attempt_limit"
    assert body["retry_at"] is None and not worker(plain_client).run_once()
