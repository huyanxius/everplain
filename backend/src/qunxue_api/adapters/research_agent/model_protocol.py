"""SDK request routing and safe failures; no prompts, tool registration or run storage."""

from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any, cast
from uuid import UUID, uuid4

from pydantic_ai import RunContext
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import ModelRequestParameters, StreamedResponse
from pydantic_ai.models.openai import (
    OpenAIChatModel,
    OpenAIChatModelSettings,
    OpenAIResponsesModel,
    OpenAIResponsesModelSettings,
)
from pydantic_ai.settings import ModelSettings, merge_model_settings

from qunxue_api.adapters.model import (
    ModelAttemptFailure,
    ModelAttemptResult,
    ModelEndpoint,
    ModelRouteContext,
    ModelRouteExecutor,
    ModelRoutesUnavailable,
)
from qunxue_api.adapters.model.failure_diagnostics import log_model_failure
from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel, MeteredOpenAIResponsesModel
from qunxue_api.modules.agent_conversation import AgentModelRouteFailure, AgentToolContext

_agent_route_correlation: ContextVar[Mapping[str, UUID | None] | None] = ContextVar(
    "agent_route_correlation",
    default=None,
)


_agent_model_settings_overrides: ContextVar[OpenAIChatModelSettings | None] = ContextVar(
    "agent_model_settings_overrides", default=None
)


