"""Synthetic account export coverage for visible cards versus private model context."""

import json
from copy import deepcopy
from datetime import UTC, datetime
from uuid import UUID, uuid4

from test_agent_memory import register
from test_conversation_context import seed
from test_conversation_summary import output, worker

from qunxue_api.adapters.sqlite.account_management_repository import SqliteAccountRepository
from qunxue_api.adapters.sqlite.agent_conversation_model import AgentRunRow
from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow


def test_run_export_keeps_user_text_and_card_but_never_private_execution_snapshot():
    original = {
        "request_snapshot": {
            "message": "Visible card\nVisible description\nMy own added request.",
            "context_suggestion": {"card_id": "card-id", "version": "source-version"},
            "_display_card": {
                "title": "Visible card", "description": "Visible description",
                "prompt": "never export malformed extra fields",
            },
            "_execution_prompt": "private internal instruction",
            "_context_suggestion": {"sources": [{"content": "hidden source snapshot"}]},
            "_billing_run_id": "private accounting pointer",
        },
        "partial_answer": "An ordinary answer.",
    }
    before = deepcopy(original)
    exported = SqliteAccountRepository._sanitize_export_row(original, table_name="agent_runs")
    assert exported["request_snapshot"] == {
        "message": original["request_snapshot"]["message"],
        "context_suggestion": {"card_id": "card-id", "version": "source-version"},
    }
    assert exported["context_card"] == {
        "title": "Visible card", "description": "Visible description",
    }
    assert exported["partial_answer"] == original["partial_answer"]
    assert original == before  # Projection never rewrites persisted history.


def test_account_export_projects_legacy_card_cache_and_run_context(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, ("我周末要去杭州，交通预算不超过五百元。",))
    assert worker(plain_client).run_once(generate=output)
    with plain_client.app.state.database.session() as session:
        summary = session.get(ConversationSummaryRow, str(owner))
        cached = deepcopy(summary.summary)
        # Preserve a legacy cache's execution field, including its last-good copy.
        cached["cards"][0]["prompt"] = "legacy worker-only instruction"
        if isinstance(cached.get("_last_good"), dict):
            cached["_last_good"]["output"]["cards"][0]["prompt"] = "legacy worker-only instruction"
        summary.summary = cached
        run = AgentRunRow(
            run_id=str(uuid4()), conversation_id=str(conversation.conversation_id),
            user_id=str(owner), idempotency_key=str(uuid4()), status="completed",
            provider="synthetic", model="synthetic", started_at=datetime.now(UTC),
        )
        session.add(run)
        run.request_snapshot = {
            "message": "我周末要去杭州，交通预算不超过五百元。",
            "_execution_prompt": "internal runner-only instruction",
            "_context_suggestion": {"content": "private hidden execution background"},
            "_display_card": {"title": "周末交通", "description": "比较可见交通预算安排。"},
        }
    created = plain_client.post(
        "/api/account/data-exports", headers={"Idempotency-Key": str(uuid4())},
        json={"format": "json"},
    )
    assert created.status_code == 201, created.text
    response = plain_client.get(created.json()["download_href"])
    assert response.status_code == 200
    serialized = json.dumps(response.json(), ensure_ascii=False)
    for secret in ("legacy worker-only instruction", "internal runner-only instruction",
                   "private hidden execution background", '"_execution_prompt"', '"prompt"'):
        assert secret not in serialized
    records = response.json()["records"]
    assert records["agent_runs"][0]["context_card"]["title"] == "周末交通"
    card = records["agent_conversation_summaries"][0]["summary"]["cards"][0]
    assert card["title"] == "杭州两日行程的交通取舍"
    assert any(row["content"] == "我周末要去杭州，交通预算不超过五百元。"
               for row in records["agent_messages"])
    with plain_client.app.state.database.session() as session:
        assert session.get(ConversationSummaryRow, str(owner)).summary["cards"][0]["prompt"] == (
            "legacy worker-only instruction"
        )
