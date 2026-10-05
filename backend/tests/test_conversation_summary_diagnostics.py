"""Offline diagnostics through the real SDK, structured output and metered SSE."""

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from billing_test_support import configure_synthetic_billing
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai.exceptions import (
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from sqlalchemy import text
from streaming_test_support import chat_http_response
from test_agent_memory import register

from qunxue_api.adapters.research_agent import conversation_summarizer
from qunxue_api.modules.agent_conversation import (
    ContextSummaryBatch,
    ContextSummaryGenerationFailure,
)
from qunxue_api.modules.billing import UnknownTokenUsage

_PRIVATE = "SYNTHETIC_PRIVATE_PROVIDER_BODY_PROMPT_KEY_TEXT"
_REASONS = (
    "http_error",
    "timeout",
    "transport_error",
    "invalid_output",
    "request_limit",
    "model_config",
    "model_error",
)


def _causes(error):
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        yield error
        error = error.__cause__ or error.__context__


def _assert_safe_failure(error, reason, http_status=None):
    assert isinstance(error, ContextSummaryGenerationFailure)
    assert error.reason == reason
    assert error.http_status == http_status
    assert error.args == ("context_summary_generation_failed",)
    assert vars(error) == {"reason": reason, "http_status": http_status}
    assert _PRIVATE not in str(error)
    assert _PRIVATE not in repr(error)
    assert _PRIVATE not in json.dumps(vars(error))


@pytest.mark.parametrize("reason", _REASONS)
def test_generation_failure_accepts_only_safe_facts(reason):
    error = ContextSummaryGenerationFailure(reason, http_status=429)
    _assert_safe_failure(error, reason, 429)
    assert isinstance(error, RuntimeError)


@pytest.mark.parametrize("reason", [_PRIVATE, "", None, True, 1, [_PRIVATE]])
def test_generation_failure_rejects_uncontrolled_reason_without_echoing_it(reason):
    with pytest.raises(ValueError) as caught:
        ContextSummaryGenerationFailure(reason)
    assert str(caught.value) == "invalid_context_summary_failure_reason"


@pytest.mark.parametrize("status", [99, 600, -1, True, False, 401.0, "401", _PRIVATE])
def test_generation_failure_rejects_invalid_status_without_echoing_it(status):
    with pytest.raises(ValueError) as caught:
        ContextSummaryGenerationFailure("http_error", http_status=status)
    assert str(caught.value) == "invalid_context_summary_http_status"


@pytest.mark.parametrize("status", [None, 100, 599])
def test_generation_failure_accepts_optional_status_and_boundaries(status):
    _assert_safe_failure(
        ContextSummaryGenerationFailure("http_error", http_status=status), "http_error", status
    )


def _sdk_failure(kind):
    request = httpx.Request("POST", "https://synthetic.test/v1/chat/completions")
    if kind == "http_error":
        return APIStatusError(
            _PRIVATE, response=httpx.Response(401, request=request), body={"error": _PRIVATE}
        )
    if kind == "timeout":
        return APITimeoutError(request)
    if kind == "transport_error":
        return APIConnectionError(message=_PRIVATE, request=request)
    if kind == "invalid_output":
        return UnexpectedModelBehavior(_PRIVATE, body=_PRIVATE)
    if kind == "request_limit":
        return UsageLimitExceeded(_PRIVATE)
    if kind == "model_config":
        return UserError(_PRIVATE)
    return RuntimeError(_PRIVATE)


@pytest.mark.parametrize("reason", _REASONS)
def test_summarizer_wraps_sdk_errors_and_keeps_original_cause(monkeypatch, reason):
    original = _sdk_failure(reason)
    summarizer = conversation_summarizer.PydanticConversationSummarizer(
        base_url="https://synthetic.test/v1", api_key="synthetic-key", model="gpt-6-luna"
    )

    async def fail(_batch):
        raise original

    monkeypatch.setattr(summarizer, "summarize", fail)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        summarizer(None)
    _assert_safe_failure(caught.value, reason, 401 if reason == "http_error" else None)
    assert caught.value.__cause__ is original


def test_summarizer_wraps_pydantic_validation_without_retaining_invalid_text(monkeypatch):
    with pytest.raises(ValidationError) as invalid:
        conversation_summarizer.SummarySource(
            conversation_id=_PRIVATE, message_id=str(uuid4()), quote=_PRIVATE
        )
    summarizer = conversation_summarizer.PydanticConversationSummarizer(
        base_url="https://synthetic.test/v1", api_key="synthetic-key", model="gpt-6-luna"
    )

    async def fail(_batch):
        raise invalid.value

    monkeypatch.setattr(summarizer, "summarize", fail)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        summarizer(None)
    _assert_safe_failure(caught.value, "invalid_output")
    assert caught.value.__cause__ is invalid.value


def test_summarizer_wraps_pydantic_http_error_without_an_openai_cause(monkeypatch):
    original = ModelHTTPError(503, _PRIVATE, body={"error": _PRIVATE})
    summarizer = conversation_summarizer.PydanticConversationSummarizer(
        base_url="https://synthetic.test/v1", api_key="synthetic-key", model="gpt-6-luna"
    )

    async def fail(_batch):
        raise original

    monkeypatch.setattr(summarizer, "summarize", fail)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        summarizer(None)
    _assert_safe_failure(caught.value, "http_error", 503)
    assert caught.value.__cause__ is original


@pytest.fixture
def summary_wire_batch(plain_client):
    owner = UUID(register(plain_client))
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")
    return ContextSummaryBatch(
        user_id=owner,
        lease_token=str(uuid4()),
        fingerprint="synthetic-summary-fingerprint",
        usage_day=datetime.now(UTC).date().isoformat(),
        sources=(
            {
                "conversation_id": str(uuid4()),
                "message_id": str(uuid4()),
                "role": "user",
                "content": "我周末要去杭州，交通预算不超过五百元。",
            },
        ),
        omitted_messages=2,
    )


def _wire_summarizer(monkeypatch, reply):
    requests, settings = [], []

    def response(request):
        assert request.method == "POST"
        assert request.url == "https://synthetic.test/v1/chat/completions"
        assert request.headers["x-summary-fixture"] == "1"
        body = json.loads(request.content)
        requests.append(body)
        return reply(request, body)

    def client_factory(**kwargs):
        settings.append(kwargs.copy())
        return AsyncOpenAI(
            **kwargs,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(response), trust_env=False),
        )

    monkeypatch.setattr(conversation_summarizer, "AsyncOpenAI", client_factory)
    return (
        conversation_summarizer.PydanticConversationSummarizer(
            base_url="https://synthetic.test/v1",
            api_key="synthetic-key",
            model="gpt-6-luna",
            timeout_seconds=30,
            extra_headers={"x-summary-fixture": "1"},
        ),
        requests,
        settings,
    )


