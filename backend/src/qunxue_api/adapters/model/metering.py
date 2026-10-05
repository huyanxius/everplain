"""One metering boundary for every SDK request, including nested calls and retries."""

import hashlib
import json
from contextvars import ContextVar

from qunxue_api.adapters.model.dispatch import attach_dispatch, response_dispatch_hook
from qunxue_api.adapters.model.routing import current_model_route_scope
from qunxue_api.adapters.model.token_usage import (
    ResponsesUsageSnapshot,
    UnknownTokenUsage,
    UsageSafeOpenAIChatModel,
    UsageSafeOpenAIResponsesModel,
    UsageSnapshot,
    normalized_usage,
    response_value,
    responses_finish_reason,
)
from qunxue_api.modules.billing import (
    BillingContextMissing as BillingContextMissing,
)
from qunxue_api.modules.billing import (
    ModelDeliveryRejected as ModelDeliveryRejected,
)

_last_attempt = ContextVar("billing_last_attempt", default=None)


_wire_request = ContextVar("billing_wire_request", default=None)


_current_operation = ContextVar("billing_operation", default=None)


def current_operation(*, required=False):
    scope = _current_operation.get()
    if required and scope is None:
        raise BillingContextMissing("paid invocation has no billing operation")
    return scope


def reject_current_attempt(code):
    scope, prior = current_operation(), _last_attempt.get()
    if scope and prior and prior[0] == scope.run_id:
        scope.runtime.mark_attempt_error(prior[1], code)


def _mark_validation_retry(scope, messages):
    if not messages or not any(
        type(part).__name__ == "RetryPromptPart" for part in getattr(messages[-1], "parts", ())
    ):
        return
    # Pydantic AI may advance requests in separate asyncio tasks, so a wire
    # hook's ContextVar update is not inherited by the next graph task. Match
    # the actual response being retried instead of another concurrent attempt.
    for message in reversed(messages[:-1]):
        receipt = getattr(message, "provider_response_id", None)
        if receipt in scope.response_attempts:
            scope.runtime.mark_attempt_error(
                scope.response_attempts[receipt], "output_validation_retry"
            )
            return
    prior = _last_attempt.get()
    if prior is not None and prior[0] == scope.run_id:
        scope.runtime.mark_attempt_error(prior[1], "output_validation_retry")


