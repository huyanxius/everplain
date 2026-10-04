import asyncio
import json

import httpx
import pytest
from streaming_test_support import chat_sse
from test_openai_compatible_provider import _fake_openai_service, _phenomenon_response, _Reply

from qunxue_api.adapters.media_import.image import OpenAICompatibleVisionProvider
from qunxue_api.adapters.model.openai_compatible_provider import OpenAICompatibleModelProvider


def completion(content="OK"):
    return {"id": "synthetic", "model": "synthetic",
            "choices": [{"message": {"role": "assistant", "content": content},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105,
                      "prompt_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 0}}}


def test_structured_legacy_provider_collects_stream_over_real_http():
    body = chat_sse(completion(json.dumps(_phenomenon_response("Synthetic phenomenon"))))
    with _fake_openai_service(_Reply(body)) as (url, requests):
        provider = OpenAICompatibleModelProvider(base_url=url, model="synthetic", api_key=None,
                                                timeout_seconds=2, capability_tier="base")
        result = provider.extract_phenomenon(raw_input="Synthetic", research_intent=None,
                                             context=None)
    assert result.output.phenomenon == "Synthetic phenomenon"
    assert requests[0]["json"]["stream"] is True
    assert requests[0]["json"]["stream_options"] == {"include_usage": True}


@pytest.mark.parametrize("kind", ["probe", "vision"])
def test_direct_adapters_request_streams_and_collect_complete_values(kind):
    def reply(request):
        payload = json.loads(request.content)
        assert payload["stream"] is True
        assert payload["stream_options"] == {"include_usage": True}
        content = "OK" if kind == "probe" else '{"text":"visible","description":"image"}'
        return httpx.Response(200, content=chat_sse(completion(content)),
                              headers={"content-type": "text/event-stream"})

    transport = httpx.MockTransport(reply)
    if kind == "probe":
        provider = OpenAICompatibleModelProvider(
            base_url="https://synthetic.test/v1", model="synthetic", api_key=None,
            timeout_seconds=2, capability_tier="base", probe_transport=transport)
        asyncio.run(provider.probe())
    else:
        provider = OpenAICompatibleVisionProvider(
            base_url="https://synthetic.test/v1", model="synthetic", transport=transport)
        assert provider.describe(content=b"image", media_type="image/png") == {
            "text": "visible", "description": "image"}


def test_shared_collector_preserves_utf8_and_cache_usage_across_byte_boundaries():
    from qunxue_api.adapters.model.streaming import (
        collect_chat_completion,
        collect_chat_completion_async,
    )

    body = chat_sse(completion("你好")).decode().replace("\\u4f60", "你").replace("\\u597d", "好")
    chunks = [bytes([value]) for value in body.encode()]
    result = collect_chat_completion(iter(chunks))

    async def run():
        async def source():
            for chunk in chunks:
                yield chunk
        return await collect_chat_completion_async(source())

    assert asyncio.run(run()) == result
    assert result["choices"][0]["message"]["content"] == "你好"
    assert result["usage"]["prompt_tokens_details"]["cached_tokens"] == 40


@pytest.mark.parametrize("failure", ["missing_done", "missing_usage", "late_error", "oversized"])
def test_shared_collector_rejects_incomplete_or_invalid_streams(failure):
    from qunxue_api.adapters.model.streaming import collect_chat_completion
    from qunxue_api.modules.billing import ModelDeliveryRejected, UnknownTokenUsage

    value = completion()
    if failure == "missing_usage":
        value.pop("usage")
    body = chat_sse(value)
    if failure == "missing_done":
        body = body.removesuffix(b"data: [DONE]\n\n")
    if failure == "late_error":
        body = body.replace(b"data: [DONE]", b'data: {"error":{"message":"synthetic"}}')
    with pytest.raises((ModelDeliveryRejected, UnknownTokenUsage)):
        collect_chat_completion(iter([body]), max_bytes=20 if failure == "oversized" else 10000)


def test_fine_grained_deltas_do_not_consume_the_completed_result_limit():
    from qunxue_api.adapters.model.streaming import collect_chat_completion

    value = completion("x" * 6000)
    coarse = chat_sse(value)
    events = coarse.decode().split("\n\n")
    first = json.loads(events[0].removeprefix("data: "))
    first["choices"][0]["delta"]["content"] = "x"
    initial = "data: " + json.dumps(first) + "\n\n"
    first["choices"][0]["delta"].pop("role")
    fine = (initial + ("data: " + json.dumps(first) + "\n\n") * 5999
            + "\n\n".join(events[1:])).encode()
    assert len(fine) > 1_000_000
    assert collect_chat_completion([fine]) == collect_chat_completion([coarse])
