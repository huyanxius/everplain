# ruff: noqa: F811
"""Real SDK, entirely synthetic HTTP and accounts; never call a provider."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.metering import (
    MeteredOpenAIChatModel,
    MeteredOpenAIResponsesModel,
    OperationScope,
)
from qunxue_api.modules.agent_conversation import AgentInterrupted
from qunxue_api.modules.billing import (
    BillingBudgetExceeded,
    BillingContextMissing,
    BillingReplayBlocked,
)


class SyntheticStop(BaseException):
    pass


@pytest.mark.parametrize("protocol", ["chat", "responses"])
@pytest.mark.parametrize(
    "failure",
    [
        "attempt_budget",
        "service_budget",
        "credits",
        "shape",
        "interrupted",
        "closed",
        "base_exception",
    ],
)
def test_wire_budget_failure_is_preserved_without_a_provider_request(wallet, protocol, failure):
    runtime, engine = wallet
    if failure == "attempt_budget":
        runtime.max_attempt_pico = 1
    elif failure == "service_budget":
        runtime.daily_budget_pico = 1
    elif failure == "credits":
        with engine.begin() as connection:
            connection.execute(text("UPDATE credit_accounts SET balance=1"))
    prior_risk = runtime.operator_risk_pico()
    network_calls = []
    local_error = (
        AgentInterrupted("synthetic stop")
        if failure == "interrupted"
        else SyntheticStop("synthetic stop")
        if failure == "base_exception"
        else None
    )

    def before_network():
        if local_error is not None:
            raise local_error

    def forbidden_network(request):
        network_calls.append(request)
        pytest.fail("local wire budget rejection must not call the provider")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden_network)) as http:
            cls = MeteredOpenAIChatModel if protocol == "chat" else MeteredOpenAIResponsesModel
            model = cls(
                "gpt-6.1-sol",
                require_billing=True,
                provider=OpenAIProvider(
                    openai_client=AsyncOpenAI(
                        base_url="https://synthetic.test/v1",
                        api_key="synthetic",
                        http_client=http,
                        max_retries=0,
                    )
                ),
                settings={} if failure == "shape" else {"max_tokens": 100},
            )
            with OperationScope(
                runtime,
                user_id="user",
                run_id=uuid4(),
                fingerprint="synthetic",
                before_network=before_network,
            ) as scope:
                if failure == "closed":
                    runtime.finish(run_id=scope.run_id, outcome="cancelled")
                await Agent(model).run("synthetic")

    expected = {
        "shape": BillingContextMissing,
        "interrupted": AgentInterrupted,
        "closed": BillingReplayBlocked,
        "base_exception": SyntheticStop,
    }.get(failure, BillingBudgetExceeded)
    with pytest.raises(expected) as caught:
        asyncio.run(run())
    if local_error is not None:
        assert caught.value is local_error
    if failure == "service_budget":
        assert caught.value.reason == "service_budget_exceeded"
    elif failure == "credits":
        assert caught.value.reason == "credits_depleted"
    assert not network_calls
    assert runtime.operator_risk_pico() == prior_risk
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM billing_attempts")) == 0
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == (
            1 if failure == "credits" else 10000
        )
        assert connection.scalar(text("SELECT hold_points FROM billing_operations")) == 0


@pytest.mark.parametrize("protocol", ["chat", "responses"])
def test_actual_network_connection_error_retains_provider_classification(wallet, protocol):
    runtime, engine = wallet
    network_calls = []

    def network_error(request):
        network_calls.append(request)
        raise httpx.ConnectError("synthetic network failure", request=request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(network_error)) as http:
            cls = MeteredOpenAIChatModel if protocol == "chat" else MeteredOpenAIResponsesModel
            model = cls(
                "gpt-6.1-sol",
                require_billing=True,
                provider=OpenAIProvider(
                    openai_client=AsyncOpenAI(
                        base_url="https://synthetic.test/v1",
                        api_key="synthetic",
                        http_client=http,
                        max_retries=0,
                    )
                ),
                settings={"max_tokens": 100},
            )
            with OperationScope(runtime, user_id="user", run_id=uuid4(), fingerprint="synthetic"):
                await Agent(model).run("synthetic")

    with pytest.raises(ModelAPIError) as caught:
        asyncio.run(run())
    assert type(caught.value.__cause__).__name__ == "APIConnectionError"
    assert isinstance(caught.value.__cause__.__cause__, httpx.ConnectError)
    assert len(network_calls) == 1
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM billing_attempts")) == 1
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == 10000
