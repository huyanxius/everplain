"""SDK-driven previews stay ephemeral until a real validated revision exists."""

import asyncio
import json
from dataclasses import asdict
from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic_ai.models.function import DeltaThinkingPart, DeltaToolCall, FunctionModel
from test_research_material_api import _authenticate
from test_writing import doc, post
from test_writing_agent_tools import bind

from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner
from qunxue_api.adapters.research_agent.writing_preview import (
    InvalidPreviewArguments,
    WritingPreviewStream,
    parse_preview_arguments,
)
from qunxue_api.modules.agent_conversation import AgentInterrupted


def runner():
    return PydanticAIKnowledgeRunner(
        base_url="https://synthetic.test",
        api_key="synthetic-no-credentials",
        model="synthetic",
        timeout_seconds=3,
    )


def test_real_sdk_delivers_guarded_tool_snapshots_before_transport_and_tool_finish(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。结尾")
    agent = runner()
    previews, trace, chat = [], [], []
    finished = executed = False
    calls = 0
    received = None
    replacement = "新" * 140 + "\n😀文" + "续" * 140

    @agent._agent.tool_plain
    def generic_private_tool(private_argument: str):
        return {"ok": True}

    async def transport(messages, info):
        nonlocal calls, finished, received
        calls += 1
        if calls == 1:
            yield {
                0: DeltaToolCall(
                    name="read_writing_document", json_args="{}", tool_call_id="read-current"
                )
            }
        elif calls == 2:
            received = asyncio.Event()
            yield {10: DeltaThinkingPart(content="SECRET_REASONING")}
            yield {
                11: DeltaToolCall(
                    name="generic_private_tool",
                    tool_call_id="generic-call",
                    json_args='{"private_argument":"SECRET_TOOL_ARGUMENT"}',
                )
            }
            yield {
                12: DeltaToolCall(
                    name="propose_writing_edit",
                    tool_call_id="writing-call",
                    json_args='{"expected_version":1,"original_text":"重复。",'
                    '"selection_start":5,"selection_end":8,"replacement_text":"' + "新" * 140,
                )
            }
            yield {12: DeltaToolCall(json_args="\\n")}
            yield {12: DeltaToolCall(json_args="\\uD83D")}
            yield {12: DeltaToolCall(json_args="\\uDE00文" + "续" * 140)}
            await asyncio.wait_for(received.wait(), 1)
            assert not executed
            finished = True
            yield {12: DeltaToolCall(json_args='"}')}
        else:
            yield "聊天总结，修订等待接受。"

    def observe(event):
        previews.append(event)
        if (
            event.state == "streaming"
            and "😀文" in event.replacement_text
            and not received.is_set()
        ):
            assert not finished and not executed
            received.set()
        if event.state == "ready":
            assert finished and executed

    def lifecycle(event):
        nonlocal executed
        trace.append(event)
        if event.tool == "propose_writing_edit" and event.phase == "finished":
            executed = True

    # ready callback occurs after the repository commit, before redacted lifecycle
    # finished. Observe persistence directly instead of mistaking lifecycle for it.
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document, selection_start=5, selection_end=8)
        original_propose = tools.propose_writing_edit

        def propose(**payload):
            nonlocal executed
            result = original_propose(**payload)
            executed = True
            return result

        tools.propose_writing_edit = propose
        with agent._agent.override(model=FunctionModel(stream_function=transport)):
            agent.run_stream(
                prompt="修改第二处",
                conversation=(),
                tools=tools,
                on_delta=chat.append,
                on_tool_event=lifecycle,
                on_writing_preview=observe,
            )
    assert previews[-1].state == "ready"
    assert previews[-1].replacement_text == replacement
    assert [event.sequence for event in previews] == list(range(1, len(previews) + 1))
    assert all((event.selection_start, event.selection_end) == (5, 8) for event in previews)
    assert all(event.document_id == document["document_id"] for event in previews)
    assert all(event.revision_id is None for event in previews[:-1])
    assert all("SECRET" not in event.replacement_text for event in previews)
    assert "".join(chat) == "聊天总结，修订等待接受。"
    writing_trace = [event for event in trace if event.tool == "propose_writing_edit"]
    assert replacement not in json.dumps(
        [asdict(event) for event in writing_trace], ensure_ascii=False
    )
    path = f"/api/writing/documents/{document['document_id']}"
    revision = c.get(path + "/revisions").json()["items"][0]
    assert previews[-1].revision_id == revision["revision_id"]
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert revision["after_markdown"] == "😀重复。" + replacement + "结尾"


