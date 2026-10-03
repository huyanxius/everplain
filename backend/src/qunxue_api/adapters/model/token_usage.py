"""Normalize provider counters directly; SDK price extraction is not a usage source."""

from collections.abc import Mapping

from pydantic_ai import _utils
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.models.openai import (
    OpenAIChatModel,
    OpenAIResponsesModel,
    OpenAIResponsesStreamedResponse,
    OpenAIStreamedResponse,
)
from pydantic_ai.usage import RequestUsage

from qunxue_api.modules.billing import ModelDeliveryRejected
from qunxue_api.modules.billing import UnknownTokenUsage as UnknownTokenUsage


def _counter(data: Mapping, key: str, default=None) -> int:
    value = data.get(key, default)
    if type(value) is not int or value < 0:
        raise UnknownTokenUsage(f"invalid token counter: {key}")
    return value


def normalized_usage(raw: object) -> RequestUsage:
    if hasattr(raw, "model_dump"):
        raw = raw.model_dump(exclude_none=True)
    if not isinstance(raw, Mapping):
        raise UnknownTokenUsage("token usage is absent")
    input_key = "prompt_tokens" if "prompt_tokens" in raw else "input_tokens"
    output_key = "completion_tokens" if "completion_tokens" in raw else "output_tokens"
    input_tokens = _counter(raw, input_key)
    output_tokens = _counter(raw, output_key)
    input_details = raw.get("prompt_tokens_details", raw.get("input_tokens_details", {}))
    output_details = raw.get("completion_tokens_details", raw.get("output_tokens_details", {}))
    if not isinstance(input_details, Mapping) or not isinstance(output_details, Mapping):
        raise UnknownTokenUsage("invalid token details")
    cached = _counter(input_details, "cached_tokens", 0)
    written = _counter(
        input_details, "cache_write_tokens", raw.get("cache_creation_input_tokens", 0)
    )
    if "prompt_cache_hit_tokens" in raw or "prompt_cache_miss_tokens" in raw:
        hit = _counter(raw, "prompt_cache_hit_tokens")
        miss = _counter(raw, "prompt_cache_miss_tokens")
        if (
            hit + miss != input_tokens
            or written
            or ("cached_tokens" in input_details and cached != hit)
        ):
            raise UnknownTokenUsage("DeepSeek cache counters do not partition input")
        cached = hit
    if "total_tokens" in raw and _counter(raw, "total_tokens") != input_tokens + output_tokens:
        raise UnknownTokenUsage("total_tokens contradicts input/output")
    reasoning = _counter(output_details, "reasoning_tokens", 0)
    if cached + written > input_tokens or reasoning > output_tokens:
        raise UnknownTokenUsage("token subsets exceed totals")
    return RequestUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cached,
        cache_write_tokens=written,
        details={"reasoning_tokens": reasoning},
    )


class UsageSnapshot:
    """One attempt's cumulative snapshots with provider terminal evidence."""

    def __init__(self, continuous=False):
        self.continuous = continuous
        self.latest = None
        self.final = None
        self.final_response = None
        self.finish_reason = None
        self.content_after_snapshot = False

    def accept(self, chunk):
        for choice in chunk.choices:
            if choice.finish_reason:
                if self.finish_reason and self.finish_reason != choice.finish_reason:
                    raise UnknownTokenUsage("stream terminal reasons disagree")
                self.finish_reason = choice.finish_reason
        finished = (chunk.usage is not None and not chunk.choices) or any(
            c.finish_reason for c in chunk.choices
        )
        content = any(
            c.delta is not None
            and any(
                value is not None and value != "" and value != []
                for key, value in c.delta.model_dump(exclude_none=True).items()
                if key != "role"
            )
            for c in chunk.choices
        )
        if self.final is not None and content:
            raise UnknownTokenUsage("stream contains new content after final usage")
        if chunk.usage is not None:
            snapshot = normalized_usage(chunk.usage)
            if self.final is not None and snapshot != self.final:
                raise UnknownTokenUsage("final usage snapshots disagree")
            self.latest = (snapshot, chunk)
            self.content_after_snapshot = False
            if finished:
                self.final, self.final_response = snapshot, chunk
        elif content and self.latest is not None:
            self.content_after_snapshot = True
        if (
            finished
            and self.continuous
            and self.latest is not None
            and not self.content_after_snapshot
        ):
            self.final, self.final_response = self.latest


class UsageSafeOpenAIStreamedResponse(OpenAIStreamedResponse):
    async def _get_event_iterator(self):
        self._snapshot = UsageSnapshot(
            bool(self._model_settings and self._model_settings.get("openai_continuous_usage_stats"))
        )
        async for event in super()._get_event_iterator():
            if self._snapshot.final is not None:
                self._usage = self._snapshot.final
            yield event
        if self._snapshot.final is None:
            raise UnknownTokenUsage("stream ended without final token usage")
        self._usage = self._snapshot.final

    def _map_usage(self, chunk):
        self._snapshot.accept(chunk)
        return RequestUsage()


