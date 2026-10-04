# ruff: noqa: F811
"""Exercise the real SDK with synthetic HTTP; no paid provider or live calls."""

import asyncio
import hashlib
import json
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.metering import (
    BillingContextMissing,
    MeteredOpenAIResponsesModel,
    ModelDeliveryRejected,
    OperationScope,
)
from qunxue_api.adapters.model.token_usage import UnknownTokenUsage


def response_body(status="completed", *, usage=True, refusal=False):
    body = {
        "id": "resp_synthetic",
        "object": "response",
        "created_at": 1,
        "model": "gpt-6.1-sol",
        "status": status,
        "service_tier": "default",
        "output": [
            {
                "type": "message",
                "id": "msg_synthetic",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "refusal", "refusal": "Cannot comply"}]
                if refusal
                else [{"type": "output_text", "text": "OK", "annotations": []}],
            }
        ],
        "error": {"code": "server_error", "message": "synthetic failure"}
        if status == "failed"
        else None,
        "incomplete_details": {"reason": "max_output_tokens"} if status == "incomplete" else None,
        "usage": {
            "input_tokens": 100,
            "output_tokens": 30,
            "total_tokens": 130,
            "input_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 20},
        }
        if usage
        else None,
    }
    return body


def stream_events(body, *, terminal=True, provisional=False):
    initial = {**body, "output": [], "usage": None, "status": "in_progress"}
    events = [{"type": "response.created", "response": initial}]
    if provisional:
        events.append(
            {"type": "response.in_progress", "response": {**initial, "usage": body["usage"]}}
        )
    events.append(
        {
            "type": "response.output_text.delta",
            "item_id": "msg_synthetic",
            "output_index": 0,
            "content_index": 0,
            "delta": "OK",
        }
    )
    if terminal:
        events.append({"type": f"response.{body['status']}", "response": body})
    return events


def http_response(body, stream, *, terminal=True, provisional=False):
    events = stream_events(body, terminal=terminal, provisional=provisional)
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content="".join(
            "data: " + json.dumps({**e, "sequence_number": n}) + "\n\n"
            for n, e in enumerate(events)
        )
        + "data: [DONE]\n\n",
    )


def build_model(http, *, retries=0, require_billing=True, settings=None):
    return MeteredOpenAIResponsesModel(
        "gpt-6.1-sol",
        require_billing=require_billing,
        provider=OpenAIProvider(
            openai_client=AsyncOpenAI(
                api_key="synthetic",
                base_url="https://synthetic.test/v1",
                http_client=http,
                max_retries=retries,
            )
        ),
        settings={"max_tokens": 100, "openai_reasoning_effort": "high", **(settings or {})},
    )


async def run_agent(runtime, handler, *, stream=False, settings=None):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        model = build_model(http, settings=settings)
        with OperationScope(
            runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
        ) as scope:
            agent = Agent(model, instructions="Synthetic instructions")
            if stream:
                async with agent.run_stream("synthetic") as result:
                    output = await result.get_output()
                    usage = result.usage
            else:
                result = await agent.run("synthetic")
                output, usage = result.output, result.usage
            scope.finish("success")
            return output, usage


def attempt_rows(engine):
    with engine.connect() as conn:
        return [
            dict(row)
            for row in conn.execute(
                text("SELECT * FROM billing_attempts ORDER BY created_at")
            ).mappings()
        ]


def record_completions(monkeypatch, runtime):
    calls = []
    original = runtime.complete_attempt

    def record(**kwargs):
        calls.append(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(runtime, "complete_attempt", record)
    return calls


@pytest.mark.parametrize("stream", [False, True])
def test_responses_wire_guard_records_final_payload_and_terminal_usage(wallet, stream, monkeypatch):
    runtime, engine = wallet
    requests = []
    completions = record_completions(monkeypatch, runtime)

    def reply(request):
        assert request.url.path == "/v1/responses"
        requests.append(json.loads(request.content))
        return http_response(response_body(), stream, provisional=True)

    output, usage = asyncio.run(
        run_agent(
            runtime, reply, stream=stream, settings={"extra_body": {"reasoning": {"effort": "low"}}}
        )
    )
    assert output == "OK"
    assert (usage.input_tokens, usage.output_tokens, usage.cache_read_tokens) == (100, 30, 40)
    assert usage.details["reasoning_tokens"] == 20
    (row,) = attempt_rows(engine)
    encoded = json.dumps(requests[0], ensure_ascii=False, sort_keys=True).encode()
    assert row["request_hash"] == hashlib.sha256(encoded).hexdigest()
    assert row["input_limit"] == len(encoded) * 2 + 4096
    assert requests[0]["instructions"] == "Synthetic instructions"
    assert row["output_limit"] == requests[0]["max_output_tokens"] == 100
    assert row["api_type"] == "responses"
    assert row["requested_effort"] == "low"
    assert row["provider_host"] == "synthetic.test"
    assert row["provider_response_id"] == "resp_synthetic"
    assert row["finish_reason"] == "completed"
    assert row["usage_state"] == "known"
    assert row["outcome"] == "success"
    assert row["reasoning_tokens"] == 20
    assert row["reference_cost_pico"] == 424000000
    assert len(completions) == 1


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("status", ["incomplete", "failed", "cancelled"])
def test_failed_terminal_responses_preserve_cost_but_waive_delivery(
    wallet, stream, status, monkeypatch
):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)
    with pytest.raises(ModelDeliveryRejected):
        asyncio.run(
            run_agent(
                runtime, lambda r: http_response(response_body(status), stream), stream=stream
            )
        )
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "known"
    assert row["reference_cost_pico"] == 424000000
    assert row["billable"] == 0
    assert row["outcome"] == ("limited" if status == "incomplete" else "error")
    assert row["finish_reason"] == ("max_output_tokens" if status == "incomplete" else status)
    assert len(completions) == 1
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT balance FROM credit_accounts")) == 10000


