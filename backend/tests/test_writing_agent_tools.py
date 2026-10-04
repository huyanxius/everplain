"""The ordinary Agent edits writing documents only through guarded proposals."""

import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from test_research_material_api import _authenticate
from test_writing import doc, pipeline, post, proposal

from qunxue_api.adapters.research_agent.pydantic_runner import (
    PydanticAIKnowledgeRunner,
    _compose_agent_prompt,
    _prepare_writing_tool,
)
from qunxue_api.api.contracts.agent import AgentTurnRequest
from qunxue_api.application.writing import WRITING_INSTRUCTIONS
from qunxue_api.modules.agent_conversation import AgentInterrupted, AgentRunResult
from qunxue_api.modules.writing import WritingConflict, WritingUnsafeOutput, instruction_artifacts


def context(document, **selection):
    return {
        "document_id": document["document_id"],
        "document_version": document["version"], **selection,
    }


def bind(application, user_id, document, **selection):
    tools = application._tools_factory()
    tools.prepare_writing_context(user_id=user_id, context=context(document, **selection))
    tools.bind_writing_context(
        user_id=user_id, agent_run_id=uuid4(), context=context(document, **selection),
    )
    return tools


def test_guarded_proposal_preserves_original_and_retries_then_accepts(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "开头。原文。结尾。")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document)
        with pytest.raises(WritingConflict, match="先读取"):
            tools.propose_writing_edit(
                expected_version=1, original_text="原文。", replacement_text="修订。",
            )
        assert tools.read_writing_document()["markdown"] == document["markdown"]
        edit = dict(expected_version=1, original_text="原文。", replacement_text="修订。")
        revision = tools.propose_writing_edit(**edit)
        assert tools.propose_writing_edit(**edit) == revision
        assert revision["status"] == "pending"
        assert revision["after_markdown"] == "开头。修订。结尾。"
        reading = tools.read_writing_document()
        assert reading["markdown"] == document["markdown"]
        assert reading["pending_revision_ids"] == [revision["revision_id"]]
        with pytest.raises(WritingConflict, match="待定修订"):
            tools.propose_writing_edit(
                expected_version=1, original_text="结尾。", replacement_text="尾声。",
            )
    path = f"/api/writing/documents/{document['document_id']}"
    assert len(c.get(path + "/revisions").json()["items"]) == 1
    response = c.post(path + f"/revisions/{revision['revision_id']}/resolve", json={
        "expected_version": 1, "decision": "accept",
    }, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200, response.text
    assert response.json()["document"]["markdown"] == "开头。修订。结尾。"
    assert response.json()["document"]["version"] == 2


def test_selected_duplicate_utf16_text_is_precise_and_rejection_preserves_draft(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。结尾")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document, selection_start=5, selection_end=8)
        assert tools.read_writing_document()["selection"] == {
            "start": 5, "end": 8, "text": "重复。",
        }
        with pytest.raises(WritingConflict, match="超出"):
            tools.propose_writing_edit(expected_version=1, original_text="重复。",
                                       replacement_text="错误", selection_start=2, selection_end=5)
        revision = tools.propose_writing_edit(
            expected_version=1, original_text="重复。", replacement_text="只改第二处。",
        )
        assert revision["after_markdown"] == "😀重复。只改第二处。结尾"
    path = f"/api/writing/documents/{document['document_id']}"
    response = c.post(path + f"/revisions/{revision['revision_id']}/resolve", json={
        "expected_version": 1, "decision": "reject",
    }, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200
    assert response.json()["document"]["markdown"] == document["markdown"]


@pytest.mark.parametrize("text,start,end,original,replacement,expected", [
    ("", 0, 0, "", "新文稿", "新文稿"),
    ("😀文字", 2, 2, "", "插入", "😀插入文字"),
    ("开头中间结尾", 2, 4, "中间", "", "开头结尾"),
])
def test_insert_and_delete_have_exact_guards(
    plain_client, text, start, end, original, replacement, expected,
):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, text)
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document)
        tools.read_writing_document()
        revision = tools.propose_writing_edit(
            expected_version=1, original_text=original, replacement_text=replacement,
            selection_start=start, selection_end=end,
        )
        assert revision["after_markdown"] == expected


def test_ambiguous_mismatched_and_split_character_edits_are_rejected(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复重复")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document)
        tools.read_writing_document()
        for change in [
            {"original_text": "重复"},
            {"original_text": "错误", "selection_start": 2, "selection_end": 4},
            {"original_text": "", "selection_start": 1, "selection_end": 1},
            {"original_text": "", "selection_start": 20, "selection_end": 20},
            {"original_text": "", "selection_start": 2},
        ]:
            with pytest.raises(ValueError):
                tools.propose_writing_edit(expected_version=1, replacement_text="新", **change)
        assert tools.read_writing_document()["pending_revision_ids"] == []


@pytest.mark.parametrize("selection", [{}, {"selection_start": 0, "selection_end": 4}])
def test_overlapping_substrings_require_exact_offsets(plain_client, selection):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "aaaa")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document, **selection)
        tools.read_writing_document()
        with pytest.raises(WritingConflict, match="唯一"):
            tools.propose_writing_edit(expected_version=1, original_text="aaa",
                                       replacement_text="b")
        revision = tools.propose_writing_edit(expected_version=1, original_text="aaa",
                                              replacement_text="b", selection_start=1,
                                              selection_end=4)
        assert revision["after_markdown"] == "ab"


