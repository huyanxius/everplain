"""Real native SDKs, synthetic HTTP/SSE and SQLite receipts; no upstream calls."""

# ruff: noqa: F811
import asyncio
import json
from dataclasses import replace
from uuid import uuid4

import httpx
import httpx2
import pytest
from pydantic_ai import Agent
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.model.routing import ModelEndpoint, ModelRouteContext, ModelRouteExecutor
from qunxue_api.adapters.research_agent.model_capacity import AgentModelCapacity
from qunxue_api.adapters.research_agent.native_models import build_native_agent_model
from qunxue_api.settings import AgentModelEffortSettings


def receipt(protocol, tool, index, *, missing=False):
    if protocol == "gemini_generate_content":
        part = (
            {
                "functionCall": {"name": "add", "args": {"a": 17, "b": 25}},
                "thoughtSignature": "c3ludGhldGljLXNpZ25hdHVyZQ==",
            }
            if tool
            else {"text": "42"}
        )
        value = {
            "responseId": f"google-{index}",
            "modelVersion": "gemini-3.5-flash",
            "candidates": [{"content": {"role": "model", "parts": [part]}, "finishReason": "STOP"}],
        }
        if not missing:
            value["usageMetadata"] = {
                "promptTokenCount": 20,
                "candidatesTokenCount": 3,
                "thoughtsTokenCount": 2,
                "totalTokenCount": 25,
                "cachedContentTokenCount": 4,
            }
        return value
    value = {
        "id": f"claude-{index}",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "stop_sequence": None,
        "stop_reason": "tool_use" if tool else "end_turn",
        "content": [
            {
                "type": "thinking",
                "thinking": "Calculate the result",
                "signature": "synthetic-native-signature",
            },
            {"type": "tool_use", "id": "call-1", "name": "add", "input": {"a": 17, "b": 25}},
        ]
        if tool
        else [{"type": "text", "text": "42"}],
        "usage": {"input_tokens": 20, "output_tokens": 5},
    }
    if not missing:
        value["usage"].update(cache_read_input_tokens=4, cache_creation_input_tokens=2)
    return value


def streamed(protocol, value):
    if protocol == "gemini_generate_content":
        return "data: " + json.dumps(value) + "\n\n"
    initial = {
        **value,
        "content": [],
        "stop_reason": None,
        "usage": {**value["usage"], "output_tokens": 0},
    }
    events = [{"type": "message_start", "message": initial}]
    for index, part in enumerate(value["content"]):
        if part["type"] == "thinking":
            start = {"type": "thinking", "thinking": "", "signature": ""}
            deltas = [
                {"type": "thinking_delta", "thinking": part["thinking"]},
                {"type": "signature_delta", "signature": part["signature"]},
            ]
        elif part["type"] == "tool_use":
            start = {**part, "input": {}}
            deltas = [{"type": "input_json_delta", "partial_json": json.dumps(part["input"])}]
        else:
            start = {"type": "text", "text": ""}
            deltas = [{"type": "text_delta", "text": part["text"]}]
        events.append({"type": "content_block_start", "index": index, "content_block": start})
        events.extend({"type": "content_block_delta", "index": index, "delta": d} for d in deltas)
        events.append({"type": "content_block_stop", "index": index})
    events.extend(
        [
            {
                "type": "message_delta",
                "delta": {"stop_reason": value["stop_reason"], "stop_sequence": None},
                "usage": {"output_tokens": value["usage"]["output_tokens"]},
            },
            {"type": "message_stop"},
        ]
    )
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


LEVELS = [("gemini_generate_content", level) for level in ("minimal", "low", "medium", "high")]
LEVELS += [("anthropic_messages", level) for level in ("low", "medium", "high", "xhigh", "max")]


@pytest.mark.parametrize("protocol,effort", LEVELS)
@pytest.mark.parametrize("stream", [False, True])
def test_native_real_sdk_tool_roundtrip_and_exact_receipts(wallet, protocol, effort, stream):
    _run_case(wallet, protocol, effort, stream, missing=False)


@pytest.mark.parametrize("protocol", ["gemini_generate_content", "anthropic_messages"])
@pytest.mark.parametrize("stream", [False, True])
def test_native_unknown_usage_keeps_body_and_avoids_duplicate_charge(wallet, protocol, stream):
    _run_case(wallet, protocol, "high", stream, missing=True)


@pytest.mark.parametrize("protocol", ["gemini_generate_content", "anthropic_messages"])
@pytest.mark.parametrize("stream", [False, True])
def test_native_raw_booleans_are_not_coerced_to_billable_integer_receipts(wallet, protocol, stream):
    _run_case(wallet, protocol, "high", stream, missing=False, invalid=True)


@pytest.mark.parametrize("protocol", ["gemini_generate_content", "anthropic_messages"])
@pytest.mark.parametrize("stream", [False, True])
def test_native_bearer_auth_is_explicit_and_does_not_mix_credential_headers(
    wallet, protocol, stream
):
    _run_case(wallet, protocol, "high", stream, missing=False, authentication="bearer")