class UsageSafeOpenAIChatModel(OpenAIChatModel):
    _streamed_response_cls = UsageSafeOpenAIStreamedResponse

    def _map_usage(self, response):
        return normalized_usage(response.usage)


def response_value(response, key, default=None):
    return (
        response.get(key, default)
        if isinstance(response, Mapping)
        else getattr(response, key, default)
    )


def responses_finish_reason(response):
    for item in response_value(response, "output", ()) or ():
        if response_value(item, "type") == "message" and any(
            response_value(part, "type") == "refusal"
            for part in response_value(item, "content", ()) or ()
        ):
            return "content_filter"
    details = response_value(response, "incomplete_details")
    return response_value(details, "reason") or response_value(response, "status")


class ResponsesUsageSnapshot:
    """Only a terminal Responses event supplies final, cumulative token usage."""

    terminal_statuses = {"completed", "incomplete", "failed", "cancelled"}

    def __init__(self):
        self.final_response = None
        self.final = None
        self.finish_reason = None
        self.receipt = None
        self.refused = False

    def accept_response(self, response):
        self.receipt = {
            key: response_value(response, key) for key in ("id", "model", "service_tier")
        }
        if response_value(response, "status") not in self.terminal_statuses:
            return
        if self.final_response is not None:
            raise UnknownTokenUsage("stream contains multiple terminal Responses events")
        # Retain malformed/missing terminal usage for the billing error record too.
        self.final_response = response
        self.finish_reason = "content_filter" if self.refused else responses_finish_reason(response)
        self.final = normalized_usage(response_value(response, "usage"))

    def accept(self, event):
        if self.final_response is not None:
            raise UnknownTokenUsage("stream contains events after terminal Responses usage")
        event_type = response_value(event, "type", "")
        if event_type in {"error", "response.error"}:
            raise ModelDeliveryRejected("Responses stream reported an error")
        if event_type in {"response.refusal.delta", "response.refusal.done"}:
            self.refused = True
        response = response_value(event, "response")
        if response is None:
            return
        status = response_value(response, "status")
        if event_type in {f"response.{s}" for s in self.terminal_statuses}:
            self.accept_response(response)
            if event_type != f"response.{status}":
                raise UnknownTokenUsage("Responses terminal event and status disagree")
        elif status in self.terminal_statuses:
            raise UnknownTokenUsage("Responses terminal status lacks a terminal event")
        else:
            self.accept_response(response)


class UsageSafeOpenAIResponsesStreamedResponse(OpenAIResponsesStreamedResponse):
    async def _get_event_iterator(self):
        self._snapshot = ResponsesUsageSnapshot()
        async for event in super()._get_event_iterator():
            if self._snapshot.final is not None:
                self._usage = self._snapshot.final
            yield event
        if self._snapshot.final is None:
            raise UnknownTokenUsage("stream ended without final Responses token usage")
        self._usage = self._snapshot.final
        if self._snapshot.finish_reason != "completed" or self.finish_reason == "content_filter":
            raise ModelDeliveryRejected("Responses output was not completed")

    def _map_usage(self, response):
        self._snapshot.accept_response(response)
        # The SDK adds cumulative in-progress and terminal snapshots. Replace with
        # the raw terminal snapshot instead, without SDK pricing extraction.
        return RequestUsage()


class UsageSafeOpenAIResponsesModel(OpenAIResponsesModel):
    def _process_response(self, response, model_settings, model_request_parameters):
        usage = normalized_usage(response.usage)
        if responses_finish_reason(response) != "completed":
            raise ModelDeliveryRejected("Responses output was not completed")
        result = super()._process_response(response, model_settings, model_request_parameters)
        result.usage = usage
        return result

    async def _process_streamed_response(self, response, model_settings, model_request_parameters):
        # The SDK's Responses factory hard-codes its streamed-response class.
        # Preserve its construction contract and replace only usage handling.
        peekable = _utils.PeekableAsyncStream(response)
        first = await peekable.peek()
        if isinstance(first, _utils.Unset) or response_value(first, "type") != "response.created":
            raise UnexpectedModelBehavior("Responses stream did not start with response.created")
        return UsageSafeOpenAIResponsesStreamedResponse(
            model_request_parameters=model_request_parameters,
            _model_name=first.response.model,
            _model_settings=model_settings,
            _response=peekable,
            _provider_name=self._provider.name,
            _provider_url=self._provider.base_url,
            _provider_timestamp=_utils.number_to_datetime(first.response.created_at)
            if first.response.created_at
            else None,
        )