def _run_billed_summary(plain_client, batch, summarizer):
    with plain_client.app.state.billing_operations.open(
        user_id=batch.user_id,
        run_id=batch.lease_token,
        payload={"context_fingerprint": batch.fingerprint},
        phase="conversation_summary",
    ) as operation:
        value = summarizer(batch)
        operation.finish("success")
        return value


def _completion(body, batch, *, invalid_output=False, missing_usage=False):
    source = batch.sources[0]
    ref = {
        "conversation_id": source["conversation_id"],
        "message_id": _PRIVATE if invalid_output else source["message_id"],
        "quote": source["content"],
    }
    output = {
        "summary": "你在讨论杭州周末交通，预算不超过五百元。",
        "summary_sources": [ref],
        "cards": [],
    }
    value = {
        "id": "synthetic-summary-receipt",
        "object": "chat.completion",
        "created": 1,
        "model": "gpt-6-luna",
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "summary-output",
                            "type": "function",
                            "function": {
                                "name": body["tools"][0]["function"]["name"],
                                "arguments": json.dumps(output, ensure_ascii=False),
                            },
                        }
                    ],
                },
            }
        ],
    }
    if not missing_usage:
        value["usage"] = {
            "prompt_tokens": 80,
            "completion_tokens": 20,
            "total_tokens": 100,
            "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
        }
    return value, output


def _assert_wire_contract(requests, settings, batch):
    assert len(requests) == len(settings) == 1
    body = requests[0]
    assert body["model"] == "gpt-6-luna"
    assert body["stream"] is True
    assert body["stream_options"]["include_usage"] is True
    assert body["max_completion_tokens"] == 1800
    assert len(body["tools"]) == 1
    assert body["tool_choice"] == "required"
    user = next(message for message in body["messages"] if message["role"] == "user")
    assert json.loads(user["content"]) == {
        "sources": list(batch.sources),
        "omitted_messages": batch.omitted_messages,
    }
    assert settings[0]["max_retries"] == 0
    assert settings[0]["timeout"] == 30


