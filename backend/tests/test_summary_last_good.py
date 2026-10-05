"""Last-good is real generated content, never generic fallback suggestions."""

import json
from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select
from test_agent_memory import register
from test_conversation_context import seed, tools
from test_conversation_summary import worker

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentConversationRow
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow, MemoryUsageRow


def three_topics(client):
    owner = UUID(register(client))
    conversations = [seed(client, owner, (topic,)) for topic in (
        "杭州周末交通预算五百元", "读书会演讲只有五分钟", "周五迁移需要保留回退入口",
    )]
    return owner, conversations


def real_cards(batch):
    sources = [s for s in batch.sources if s["role"] == "user"]
    refs = [{"conversation_id": s["conversation_id"], "message_id": s["message_id"],
             "quote": s["content"]} for s in sources]
    return {
        "summary": "最近讨论了杭州交通、读书会演讲和迁移回退。",
        "summary_sources": refs,
        "cards": [{"title": s["content"],
                   "description": f"你具体提到{s['content']}，可以一起继续核对相关安排。",
                   "prompt": f"先回读原文，再讨论{s['content']}。", "sources": [ref]}
                  for s, ref in zip(sources, refs, strict=True)],
    }


def saved(client):
    owner, conversations = three_topics(client)
    current = worker(client)
    current.generate = lambda batch: (real_cards(batch), 1200, 300)
    assert current.run_once()
    body = client.get("/api/agent/context-summary").json()
    assert len(body["cards"]) == 3
    return owner, conversations, body


def test_source_change_returns_actual_last_good_cards_and_original_timestamp(plain_client):
    owner, conversations, old = saved(plain_client)
    with plain_client.app.state.database.session() as session:
        session.get(AgentConversationRow, str(conversations[0].conversation_id)).title = (
            "最新旅行安排"
        )
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "pending" and body["is_stale"]
    assert len(body["cards"]) == 3 and body["summary"] == old["summary"]
    assert body["updated_at"] == old["updated_at"]
    assert {card["title"] for card in body["cards"]} == {card["title"] for card in old["cards"]}
    recalled = tools(plain_client, owner).context
    context = json.loads(recalled.split("\n", 1)[1])
    assert context["summary"] == old["summary"] and context["is_stale"]
    assert datetime.fromisoformat(context["updated_at"]) == datetime.fromisoformat(
        old["updated_at"],
    )


def test_failed_refresh_and_exhausted_budget_do_not_clear_last_good(plain_client):
    owner, conversations, old = saved(plain_client)
    with plain_client.app.state.database.session() as session:
        session.get(AgentConversationRow, str(conversations[0].conversation_id)).title = (
            "新的来源水位"
        )
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        usage.calls, usage.budget_tokens = 3, 62598
        row = session.get(ConversationSummaryRow, str(owner))
        row.fingerprint = ""
        row.last_error = "model:usage_unknown"
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and body["status_reason"] == "daily_budget"
    assert body["is_stale"] and len(body["cards"]) == 3 and body["summary"] == old["summary"]
    assert body["updated_at"] == old["updated_at"]
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        assert (usage.calls, usage.budget_tokens) == (3, 62598)


def test_failed_model_refresh_keeps_last_good_cards(plain_client):
    owner, conversations, old = saved(plain_client)
    with plain_client.app.state.database.session() as session:
        session.get(AgentConversationRow, str(conversations[0].conversation_id)).title = "新来源"
    plain_client.get("/api/agent/context-summary")

    def fail(_batch):
        raise RuntimeError("synthetic_provider_failure")

    current = worker(plain_client)
    current.generate = fail
    assert current.run_once()
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and body["is_stale"]
    assert len(body["cards"]) == 3 and body["updated_at"] == old["updated_at"]
    for before, after in zip(old["cards"], body["cards"], strict=True):
        assert all(before[key] == after[key] for key in ("title", "description", "prompt"))
        assert before["sources"][0]["quote"] == after["sources"][0]["quote"]


@pytest.mark.parametrize("counts", [(None, None), (-1, 20), (True, 20), (80, None)])
def test_valid_content_is_cached_with_pending_usage_instead_of_rolled_back(plain_client, counts):
    owner, _ = three_topics(plain_client)
    current = worker(plain_client)
    current.generate = lambda batch: (real_cards(batch), *counts)
    assert current.run_once()
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "ready" and len(body["cards"]) == 3 and body["summary"]
    assert body["usage_status"] == "pending" and not body["is_stale"]
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        assert (usage.calls, usage.budget_tokens, usage.input_tokens, usage.output_tokens) == (
            1, 24000, 0, 0,
        )


def test_deleted_source_removes_only_its_card_and_shared_summary(plain_client):
    owner, conversations, _ = saved(plain_client)
    with plain_client.app.state.database.session() as session:
        SqliteConversationRepository(session).delete(
            user_id=owner, conversation_id=conversations[0].conversation_id,
        )
    body = plain_client.get("/api/agent/context-summary").json()
    assert len(body["cards"]) == 2 and not body["summary"]
    assert all("杭州" not in card["title"] for card in body["cards"])
    assert "杭州" not in str(body)


def test_last_good_outside_recent_six_conversations_is_still_readable(plain_client):
    owner, _, old = saved(plain_client)
    for index in range(7):
        seed(plain_client, owner, (f"更新的不同话题{index}",))
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "pending" and body["is_stale"]
    assert body["cards"] == old["cards"] and body["updated_at"] == old["updated_at"]


def test_global_permission_revocation_still_hides_cached_private_content(plain_client):
    owner, _, _ = saved(plain_client)
    with plain_client.app.state.memory_service_scope() as memory:
        memory.repository.configure(owner, None, expected_version=0,
                                    use_memory=False, learn_memory=False)
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "disabled" and not body["cards"] and not body["summary"]


def test_no_successful_cache_is_honestly_empty_without_template_cards(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    current = worker(plain_client)
    current.generate = lambda _: ({"summary": "", "summary_sources": [], "cards": []}, 80, 20)
    assert current.run_once()
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "empty" and not body["cards"] and not body["summary"]
    with plain_client.app.state.database.session() as session:
        row = session.scalar(select(ConversationSummaryRow).where(
            ConversationSummaryRow.user_id == str(owner),
        ))
        assert "_last_good" not in row.summary


def test_empty_new_output_preserves_successful_last_good_cards(plain_client):
    owner, conversations, old = saved(plain_client)
    with plain_client.app.state.database.session() as session:
        session.get(AgentConversationRow, str(conversations[0].conversation_id)).title = "修改来源"
    plain_client.get("/api/agent/context-summary")
    current = worker(plain_client)
    current.generate = lambda _: ({"summary": "", "summary_sources": [], "cards": []}, 80, 20)
    assert current.run_once()
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "ready" and body["is_stale"]
    assert len(body["cards"]) == 3 and body["updated_at"] == old["updated_at"]
