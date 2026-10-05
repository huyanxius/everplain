"""Native SDK bridges with the existing per-wire attempt and receipt lifecycle."""

import inspect
import json
from contextvars import ContextVar
from dataclasses import fields

import httpx
import httpx2
from anthropic import Omit
from pydantic_ai import _utils
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicStreamedResponse
from pydantic_ai.models.google import GeminiStreamedResponse, GoogleModel

from qunxue_api.adapters.model.dispatch import attach_dispatch
from qunxue_api.adapters.model.metering import _mark_validation_retry, current_operation
from qunxue_api.adapters.model.native_usage import NativeUsageSnapshot
from qunxue_api.adapters.model.routing import ModelAttemptResult, current_model_route_scope
from qunxue_api.modules.billing import BillingContextMissing

_native_request = ContextVar("native_metered_request", default=None)


class _NativeTransport:
    def __init__(self, inner):
        self.inner, self.client = inner, None

    async def handle_async_request(self, request):
        state = _native_request.get()
        if state is None:
            raise BillingContextMissing("native transport requires an explicit model attempt")
        if state["sent"]:
            raise BillingContextMissing(
                "native SDK retries/redirects require a new explicit attempt"
            )
        library = httpx if state["protocol"] == "gemini_generate_content" else httpx2
        payload = json.loads(await request.aread())
        if state["protocol"] == "gemini_generate_content":
            if not request.url.path.endswith((":generateContent", ":streamGenerateContent")):
                raise BillingContextMissing("unexpected native Google paid endpoint")
            config = payload.get("generationConfig", {}).get("thinkingConfig", {})
            if "thinking_level" in config:
                level = config.pop("thinking_level")
                if "thinkingLevel" in config and config["thinkingLevel"] != level:
                    raise ValueError("conflicting native Google thinking levels")
                config["thinkingLevel"] = level
            request = library.Request(
                request.method,
                request.url,
                headers={
                    k: v
                    for k, v in request.headers.items()
                    if k != "content-length"
                    and not (
                        k == "x-goog-api-key" and getattr(self, "bearer_authentication", False)
                    )
                },
                content=json.dumps(payload),
                extensions=request.extensions,
            )
        elif not request.url.path.endswith("/v1/messages"):
            raise BillingContextMissing("unexpected native Anthropic paid endpoint")
        elif getattr(self, "bearer_authentication", False):
            request = library.Request(
                request.method,
                request.url,
                headers={k: v for k, v in request.headers.items() if k != "x-api-key"},
                content=request.content,
                extensions=request.extensions,
            )
        scope = state["scope"]
        if scope is not None:
            state["attempt"] = scope.before_attempt_payload(
                payload,
                current_model_route_scope(),
                request.url.host,
                api_type=state["protocol"],
                model=state["model"],
                request_target=request.url.path,
            )
            state["dispatch"] = attach_dispatch(
                request,
                scope.runtime,
                state["attempt"],
                self.client,
            )
        state["sent"] = True
        try:
            response = await self.inner.handle_async_request(request)
            if state.get("dispatch"):
                state["dispatch"].record_response(response)
            tap = _WireReceiptTap(
                state["snapshot"],
                "text/event-stream" in response.headers.get("content-type", ""),
            )
            if hasattr(response, "_content"):
                tap.feed(response.content)
                tap.finish()
            else:
                cls = _HttpxReceiptStream if library is httpx else _Httpx2ReceiptStream
                response.stream = cls(response.stream, tap)
            return response
        except BaseException as error:
            if state.get("dispatch"):
                state["dispatch"].finish_failed(error)
            raise

    async def aclose(self):
        await self.inner.aclose()


class NativeGoogleTransport(_NativeTransport, httpx.AsyncBaseTransport):
    pass


class NativeAnthropicTransport(_NativeTransport, httpx2.AsyncBaseTransport):
    pass


