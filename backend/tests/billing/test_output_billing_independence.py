# ruff: noqa: F811
"""Real SDK + synthetic SSE/SQLite. Never contacts or mutates a live provider."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from test_buffered_streaming import chat_stream
from test_durable_billing import balance, operation, wallet  # noqa: F401
from test_responses_metering import http_response, response_body

from qunxue_api.adapters.model.metering import (
    MeteredOpenAIChatModel,
    MeteredOpenAIResponsesModel,
    OperationScope,
)
from qunxue_api.modules.billing import BillingBudgetExceeded


@pytest.fixture
def independent_wallet(wallet):
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v2"
    return runtime, engine


def rows(engine):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text("SELECT * FROM billing_attempts")).mappings()]


def wire(runtime, run, output_limit=-1):
    return runtime.before_attempt(
        run_id=run,
        endpoint_id="synthetic",
        model="gpt-6.1-sol",
        input_limit=1000,
        output_limit=output_limit,
        request_hash=str(uuid4()),
        provider_host="synthetic.test",
    )


def receipt(runtime, ident, **extra):
    runtime.complete_attempt(
        attempt_id=ident,
        returned_model="gpt-6.1-sol",
        input_tokens=1000,
        output_tokens=100,
        cache_read_tokens=200,
        cache_write_tokens=300,
        provider_response_id="receipt-" + ident,
        outcome="success",
        **extra,
    )


@pytest.mark.parametrize("protocol", ["chat", "responses"])
@pytest.mark.parametrize("missing", [False, True])
@pytest.mark.parametrize("limited", [False, True])
def test_content_and_terminal_usage_are_independent(independent_wallet, protocol, missing, limited):
    runtime, engine = independent_wallet
    requests = []

    def reply(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if protocol == "responses":
            return http_response(
                response_body("incomplete" if limited else "completed", usage=not missing), True
            )
        content = chat_stream(missing_usage=missing)
        if limited:
            content = content.replace('"finish_reason": "stop"', '"finish_reason": "length"')
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=content)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            cls = MeteredOpenAIChatModel if protocol == "chat" else MeteredOpenAIResponsesModel
            model = cls(
                "gpt-6.1-sol",
                require_billing=True,
                provider=OpenAIProvider(
                    openai_client=AsyncOpenAI(
                        api_key="synthetic",
                        base_url="https://synthetic.test/v1",
                        http_client=http,
                        max_retries=0,
                    )
                ),
            )
            with OperationScope(
                runtime, user_id="user", run_id=uuid4(), fingerprint="independent"
            ) as scope:
                result = await Agent(model).run("Reply OK")
                assert result.output == "OK"
                scope.finish("success")
                return scope.delivery_state, result.all_messages()[-1].provider_details

    state, details = asyncio.run(run())
    assert state["output_finish_reason"] == ("truncated" if limited else "complete")
    assert state["usage_status"] == ("pending" if missing else "known")
    assert state["settlement_status"] == ("pending" if missing else "settled")
    assert state["quota_exhausted"] is False
    assert details["usage_status"] == ("pending" if missing else "known")
    assert len(requests) == 1
    assert not any(
        k in requests[0] for k in ["max_tokens", "max_completion_tokens", "max_output_tokens"]
    )
    (row,) = rows(engine)
    assert row["output_limit"] == -1
    assert row["input_tokens"] is (None if missing else row["input_tokens"])
    assert row["reference_cost_pico"] is (None if missing else row["reference_cost_pico"])
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT status FROM billing_operations")) == "success"
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == (0 if missing else 1)


def test_missing_usage_does_not_stop_following_tool_and_model_step(independent_wallet):
    runtime, engine = independent_wallet
    calls, invoked = [], []

    def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=chat_stream(
                tool=len(calls) == 1, missing_usage=len(calls) == 1, receipt=f"wire-{len(calls)}"
            ),
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            model = MeteredOpenAIChatModel(
                "gpt-6.1-sol",
                require_billing=True,
                provider=OpenAIProvider(
                    openai_client=AsyncOpenAI(
                        api_key="synthetic",
                        base_url="https://synthetic.test/v1",
                        http_client=http,
                        max_retries=0,
                    )
                ),
            )
            agent = Agent(model)

            @agent.tool_plain
            def add(a: int, b: int) -> int:
                invoked.append((a, b))
                return a + b

            with OperationScope(
                runtime, user_id="user", run_id=uuid4(), fingerprint="tools"
            ) as scope:
                assert (await agent.run("Add 17 and 25")).output == "OK"
                scope.finish("success")
                assert scope.delivery_state["usage_status"] == "pending"
                assert scope.delivery_state["output_finish_reason"] == "complete"

    asyncio.run(run())
    assert invoked == [(17, 25)]
    assert len(calls) == 2
    assert [r["usage_state"] for r in rows(engine)] == ["unknown", "known"]


def test_native_maximum_and_unknown_risk_never_freeze_or_exhaust_free_balance(independent_wallet):
    runtime, engine = independent_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=30"))
    runtime.max_attempt_pico = runtime.max_operation_pico = runtime.daily_budget_pico = 1
    runtime.max_attempts = 1
    run = operation(runtime)
    first = wire(runtime, run, 384000)
    runtime.complete_attempt(attempt_id=first, usage_known=False, outcome="success")
    second = wire(runtime, run)
    assert second != first
    assert runtime.available_balance("user") == balance(engine) == 30
    assert runtime.delivery_state(run)["quota_exhausted"] is False
    assert runtime.delivery_state(run)["usage_status"] == "pending"
    runtime.finish(run_id=run, outcome="success")


def test_confirmed_quota_exhaustion_stops_next_wire_without_debt_or_waiver(independent_wallet):
    runtime, engine = independent_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=10"))
    run = operation(runtime)
    ident = wire(runtime, run)
    receipt(runtime, ident)
    state = runtime.delivery_state(run)
    assert state["usage_status"] == "known"
    assert state["settlement_status"] == "pending"
    assert state["pending_credit_numerator"] == "17700000000000"
    assert state["quota_exhausted"] is True
    assert balance(engine) == 0
    assert rows(engine)[0]["reference_cost_pico"] == 2770000000
    with pytest.raises(BillingBudgetExceeded) as error:
        wire(runtime, run)
    assert error.value.reason == "credits_depleted"
    for _ in range(3):
        receipt(runtime, ident)
        runtime.finish(run_id=run, outcome="success")
    assert balance(engine) == 0
    assert runtime.delivery_state(run)["pending_credit_numerator"] == "17700000000000"
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1
        assert conn.scalar(text("SELECT charged_points FROM billing_operations")) == 10


def test_context_failure_after_confirmed_usage_does_not_refund_or_duplicate(independent_wallet):
    runtime, engine = independent_wallet
    run = operation(runtime)
    ident = wire(runtime, run)
    receipt(runtime, ident)
    runtime.finish(run_id=run, outcome="error")  # later local context/output business failure
    receipt(runtime, ident)
    assert balance(engine) == 9973
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1
        assert conn.scalar(text("SELECT status FROM billing_operations")) == "error"


def test_operation_policy_override_does_not_change_operator_or_old_snapshots(wallet):
    runtime, engine = wallet
    with OperationScope(runtime, user_id="user", run_id=uuid4(), fingerprint="old") as old:
        assert old.independent_delivery is False
        old.finish("cancelled")
    with OperationScope(
        runtime,
        user_id="user",
        run_id=uuid4(),
        fingerprint="agent",
        billing_policy="actual_usage_v2",
    ) as agent:
        assert agent.independent_delivery is True
        agent.finish("success")
    assert runtime.billing_policy == "delivery_v1"
    with engine.connect() as conn:
        policies = [
            json.loads(x)["billing_policy"]
            for x in conn.scalars(
                text("SELECT price_json FROM billing_operations ORDER BY created_at")
            )
        ]
    assert policies == ["delivery_v1", "actual_usage_v2"]
