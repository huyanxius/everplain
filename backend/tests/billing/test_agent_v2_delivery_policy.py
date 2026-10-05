"""Current default Agent scopes, real 0600 Free30 and isolated application state."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from billing_test_support import synthetic_billing_runtime
from sqlalchemy import text
from test_agent_conversation import _FakeAgentTools
from test_agent_memory import register

from qunxue_api.adapters.model.billing_operations import SqliteBillingOperations
from qunxue_api.adapters.model.metering import current_operation
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import (
    AgentInterrupted,
    AgentRunResult,
    ConversationService,
)
from qunxue_api.modules.billing import BillingBudgetExceeded


class CurrentRunner:
    def __init__(self, mode="complete"):
        self.mode, self.calls, self.identities, self.states = mode, 0, [], []

    def run(self, *, on_delta=None, **_kwargs):
        scope = current_operation(required=True)
        assert scope.independent_delivery is True
        self.calls += 1
        self.identities.append(scope.run_id)
        modes = ["complete", "length"] if self.mode == "tool_then_length" else [self.mode]
        answer = ""
        for index, mode in enumerate(modes):
            ident = scope.before_attempt_payload(
                {"model": "gpt-6.1-sol", "messages": []}, provider_host="synthetic.test"
            )
            delta = f"已保存正文{index + 1}。"
            answer += delta
            if on_delta:
                on_delta(delta)
            scope.complete(
                ident,
                {
                    "id": "receipt-" + ident,
                    "model": "gpt-6.1-sol",
                    "usage": None
                    if mode == "pending"
                    else {
                        "prompt_tokens": 600,
                        "completion_tokens": 800,
                        "total_tokens": 1400,
                        "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                    },
                },
                outcome="success",
                finish_reason="length" if mode == "length" else "stop",
            )
            self.states.append(scope.delivery_state)
            if mode == "pending":
                # A missing receipt alone cannot stop the following Agent step.
                follow = scope.before_attempt_payload({"model": "gpt-6.1-sol", "messages": []})
                scope.complete(follow, outcome="success", usage_known=False, finish_reason="stop")
            if mode == "quota":
                scope.before_attempt_payload({"model": "gpt-6.1-sol", "messages": []})
            if mode == "cancel" or (mode == "retry" and self.calls == 1):
                raise AgentInterrupted("explicit synthetic stop")
        return AgentRunResult(
            answer=answer,
            citations=(),
            release_id="release-a",
            provider="fake",
            model="gpt-6.1-sol",
        )

    run_stream = run


@pytest.fixture
def current_app(plain_client):
    user = UUID(register(plain_client))
    database = plain_client.app.state.database
    runtime = synthetic_billing_runtime(database.engine)
    runtime.book = replace(runtime.book, credits_per_usd=100)  # real Free30; explicit test tariff
    now = [datetime(2026, 10, 5, 9, tzinfo=UTC)]
    runtime.clock = lambda: now[0]
    with database.session() as session:
        repository = SqliteConversationRepository(session)
        operations = SqliteBillingOperations(database, runtime).bound_to(session)

        def build(runner):
            return DisciplinaryAgentApplication(
                conversations=ConversationService(repository),
                runner=runner,
                tools_factory=_FakeAgentTools,
                billing=operations,
                atomic=operations.atomic,
                rollback=session.rollback,
            )

        yield user, database, runtime, repository, build, now


@pytest.mark.parametrize("mode", ["complete", "tool_then_length", "pending"])
def test_default_agent_current_policy_delivers_normal_length_or_pending(current_app, mode):
    user, database, runtime, _repository, build, _now = current_app
    runner = CurrentRunner(mode)
    app = build(runner)
    args = dict(
        user_id=user,
        conversation_id=None,
        prompt="synthetic",
        idempotency_key=mode,
        on_delta=lambda _delta: None,
    )
    answer = app.run_turn(**args)
    replay = app.run_turn(**args)
    assert answer.result.answer.startswith("已保存正文")
    assert replay.replayed is True
    assert runner.calls == 1
    assert runner.states[-1]["output_finish_reason"] == (
        "truncated" if mode == "tool_then_length" else "complete"
    )
    assert runner.states[-1]["usage_status"] == ("pending" if mode == "pending" else "known")
    assert runtime.billing_policy == "delivery_v1"  # Only the explicit Agent scope changes.
    with database.engine.connect() as conn:
        operation = conn.execute(text("SELECT * FROM billing_operations")).mappings().one()
        assert json.loads(operation["price_json"])["billing_policy"] == "actual_usage_v2"
        assert operation["quota_period_epoch"] == 1
        assert (
            conn.scalar(text("SELECT limit_points FROM credit_quota_periods WHERE epoch=1")) == 30
        )
        assert conn.scalar(text("SELECT balance FROM credit_accounts")) >= 28


def test_confirmed_free30_exhaustion_stops_next_dispatch_and_preserves_text(current_app):
    user, database, runtime, repository, build, _now = current_app
    runtime.book = replace(runtime.book, credits_per_usd=10000)
    runner = CurrentRunner("quota")
    with pytest.raises(BillingBudgetExceeded) as error:
        build(runner).run_turn(
            user_id=user,
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="quota",
            on_delta=lambda _delta: None,
        )
    assert error.value.reason == "credits_depleted"
    assert runner.states[-1]["quota_exhausted"] is True
    saved = repository.find_run(user_id=user, idempotency_key="quota")
    assert saved.partial_answer == "已保存正文1。"
    with database.engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM billing_attempts")) == 1
        assert conn.scalar(text("SELECT balance FROM credit_accounts")) == 0
        assert conn.scalar(text("SELECT reference_cost_pico FROM billing_attempts")) == 9200000000
        assert (
            conn.scalar(text("SELECT original_credit_pico FROM billing_operations"))
            == "92000000000000"
        )


def test_cancel_and_same_key_retry_keep_confirmed_receipts_distinct(current_app):
    user, database, runtime, repository, build, _now = current_app
    runner = CurrentRunner("retry")
    app = build(runner)
    args = dict(
        user_id=user,
        conversation_id=None,
        prompt="synthetic",
        idempotency_key="retry",
        on_delta=lambda _delta: None,
    )
    with pytest.raises(AgentInterrupted):
        app.run_turn(**args)
    assert (
        repository.find_run(user_id=user, idempotency_key="retry").partial_answer == "已保存正文1。"
    )
    assert runtime.available_balance(user) == 30  # Confirmed 0.92 point retained as exact carry.
    result = app.run_turn(**args)
    assert result.result.answer == "已保存正文1。"
    assert app.run_turn(**args).replayed
    assert runner.identities[0] != runner.identities[1]
    with database.engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM billing_operations")) == 2
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 2
        assert (
            conn.scalar(text("SELECT total_credit_pico FROM credit_quota_periods WHERE epoch=1"))
            == "1840000000000"
        )


def test_late_receipt_cannot_consume_renewed_epoch_or_reopen_delivery(current_app):
    user, database, runtime, _repository, build, now = current_app
    runner = CurrentRunner("pending")
    build(runner).run_turn(
        user_id=user,
        conversation_id=None,
        prompt="synthetic",
        idempotency_key="late",
        on_delta=lambda _delta: None,
    )
    with database.engine.connect() as conn:
        ident = conn.scalar(
            text("SELECT attempt_id FROM billing_attempts ORDER BY created_at LIMIT 1")
        )
    runtime.record_response_received(ident, "late-provider-request")
    now[0] += timedelta(days=7)
    with runtime._transaction() as conn:
        period = ensure_quota_period(conn, str(user), now[0], start=True)
        assert period["epoch"] == 2
    result = runtime.reconcile_usage(
        attempt_id=ident,
        provider_host="synthetic.test",
        provider_request_id="late-provider-request",
        model="gpt-6.1-sol",
        input_tokens=600,
        output_tokens=800,
        cache_read_tokens=0,
        cache_write_tokens=0,
    )
    assert result == "reconciled"
    assert runtime.delivery_state(runner.identities[0])["settlement_status"] == "pending"
    with database.engine.connect() as conn:
        assert conn.scalar(text("SELECT balance FROM credit_accounts")) == 30
        assert (
            conn.scalar(text("SELECT total_credit_pico FROM credit_quota_periods WHERE epoch=2"))
            == "0"
        )
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 0


@pytest.mark.parametrize("first_usage_missing", [False, True])
def test_default_factory_real_sdk_tool_then_length_keeps_body_and_receipts(
    current_app,
    first_usage_missing,
):
    import asyncio

    import httpx
    from openai import AsyncOpenAI
    from pydantic_ai import Agent
    from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta
    from pydantic_ai.providers.openai import OpenAIProvider
    from test_buffered_streaming import chat_stream

    from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel

    user, database, _runtime, _repository, build, _now = current_app

    class SDKToolRunner:
        def __init__(self):
            self.requests, self.executed_tools, self.state = [], [], None

        def run_stream(self, *, on_delta, **_kwargs):
            def reply(request):
                self.requests.append(json.loads(request.content))
                first = len(self.requests) == 1
                body = chat_stream(
                    tool=first,
                    missing_usage=first and first_usage_missing,
                    receipt=f"sdk-tool-{len(self.requests)}",
                )
                if not first:
                    body = body.replace('"finish_reason": "stop"', '"finish_reason": "length"')
                return httpx.Response(
                    200, headers={"content-type": "text/event-stream"}, content=body
                )

            async def events(_ctx, stream):
                async for event in stream:
                    if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                        on_delta(event.part.content)
                    elif isinstance(event, PartDeltaEvent) and isinstance(
                        event.delta, TextPartDelta
                    ):
                        on_delta(event.delta.content_delta)

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
                        self.executed_tools.append((a, b))
                        return a + b

                    response = await agent.run("Add 17 and 25", event_stream_handler=events)
                    self.state = current_operation(required=True).delivery_state
                    return AgentRunResult(
                        answer=response.output,
                        citations=(),
                        release_id="release-a",
                        provider="fake-sdk",
                        model="gpt-6.1-sol",
                    )

            return asyncio.run(run())

    runner = SDKToolRunner()
    displayed = []
    result = build(runner).run_turn(
        user_id=user,
        conversation_id=None,
        prompt="Add 17 and 25",
        idempotency_key=str(uuid4()),
        on_delta=displayed.append,
    )
    assert result.result.answer == "OK"
    assert "".join(displayed) == "OK"
    assert runner.executed_tools == [(17, 25)]
    assert len(runner.requests) == 2
    assert runner.requests[-1]["messages"][-1]["content"] == "42"
    assert runner.state["output_finish_reason"] == "truncated"
    assert runner.state["usage_status"] == ("pending" if first_usage_missing else "known")
    assert runner.state["quota_exhausted"] is False
    with database.engine.connect() as conn:
        assert (
            conn.scalar(text("SELECT limit_points FROM credit_quota_periods WHERE epoch=1")) == 30
        )
        assert conn.scalar(text("SELECT count(*) FROM billing_attempts")) == 2
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == (
            1 if first_usage_missing else 2
        )
