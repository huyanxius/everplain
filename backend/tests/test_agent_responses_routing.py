# ruff: noqa: F811
"""Responses must keep the existing route, budget and per-attempt billing boundary."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model import (
    InMemoryModelAttemptRecorder,
    ModelEndpoint,
    ModelRouteExecutor,
)
from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.research_agent.pydantic_runner import (
    _RetryingOpenAIResponsesModel,
)
from qunxue_api.modules.agent_conversation import LUNA_REASONING_EFFORTS


def response_payload():
    return {
        "id": "resp_synthetic_route",
        "object": "response",
        "created_at": 1,
        "model": "gpt-6-luna",
        "status": "completed",
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
        "output": [
            {
                "id": "msg_synthetic",
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "OK", "annotations": []}],
            }
        ],
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 100,
            "total_tokens": 1100,
            "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 50},
        },
    }


def stream_response_payload():
    body = response_payload()
    initial = {**body, "output": [], "usage": None, "status": "in_progress"}
    events = [
        {"type": "response.created", "response": initial},
        {"type": "response.output_text.delta", "item_id": "msg_synthetic",
         "output_index": 0, "content_index": 0, "delta": "OK"},
        {"type": "response.completed", "response": body},
    ]
    return httpx.Response(200, headers={"content-type": "text/event-stream"},
                          text="".join("data: " + json.dumps({**event, "sequence_number": n})
                                       + "\n\n" for n, event in enumerate(events)))


@pytest.mark.parametrize("effort", LUNA_REASONING_EFFORTS)
def test_responses_route_preserves_effort_wire_cap_and_one_billing_attempt(wallet, effort):
    runtime, engine = wallet
    recorder = InMemoryModelAttemptRecorder()
    calls = []

    def reply(request):
        calls.append(json.loads(request.content))
        assert request.url.path == "/v1/responses"
        return stream_response_payload()

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False) as http:
            provider = OpenAIProvider(
                openai_client=AsyncOpenAI(
                    api_key="synthetic",
                    base_url="https://synthetic.test/v1",
                    http_client=http,
                    max_retries=0,
                )
            )
            model = _RetryingOpenAIResponsesModel(
                "gpt-6-luna",
                provider=provider,
                require_billing=True,
                settings={
                    "openai_reasoning_effort": effort,
                    "max_tokens": 2400,
                    "openai_store": False,
                },
                route_executor=ModelRouteExecutor(
                    endpoints=(
                        ModelEndpoint(
                            "primary", "https://synthetic.test/v1", "gpt-6-luna", None, 1
                        ),
                    ),
                    recorder=recorder,
                    max_input_tokens=32000,
                    max_output_tokens=100,
                    max_retries=0,
                ),
            )
            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
            ) as operation:
                result = await Agent(model).run("synthetic question")
                operation.finish("success")
                assert result.output == "OK"

    asyncio.run(run())
    assert len(calls) == 1
    assert calls[0]["reasoning"]["effort"] == effort
    assert calls[0]["max_output_tokens"] == 2400
    assert calls[0]["store"] is False
    assert "temperature" not in calls[0]
    assert len(recorder.list_all()) == 1
    assert recorder.list_all()[0].model == "gpt-6-luna"
    # Routing selects the stream at headers; final usage belongs to its receipt.
    assert recorder.list_all()[0].input_tokens is None
    assert recorder.list_all()[0].output_tokens is None
    with engine.connect() as connection:
        from sqlalchemy import text

        assert connection.execute(
            text("SELECT api_type, requested_effort, requested_model FROM billing_attempts")
        ).one() == ("responses", effort, "gpt-6-luna")
        assert connection.execute(
            text("SELECT input_tokens, output_tokens FROM billing_attempts")
        ).one() == (1000, 100)


def test_responses_route_defers_actual_context_boundary_to_provider():
    calls = []

    def reply(request):
        calls.append(request)
        return stream_response_payload()

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(reply), trust_env=False
        ) as http:
            provider = OpenAIProvider(
                openai_client=AsyncOpenAI(api_key="synthetic", http_client=http, max_retries=0)
            )
            model = _RetryingOpenAIResponsesModel(
                "gpt-6-luna",
                provider=provider,
                route_executor=ModelRouteExecutor(
                    endpoints=(
                        ModelEndpoint(
                            "primary", "https://synthetic.test/v1", "gpt-6-luna", None, 1
                        ),
                    ),
                    max_input_tokens=10,
                ),
            )
            result = await Agent(model).run("synthetic question")
            assert result.output == "OK"

    asyncio.run(run())
    assert len(calls) == 1