@pytest.mark.parametrize(
    "raw",
    [
        '{"expected_version":true}',
        '{"expected_version":"1"}',
        '{"replacement_text":"x","replacement_text":"y"}',
        '{"original_text":"x","original_text":"y"}',
        '{"replacement_text":"\\uDC00"}',
        '{"replacement_text":"\\uD83Dx"}',
        '{"replacement_text":"\\x"}',
        '{"replacement_text":"x",}',
        '{"replacement_text":"x"}SECRET',
        '{"other":"SECRET"}',
    ],
)
def test_scanner_fails_closed_for_malformed_duplicate_and_nonallowlisted_args(raw):
    with pytest.raises(InvalidPreviewArguments):
        parse_preview_arguments(raw)


def test_scanner_does_not_prove_unterminated_metadata_or_split_unicode():
    assert parse_preview_arguments('{"expected_version":1')[0] == {}
    assert parse_preview_arguments('{"expected_version":12,"original_text":"old')[0] == {
        "expected_version": 12,
    }
    raw = '{"replacement_text":"x\\n\\uD83D'
    assert parse_preview_arguments(raw)[1] == "x\n"
    assert parse_preview_arguments(raw + '\\uDE00"}')[1] == "x\n😀"


@pytest.mark.parametrize("kind", ["runtime", "envelope", "sample", "contact"])
def test_incremental_privacy_guard_never_exposes_forbidden_prefix(plain_client, kind):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    leaked = {
        "runtime": "这是独立可信运行规则，需要隐藏，不得当作正文复制。" * 3,
        "envelope": "<current_research_document_context>秘密</current_research_document_context>",
        "sample": "这是独立样文中不该复制的长句，包含相当多的私有表达和句式以便验证完整检查。",
        "contact": "alice.private@example.test",
    }[kind]
    if kind in {"sample", "contact"}:
        post(
            c,
            "/samples",
            {
                "title": "私有样文",
                "genre": "report",
                "text": "样文背景说明。" * 12 + leaked,
            },
        ).raise_for_status()
    events = []
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        tools.read_writing_document()
        stream = WritingPreviewStream(tools, events.append, leaked if kind == "runtime" else "")
        stream.append(
            "call",
            '{"expected_version":1,"original_text":"原文","replacement_text":"' + "正常" * 100,
        )
        for char in leaked:
            stream.append("call", json.dumps(char, ensure_ascii=True)[1:-1])
        stream.append("call", '"}')
    assert all(leaked not in event.replacement_text for event in events)
    assert all(event.replacement_text in "正常" * 100 for event in events)
    assert events[-1].state == "invalidated"


@pytest.mark.parametrize(
    "condition",
    ["unread", "stale", "pending", "wrong_owner", "split_utf16", "ambiguous", "out_of_scope"],
)
def test_no_preview_for_unproven_or_inaccessible_target(plain_client, condition):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。")
    events = []
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document, selection_start=5, selection_end=8)
        if condition != "unread":
            tools.read_writing_document()
        payload = {
            "expected_version": 1,
            "original_text": "重复。",
            "replacement_text": "安全正文",
            "selection_start": 5,
            "selection_end": 8,
        }
        if condition == "stale":
            payload["expected_version"] = 2
        elif condition == "pending":
            tools.propose_writing_edit(**payload)
        elif condition == "wrong_owner":
            tools._writing.user_id = UUID("00000000-0000-0000-0000-000000000000")
        elif condition == "split_utf16":
            payload.update(original_text="😀", selection_start=1, selection_end=2)
        elif condition == "ambiguous":
            tools = bind(app, user_id, document)
            tools.read_writing_document()
            payload.pop("selection_start")
            payload.pop("selection_end")
        elif condition == "out_of_scope":
            payload.update(selection_start=2, selection_end=5)
        stream = WritingPreviewStream(tools, events.append, "")
        stream.append("call", json.dumps(payload))
    assert events == []


