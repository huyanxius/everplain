"""Same P0 v2 delivery channel, real SDK, synthetic provider responses."""

import json
from types import SimpleNamespace

import pytest
from billing_test_support import configure_synthetic_billing
from sqlalchemy import text
from streaming_test_support import chat_http_response
from test_conversation_summary import worker
from test_conversation_summary_diagnostics import _completion, _wire_summarizer
from test_summary_last_good import real_cards, three_topics


@pytest.mark.parametrize("fault", [
    "missing", "cache_contract", "contradictory", "invalid_core", "settlement",
])
def test_valid_structured_cards_with_unknown_usage_are_persisted_ready(
    plain_client, monkeypatch, fault,
):
    owner, _ = three_topics(plain_client)
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")
    if fault == "settlement":
        def failed_settlement(**_kwargs):
            raise RuntimeError("synthetic_settlement_unavailable")
        monkeypatch.setattr(plain_client.app.state.billing_operations.runtime,
                            "finish", failed_settlement)

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        batch = SimpleNamespace(sources=payload["sources"])
        completion, _ = _completion(body, batch)
        completion["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = (
            json.dumps(real_cards(batch), ensure_ascii=False)
        )
        if fault == "missing":
            completion.pop("usage")
        elif fault == "cache_contract":
            # Exact core numbers from the reported case; cache subtypes are not
            # declared zero and must remain unconfirmed, not destroy content.
            completion["usage"] = {
                "prompt_tokens": 6598, "completion_tokens": 1337, "total_tokens": 7935,
                "prompt_tokens_details": {}, "completion_tokens_details": {},
            }
        elif fault == "contradictory":
            completion["usage"]["total_tokens"] = 999
        elif fault == "invalid_core":
            completion["usage"]["completion_tokens"] = -1
        return chat_http_response(completion, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)
    current = worker(plain_client)
    current.generate, current.billing = summarizer, plain_client.app.state.billing_operations
    assert current.run_once()
    result = plain_client.get("/api/agent/context-summary").json()
    assert len(requests) == 1
    assert result["status"] == "ready" and len(result["cards"]) == 3 and result["summary"]
    expected_usage = "known" if fault == "settlement" else "pending"
    assert result["usage_status"] == expected_usage and not result["is_stale"]
    assert result["updated_at"]
    assert plain_client.get("/api/agent/context-summary").json() == result
    with plain_client.app.state.database.engine.connect() as conn:
        operation = conn.execute(text(
            "SELECT price_json,exempt,hold_points,charged_points FROM billing_operations "
            "WHERE user_id=:owner",
        ), {"owner": str(owner)}).mappings().one()
        assert json.loads(operation["price_json"])["billing_policy"] == "actual_usage_v2"
        assert operation["exempt"] == 1 and operation["hold_points"] == 0
        assert operation["charged_points"] == 0
        attempt = conn.execute(text(
            "SELECT usage_state,reference_cost_pico FROM billing_attempts",
        )).mappings().one()
        if fault == "settlement":
            assert attempt["usage_state"] == "known" and attempt["reference_cost_pico"] > 0
        else:
            assert attempt["usage_state"] != "known" and attempt["reference_cost_pico"] is None
        daily = conn.execute(text(
            "SELECT calls,budget_tokens,input_tokens,output_tokens FROM agent_memory_usage",
        )).one()
        assert daily.calls == 1 and daily.budget_tokens > 0
        assert daily.input_tokens == daily.output_tokens == 0


def test_invalid_model_structure_cannot_become_a_fake_success(plain_client, monkeypatch):
    three_topics(plain_client)
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        completion, _ = _completion(body, SimpleNamespace(sources=payload["sources"]),
                                    invalid_output=True, missing_usage=True)
        return chat_http_response(completion, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)
    current = worker(plain_client)
    current.generate, current.billing = summarizer, plain_client.app.state.billing_operations
    assert current.run_once()
    result = plain_client.get("/api/agent/context-summary").json()
    assert len(requests) == 1 and result["status"] != "ready"
    assert not result["summary"] and not result["cards"]