def _run_case(wallet, protocol, effort, stream, *, missing, invalid=False, authentication="native"):

    pending = missing or invalid
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v2"
    model = "gemini-3.5-flash" if protocol == "gemini_generate_content" else "claude-sonnet-5-5"
    runtime.book = replace(runtime.book, aliases={model: "gpt-6.1-sol"})
    calls = []
    library = httpx if protocol == "gemini_generate_content" else httpx2
    base = (
        "https://synthetic.invalid"
        if protocol == "gemini_generate_content"
        else ("https://synthetic.invalid/bypass/anthropic")
    )

    def reply(request):
        payload = json.loads(request.content)
        if authentication == "bearer":
            assert request.headers["authorization"] == "Bearer synthetic"
            assert "x-goog-api-key" not in request.headers
            assert "x-api-key" not in request.headers
        calls.append(payload)
        value = receipt(protocol, len(calls) == 1, len(calls), missing=missing)
        if invalid:
            if protocol == "gemini_generate_content":
                value["usageMetadata"].update(thoughtsTokenCount=True, totalTokenCount=24)
            else:
                value["usage"]["input_tokens"] = True
        if stream:
            return library.Response(
                200,
                headers={"content-type": "text/event-stream", "x-request-id": f"wire-{len(calls)}"},
                content=streamed(protocol, value),
            )
        return library.Response(200, headers={"x-request-id": f"wire-{len(calls)}"}, json=value)

    async def run():
        endpoint = ModelEndpoint("primary", base, model, "synthetic", 30, provider="synthetic")
        setting = (
            AgentModelEffortSettings(google_thinking_level=effort)
            if (protocol == "gemini_generate_content")
            else AgentModelEffortSettings(anthropic_effort=effort, anthropic_thinking="adaptive")
        )
        native = build_native_agent_model(
            protocol=protocol,
            base_url=base,
            api_key="synthetic",
            model=model,
            timeout_seconds=30,
            extra_headers={},
            capacity=AgentModelCapacity(
                1000,
                512,
                "maxOutputTokens" if protocol == "gemini_generate_content" else "max_tokens",
                "synthetic-only",
            ),
            effort=setting,
            route_executor=ModelRouteExecutor(endpoints=(endpoint,), max_retries=0),
            route_context_factory=lambda: ModelRouteContext(uuid4(), uuid4(), "agent_completion"),
            route_error=lambda error: error,
            require_billing=True,
            cache_omission_is_zero=protocol == "gemini_generate_content" and not missing,
            transport=library.MockTransport(reply),
            native_authentication=authentication,
        )
        agent = Agent(native)

        @agent.tool_plain
        def add(a: int, b: int) -> int:
            return a + b

        with OperationScope(runtime, user_id="user", run_id=uuid4(), fingerprint="native") as scope:
            if stream:
                async with agent.run_stream("17+25") as result:
                    output = await result.get_output()
            else:
                result = await agent.run("17+25")
                output = result.output
            assert output == "42"
            assert scope.delivery_state["usage_status"] == ("pending" if pending else "known")
            scope.finish("success")

    asyncio.run(run())
    assert len(calls) == 2
    for payload in calls:
        if protocol == "gemini_generate_content":
            assert payload["generationConfig"]["thinkingConfig"] == {
                "thinkingLevel": effort.upper()
            }
            assert payload["generationConfig"]["maxOutputTokens"] == 512
        else:
            assert payload["thinking"] == {"type": "adaptive"}
            assert payload["output_config"] == {"effort": effort}
            assert payload["max_tokens"] == 512
        assert "reasoning_effort" not in payload
    if protocol == "gemini_generate_content":
        parts = calls[1]["contents"][-2]["parts"]
        assert parts[0]["thoughtSignature"] == "c3ludGhldGljLXNpZ25hdHVyZQ=="
        assert calls[1]["contents"][-1]["parts"][0]["functionResponse"]["name"] == "add"
    else:
        assert calls[1]["messages"][-2]["content"][0]["signature"] == "synthetic-native-signature"
        assert calls[1]["messages"][-1]["content"][0]["type"] == "tool_result"
    with engine.connect() as conn:
        attempts = conn.execute(text("SELECT * FROM billing_attempts")).mappings().all()
        assert len(attempts) == 2
        assert all(row["api_type"] == protocol for row in attempts)
        assert all(
            row["requested_effort"]
            == (effort.upper() if protocol == "gemini_generate_content" else effort)
            for row in attempts
        )
        assert all(row["usage_state"] == ("unknown" if pending else "known") for row in attempts)
        if not pending:
            assert all(
                row["input_tokens"] == (20 if protocol == "gemini_generate_content" else 26)
                for row in attempts
            )
            assert all(row["output_tokens"] == 5 for row in attempts)
            assert all(row["cache_read_tokens"] == 4 for row in attempts)
            assert all(
                row["cache_write_tokens"] == (0 if protocol == "gemini_generate_content" else 2)
                for row in attempts
            )
    if pending:
        first = attempts[0]
        evidence = dict(
            attempt_id=first["attempt_id"],
            provider_host="synthetic.invalid",
            provider_request_id="wire-1",
            model=model,
            input_tokens=26,
            output_tokens=5,
            cache_read_tokens=4,
            cache_write_tokens=2,
        )
        runtime.reconcile_usage(**evidence)
        with engine.connect() as conn:
            charged = conn.scalar(text("SELECT credit_pico FROM billing_operations"))
        assert runtime.reconcile_usage(**evidence) == "already_known"
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT credit_pico FROM billing_operations")) == charged
