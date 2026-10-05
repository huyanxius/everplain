"""Provider diagnostics expose only bounded class labels and safe correlations."""

import asyncio
import json
import logging
import subprocess
import sys
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.providers.openai import OpenAIProvider

from qunxue_api.adapters.model import failure_diagnostics as diagnostics
from qunxue_api.adapters.model.metering import (
    MeteredOpenAIChatModel,
    MeteredOpenAIResponsesModel,
)
from qunxue_api.adapters.model.routing import (
    InMemoryModelAttemptRecorder,
    ModelEndpoint,
    ModelRouteContext,
    ModelRouteExecutor,
    ModelRouteScope,
    model_route_scope,
)
from qunxue_api.adapters.research_agent import pydantic_runner

SECRET = "Authorization: Bearer private-token prompt=private-text https://private.test/secret"


def payload(caplog):
    records = [record for record in caplog.records if record.name == diagnostics.__name__]
    assert len(records) == 1
    record = records[0]
    assert not record.exc_info and record.exc_text is None and record.stack_info is None
    assert SECRET not in record.getMessage()
    assert all(value not in record.getMessage() for value in (
        "Authorization", "private-token", "private-text", "private.test", "secret",
    ))
    assert not any(isinstance(arg, BaseException) for arg in record.args)
    return json.loads(record.getMessage().removeprefix("model_provider_failure "))


@pytest.fixture(autouse=True)
def diagnostic_capture_policy(caplog, monkeypatch):
    # Alembic fixtures run fileConfig in this pytest process, while production
    # runs Alembic and the API in separate processes. Each unit test explicitly
    # owns its capture policy and restores the previous disabled flag afterward.
    # The production helper never overrides an application's logging policy.
    monkeypatch.setattr(diagnostics.logger, "disabled", False)
    caplog.set_level(logging.WARNING, logger=diagnostics.__name__)


def test_explicitly_disabled_logger_stays_silent(caplog, monkeypatch):
    monkeypatch.setattr(diagnostics.logger, "disabled", True)
    diagnostics.log_model_failure(ModelHTTPError(503, "synthetic", SECRET))
    assert diagnostics.logger.disabled is True
    assert not [record for record in caplog.records if record.name == diagnostics.__name__]


