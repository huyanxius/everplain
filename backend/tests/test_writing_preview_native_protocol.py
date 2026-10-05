"""Real native SDK writing previews over synthetic HTTP/SSE and local SQLite.

No provider requests are sent. Anthropic streams JSON fragments; this Gemini SDK
normalizes each function call as a complete argument snapshot.
"""

import asyncio
import json
from uuid import UUID

import httpx
import httpx2
import pytest
from test_native_protocol_metering import receipt, streamed
from test_research_material_api import _authenticate
from test_writing import doc
from test_writing_agent_tools import bind

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.research_agent import native_models
from qunxue_api.adapters.research_agent.model_capacity import AgentModelCapacity
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner
from qunxue_api.settings import AgentModelEffortSettings


@pytest.mark.parametrize("protocol", ["anthropic_messages", "gemini_generate_content"])
def test_native_sdk_writing_preview_real_parser_and_persistence(
    plain_client, monkeypatch, protocol
):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    library = httpx if protocol == "gemini_generate_content" else httpx2
    base = "https://synthetic.invalid"
    model = "gemini-3.5-flash" if protocol == "gemini_generate_content" else "claude-sonnet-5-5"
    native_build = native_models.build_native_agent_model
    calls, previews, chat = [], [], []
    replacement = "新" * 300 + "😀结尾"
    payload = dict(expected_version=1, original_text="原文", replacement_text=replacement)
    observed = None
    executed = False
    stream_ended = False

    class PausedWritingStream(library.AsyncByteStream):
        async def __aiter__(self):
            nonlocal observed, stream_ended
            observed = asyncio.Event()
            value = receipt(protocol, True, 2)
            value["content"][0]["thinking"] = "SECRET_REASONING"
            value["content"][-1].update(
                name="propose_writing_edit", id="writing-call", input=payload
            )
            blocks = streamed(protocol, value).split("\n\n")
            for block in blocks:
                if not block:
                    continue
                if "input_json_delta" in block:
                    event = json.loads(block.split("\ndata: ", 1)[1])
                    raw = event["delta"]["partial_json"]
                    # Pause within the escaped replacement string, before closing JSON.
                    end = raw.index(r"\u65b0") + 6 * 250
                    event["delta"]["partial_json"] = raw[:end]
                    yield (
                        "event: content_block_delta\ndata: " + json.dumps(event) + "\n\n"
                    ).encode()
                    await asyncio.wait_for(observed.wait(), 2)
                    assert not executed
                    event["delta"]["partial_json"] = raw[end:]
                    yield (
                        "event: content_block_delta\ndata: " + json.dumps(event) + "\n\n"
                    ).encode()
                else:
                    yield (block + "\n\n").encode()
            stream_ended = True

    def reply(request):
        nonlocal stream_ended
        calls.append(json.loads(request.content))
        index = len(calls)
        assert index <= 3
        value = receipt(protocol, index < 3, index)
        if protocol == "gemini_generate_content":
            parts = value["candidates"][0]["content"]["parts"]
            if index < 3:
                parts[0]["functionCall"].update(
                    name="read_writing_document" if index == 1 else "propose_writing_edit",
                    args={} if index == 1 else payload,
                    id="read-call" if index == 1 else "writing-call",
                )
                parts.insert(0, {"text": "SECRET_REASONING", "thought": True})
        elif index < 3:
            value["content"][0]["thinking"] = "SECRET_REASONING"
            value["content"][-1].update(
                name="read_writing_document" if index == 1 else "propose_writing_edit",
                input={} if index == 1 else payload,
                id="read-call" if index == 1 else "writing-call",
            )
        if protocol == "anthropic_messages" and index == 2:
            return library.Response(
                200, headers={"content-type": "text/event-stream"}, stream=PausedWritingStream()
            )
        if index == 3:
            stream_ended = True
        return library.Response(
            200, headers={"content-type": "text/event-stream"}, content=streamed(protocol, value)
        )

    monkeypatch.setattr(
        native_models,
        "build_native_agent_model",
        lambda **kw: native_build(**kw, transport=library.MockTransport(reply)),
    )
    effort = (
        AgentModelEffortSettings(google_thinking_level="high")
        if protocol == "gemini_generate_content"
        else AgentModelEffortSettings(anthropic_effort="high", anthropic_thinking="adaptive")
    )
    runner = PydanticAIKnowledgeRunner(
        base_url=base,
        api_key="synthetic",
        model=model,
        timeout_seconds=5,
        protocol=protocol,
        reasoning_settings=effort,
        native_cache_omission_is_zero=True,
        route_executor=ModelRouteExecutor(
            endpoints=(ModelEndpoint("primary", base, model, "synthetic", 5),), max_retries=0
        ),
        model_capacities={
            f"{base}|{protocol}|{model}": AgentModelCapacity(
                100000,
                512,
                "maxOutputTokens" if protocol == "gemini_generate_content" else "max_tokens",
                "synthetic-only",
            )
        },
    )

    def observe(event):
        previews.append(event)
        if event.state == "streaming":
            assert not executed
            if protocol == "anthropic_messages" and not stream_ended:
                observed.set()
        if event.state == "ready":
            assert executed

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        original = tools.propose_writing_edit

        def propose(**kw):
            nonlocal executed
            result = original(**kw)
            executed = True
            return result

        tools.propose_writing_edit = propose
        runner.run_stream(
            prompt="修改原文",
            conversation=(),
            tools=tools,
            on_delta=chat.append,
            on_writing_preview=observe,
        )
    assert len(calls) == 3
    assert "".join(chat) == "42"
    assert previews and previews[-1].state == "ready"
    assert any(event.state == "streaming" for event in previews)
    assert [event.sequence for event in previews] == list(range(1, len(previews) + 1))
    assert previews[-1].replacement_text == replacement
    assert all("SECRET" not in event.replacement_text for event in previews)
    assert all(event.state in {"streaming", "ready"} for event in previews)
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == "原文"
    revision = c.get(path + "/revisions").json()["items"][0]
    assert revision["after_markdown"] == replacement
    assert revision["revision_id"] == previews[-1].revision_id
    assert revision["status"] == "pending"