@pytest.mark.parametrize("stream", [False, True])
def test_refusal_is_not_a_completed_deliverable(wallet, stream, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)
    with pytest.raises(ModelDeliveryRejected):
        asyncio.run(
            run_agent(
                runtime, lambda r: http_response(response_body(refusal=True), stream), stream=stream
            )
        )
    (row,) = attempt_rows(engine)
    assert row["finish_reason"] == "content_filter"
    assert row["reference_cost_pico"] == 424000000
    assert row["billable"] == 0
    assert len(completions) == 1


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("invalid", ["missing", "negative", "contradictory", "cache_contract"])
def test_unusable_responses_usage_is_unknown_not_zero(wallet, stream, invalid, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)
    body = response_body(usage=invalid != "missing")
    if invalid == "negative":
        body["usage"]["input_tokens"] = -1
    elif invalid == "contradictory":
        body["usage"]["output_tokens_details"]["reasoning_tokens"] = 31
    elif invalid == "cache_contract":
        del body["usage"]["input_tokens_details"]["cache_write_tokens"]
    with pytest.raises(UnknownTokenUsage):
        asyncio.run(run_agent(runtime, lambda r: http_response(body, stream), stream=stream))
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "unknown"
    assert row["reference_cost_pico"] is None
    assert row["input_tokens"] is None
    assert row["outcome"] == "error"
    assert len(completions) == 1


def test_stream_eof_does_not_promote_provisional_usage(wallet, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)
    with pytest.raises(UnknownTokenUsage):
        asyncio.run(
            run_agent(
                runtime,
                lambda r: http_response(response_body(), True, terminal=False, provisional=True),
                stream=True,
            )
        )
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "unknown"
    assert row["reference_cost_pico"] is None
    assert row["provider_response_id"] == "resp_synthetic"
    assert row["failure_code"] == "stream_incomplete"
    assert len(completions) == 1


def test_cancelled_consumer_records_once_and_keeps_usage_unknown(wallet, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: http_response(response_body(), True))
        ) as http:
            model = build_model(http)
            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="cancelled"
            ):
                async with model.request_stream(
                    [ModelRequest(parts=[UserPromptPart("synthetic")])],
                    None,
                    ModelRequestParameters(),
                ) as response:
                    async for _ in response:
                        break

    asyncio.run(run())
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "unknown"
    assert row["reference_cost_pico"] is None
    assert row["failure_code"] == "stream_cancelled"
    assert len(completions) == 1


@pytest.mark.parametrize(
    "extra_body",
    [
        {"tools": [{"type": "web_search"}]},
        {"tools": [{"type": "image_generation"}]},
        {
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_image", "image_url": "https://synthetic.test/image.png"}
                    ],
                }
            ]
        },
        {
            "input": [
                {
                    "type": "function_call_output",
                    "call_id": "call",
                    "output": [{"type": "input_file", "file_id": "file"}],
                }
            ]
        },
        {"input": [{"type": "item_reference", "id": "hidden"}]},
        {"previous_response_id": "hidden"},
        {"conversation": "hidden"},
        {"prompt": {"id": "hidden"}},
        {"background": True},
        {"modalities": ["text", "audio"]},
        {"context_management": [{"type": "compaction", "compact_threshold": 100}]},
        {"max_output_tokens": None},
    ],
)
def test_final_wire_body_blocks_unbudgeted_responses_before_http(wallet, extra_body):
    runtime, engine = wallet
    calls = []
    # The OpenAI SDK wraps request-hook failures as connection errors; the cause
    # must still be the billing guard and no request may reach the transport.
    with pytest.raises(Exception) as error:
        asyncio.run(
            run_agent(
                runtime, lambda r: calls.append(r), settings={"extra_body": deepcopy(extra_body)}
            )
        )
    cause = error.value
    while cause.__cause__ is not None:
        cause = cause.__cause__
    assert isinstance(cause, BillingContextMissing)
    assert calls == []
    assert attempt_rows(engine) == []