def test_fresh_api_process_emits_safe_diagnostics_without_logger_overrides():
    script = """
from pydantic_ai.exceptions import ModelHTTPError
from qunxue_api.adapters.model.failure_diagnostics import log_model_failure, logger
assert not logger.disabled
log_model_failure(ModelHTTPError(503, "private-token", {"prompt": "private-text"}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=15, check=True,
    )
    lines = [line for line in result.stderr.splitlines() if "model_provider_failure " in line]
    assert len(lines) == 1
    data = json.loads(lines[0].split("model_provider_failure ", 1)[1])
    assert data["error_type"] == "ModelHTTPError" and data["http_status"] == 503
    assert all(value not in result.stdout + result.stderr for value in (
        "private-token", "private-text", "Authorization", "https://private.test",
    ))


def test_logs_only_allowed_fields_and_exact_uuid_correlations(caplog):
    route, request, run = uuid4(), uuid4(), uuid4()
    error = ModelHTTPError(503, SECRET, {"Authorization": SECRET, "prompt": SECRET})
    error.__cause__ = APIConnectionError(message=SECRET, request=httpx.Request("GET", "https://x"))
    error.__cause__.__cause__ = httpx.ConnectError(SECRET)
    context = ModelRouteContext(trace_id=uuid4(), request_id=request, operation=SECRET,
                                route_id=route, agent_run_id=run, capability=SECRET)
    endpoint = ModelEndpoint(SECRET, SECRET, SECRET, SECRET, 30)
    with caplog.at_level(logging.WARNING), model_route_scope(ModelRouteScope(context, endpoint, 1)):
        diagnostics.log_model_failure(error)
    assert payload(caplog) == {
        "error_type": "ModelHTTPError", "cause_types": ["APIConnectionError", "ConnectError"],
        "http_status": 503, "route_id": str(route), "request_id": str(request), "run_id": str(run),
    }


@pytest.mark.parametrize("status", [True, False, 503.0, "503", SECRET, 99, 600, None])
def test_status_is_only_bounded_exact_integer(caplog, status):
    error = ModelHTTPError(503, "synthetic", SECRET)
    error.status_code = status
    diagnostics.log_model_failure(error)
    assert payload(caplog)["http_status"] is None


def test_never_reads_or_formats_malicious_exception_attributes(caplog):
    touched = []

    def poison(self, *args):
        touched.append(args)
        raise AssertionError(SECRET)

    custom = type("Authorization_private_token", (ModelHTTPError,), {
        "__getattribute__": poison, "__str__": poison, "__repr__": poison,
        "status_code": property(poison), "__cause__": property(poison),
    })
    error = custom.__new__(custom)
    BaseException.__init__(error, SECRET)
    cause = httpx.ReadTimeout(SECRET)
    BaseException.__dict__["__cause__"].__set__(error, cause)
    diagnostics.log_model_failure(error)
    result = payload(caplog)
    assert result["error_type"] == "OtherError"
    assert result["cause_types"] == ["ReadTimeout"]
    assert result["http_status"] is None
    assert touched == []


def test_untrusted_status_value_and_custom_type_name_are_not_formatted(caplog):
    class Poison:
        def __repr__(self):
            raise AssertionError(SECRET)

        __str__ = __repr__

    error = ModelHTTPError(503, "synthetic", None)
    error.status_code = Poison()
    error.body = Poison()
    error.__cause__ = type("private-token", (Exception,), {})(SECRET)
    diagnostics.log_model_failure(error)
    result = payload(caplog)
    assert result["http_status"] is None and result["cause_types"] == ["OtherError"]


def test_cause_cycles_are_safe(caplog):
    error = ModelAPIError("synthetic", SECRET)
    cause = httpx.ReadTimeout(SECRET)
    error.__cause__, cause.__cause__ = cause, error
    diagnostics.log_model_failure(error)
    assert payload(caplog)["cause_types"] == ["ReadTimeout"]


def test_chain_is_bounded_to_four_causes_and_prefers_explicit_cause(caplog):
    error = ModelAPIError("synthetic", SECRET)
    current = error
    for _ in range(10):
        cause = httpx.ConnectTimeout(SECRET)
        current.__cause__, current.__context__ = cause, ValueError(SECRET)
        current = cause
    current.status_code = 503
    diagnostics.log_model_failure(error)
    result = payload(caplog)
    assert result["cause_types"] == ["ConnectTimeout"] * 4
    assert result["http_status"] is None


def test_context_chain_is_used_when_no_explicit_cause(caplog):
    error = ModelAPIError("synthetic", SECRET)
    error.__context__ = httpx.ReadTimeout(SECRET)
    diagnostics.log_model_failure(error)
    assert payload(caplog)["cause_types"] == ["ReadTimeout"]


@pytest.mark.parametrize("value", [SECRET, 1, SimpleNamespace(int=1)])
def test_non_uuid_context_fields_are_omitted(caplog, value):
    context = ModelRouteContext(trace_id=uuid4(), request_id=value, operation="agent_completion",
                                route_id=value, agent_run_id=value)
    scope = ModelRouteScope(context, ModelEndpoint("primary", "", "", None, 30), 1)
    with model_route_scope(scope):
        diagnostics.log_model_failure(ModelAPIError("synthetic", SECRET))
    result = payload(caplog)
    assert result["route_id"] is None and result["request_id"] is None and result["run_id"] is None


def test_uuid_subclass_and_corrupted_uuid_cannot_emit_custom_text(caplog):
    class PoisonUUID(UUID):
        def __str__(self):
            return SECRET

    corrupted = uuid4()
    object.__setattr__(corrupted, "int", SECRET)
    context = ModelRouteContext(trace_id=uuid4(), request_id=PoisonUUID(int=1),
                                route_id=corrupted, agent_run_id=None, operation="agent_completion")
    with model_route_scope(ModelRouteScope(context, ModelEndpoint("primary", "", "", None, 30), 1)):
        diagnostics.log_model_failure(ModelAPIError("synthetic", SECRET))
    result = payload(caplog)
    assert result["request_id"] is None and result["route_id"] is None


def test_logging_failure_is_silently_ignored(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(diagnostics.logger, "warning", broken)
    diagnostics.log_model_failure(ModelHTTPError(503, "synthetic", SECRET))


@pytest.mark.parametrize("protocol", ["chat", "responses"])
@pytest.mark.parametrize("kind", ["http", "timeout", "rejected"])
@pytest.mark.parametrize("broken_logger", [False, True])
def test_both_runner_catches_log_without_changing_route_failure(
    caplog, monkeypatch, protocol, kind, broken_logger,
):
    error = (
        ModelHTTPError(400 if kind == "rejected" else 503, "synthetic", SECRET)
        if kind != "timeout" else ModelAPIError("synthetic", SECRET)
    )
    if kind == "timeout":
        error.__cause__ = APITimeoutError(request=httpx.Request("GET", "https://private.test"))
        error.__cause__.__cause__ = httpx.ReadTimeout(SECRET)
    parent, cls, method = (
        (MeteredOpenAIChatModel, pydantic_runner._RetryingOpenAIChatModel, "_completions_create")
        if protocol == "chat" else
        (MeteredOpenAIResponsesModel, pydantic_runner._RetryingOpenAIResponsesModel,
         "_responses_create")
    )
    invocations = []

    async def fail(*args, **kwargs):
        invocations.append(True)
        raise error

    monkeypatch.setattr(parent, method, fail)
    if broken_logger:
        def broken(*args, **kwargs):
            raise RuntimeError(SECRET)
        monkeypatch.setattr(diagnostics.logger, "warning", broken)
    recorder = InMemoryModelAttemptRecorder()
    model = cls("gpt-6-luna", provider=OpenAIProvider(openai_client=AsyncOpenAI(
        api_key="synthetic", base_url="https://synthetic.invalid/v1", max_retries=0,
    )), route_executor=ModelRouteExecutor(
        endpoints=(
            ModelEndpoint("primary", "https://synthetic.invalid/v1", "gpt-6-luna", None, 30),
        ),
        recorder=recorder, max_retries=0,
    ))
    run = uuid4()
    token = pydantic_runner._agent_route_correlation.set({"agent_run_id": run})
    try:
        with pytest.raises(pydantic_runner.AgentModelRouteError) as caught:
            asyncio.run(getattr(model, method)([], False, {}, ModelRequestParameters()))
    finally:
        pydantic_runner._agent_route_correlation.reset(token)
    expected = "agent_model_request_rejected" if kind == "rejected" else "agent_model_unavailable"
    assert caught.value.code == expected
    assert invocations == [True]
    attempts = recorder.list_all()
    assert len(attempts) == 1
    assert attempts[0].failure_code == (
        "model_request_rejected" if kind == "rejected" else "model_unavailable"
    )
    if not broken_logger:
        result = payload(caplog)
        assert result["route_id"] == str(attempts[0].route_id)
        assert result["request_id"] == str(attempts[0].context.request_id)
        assert result["run_id"] == str(run)
        assert result["http_status"] == (
            None if kind == "timeout" else 400 if kind == "rejected" else 503
        )
        assert result["cause_types"] == (
            ["APITimeoutError", "ReadTimeout"] if kind == "timeout" else []
        )