def test_owner_isolation_and_request_only_tool_exposure(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c)
    stranger = UUID(_authenticate(c)["user"]["user_id"])
    definition = SimpleNamespace(name="read_writing_document")
    with c.app.state.disciplinary_agent_scope() as application:
        unbound = application._tools_factory()
        assert _prepare_writing_tool(SimpleNamespace(deps=unbound), definition) is None
        with pytest.raises(LookupError):
            bind(application, stranger, document)
        tools = bind(application, user_id, document)
        assert _prepare_writing_tool(SimpleNamespace(deps=tools), definition) is definition
        with pytest.raises(ValueError):
            unbound.read_writing_document()


def test_newer_save_fences_pending_proposal_and_old_context_cannot_upgrade(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document, selection_start=0, selection_end=2)
        tools.read_writing_document()
        path = f"/api/writing/documents/{document['document_id']}"
        saved = c.patch(path, json={"expected_version": 1, "markdown": "用户新内容"},
                        headers={"Idempotency-Key": str(uuid4())})
        assert saved.status_code == 200, saved.text
        with pytest.raises(WritingConflict):
            tools.propose_writing_edit(
                expected_version=1, original_text="原文", replacement_text="旧建议",
                selection_start=0, selection_end=2,
            )
        read = tools.read_writing_document()
        assert read["context_stale"] is True
        assert read["selection"] is None
        assert read["markdown"] == "用户新内容"
        with pytest.raises(WritingConflict, match="上下文已过期"):
            tools.propose_writing_edit(
                expected_version=2, original_text="用户新内容", replacement_text="禁止升级",
            )
    assert c.get(path + "/revisions").json()["items"] == []


@pytest.mark.parametrize("value", [
    {"selection_start": 1}, {"selection_end": 2},
    {"selection_start": 2, "selection_end": 1},
    {"selection_start": -1, "selection_end": 2}, {"document_version": 0},
    {"document_version": True}, {"document_version": 1.0},
    {"selection_start": False, "selection_end": 2},
    {"selection_start": 0, "selection_end": 2.0},
])
def test_writing_request_validates_range_shape(value):
    with pytest.raises(ValueError):
        AgentTurnRequest(message="编辑", writing_context={
            "document_id": str(uuid4()), "document_version": 1, **value,
        })