@pytest.mark.parametrize("retries,scope_enabled", [(0, False), (2, True)])
def test_responses_require_context_and_no_sdk_retries(wallet, retries, scope_enabled):
    runtime, engine = wallet
    calls = []

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: calls.append(r))
        ) as http:
            model = build_model(http, retries=retries)
            if scope_enabled:
                with OperationScope(
                    runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
                ):
                    await Agent(model).run("synthetic")
            else:
                await Agent(model).run("synthetic")

    with pytest.raises(BillingContextMissing):
        asyncio.run(run())
    assert calls == []
    assert attempt_rows(engine) == []


def test_provider_http_failure_records_one_unknown_attempt_without_retry(wallet, monkeypatch):
    runtime, engine = wallet
    calls = []
    completions = record_completions(monkeypatch, runtime)

    def reply(request):
        calls.append(request)
        return httpx.Response(503, json={"error": {"message": "synthetic unavailable"}})

    with pytest.raises(ModelHTTPError):
        asyncio.run(run_agent(runtime, reply))
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "unknown"
    assert row["reference_cost_pico"] is None
    assert row["billable"] == 0
    assert len(calls) == len(completions) == 1


@pytest.mark.parametrize("stream", [False, True])
def test_function_tool_round_trip_reserves_the_actual_expanded_input(wallet, stream):
    runtime, engine = wallet
    calls = []
    first = response_body()
    first["output"] = [
        {
            "type": "function_call",
            "id": "fc_synthetic",
            "call_id": "call_synthetic",
            "name": "lookup",
            "arguments": '{"topic":"synthetic"}',
            "status": "completed",
        }
    ]

    def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        body = first if len(calls) == 1 else response_body()
        body["id"] = f"resp_synthetic_{len(calls)}"
        assert payload["stream"] is True
        # A tool invocation must appear as a streamed output item for the SDK.
        events = stream_events(body)
        if len(calls) == 1:
            events[1] = {
                "type": "response.output_item.added",
                "output_index": 0,
                "item": first["output"][0],
            }
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content="".join(
                "data: " + json.dumps({**e, "sequence_number": n}) + "\n\n"
                for n, e in enumerate(events)
            ),
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            agent = Agent(build_model(http))

            @agent.tool_plain
            def lookup(topic: str) -> str:
                return "synthetic tool result: " + topic

            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="tool"
            ) as scope:
                if stream:
                    async with agent.run_stream("synthetic") as result:
                        assert await result.get_output() == "OK"
                else:
                    assert (await agent.run("synthetic")).output == "OK"
                scope.finish("success")

    asyncio.run(run())
    assert len(calls) == 2
    assert all(call["tools"][0]["type"] == "function" for call in calls)
    assert any(
        item.get("type") == "function_call_output" and "synthetic tool result" in item["output"]
        for item in calls[1]["input"]
    )
    rows = attempt_rows(engine)
    assert len(rows) == 2
    assert rows[0]["run_id"] == rows[1]["run_id"]
    assert all(row["outcome"] == "success" for row in rows)
    assert rows[1]["input_limit"] > rows[0]["input_limit"]


def test_validation_retry_marks_previous_attempt_nonbillable(wallet):
    runtime, engine = wallet
    calls = []

    def reply(request):
        calls.append(json.loads(request.content))
        return http_response({**response_body(), "id": f"resp_synthetic_{len(calls)}"}, True)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            agent = Agent(build_model(http), retries=1)

            @agent.output_validator
            def validate(output: str) -> str:
                if len(calls) == 1:
                    raise ModelRetry("synthetic validation retry")
                return output

            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="retry"
            ) as scope:
                await agent.run("synthetic")
                scope.finish("success")

    asyncio.run(run())
    first, second = attempt_rows(engine)
    assert first["failure_code"] == "output_validation_retry"
    assert first["outcome"] == "error"
    assert first["billable"] == 0
    assert first["reference_cost_pico"] == 424000000
    assert second["outcome"] == "success"
    assert second["billable"] == 1