class _WireReceiptTap:
    def __init__(self, snapshot, sse):
        self.snapshot, self.sse, self.buffer, self.data = snapshot, sse, b"", []

    def _accept(self, data):
        try:
            self.snapshot.observe_wire(json.loads(data))
        except (ValueError, TypeError):
            self.snapshot.invalid = True

    def feed(self, data):
        self.buffer += data
        if not self.sse:
            return
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            line = line.rstrip(b"\r")
            if not line and self.data:
                self._accept(b"\n".join(self.data))
                self.data = []
            elif line.startswith(b"data:"):
                self.data.append(line[5:].lstrip(b" "))

    def finish(self):
        if not self.sse and self.buffer:
            self._accept(self.buffer)
        elif self.data or self.buffer:
            self.snapshot.invalid = True
        self.buffer, self.data = b"", []


class _ReceiptStream:
    def __init__(self, source, tap):
        self.source, self.tap = source, tap

    async def __aiter__(self):
        async for chunk in self.source:
            self.tap.feed(chunk)
            yield chunk
        self.tap.finish()

    async def aclose(self):
        if self.tap.buffer or self.tap.data:
            self.tap.snapshot.invalid = True
        await self.source.aclose()


class _HttpxReceiptStream(_ReceiptStream, httpx.AsyncByteStream):
    pass


class _Httpx2ReceiptStream(_ReceiptStream, httpx2.AsyncByteStream):
    pass


class _NativeSDKStream:
    def __init__(self, source, state):
        self.source, self.state, self.done = source, state, False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def __aiter__(self):
        source = self.source.__aiter__()
        try:
            while True:
                # PydanticAI may advance the stream in a different graph task.
                # A ContextVar token must never survive an async-generator yield.
                token = _native_request.set(self.state)
                try:
                    chunk = await anext(source)
                except StopAsyncIteration:
                    break
                finally:
                    _native_request.reset(token)
                if not self.state["snapshot"].wire_observed:
                    self.state["snapshot"].accept(chunk)
                yield chunk
            self._finish("success")
        except BaseException:
            self._finish("error", "stream_incomplete")
            raise

    def _finish(self, outcome, failure=None):
        if self.done:
            return
        self.done = True
        _complete_native(self.state, outcome, failure)

    async def aclose(self):
        try:
            closer = getattr(self.source, "aclose", None) or getattr(self.source, "close", None)
            if closer:
                await closer()
        finally:
            self._finish("error", "stream_cancelled")

    close = aclose


def _complete_native(state, outcome, failure=None):
    if state.get("completed"):
        return
    scope, attempt, snapshot = state["scope"], state["attempt"], state["snapshot"]
    if scope is None or attempt is None:
        return
    state["completed"] = True
    if not snapshot.terminal and outcome == "success":
        failure = failure or "missing_native_terminal"
    if snapshot.invalid:
        failure = "invalid_native_token_usage"
    scope.complete(
        attempt,
        snapshot.canonical(),
        outcome=outcome,
        failure_code=failure,
        finish_reason=snapshot.finish_reason,
        usage_known=snapshot.known,
    )


