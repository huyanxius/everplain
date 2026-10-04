"""Collect Chat Completions SSE for callers that consume a complete JSON value."""

import json

from openai._streaming import SSEDecoder
from openai.lib.streaming.chat import ChatCompletionStreamState
from openai.types.chat import ChatCompletionChunk

from qunxue_api.adapters.model.token_usage import UnknownTokenUsage, UsageSnapshot
from qunxue_api.modules.billing import ModelDeliveryRejected


class _ChatStream:
    def __init__(self):
        self.usage = UsageSnapshot()
        self.completion = ChatCompletionStreamState()
        self.identity = None
        self.done = False

    def accept(self, event):
        if self.done:
            raise ModelDeliveryRejected("model sent data after the stream ended")
        if event.data.strip() == "[DONE]":
            self.done = True
            return
        raw = event.json()
        if event.event == "error" or not isinstance(raw, dict) or raw.get("error"):
            raise ModelDeliveryRejected("model stream reported an error")
        chunk = ChatCompletionChunk.model_validate(raw)
        identity = (chunk.id, chunk.model)
        if self.identity is not None and self.identity != identity:
            raise ModelDeliveryRejected("model stream response identity changed")
        self.identity = identity
        self.usage.accept(chunk)
        # Use the SDK's accumulator for split text and function arguments. Usage
        # validation remains the same as the interactive Pydantic AI stream.
        for _event in self.completion.handle_chunk(chunk):
            pass

    def result(self, max_bytes):
        if self.identity is None:
            raise ValueError("model response did not contain completion events")
        if not self.done or self.usage.finish_reason is None:
            raise ModelDeliveryRejected("model stream ended without a terminal response")
        if self.usage.final is None:
            raise UnknownTokenUsage("model stream ended without final token usage")
        result = self.completion.current_completion_snapshot.model_dump(exclude_none=True)
        result["usage"] = self.usage.final_response.usage.model_dump(exclude_none=True)
        if len(json.dumps(result, ensure_ascii=False).encode()) > max_bytes:
            raise ModelDeliveryRejected("model result exceeded the response size limit")
        return result


# Small token deltas repeat the envelope on every event. Keep the completed
# JSON limit separate from a bounded, larger allowance for SSE framing.
def collect_chat_completion(chunks, *, max_bytes=1_000_000):
    def bounded():
        size = 0
        for chunk in chunks:
            size += len(chunk)
            if size > max_bytes * 64:
                raise ModelDeliveryRejected("model stream exceeded the response size limit")
            yield chunk

    state = _ChatStream()
    for event in SSEDecoder().iter_bytes(bounded()):
        state.accept(event)
    return state.result(max_bytes)


async def collect_chat_completion_async(chunks, *, max_bytes=1_000_000):
    async def bounded():
        size = 0
        async for chunk in chunks:
            size += len(chunk)
            if size > max_bytes * 64:
                raise ModelDeliveryRejected("model stream exceeded the response size limit")
            yield chunk

    state = _ChatStream()
    async for event in SSEDecoder().aiter_bytes(bounded()):
        state.accept(event)
    return state.result(max_bytes)
