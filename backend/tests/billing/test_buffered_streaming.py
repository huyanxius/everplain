"""Buffered callers must retain the same stream usage and failure rules as chat."""

# ruff: noqa: F811
import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401
from test_responses_metering import http_response, response_body

from qunxue_api.adapters.model.metering import (
    MeteredOpenAIChatModel,
    MeteredOpenAIResponsesModel,
    OperationScope,
)


def chat_stream(*, missing_usage=False, tool=False, receipt="stream-1"):
    base = {"id": receipt, "object": "chat.completion.chunk", "created": 1,
            "model": "gpt-6.1-sol"}
    deltas = ([{"tool_calls": [{"index": 0, "id": "call-1", "type": "function",
                                "function": {"name": "add", "arguments": '{"a":'}}]},
               {"tool_calls": [{"index": 0, "function": {"arguments": '17,"b":25}'}}]}]
              if tool else [{"content": "O"}, {"content": "K"}])
    events = [{**base, "choices": [{"index": 0, "delta": d, "finish_reason": None}]}
              for d in deltas]
    events.append({**base, "choices": [{"index": 0, "delta": {},
                                       "finish_reason": "tool_calls" if tool else "stop"}]})
    if not missing_usage:
        events.append({**base, "choices": [], "usage": {
            "prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130,
            "prompt_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 0},
        }})
    return "".join("data: " + json.dumps(e) + "\n\n" for e in events) + "data: [DONE]\n\n"


@pytest.mark.parametrize("protocol", ["chat", "responses"])
@pytest.mark.parametrize("missing_usage", [False, True])
def test_buffered_agent_consumes_stream_and_settles_only_terminal_usage(
    wallet, protocol, missing_usage,
):
    runtime, engine = wallet
    calls = []

    def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload["stream"] is True
        if protocol == "responses":
            return http_response(response_body(usage=not missing_usage), True)
        assert payload["stream_options"]["include_usage"] is True
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=chat_stream(missing_usage=missing_usage))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            cls = MeteredOpenAIChatModel if protocol == "chat" else MeteredOpenAIResponsesModel
            model = cls("gpt-6.1-sol", require_billing=True, settings={"max_tokens": 100},
                        provider=OpenAIProvider(openai_client=AsyncOpenAI(
                            api_key="synthetic", base_url="https://synthetic.test/v1",
                            http_client=http, max_retries=0)))
            with OperationScope(runtime, user_id="user", run_id=str(uuid4()),
                                fingerprint="buffered") as scope:
                result = await Agent(model).run("Reply OK")
                assert result.output == "OK"
                assert (result.usage.input_tokens, result.usage.cache_read_tokens,
                        result.usage.output_tokens) == (100, 40, 30)
                scope.finish("success")

    if missing_usage:
        from qunxue_api.adapters.model.token_usage import UnknownTokenUsage

        with pytest.raises(UnknownTokenUsage):
            asyncio.run(run())
    else:
        asyncio.run(run())
    assert len(calls) == 1
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT outcome, billable FROM billing_attempts")).all()
    assert rows == [("error", 0) if missing_usage else ("success", 1)]


def test_buffered_tool_call_collects_split_arguments_before_execution():
    calls = []
    tool_calls = []

    def reply(request):
        payload = json.loads(request.content)
        assert payload["stream"] is True
        calls.append(payload)
        if len(calls) == 2:
            assert payload["messages"][-1]["content"] == "42"
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=chat_stream(tool=len(calls) == 1))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            model = MeteredOpenAIChatModel("gpt-6.1-sol", provider=OpenAIProvider(
                openai_client=AsyncOpenAI(api_key="synthetic", http_client=http, max_retries=0)))
            agent = Agent(model)

            @agent.tool_plain
            def add(a: int, b: int) -> int:
                tool_calls.append((a, b))
                return a + b

            assert (await agent.run("Add 17 and 25")).output == "OK"

    asyncio.run(run())
    assert tool_calls == [(17, 25)]
    assert len(calls) == 2