class _NativeModel:
    def _configure_native(
        self,
        *,
        protocol,
        route_executor,
        route_context_factory,
        route_error,
        require_billing,
        cache_omission_is_zero,
    ):
        self._native_protocol = protocol
        self._route_executor = route_executor
        self._route_context_factory = route_context_factory
        self._route_error = route_error
        self.require_billing = require_billing
        self._cache_omission_is_zero = cache_omission_is_zero

    async def _native_create(self, messages, stream, create, settings, parameters):
        scope = current_operation(required=self.require_billing)
        if scope is not None:
            _mark_validation_retry(scope, messages)
        state = {
            "scope": scope,
            "attempt": None,
            "sent": False,
            "protocol": self._native_protocol,
            "model": self.model_name,
            "snapshot": NativeUsageSnapshot(
                self._native_protocol,
                cache_omission_is_zero=self._cache_omission_is_zero,
            ),
        }
        self._native_snapshot = state["snapshot"]

        async def invoke(_endpoint=None):
            token = _native_request.set(state)
            try:
                value = await create(messages, stream, settings, parameters)
                if stream:
                    value = _NativeSDKStream(value, state)
                    if self._native_protocol == "gemini_generate_content":
                        # The Google SDK opens its HTTP stream lazily. Advance one
                        # raw chunk while the route scope is still installed.
                        source = _utils.PeekableAsyncStream(value)
                        await source.peek()
                        value = _ClosablePeekable(source, value)
                else:
                    if not state["snapshot"].wire_observed:
                        state["snapshot"].accept(value)
                    _complete_native(state, "success")
                return ModelAttemptResult(value)
            except BaseException as error:
                _complete_native(state, "error", type(error).__name__)
                raise
            finally:
                _native_request.reset(token)

        if self._route_executor is None:
            return (await invoke()).value
        try:
            return (
                await self._route_executor.execute_async(
                    context=self._route_context_factory(),
                    invoke=invoke,
                )
            ).value
        except Exception as error:
            translated = self._route_error(error)
            if translated is error:
                raise
            raise translated from None

    async def count_tokens(self, *_args, **_kwargs):
        raise BillingContextMissing(
            "native countTokens is not a separately metered product operation"
        )

    def _process_response(self, response):
        mapped = super()._process_response(response)
        mapped.usage = self._native_snapshot.sdk_usage()
        mapped.provider_details = {
            **(mapped.provider_details or {}),
            "usage_status": "known" if self._native_snapshot.known else "pending",
        }
        return mapped

    async def _process_streamed_response(self, response, parameters):
        mapped = await super()._process_streamed_response(response, parameters)
        cls = (
            NativeGeminiStream
            if self._native_protocol == "gemini_generate_content"
            else NativeAnthropicStream
        )
        safe = cls(**{f.name: getattr(mapped, f.name) for f in fields(mapped) if f.init})
        safe.native_snapshot = self._native_snapshot
        return safe


class _ClosablePeekable:
    def __init__(self, source, stream):
        self.source, self.stream = source, stream

    def __aiter__(self):
        return self.source.__aiter__()

    async def aclose(self):
        await self.stream.aclose()


class _NativeStreamUsage:
    async def _get_event_iterator(self):
        async for event in super()._get_event_iterator():
            self._usage = self.native_snapshot.sdk_usage()
            yield event
        self._usage = self.native_snapshot.sdk_usage()
        self.provider_details = {
            **(self.provider_details or {}),
            "usage_status": "known" if self.native_snapshot.known else "pending",
        }


class NativeGeminiStream(_NativeStreamUsage, GeminiStreamedResponse):
    pass


class NativeAnthropicStream(_NativeStreamUsage, AnthropicStreamedResponse):
    pass


class MeteredNativeGoogleModel(_NativeModel, GoogleModel):
    async def _generate_content(self, messages, stream, model_settings, parameters):
        return await self._native_create(
            messages,
            stream,
            super()._generate_content,
            model_settings,
            parameters,
        )


class MeteredNativeAnthropicModel(_NativeModel, AnthropicModel):
    def install_compatibility(self):
        create = self.client.beta.messages.create
        accepted = set(inspect.signature(create).parameters)

        async def compatible_create(**kwargs):
            unsupported = {k: v for k, v in kwargs.items() if k not in accepted}
            if not all(isinstance(v, Omit) for v in unsupported.values()):
                raise ValueError("unsupported explicitly supplied Anthropic SDK setting")
            return await create(**{k: v for k, v in kwargs.items() if k in accepted})

        self.client.beta.messages.create = compatible_create

    async def _messages_create(self, messages, stream, model_settings, parameters):
        if self.client.max_retries != 0:
            raise BillingContextMissing("native SDK automatic retries must be disabled")
        return await self._native_create(
            messages,
            stream,
            super()._messages_create,
            model_settings,
            parameters,
        )
