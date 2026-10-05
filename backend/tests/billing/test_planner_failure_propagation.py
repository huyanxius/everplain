# ruff: noqa: F811
import json
from unittest.mock import patch
from uuid import UUID

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from sqlalchemy import text
from test_agent_conversation import _FakeAgentTools
from test_application_metering import Operations, Runner
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import AgentModelRouteFailure, ConversationService


@pytest.mark.parametrize("protocol", ["chat_completions", "responses"])
@pytest.mark.parametrize("status", [429, 503])
def test_actual_planner_upstream_failure_does_not_dispatch_an_answer(wallet, protocol, status):
    runtime, engine = wallet
    calls = []

    def upstream(request):
        calls.append(json.loads(request.content))
        return httpx.Response(
            status,
            json={"error": {"message": "synthetic unavailable"}},
            headers={"Retry-After": "7"},
        )

    http = httpx.AsyncClient(transport=httpx.MockTransport(upstream), trust_env=False)

    def client(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=http)

    with patch.object(pydantic_runner, "AsyncOpenAI", client):
        runner = pydantic_runner.PydanticAIKnowledgeRunner(
            base_url="https://synthetic.test/v1",
            api_key="synthetic",
            model="gpt-6-luna",
            timeout_seconds=30,
            protocol=protocol,
            require_billing=True,
            route_executor=ModelRouteExecutor(
                endpoints=(
                    ModelEndpoint("primary", "https://synthetic.test/v1", "gpt-6-luna", None, 30),
                )
            ),
        )
        app = DisciplinaryAgentApplication(
            conversations=ConversationService.in_memory(),
            runner=runner,
            tools_factory=_FakeAgentTools,
            billing=Operations(runtime),
        )
        with pytest.raises(AgentModelRouteFailure) as raised:
            app.run_turn(
                user_id=UUID(int=1),
                conversation_id=None,
                prompt="你好",
                idempotency_key="upstream-failure",
            )
        assert raised.value.code == "agent_model_unavailable"
    assert len(calls) == 1
    assert runtime.available_balance("user") == 10000
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM billing_attempts")) == 1
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
        assert connection.scalar(text("SELECT hold_points FROM billing_operations")) == 0


def test_semantic_planning_failure_still_allows_answer(wallet):
    runtime, _ = wallet

    class SemanticPlanner(Runner):
        def prepare_research(self, **kwargs):
            raise ValueError("synthetic invalid planning decision")

    runner = SemanticPlanner()
    app = DisciplinaryAgentApplication(
        conversations=ConversationService.in_memory(),
        runner=runner,
        tools_factory=_FakeAgentTools,
        billing=Operations(runtime),
    )
    result = app.run_turn(
        user_id=UUID(int=1),
        conversation_id=None,
        prompt="你好",
        idempotency_key="semantic-fallback",
    )
    assert result.turn is not None and runner.calls == 1


@pytest.mark.parametrize(
    "failure",
    [
        ModelHTTPError(429, "gpt-6-luna", {"error": {"message": "synthetic rate limit"}}),
        ModelAPIError("gpt-6-luna", "synthetic connection failure"),
    ],
)
def test_raw_sdk_planner_failures_use_the_application_failure_boundary(wallet, failure):
    runtime, engine = wallet
    http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: pytest.fail("no SDK request is expected")),
        trust_env=False,
    )

    def client(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=http)

    with patch.object(pydantic_runner, "AsyncOpenAI", client):
        runner = pydantic_runner.PydanticAIKnowledgeRunner(
            base_url="https://synthetic.test/v1",
            api_key="synthetic",
            model="gpt-6-luna",
            timeout_seconds=30,
            require_billing=True,
            route_executor=ModelRouteExecutor(
                endpoints=(
                    ModelEndpoint("primary", "https://synthetic.test/v1", "gpt-6-luna", None, 30),
                )
            ),
        )
    app = DisciplinaryAgentApplication(
        conversations=ConversationService.in_memory(),
        runner=runner,
        tools_factory=_FakeAgentTools,
        billing=Operations(runtime),
    )
    with (
        patch.object(runner._planner_agent, "run", side_effect=failure),
        patch.object(runner, "run", side_effect=AssertionError("answer must not be dispatched")),
        pytest.raises(AgentModelRouteFailure) as raised,
    ):
        app.run_turn(
            user_id=UUID(int=1),
            conversation_id=None,
            prompt="你好",
            idempotency_key="raw-sdk-failure",
        )
    assert raised.value.code == "agent_model_unavailable"
    assert runtime.available_balance("user") == 10000
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
        assert connection.scalar(text("SELECT hold_points FROM billing_operations")) == 0