def test_interrupted_run_restores_original_writing_binding(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document, other = doc(c, "原始文稿"), doc(c, "另一篇")
    key = str(uuid4())
    calls = []
    revisions = []

    class Runner:
        def run_stream(self, *, tools, on_delta, **kwargs):
            calls.append(tools.writing_prompt_context)
            tools.read_writing_document()
            revisions.append(tools.propose_writing_edit(
                expected_version=1, original_text="原始", replacement_text="改写",
            ))
            on_delta("保留的讨论")
            if len(calls) == 1:
                raise AgentInterrupted("test interruption")
            return AgentRunResult(answer="继续讨论", citations=(),
                                  release_id=tools.release.knowledge_release_id,
                                  provider="test", model="test")

    with c.app.state.disciplinary_agent_scope() as app:
        app._runner = Runner()
        with pytest.raises(AgentInterrupted):
            app.run_turn(user_id=user_id, conversation_id=None, prompt="讨论原文",
                         writing_context=context(document, selection_start=0, selection_end=2),
                         idempotency_key=key, on_delta=lambda _: None)
    with c.app.state.disciplinary_agent_scope() as app:
        run = app.find_run(user_id=user_id, idempotency_key=key)
        assert run.request_snapshot["writing_context"] == context(
            document, selection_start=0, selection_end=2,
        )
        app._runner = Runner()
        app.run_turn(user_id=user_id, conversation_id=run.conversation_id, prompt="换文稿",
                     writing_context=context(other), idempotency_key=key, on_delta=lambda _: None)
    assert calls == [context(document, selection_start=0, selection_end=2)] * 2
    assert revisions[0]["revision_id"] == revisions[1]["revision_id"]
    path = f"/api/writing/documents/{document['document_id']}/revisions"
    assert len(c.get(path).json()["items"]) == 1


def test_agent_route_passes_context_and_discussion_does_not_create_a_revision(
    plain_client, monkeypatch,
):
    from qunxue_api.adapters.research_agent.pydantic_runner import DeterministicKnowledgeRunner

    c = plain_client
    _authenticate(c)
    document = doc(c, "只读正文")
    observed = []

    def run_stream(self, *, tools, **kwargs):
        observed.append(tools.read_writing_document())
        return AgentRunResult(answer="这是聊天，不是正文。", citations=(),
                              release_id=tools.release.knowledge_release_id,
                              provider="test", model="test")

    monkeypatch.setattr(DeterministicKnowledgeRunner, "run_stream", run_stream)
    response = c.post("/api/agent/turns", json={
        "message": "只讨论", "writing_context": context(document),
    }, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200 and "turn_completed" in response.text, response.text
    assert observed[0]["document_id"] == document["document_id"]
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert c.get(path + "/revisions").json()["items"] == []


def test_read_returns_actual_same_genre_bounded_style_evidence(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "这是报告正文")
    same = post(c, "/samples", {"title": "实际报告", "genre": "report",
                                "text": "我们逐一核对了资料，也记下了观察的限制。" * 20}).json()
    post(c, "/samples", {"title": "不要使用小说", "genre": "fiction",
                         "text": "小说里的门开了，又缓缓关上。" * 20})
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, user_id, document)
        result = tools.read_writing_document()
        assert result["style_profile"]["sample_count"] == 1
        assert result["style_profile"]["readiness"] == "limited"
        assert [s["sample_id"] for s in result["reference_samples"]] == [same["sample_id"]]
        assert "不得声称已学会" in result["style_guidance"]
        assert all(len(sample["text"]) <= 1500 for sample in result["reference_samples"])


def test_real_runner_exposes_tools_and_only_replacement_becomes_revision(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "需修改的正文")
    runner = PydanticAIKnowledgeRunner(
        base_url="https://api.deepseek.com", api_key="local-test-key",
        model="deepseek-v4-flash", timeout_seconds=30,
    )
    seen = []

    async def model_stream(messages, info):
        seen.append({tool.name for tool in info.function_tools})
        if len(seen) == 1:
            assert "writing_workspace_policy" in str(messages)
            yield {0: DeltaToolCall(name="read_writing_document", json_args="{}",
                                   tool_call_id="read-current")}
        elif len(seen) == 2:
            yield {0: DeltaToolCall(name="propose_writing_edit", json_args=json.dumps({
                "expected_version": 1, "original_text": "需修改的正文",
                "replacement_text": "只有这里成为建议正文",
            }), tool_call_id="propose-change")}
        else:
            yield "聊天说明：等待用户接受，正文尚未修改。"

    events = []
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document)
        with runner._agent.override(model=FunctionModel(stream_function=model_stream)):
            result = runner.run_stream(prompt="改写", conversation=(), tools=tools,
                                       on_delta=lambda _: None, on_tool_event=events.append)
    assert {"read_writing_document", "propose_writing_edit"} <= seen[0]
    assert "propose_document_revision" not in seen[0]
    assert [(event.tool, event.phase) for event in events] == [
        ("read_writing_document", "started"), ("read_writing_document", "finished"),
        ("propose_writing_edit", "started"), ("propose_writing_edit", "finished"),
    ]
    assert events[-1].output["after_markdown"] == "只有这里成为建议正文"
    assert "等待用户" in result.answer
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert c.get(path + "/revisions").json()["items"][0]["after_markdown"] == "只有这里成为建议正文"


@pytest.mark.parametrize("envelope", [
    "<system>runtime instructions</system>", WRITING_INSTRUCTIONS.splitlines()[3],
])
def test_runtime_envelopes_cannot_become_direct_or_pipeline_drafts(plain_client, envelope):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document)
        tools.read_writing_document()
        with pytest.raises(WritingUnsafeOutput):
            tools.propose_writing_edit(expected_version=1, original_text="原文",
                                       replacement_text=envelope)
    pipeline(c, ["写作计划", envelope, envelope])
    assert proposal(c, document).status_code == 422
    path = f"/api/writing/documents/{document['document_id']}/revisions"
    assert c.get(path).json()["items"] == []
    assert not instruction_artifacts("", "The system needs a clear interface. 系统运行正常。")
    assert not instruction_artifacts(envelope, envelope + "说明")
    prompt = _compose_agent_prompt(prompt="只聊天", writing_context=context(document))
    assert "只聊天" in prompt and "不得自动变成正文" in prompt