class _RetryingOpenAIChatModel(MeteredOpenAIChatModel):
    """Bridge Pydantic AI serialization onto the shared route executor."""

    def __init__(
        self,
        *args,
        route_executor: ModelRouteExecutor | None,
        fallback_models: Mapping[str, OpenAIChatModel] | None = None,
        native_output_parameters: Mapping[str, str] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._route_executor = route_executor
        self._native_output_parameters = dict(native_output_parameters or {})
        self._endpoint_models = {"primary": self, **(fallback_models or {})}

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        settings_token = _agent_model_settings_overrides.set(
            cast(OpenAIChatModelSettings, dict(model_settings or {}))
        )
        try:
            return await super().request(
                messages,
                model_settings,
                model_request_parameters,
            )
        finally:
            _agent_model_settings_overrides.reset(settings_token)

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: RunContext[Any] | None = None,
    ) -> AsyncGenerator[StreamedResponse]:
        settings_token = _agent_model_settings_overrides.set(
            cast(OpenAIChatModelSettings, dict(model_settings or {}))
        )
        try:
            async with super().request_stream(
                messages,
                model_settings,
                model_request_parameters,
                run_context,
            ) as response:
                yield response
        finally:
            _agent_model_settings_overrides.reset(settings_token)

    async def _completions_create(
        self,
        messages: list[ModelMessage],
        stream: bool,
        model_settings: OpenAIChatModelSettings,
        model_request_parameters: ModelRequestParameters,
    ):
        if self._route_executor is None:
            raise RuntimeError("a shared model route executor is required")
        correlation = _agent_route_correlation.get() or {}
        context = ModelRouteContext(
            trace_id=uuid4(),
            request_id=uuid4(),
            operation="agent_completion",
            task_id=_uuid_correlation(correlation.get("task_id")),
            agent_run_id=_uuid_correlation(correlation.get("agent_run_id")),
            capability="agent_completion",
        )
        runtime_overrides = _runtime_model_settings(
            primary_defaults=cast(OpenAIChatModelSettings, self.settings or {}),
            prepared_settings=model_settings,
        )

        async def attempt(endpoint: ModelEndpoint) -> ModelAttemptResult[object]:
            try:
                model = self._endpoint_models[endpoint.endpoint_id]
            except KeyError as error:
                raise RuntimeError(
                    f"no Agent model configured for endpoint {endpoint.endpoint_id}"
                ) from error
            # Match Pydantic AI's shallow merge contract: endpoint defaults are
            # the base and per-call settings take precedence without mutation.
            endpoint_settings = cast(
                OpenAIChatModelSettings,
                merge_model_settings(model.settings, runtime_overrides) or {},
            )
            if (
                self._native_output_parameters.get(endpoint.endpoint_id) == "max_tokens"
                and "max_tokens" in endpoint_settings
            ):
                # PydanticAI maps its max_tokens setting to max_completion_tokens.
                # Send the parameter documented by this exact upstream instead,
                # without emitting conflicting legacy and modern caps together.
                native_cap = endpoint_settings.pop("max_tokens")
                endpoint_settings["extra_body"] = {
                    **(endpoint_settings.get("extra_body") or {}), "max_tokens": native_cap,
                }
            try:
                value = await MeteredOpenAIChatModel._completions_create(
                    model,
                    messages,
                    stream,
                    endpoint_settings,
                    model_request_parameters,
                )
            except (ModelHTTPError, ModelAPIError) as error:
                log_model_failure(error)
                raise ModelAttemptFailure(
                    code=_model_attempt_failure_code(error),
                    retryable=_is_retryable_model_error(error),
                ) from error
            input_tokens, output_tokens = _completion_usage(value)
            return ModelAttemptResult(
                value=value,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        try:
            routed = await self._route_executor.execute_async(
                context=context,
                invoke=attempt,
            )
        except ModelAttemptFailure as failure:
            raise AgentModelRouteError.from_attempt(failure) from None
        except ModelRoutesUnavailable:
            raise AgentModelRouteError("agent_model_unavailable") from None
        return routed.value


class _RetryingOpenAIResponsesModel(MeteredOpenAIResponsesModel):
    """Bridge Pydantic AI serialization onto the shared route executor."""

    def __init__(
        self,
        *args,
        route_executor: ModelRouteExecutor | None,
        fallback_models: Mapping[str, OpenAIResponsesModel] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._route_executor = route_executor
        self._endpoint_models = {"primary": self, **(fallback_models or {})}

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        settings_token = _agent_model_settings_overrides.set(
            cast(OpenAIResponsesModelSettings, dict(model_settings or {}))
        )
        try:
            return await super().request(
                messages,
                model_settings,
                model_request_parameters,
            )
        finally:
            _agent_model_settings_overrides.reset(settings_token)

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: RunContext[Any] | None = None,
    ) -> AsyncGenerator[StreamedResponse]:
        settings_token = _agent_model_settings_overrides.set(
            cast(OpenAIResponsesModelSettings, dict(model_settings or {}))
        )
        try:
            async with super().request_stream(
                messages,
                model_settings,
                model_request_parameters,
                run_context,
            ) as response:
                yield response
        finally:
            _agent_model_settings_overrides.reset(settings_token)

    async def _responses_create(
        self,
        messages: list[ModelMessage],
        stream: bool,
        model_settings: OpenAIResponsesModelSettings,
        model_request_parameters: ModelRequestParameters,
    ):
        if self._route_executor is None:
            raise RuntimeError("a shared model route executor is required")
        correlation = _agent_route_correlation.get() or {}
        context = ModelRouteContext(
            trace_id=uuid4(),
            request_id=uuid4(),
            operation="agent_completion",
            task_id=_uuid_correlation(correlation.get("task_id")),
            agent_run_id=_uuid_correlation(correlation.get("agent_run_id")),
            capability="agent_completion",
        )
        runtime_overrides = _runtime_model_settings(
            primary_defaults=cast(OpenAIResponsesModelSettings, self.settings or {}),
            prepared_settings=model_settings,
        )

        async def attempt(endpoint: ModelEndpoint) -> ModelAttemptResult[object]:
            try:
                model = self._endpoint_models[endpoint.endpoint_id]
            except KeyError as error:
                raise RuntimeError(
                    f"no Agent model configured for endpoint {endpoint.endpoint_id}"
                ) from error
            # Match Pydantic AI's shallow merge contract: endpoint defaults are
            # the base and per-call settings take precedence without mutation.
            endpoint_settings = cast(
                OpenAIResponsesModelSettings,
                merge_model_settings(model.settings, runtime_overrides) or {},
            )
            try:
                value = await MeteredOpenAIResponsesModel._responses_create(
                    model,
                    messages,
                    stream,
                    endpoint_settings,
                    model_request_parameters,
                )
            except (ModelHTTPError, ModelAPIError) as error:
                log_model_failure(error)
                raise ModelAttemptFailure(
                    code=_model_attempt_failure_code(error),
                    retryable=_is_retryable_model_error(error),
                ) from error
            input_tokens, output_tokens = _completion_usage(value)
            return ModelAttemptResult(
                value=value,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        try:
            routed = await self._route_executor.execute_async(
                context=context,
                invoke=attempt,
            )
        except ModelAttemptFailure as failure:
            raise AgentModelRouteError.from_attempt(failure) from None
        except ModelRoutesUnavailable:
            raise AgentModelRouteError("agent_model_unavailable") from None
        return routed.value


class AgentModelRouteError(AgentModelRouteFailure):
    """Safe, stable failure raised after an Agent model route cannot complete."""

    _MESSAGES = {
        "agent_model_unavailable": (
            "Agent model providers are temporarily unavailable."
        ),
        "agent_model_request_rejected": "Agent model request was rejected.",
        "agent_input_limit": "Agent input exceeds the configured context limit.",
    }

    def __init__(self, code: str) -> None:
        if code not in self._MESSAGES:
            code = "agent_model_unavailable"
        self.code = code
        super().__init__(f"{code}: {self._MESSAGES[code]}")

    @classmethod
    def from_attempt(cls, failure: ModelAttemptFailure) -> "AgentModelRouteError":
        code = {
            "model_request_rejected": "agent_model_request_rejected",
            "model_input_limit": "agent_input_limit",
        }.get(failure.code, "agent_model_unavailable")
        return cls(code)


def _runtime_model_settings(
    *,
    primary_defaults: OpenAIChatModelSettings,
    prepared_settings: OpenAIChatModelSettings,
) -> OpenAIChatModelSettings:
    captured = _agent_model_settings_overrides.get()
    if captured is not None:
        return dict(captured)
    return {
        key: value
        for key, value in prepared_settings.items()
        if key not in primary_defaults or primary_defaults[key] != value
    }


def _is_transient_unknown_provider(error: ModelHTTPError) -> bool:
    if error.status_code != 400:
        return False
    body = error.body
    message: object | None = None
    if isinstance(body, Mapping):
        message = body.get("message")
        nested_error = body.get("error")
        if message is None and isinstance(nested_error, Mapping):
            message = nested_error.get("message")
    return isinstance(message, str) and "unknown provider for model" in message.lower()


def _is_retryable_model_error(error: ModelHTTPError | ModelAPIError) -> bool:
    if isinstance(error, ModelHTTPError):
        return (
            _is_transient_unknown_provider(error)
            or error.status_code in {408, 409, 429}
            or error.status_code >= 500
        )
    return True


def _model_attempt_failure_code(error: ModelHTTPError | ModelAPIError) -> str:
    if not isinstance(error, ModelHTTPError):
        return "model_unavailable"
    if error.status_code == 429:
        return "model_rate_limited"
    if (
        _is_transient_unknown_provider(error)
        or error.status_code in {408, 409}
        or error.status_code >= 500
    ):
        return "model_unavailable"
    return "model_request_rejected"


def _uuid_correlation(value: object) -> UUID | None:
    return value if isinstance(value, UUID) else None


def _agent_route_context_from_tools(
    tools: AgentToolContext,
) -> Mapping[str, UUID | None] | None:
    get_context = getattr(tools, "agent_route_context", None)
    if not callable(get_context):
        return None
    raw_context = get_context()
    if not isinstance(raw_context, Mapping):
        return None
    return {
        "user_id": _uuid_correlation(raw_context.get("user_id")),
        "task_id": _uuid_correlation(raw_context.get("task_id")),
        "agent_run_id": _uuid_correlation(raw_context.get("agent_run_id")),
    }


def _completion_usage(completion: object) -> tuple[int | None, int | None]:
    usage = getattr(completion, "usage", None)
    if usage is None:
        return (None, None)
    input_tokens = getattr(usage, "prompt_tokens", None)
    if input_tokens is None:
        input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "completion_tokens", None)
    if output_tokens is None:
        output_tokens = getattr(usage, "output_tokens", None)
    return (
        int(input_tokens) if input_tokens is not None else None,
        int(output_tokens) if output_tokens is not None else None,
    )