def _safe_usage_evidence(raw):
    """Persist only numeric usage facts, never arbitrary provider payloads."""
    from collections.abc import Mapping

    if hasattr(raw, "model_dump"):
        raw = raw.model_dump(exclude_none=True)
    if not isinstance(raw, Mapping):
        return {}
    keys = {
        "input_tokens",
        "output_tokens",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "cache_creation_input_tokens",
        "cached_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    }
    nested = {
        "prompt_tokens_details",
        "input_tokens_details",
        "completion_tokens_details",
        "output_tokens_details",
    }
    return {
        k: v if type(v) is int else _safe_usage_evidence(v)
        for k, v in raw.items()
        if (k in keys and type(v) is int and v >= 0) or (k in nested and isinstance(v, Mapping))
    }


def _assert_responses_text_budget(payload):
    # Server-side history/reusable prompts would hide billable input from the
    # serialized request reservation. Background jobs cannot settle synchronously.
    if any(
        payload.get(key) for key in ("previous_response_id", "conversation", "prompt", "background")
    ):
        raise BillingContextMissing(
            "Responses requires full inline history and foreground execution"
        )
    if payload.get("audio") or any(mode != "text" for mode in payload.get("modalities", ())):
        raise BillingContextMissing("multimodal token budgets are not supported")
    if payload.get("context_management"):
        raise BillingContextMissing("Responses compaction needs a separate metered request budget")
    items = payload.get("input", ())
    if isinstance(items, str):
        return
    for item in items:
        kind = item.get("type", "message")
        if kind == "message":
            content = item.get("content")
        elif kind == "function_call_output":
            content = item.get("output")
        elif kind == "function_call":
            continue
        elif kind == "reasoning":
            content = (item.get("summary") or []) + (item.get("content") or [])
        else:
            raise BillingContextMissing("Responses input cannot be budgeted as inline text")
        if isinstance(content, list) and any(
            part.get("type")
            not in {"input_text", "output_text", "summary_text", "reasoning_text", "refusal"}
            for part in content
        ):
            raise BillingContextMissing("multimodal token budgets are not supported")


class OperationScope:
    def __init__(self, runtime, *, user_id, run_id, fingerprint, exempt=False,
                 before_network=None, resume=False, settlement_connection=None, quota_start=True):
        self.runtime = runtime
        self.run_id = str(run_id)
        self.user_id = str(user_id)
        self.fingerprint = fingerprint
        self.exempt = exempt
        self.before_network = before_network
        self.finished = False
        self.resume = resume
        self.settlement_connection = settlement_connection
        self.response_attempts = {}
        self.quota_start = quota_start

    def __enter__(self):
        self.runtime.start(
            user_id=self.user_id,
            run_id=self.run_id,
            fingerprint=self.fingerprint,
            exempt=self.exempt,
            **({"resume": True} if self.resume else {}),
            **({"quota_start": False} if not self.quota_start else {}),
        )
        self.token = _current_operation.set(self)
        self.last_token = _last_attempt.set(None)
        return self

    def finish(self, outcome, *, connection=None):
        if connection is None and outcome in {"success", "paused"} and self.settlement_connection:
            connection = self.settlement_connection()
        settled = self.runtime.finish(
            run_id=self.run_id, outcome=outcome,
            **({"connection": connection} if connection is not None else {}),
        )
        self.finished = True
        if outcome in {"success", "paused"} and settled in {"error", "cancelled", "refunded"}:
            raise ModelDeliveryRejected("billing operation failed delivery checks")

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is not None or not self.finished:
                self.finish("error")
        finally:
            _current_operation.reset(self.token)
            _last_attempt.reset(self.last_token)

    def before_attempt_payload(
        self, payload, route=None, provider_host=None, *, api_type="chat_completions"
    ):
        if self.before_network:
            self.before_network()
        output_limit = (
            payload.get("max_output_tokens")
            if api_type == "responses"
            else payload.get(
                "max_completion_tokens", payload.get("max_output_tokens", payload.get("max_tokens"))
            )
        )
        if type(output_limit) is not int or output_limit <= 0:
            raise BillingContextMissing("a finite provider output token cap is required")
        if payload.get("web_search_options") or any(
            tool.get("type") != "function" for tool in payload.get("tools", ())
        ):
            raise BillingContextMissing("provider-paid builtin tools need a separate tariff")
        for message in payload.get("messages", ()):
            content = message.get("content")
            if isinstance(content, list) and any(p.get("type") != "text" for p in content):
                raise BillingContextMissing("multimodal token budgets are not supported")
        if api_type == "responses":
            _assert_responses_text_budget(payload)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
        # Estimate from the final wire body, including schemas, full history and
        # returned tool content. This is not a mathematical token/cash guarantee.
        input_limit = len(encoded) * 2 + 4096
        attempt = self.runtime.before_attempt(
            run_id=self.run_id,
            endpoint_id=route.endpoint.endpoint_id if route else "direct",
            route_id=route.context.route_id if route else None,
            model=payload["model"],
            input_limit=input_limit,
            output_limit=output_limit,
            request_hash=hashlib.sha256(encoded).hexdigest(),
            provider_host=provider_host,
            api_type=api_type,
            requested_effort=(payload.get("reasoning") or {}).get("effort")
            if api_type == "responses"
            else payload.get("reasoning_effort"),
            requested_service_tier=payload.get("service_tier"),
        )
        _last_attempt.set((self.run_id, attempt))
        return attempt

    def complete(
        self, attempt_id, response=None, *, outcome="error", failure_code=None, finish_reason=None
    ):
        counts = {}
        raw = getattr(response, "usage", None)
        if isinstance(response, dict):
            raw = response.get("usage")
        returned = (
            response.get("model")
            if isinstance(response, dict)
            else getattr(response, "model", None)
        )
        receipt = (
            response.get("id") if isinstance(response, dict) else getattr(response, "id", None)
        )
        if receipt:
            self.response_attempts[receipt] = attempt_id
        if raw is not None:
            try:
                self.runtime.assert_usage_contract(attempt_id, raw)
                usage = normalized_usage(raw)
            except UnknownTokenUsage:
                self.runtime.complete_attempt(
                    attempt_id=attempt_id,
                    returned_model=returned,
                    provider_response_id=receipt,
                    outcome="error",
                    failure_code="invalid_token_usage",
                    usage_known=False,
                    raw_usage_json=json.dumps(_safe_usage_evidence(raw), sort_keys=True),
                )
                raise
            counts = dict(
                reasoning_tokens=usage.details.get("reasoning_tokens", 0),
                raw_usage_json=json.dumps(
                    {
                        "input_tokens": usage.input_tokens,
                        "output_tokens": usage.output_tokens,
                        "cache_read_tokens": usage.cache_read_tokens,
                        "cache_write_tokens": usage.cache_write_tokens,
                        "details": usage.details,
                    },
                    sort_keys=True,
                ),
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_read_tokens=usage.cache_read_tokens,
                cache_write_tokens=usage.cache_write_tokens,
            )
        choices = (
            response.get("choices", ())
            if isinstance(response, dict)
            else getattr(response, "choices", ())
        )
        reasons = [
            c.get("finish_reason") if isinstance(c, dict) else getattr(c, "finish_reason", None)
            for c in choices
        ]
        if finish_reason is not None:
            reasons = [finish_reason]
        rejected = outcome == "success" and any(r in {"length", "content_filter"} for r in reasons)
        if rejected:
            outcome = "limited" if "length" in reasons else "rejected"
        missing_usage = outcome == "success" and not counts
        if missing_usage:
            outcome, failure_code = "error", "missing_token_usage"
        self.runtime.complete_attempt(
            attempt_id=attempt_id,
            returned_model=returned,
            provider_response_id=receipt,
            outcome=outcome,
            failure_code=failure_code,
            finish_reason=reasons[0] if reasons else None,
            returned_service_tier=response.get("service_tier")
            if isinstance(response, dict)
            else getattr(response, "service_tier", None),
            **counts,
        )
        if rejected:
            raise ModelDeliveryRejected("model output was limited or refused")
        if missing_usage:
            raise UnknownTokenUsage("paid response has no usage")


class _MeteredStream:
    def __init__(self, source, scope, attempt, continuous=False):
        self.source, self.scope, self.attempt = source, scope, attempt
        self.snapshots = UsageSnapshot(continuous)
        self.done = False

    async def __aenter__(self):
        try:
            await self.source.__aenter__()
        except BaseException:
            await self.close()
            raise
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()
        return False

    async def __aiter__(self):
        try:
            async for chunk in self.source:
                self.snapshots.accept(chunk)
                yield chunk
            self.done = True
            self.scope.complete(
                self.attempt,
                self.snapshots.final_response,
                outcome="success",
                finish_reason=self.snapshots.finish_reason,
            )
        except BaseException:
            if not self.done:
                self.done = True
                self.scope.complete(
                    self.attempt,
                    self.snapshots.final_response,
                    outcome="error",
                    failure_code="stream_incomplete",
                    finish_reason=self.snapshots.finish_reason,
                )
            raise

    async def close(self):
        try:
            await self.source.close()
        finally:
            if not self.done:
                self.done = True
                self.scope.complete(
                    self.attempt,
                    self.snapshots.final_response,
                    outcome="error",
                    failure_code="stream_cancelled",
                    finish_reason=self.snapshots.finish_reason,
                )


def _complete_responses(scope, attempt, response, *, finish_reason=None):
    status = response_value(response, "status")
    reason = finish_reason or responses_finish_reason(response)
    success = status == "completed" and reason == "completed"
    if status not in ResponsesUsageSnapshot.terminal_statuses:
        response = {key: response_value(response, key) for key in ("id", "model", "service_tier")}
    scope.complete(
        attempt,
        response,
        outcome="success" if success else "limited" if reason == "max_output_tokens" else "error",
        failure_code=None if success else f"response_{status or 'missing_status'}",
        finish_reason=reason,
    )
    if not success:
        raise ModelDeliveryRejected("Responses output was not completed")


class _MeteredResponsesStream(_MeteredStream):
    def __init__(self, source, scope, attempt):
        super().__init__(source, scope, attempt)
        self.snapshots = ResponsesUsageSnapshot()

    def _fail(self, code):
        if not self.done:
            self.done = True
            self.scope.complete(
                self.attempt,
                self.snapshots.final_response or self.snapshots.receipt,
                outcome="error",
                failure_code=code,
                finish_reason=self.snapshots.finish_reason,
            )

    async def __aiter__(self):
        try:
            async for chunk in self.source:
                self.snapshots.accept(chunk)
                yield chunk
            if self.snapshots.final_response is None:
                raise UnknownTokenUsage("stream ended without terminal Responses usage")
            self.done = True
            _complete_responses(
                self.scope,
                self.attempt,
                self.snapshots.final_response,
                finish_reason=self.snapshots.finish_reason,
            )
        except BaseException:
            self._fail("stream_incomplete")
            raise

    async def close(self):
        try:
            await self.source.close()
        finally:
            self._fail("stream_cancelled")


async def _wire_hook(request):
    state = _wire_request.get()
    if state is None:
        return
    try:
        if request.extensions.get("everplain_dispatch") is not None:
            raise BillingContextMissing(
                "metered redirect or auth resend requires a new explicit request"
            )
        payload = json.loads(request.content)
        state["attempt"] = state["scope"].before_attempt_payload(
            payload,
            state["route"],
            request.url.host,
            api_type=state.get("api_type", "chat_completions"),
        )
        state["dispatch"] = attach_dispatch(
            request, state["scope"].runtime, state["attempt"], state["client"]
        )
    except Exception as error:
        # OpenAI wraps HTTP client hook exceptions as APIConnectionError. This
        # guard ran locally before the network; preserve its actual failure so
        # budget, configuration and lease errors keep their existing contracts.
        state["local_error"] = error
        raise


class MeteredOpenAIChatModel(UsageSafeOpenAIChatModel):
    def __init__(self, *args, require_billing=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.require_billing = require_billing
        client = self.client._client
        if _wire_hook not in client.event_hooks["request"]:
            client.event_hooks["request"].append(_wire_hook)
        if response_dispatch_hook not in client.event_hooks["response"]:
            client.event_hooks["response"].append(response_dispatch_hook)

    async def _completions_create(self, messages, stream, model_settings, model_request_parameters):
        scope = _current_operation.get()
        if scope is None:
            if self.require_billing:
                raise BillingContextMissing("paid invocation has no billing operation")
            return await super()._completions_create(
                messages, stream, model_settings, model_request_parameters
            )
        if self.client.max_retries != 0:
            raise BillingContextMissing("SDK automatic retries must be disabled")
        _mark_validation_retry(scope, messages)
        state = {"scope": scope, "attempt": None, "route": current_model_route_scope(),
                 "client": self.client._client}
        token = _wire_request.set(state)
        try:
            value = await super()._completions_create(
                messages, stream, model_settings, model_request_parameters
            )
        except BaseException as error:
            if state.get("dispatch") is not None:
                state["dispatch"].finish_failed(error)
            if state.get("local_error") is not None:
                if state["attempt"] is not None:
                    scope.complete(state["attempt"], outcome="error",
                                   failure_code="local_guard_after_dispatch")
                raise state["local_error"] from None
            if state["attempt"] is not None:
                scope.complete(
                    state["attempt"],
                    getattr(error, "body", None),
                    outcome="error",
                    failure_code=type(error).__name__,
                )
            raise
        finally:
            _wire_request.reset(token)
        if state["attempt"] is None:
            raise BillingContextMissing("provider transport did not pass the billing wire guard")
        if stream:
            return _MeteredStream(
                value,
                scope,
                state["attempt"],
                bool(model_settings.get("openai_continuous_usage_stats")),
            )
        scope.complete(state["attempt"], value, outcome="success")
        return value


class MeteredOpenAIResponsesModel(UsageSafeOpenAIResponsesModel):
    """Responses transport using the same per-attempt reservation and settlement."""

    def __init__(self, *args, require_billing=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.require_billing = require_billing
        client = self.client._client
        if _wire_hook not in client.event_hooks["request"]:
            client.event_hooks["request"].append(_wire_hook)
        if response_dispatch_hook not in client.event_hooks["response"]:
            client.event_hooks["response"].append(response_dispatch_hook)

    async def _responses_compact(self, *args, **kwargs):
        if self.require_billing or _current_operation.get() is not None:
            raise BillingContextMissing(
                "Responses compaction needs a separate metered request budget"
            )
        return await super()._responses_compact(*args, **kwargs)

    async def _responses_create(self, messages, stream, model_settings, model_request_parameters):
        scope = _current_operation.get()
        if scope is None:
            if self.require_billing:
                raise BillingContextMissing("paid invocation has no billing operation")
            return await super()._responses_create(
                messages, stream, model_settings, model_request_parameters
            )
        if self.client.max_retries != 0:
            raise BillingContextMissing("SDK automatic retries must be disabled")
        _mark_validation_retry(scope, messages)
        state = {
            "scope": scope,
            "attempt": None,
            "route": current_model_route_scope(),
            "api_type": "responses",
            "client": self.client._client,
        }
        token = _wire_request.set(state)
        try:
            value = await super()._responses_create(
                messages, stream, model_settings, model_request_parameters
            )
        except BaseException as error:
            if state.get("dispatch") is not None:
                state["dispatch"].finish_failed(error)
            if state.get("local_error") is not None:
                if state["attempt"] is not None:
                    scope.complete(state["attempt"], outcome="error",
                                   failure_code="local_guard_after_dispatch")
                raise state["local_error"] from None
            if state["attempt"] is not None:
                scope.complete(
                    state["attempt"],
                    getattr(error, "body", None),
                    outcome="error",
                    failure_code=type(error).__name__,
                )
            raise
        finally:
            _wire_request.reset(token)
        if state["attempt"] is None:
            raise BillingContextMissing("provider transport did not pass the billing wire guard")
        if stream:
            return _MeteredResponsesStream(value, scope, state["attempt"])
        _complete_responses(scope, state["attempt"], value)
        return value