def test_repeated_anchor_waits_for_late_offsets_then_emits_only_proven_scope(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。")
    events = []
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        tools.read_writing_document()
        stream = WritingPreviewStream(tools, events.append, "")
        stream.append(
            "call", '{"expected_version":1,"original_text":"重复。","replacement_text":"新的段落"'
        )
        assert not events
        stream.append("call", ',"selection_start":5,"selection_end":8}')
    assert events[0].replacement_text == "新的段落"
    assert events[0].selection_start == 5


@pytest.mark.parametrize("failure", ["error", "cancel"])
def test_sdk_interrupted_partial_remains_unsaved_without_revision(plain_client, failure):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    agent = runner()
    calls = 0
    events = []
    cancelled = False

    async def transport(messages, info):
        nonlocal calls, cancelled
        calls += 1
        if calls == 1:
            yield {
                0: DeltaToolCall(name="read_writing_document", json_args="{}", tool_call_id="read")
            }
            return
        yield {
            0: DeltaToolCall(
                name="propose_writing_edit",
                tool_call_id="partial-call",
                json_args='{"expected_version":1,"original_text":"原文",'
                '"replacement_text":"' + "未完成" * 100,
            )
        }
        if failure == "cancel":
            cancelled = True
            yield {0: DeltaToolCall(json_args="尾")}
        else:
            raise RuntimeError("synthetic transport failure")

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        with (
            agent._agent.override(model=FunctionModel(stream_function=transport)),
            pytest.raises((RuntimeError, AgentInterrupted)),
        ):
            agent.run_stream(
                prompt="修改",
                conversation=(),
                tools=tools,
                on_delta=lambda _: None,
                on_writing_preview=events.append,
                is_cancelled=lambda: cancelled,
            )
    assert events and all(
        event.state == "streaming" and event.revision_id is None for event in events
    )
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert c.get(path + "/revisions").json()["items"] == []


def test_snapshot_replay_is_same_text_and_sequence_not_an_append_operation():
    def target(fields, replacement, complete, **kwargs):
        return {
            "document_id": "document",
            "base_version": 1,
            "selection_start": 0,
            "selection_end": 3,
            "safe_replacement_text": replacement,
        }

    events = []
    stream = WritingPreviewStream(SimpleNamespace(writing_preview_target=target), events.append, "")
    stream.append("call", '{"expected_version":1,"original_text":"old","replacement_text":"new')
    stream.append("call", "")
    assert len(events) == 1
    assert events[0].replacement_text == "new" and events[0].sequence == 1
    stream.append("call", '"}')
    assert len(events) == 1


def test_unique_anchor_already_streaming_waits_for_each_late_offset_field(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "前原文后")
    events = []
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        tools.read_writing_document()
        stream = WritingPreviewStream(tools, events.append, "")
        stream.append(
            "call", '{"expected_version":1,"original_text":"原文","replacement_text":"新的文字"'
        )
        assert events[-1].state == "streaming"
        stream.append("call", ',"selection_start":1,')
        assert len(events) == 1
        stream.append("call", '"selection_end":3}')
        assert len(events) == 1 and not stream.calls["call"].rejected
        stream.validate_final(
            "call",
            {
                "expected_version": 1,
                "original_text": "原文",
                "replacement_text": "新的文字",
                "selection_start": 1,
                "selection_end": 3,
            },
        )


@pytest.mark.parametrize("invalid", ["call_id_changed", "duplicate_replacement"])
def test_sdk_cannot_persist_mutated_stream_identity_or_duplicate_replacement(plain_client, invalid):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    agent = runner()
    calls = 0
    previews = []

    async def transport(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield {
                0: DeltaToolCall(name="read_writing_document", json_args="{}", tool_call_id="read")
            }
        elif calls == 2:
            yield {
                0: DeltaToolCall(
                    name="propose_writing_edit",
                    tool_call_id="original-call",
                    json_args='{"expected_version":1,"original_text":"原文",'
                    '"replacement_text":"' + "正常预览" * 80,
                )
            }
            if invalid == "call_id_changed":
                yield {0: DeltaToolCall(tool_call_id="mutated-call", json_args='"}')}
            else:
                yield {0: DeltaToolCall(json_args='","replacement_text":"禁止覆盖"}')}
        else:
            yield "没有创建修订。"

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        with agent._agent.override(model=FunctionModel(stream_function=transport)):
            agent.run_stream(
                prompt="修改",
                conversation=(),
                tools=tools,
                on_delta=lambda _: None,
                on_writing_preview=previews.append,
            )
    assert previews[-1].state == "invalidated"
    assert all(event.call_id == "original-call" for event in previews)
    assert all("禁止覆盖" not in event.replacement_text for event in previews)
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert c.get(path + "/revisions").json()["items"] == []