@pytest.mark.parametrize("status", [401, 429])
def test_real_sdk_http_failures_retain_only_category_and_status(
    plain_client, summary_wire_batch, monkeypatch, status
):
    def reply(request, _body):
        return httpx.Response(
            status,
            request=request,
            json={"error": {"message": _PRIVATE, "code": _PRIVATE, "type": _PRIVATE}},
        )

    summarizer, requests, settings = _wire_summarizer(monkeypatch, reply)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        _run_billed_summary(plain_client, summary_wire_batch, summarizer)
    _assert_safe_failure(caught.value, "http_error", status)
    original = next(error for error in _causes(caught.value) if isinstance(error, APIStatusError))
    assert original.status_code == status
    assert original.body["message"] == _PRIVATE
    _assert_wire_contract(requests, settings, summary_wire_batch)


@pytest.mark.parametrize("timeout", [False, True])
def test_real_sdk_transport_failures_are_classified_through_pydantic_wrapper(
    plain_client, summary_wire_batch, monkeypatch, timeout
):
    def reply(request, _body):
        cls = httpx.ReadTimeout if timeout else httpx.ConnectError
        raise cls(_PRIVATE, request=request)

    summarizer, requests, settings = _wire_summarizer(monkeypatch, reply)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        _run_billed_summary(plain_client, summary_wire_batch, summarizer)
    _assert_safe_failure(caught.value, "timeout" if timeout else "transport_error")
    expected = APITimeoutError if timeout else APIConnectionError
    assert any(isinstance(error, expected) for error in _causes(caught.value))
    _assert_wire_contract(requests, settings, summary_wire_batch)


def test_real_sdk_metered_buffered_sse_returns_valid_structured_summary(
    plain_client, summary_wire_batch, monkeypatch
):
    expected = []

    def reply(request, body):
        completion, output = _completion(body, summary_wire_batch)
        expected.append(output)
        return chat_http_response(completion, request=request)

    summarizer, requests, settings = _wire_summarizer(monkeypatch, reply)
    assert _run_billed_summary(plain_client, summary_wire_batch, summarizer) == (
        expected[0],
        80,
        20,
    )
    _assert_wire_contract(requests, settings, summary_wire_batch)
    with plain_client.app.state.database.engine.connect() as connection:
        row = connection.execute(
            text("SELECT outcome, billable, input_tokens, output_tokens FROM billing_attempts")
        ).one()
    assert tuple(row) == ("success", 1, 80, 20)


def test_real_sdk_malformed_structured_summary_fails_once_without_exposing_output(
    plain_client, summary_wire_batch, monkeypatch
):
    def reply(request, body):
        completion, _output = _completion(body, summary_wire_batch, invalid_output=True)
        return chat_http_response(completion, request=request)

    summarizer, requests, settings = _wire_summarizer(monkeypatch, reply)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        _run_billed_summary(plain_client, summary_wire_batch, summarizer)
    _assert_safe_failure(caught.value, "invalid_output")
    assert any(isinstance(error, UnexpectedModelBehavior) for error in _causes(caught.value))
    _assert_wire_contract(requests, settings, summary_wire_batch)


def test_real_sdk_absent_terminal_usage_keeps_billing_failure_in_cause_chain(
    plain_client, summary_wire_batch, monkeypatch
):
    def reply(request, body):
        completion, _output = _completion(body, summary_wire_batch, missing_usage=True)
        return chat_http_response(completion, request=request)

    summarizer, requests, settings = _wire_summarizer(monkeypatch, reply)
    with pytest.raises(ContextSummaryGenerationFailure) as caught:
        _run_billed_summary(plain_client, summary_wire_batch, summarizer)
    _assert_safe_failure(caught.value, "model_error")
    assert any(isinstance(error, UnknownTokenUsage) for error in _causes(caught.value))
    _assert_wire_contract(requests, settings, summary_wire_batch)
    with plain_client.app.state.database.engine.connect() as connection:
        row = connection.execute(
            text("SELECT outcome, billable, failure_code FROM billing_attempts")
        ).one()
    assert tuple(row) == ("error", 0, "missing_token_usage")
