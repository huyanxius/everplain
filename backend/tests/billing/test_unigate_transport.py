# ruff: noqa: F811
"""Gemini route integration against synthetic HTTP and synthetic tariffs only."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from streaming_test_support import chat_http_response
from test_configured_tariffs import book, config
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.research_agent.pydantic_runner import (
    AgentModelRouteError,
    _RetryingOpenAIChatModel,
)

MODEL = "gemini-3.5-flash"
USAGE = {"prompt_tokens": 30, "completion_tokens": 5, "total_tokens": 35,
         "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0}}


def completion(tool=False):
    message = {"role": "assistant", "content": "OK"}
    if tool:
        message = {"role": "assistant", "content": None, "tool_calls": [{
            "id": "synthetic-tool", "type": "function",
            "function": {"name": "lookup", "arguments": "{}"},
        }]}
    return {"id": "synthetic", "object": "chat.completion", "created": 1, "model": MODEL,
            "choices": [{"index": 0, "message": message,
                         "finish_reason": "tool_calls" if tool else "stop"}], "usage": USAGE}


@pytest.mark.parametrize("mode", ["normal", "tool", "stream", "error", "cancel", "unknown_price"])
def test_selected_gemini_transport_is_strict_metered_and_has_no_reasoning(wallet, mode):
    runtime, engine = wallet
    if mode != "unknown_price":
        runtime.book = book(config())
    calls = []

    async def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert request.url.path == "/verified-test-prefix/chat/completions"
        assert payload["model"] == MODEL
        assert "reasoning_effort" not in payload
        assert "thinking" not in payload
        if mode == "cancel":
            raise asyncio.CancelledError
        if mode == "error":
            return httpx.Response(503, json={"error": {"message": "synthetic unavailable"}})
        if mode == "stream":
            chunk = {"id": "synthetic-stream", "object": "chat.completion.chunk",
                     "created": 1, "model": MODEL}
            events = [
                {**chunk, "choices": [{"index": 0, "delta": {"role": "assistant",
                    "content": "OK"}, "finish_reason": None}]},
                {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                {**chunk, "choices": [], "usage": USAGE},
            ]
            body = "".join("data: " + json.dumps(event) + "\n\n" for event in events)
            return httpx.Response(200, content=body + "data: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return chat_http_response({
            **completion(tool=mode == "tool" and len(calls) == 1),
            "id": f"synthetic-{len(calls)}",
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False) as http:
            model = _RetryingOpenAIChatModel(
                MODEL, require_billing=True, settings={"max_tokens": 100},
                provider=OpenAIProvider(openai_client=AsyncOpenAI(
                    api_key="synthetic-key", base_url="https://synthetic.invalid/verified-test-prefix",
                    http_client=http, max_retries=0,
                )),
                route_executor=ModelRouteExecutor(endpoints=(ModelEndpoint(
                    "primary", "https://synthetic.invalid/verified-test-prefix", MODEL, None, 1,
                    provider="unigate",
                ),)),
            )
            agent = Agent(model)
            if mode == "tool":
                @agent.tool_plain
                def lookup() -> str:
                    return "synthetic result"
            with OperationScope(runtime, user_id="user", run_id=str(uuid4()),
                                fingerprint="synthetic") as scope:
                if mode == "stream":
                    async with agent.run_stream("synthetic question") as result:
                        assert await result.get_output() == "OK"
                else:
                    assert (await agent.run("synthetic question")).output == "OK"
                scope.finish("success")

    if mode == "unknown_price":
        with pytest.raises(AgentModelRouteError):
            asyncio.run(run())
        assert calls == []
        return
    if mode == "cancel":
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(run())
    elif mode == "error":
        with pytest.raises(Exception, match="synthetic unavailable|unavailable|failed"):
            asyncio.run(run())
    else:
        asyncio.run(run())
    assert len(calls) == (2 if mode == "tool" else 1)
    with engine.connect() as connection:
        rows = connection.execute(text(
            "SELECT requested_model, requested_effort, api_type, price_json FROM billing_attempts"
        )).all()
    assert len(rows) == len(calls)
    assert all(row[0:3] == (MODEL, None, "chat_completions") for row in rows)
    assert all(json.loads(row[3])["version"] == "synthetic-v2" for row in rows)