def test_responses_output_budget_uses_only_its_wire_cap(wallet):
    runtime, engine = wallet
    seen = []

    def reply(request):
        seen.append(request)
        return http_response(response_body(), True)

    asyncio.run(run_agent(runtime, reply, settings={"extra_body": {"max_completion_tokens": 1}}))
    (row,) = attempt_rows(engine)
    assert row["output_limit"] == 100
    assert len(seen) == 1


def test_responses_attempt_budget_stops_dispatch(wallet):
    from qunxue_api.modules.billing import BillingBudgetExceeded

    runtime, engine = wallet
    runtime.max_attempt_pico = 1
    calls = []
    with pytest.raises(Exception) as error:
        asyncio.run(run_agent(runtime, lambda r: calls.append(r)))
    cause = error.value
    while cause.__cause__ is not None:
        cause = cause.__cause__
    assert isinstance(cause, BillingBudgetExceeded)
    assert calls == []
    assert attempt_rows(engine) == []


@pytest.mark.parametrize("status", ["in_progress", "queued", None])
def test_buffered_response_without_terminal_event_is_not_final_usage(wallet, status, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)
    with pytest.raises(UnknownTokenUsage):
        asyncio.run(run_agent(runtime, lambda r: http_response(
            response_body(status), True, terminal=False, provisional=True,
        )))
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "unknown"
    assert row["reference_cost_pico"] is None
    assert row["billable"] == 0
    assert len(completions) == 1


@pytest.mark.parametrize("bad_event", ["error", "refusal", "late_content", "duplicate_terminal"])
def test_stream_protocol_errors_never_become_billable_success(wallet, bad_event, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)

    def reply(request):
        events = stream_events(response_body())
        if bad_event == "error":
            events.insert(2, {"type": "error", "code": "server_error", "message": "synthetic"})
        elif bad_event == "refusal":
            events.insert(
                2,
                {
                    "type": "response.refusal.delta",
                    "item_id": "msg_synthetic",
                    "output_index": 0,
                    "content_index": 0,
                    "delta": "Cannot comply",
                },
            )
        elif bad_event == "late_content":
            events.append(events[1])
        else:
            events.append(events[-1])
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content="".join(
                "data: " + json.dumps({**e, "sequence_number": n}) + "\n\n"
                for n, e in enumerate(events)
            ),
        )

    expected = ModelDeliveryRejected if bad_event in {"error", "refusal"} else UnknownTokenUsage
    with pytest.raises(expected):
        asyncio.run(run_agent(runtime, reply, stream=True))
    (row,) = attempt_rows(engine)
    assert row["outcome"] == "error"
    assert row["billable"] == 0
    assert row["usage_state"] == ("unknown" if bad_event == "error" else "known")
    assert len(completions) == 1


def test_stop_after_terminal_event_preserves_known_cost_without_charging(wallet, monkeypatch):
    runtime, engine = wallet
    completions = record_completions(monkeypatch, runtime)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: http_response(response_body(), True))
        ) as http:
            model = build_model(http)
            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="cancelled"
            ):
                source = await model._responses_create(
                    [ModelRequest(parts=[UserPromptPart("synthetic")])],
                    True,
                    {"max_tokens": 100},
                    ModelRequestParameters(),
                )
                async with source:
                    async for event in source:
                        if event.type == "response.completed":
                            break
                await source.close()

    asyncio.run(run())
    (row,) = attempt_rows(engine)
    assert row["usage_state"] == "known"
    assert row["reference_cost_pico"] == 424000000
    assert row["failure_code"] == "stream_cancelled"
    assert row["billable"] == 0
    assert len(completions) == 1


@pytest.mark.parametrize("stream", [False, True])
def test_unbilled_sdk_use_still_preserves_direct_terminal_usage(stream):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda r: http_response(response_body(), stream, provisional=True)
            )
        ) as http:
            agent = Agent(build_model(http, require_billing=False))
            if stream:
                async with agent.run_stream("synthetic") as result:
                    assert await result.get_output() == "OK"
                    return result.usage
            return (await agent.run("synthetic")).usage

    usage = asyncio.run(run())
    assert (usage.input_tokens, usage.output_tokens, usage.cache_read_tokens) == (100, 30, 40)
    assert usage.details["reasoning_tokens"] == 20


def test_standalone_compaction_cannot_bypass_required_metering(wallet):
    runtime, engine = wallet
    calls = []

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: calls.append(r))
        ) as http:
            model = build_model(http)
            with OperationScope(
                runtime, user_id="user", run_id=str(uuid4()), fingerprint="compact"
            ):
                await model._responses_compact(
                    [ModelRequest(parts=[UserPromptPart("synthetic")])],
                    {"max_tokens": 100},
                    ModelRequestParameters(),
                )

    with pytest.raises(BillingContextMissing):
        asyncio.run(run())
    assert calls == []
    assert attempt_rows(engine) == []
