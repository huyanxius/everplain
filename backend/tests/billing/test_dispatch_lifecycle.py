# ruff: noqa: F811
import asyncio
import socket
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError
from pydantic_ai.providers.openai import OpenAIProvider
from qunxue_api.adapters.model.dispatch import DispatchEvidence
from qunxue_api.adapters.model.metering import (
    MeteredOpenAIChatModel,
    MeteredOpenAIResponsesModel,
    OperationScope,
)
from qunxue_api.modules.billing import BillingReplayBlocked
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401


def seed(runtime):
    run = runtime.start(user_id="user", run_id=uuid4(), fingerprint="synthetic")
    attempt = runtime.before_attempt(
        run_id=run,
        endpoint_id="primary",
        model="gpt-6.1-sol",
        input_limit=100,
        output_limit=100,
        request_hash="synthetic",
        provider_host="synthetic.test",
    )
    return run, attempt


@pytest.mark.parametrize("protocol", ["chat", "responses"])
def test_stock_tcp_refusal_proves_no_request_sent_and_releases_risk(wallet, protocol):
    runtime, engine = wallet
    with socket.socket() as unused_port:
        unused_port.bind(("127.0.0.1", 0))  # Bound, deliberately not listening.
        port = unused_port.getsockname()[1]

        async def run():
            async with httpx.AsyncClient(trust_env=False, timeout=1) as http:
                cls = MeteredOpenAIChatModel if protocol == "chat" else MeteredOpenAIResponsesModel
                model = cls(
                    "gpt-6.1-sol",
                    require_billing=True,
                    settings={"max_tokens": 100},
                    provider=OpenAIProvider(
                        openai_client=AsyncOpenAI(
                            base_url=f"http://127.0.0.1:{port}/v1",
                            api_key="synthetic",
                            http_client=http,
                            max_retries=0,
                        )
                    ),
                )
                with OperationScope(
                    runtime, user_id="user", run_id=uuid4(), fingerprint="synthetic"
                ):
                    await Agent(model).run("synthetic")

        with pytest.raises(ModelAPIError):
            asyncio.run(run())
    assert runtime.operator_risk_pico() == 0
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT dispatch_state,usage_state,reference_cost_pico FROM billing_attempts")
        ).one() == ("not_sent", "not_sent", 0)
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == 10000


@pytest.mark.parametrize("case", ["absent", "unsupported", "later_connect", "sent", "cancelled"])
def test_missing_or_uncertain_evidence_never_erases_reservation(wallet, case):
    runtime, _ = wallet
    run, attempt = seed(runtime)
    evidence = DispatchEvidence(runtime, attempt, supported=case != "unsupported")

    async def trace():
        if case != "absent":
            await evidence.trace("connection.connect_tcp.failed", {})
        if case == "later_connect":
            await evidence.trace("connection.connect_tcp.complete", {})
        if case == "sent":
            await evidence.trace("http11.send_request_headers.started", {})

    asyncio.run(trace())
    evidence.finish_failed(asyncio.CancelledError() if case == "cancelled" else RuntimeError())
    runtime.finish(run_id=run, outcome="error")
    assert runtime.operator_risk_pico() > 0
    assert len(runtime.pending_reconciliation()) == 1
    assert runtime.risk_breakdown()["pending_unknown"] == runtime.operator_risk_pico()


def test_exact_authoritative_usage_reconciles_cost_only_once(wallet):
    runtime, engine = wallet
    run, attempt = seed(runtime)
    runtime.record_response_received(attempt, "request-synthetic-1")
    runtime.finish(run_id=run, outcome="cancelled")
    with engine.connect() as connection:
        operation = dict(
            connection.execute(text("SELECT * FROM billing_operations")).mappings().one()
        )
    receipt = dict(
        attempt_id=attempt,
        provider_host="synthetic.test",
        provider_request_id="request-synthetic-1",
        model="gpt-6.1-sol",
        input_tokens=10,
        output_tokens=5,
        cache_read_tokens=0,
        cache_write_tokens=0,
    )
    assert runtime.reconcile_usage(**receipt) == "reconciled"
    assert runtime.reconcile_usage(**receipt) == "already_known"
    assert runtime.operator_risk_pico() == 70000000
    assert runtime.pending_reconciliation() == []
    with engine.connect() as connection:
        assert (
            dict(connection.execute(text("SELECT * FROM billing_operations")).mappings().one())
            == operation
        )
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == 10000
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
        assert connection.scalar(text("SELECT billable FROM billing_attempts")) == 0
        assert connection.scalar(text("SELECT outcome FROM billing_attempts")) != "success"


@pytest.mark.parametrize(
    "field,value",
    [("provider_request_id", "wrong"), ("provider_host", "other.test"), ("model", "gpt-6-luna")],
)
def test_unmatched_receipts_and_legacy_rows_remain_unknown(wallet, field, value):
    runtime, engine = wallet
    run, attempt = seed(runtime)
    runtime.record_response_received(attempt, "request-synthetic-1")
    runtime.finish(run_id=run, outcome="error")
    before = runtime.operator_risk_pico()
    receipt = dict(
        attempt_id=attempt,
        provider_host="synthetic.test",
        provider_request_id="request-synthetic-1",
        model="gpt-6.1-sol",
        input_tokens=10,
        output_tokens=5,
        cache_read_tokens=0,
        cache_write_tokens=0,
    )
    receipt[field] = value
    with pytest.raises(BillingReplayBlocked):
        runtime.reconcile_usage(**receipt)
    with engine.begin() as connection:
        connection.execute(text("UPDATE billing_attempts SET dispatch_state='legacy_unknown'"))
    assert not runtime.release_proven_not_sent(attempt)
    assert runtime.operator_risk_pico() == before
    with pytest.raises(ValueError):
        runtime.pending_reconciliation(limit=101)
