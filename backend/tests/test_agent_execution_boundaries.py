"""Frozen SDK contracts plus real SQLite failure/dispatch boundaries (no provider calls)."""

import asyncio
import dataclasses
import hashlib
import json
import threading
import time
from contextlib import suppress
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic_ai import ModelRetry, PartDeltaEvent, PartStartEvent
from pydantic_ai.messages import TextPart, TextPartDelta, ToolCallPart, ToolCallPartDelta
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.adapters.research_agent.stream_events import AgentEventBridge, VisibleTextStream
from qunxue_api.application.agent_research_workflow import AgentResearchWorkflow
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import (
    AgentInterrupted,
    AgentToolEvent,
    ConversationService,
)

BASE_TREE = "74922f53bec25d68b54581e851f1b513bc4903ad"
PAYLOADS = {
    "search_conversations": {"query": "合成历史"},
    "read_conversation": {"conversation_id": "owned-conversation"},
    "search_memory": {"query": "合成偏好"},
    "change_memory": {"action": "remember", "scope": "user", "key": "tone", "content": "简洁"},
    "search_knowledge": {"query": "合成来源"},
    "search_web": {"query": "synthetic evidence"},
    "read_web_page": {"url": "https://example.com/synthetic"},
    "search_research_materials": {"query": "合成材料"},
    "read_research_material_context": {"material_id": "owned-material"},
    "get_research_analysis": {},
    "propose_analysis_memo": {"title": "候选", "content": "合成内容", "memo_kind": "analytic",
                              "annotation_ids": []},
    "get_research_comparison_context": {"case_labels": ["A", "B"], "time_labels": []},
    "propose_case_comparison": {"title": "比较", "question": "差异", "case_labels": ["A", "B"],
                                "time_labels": [], "findings": [], "competing_explanations": [],
                                "evidence_gaps": [], "next_steps": [],
                                "theory_implication": "待核验"},
    "read_knowledge_entry": {"knowledge_id": "owned-knowledge"},
    "read_sources": {"source_ids": []},
    "browse_knowledge_directory": {},
    "propose_start_research": {"phenomenon": "合成研究对象"},
    "get_research_workflow_state": {},
    "start_theory_matching": {},
    "save_confirmed_theory_plan": {"decisions": [], "use_assignments": [], "relations": [],
                                   "user_confirmed": True},
    "read_writing_document": {},
    "propose_writing_edit": {"expected_version": 1, "original_text": "旧",
                             "replacement_text": "新"},
    "read_research_document": {"document_id": "owned-document"},
    "propose_document_revision": {"replacement_content": "新段落", "rationale": "合成理由"},
    "propose_document_creation": {"title": "合成文稿", "sections": [], "rationale": "合成理由"},
    "ask_research_question": {"question": "请选择范围", "options": ["A", "B"]},
    "update_research_map": {},
}
SHARED_TOOLS = tuple(name for name in PAYLOADS if name not in {
    "search_conversations", "read_conversation", "search_memory", "change_memory",
    "search_web", "read_web_page", "ask_research_question",
})
FEATURES = (
    "catalog_available", "research_map_enabled", "research_handoff_tools_enabled",
    "writing_tools_enabled", "research_document_tools_enabled", "web_search_enabled",
    "web_read_enabled", "research_material_tools_enabled", "research_analysis_tools_enabled",
)


def runner():
    return pydantic_runner.PydanticAIKnowledgeRunner(
        base_url="http://model.invalid", api_key=None, model="frozen", timeout_seconds=5,
        model_api_mock=True,
    )


def fake_tools():
    lists = {"search_knowledge", "search_web", "search_research_materials", "read_sources",
             "browse_knowledge_directory"}
    tools = SimpleNamespace(
        release=SimpleNamespace(knowledge_release_id="synthetic-release"), evidence={},
        selected_evidence_ids=(), private_knowledge=None, agent_run_checkpoint={},
        **dict.fromkeys(FEATURES, True),
    )
    for name in PAYLOADS:
        result = [] if name in lists else {"status": "candidate"}
        if name == "read_writing_document":
            result = {"document_id": "owned-document", "version": 1}
        if name == "propose_writing_edit":
            result = {"revision_id": "revision-1", "status": "pending"}
        setattr(tools, name, lambda *args, _result=result, **kwargs: _result)
    tools.memory = SimpleNamespace(
        context="synthetic", can_write=True, search=lambda query: {"items": []},
        change=lambda **kwargs: {"saved": True},
        conversations=SimpleNamespace(enabled=True, context="synthetic history",
                                      search=lambda *args: {"items": []},
                                      read=lambda *args: {"messages": []}),
    )
    return tools


def schema_contract(value):
    toolset = value._agent._function_toolset.tools
    masks = []
    for bits in range(1 << len(FEATURES)):
        tools = fake_tools()
        for i, name in enumerate(FEATURES):
            setattr(tools, name, bool(bits & (1 << i)))
        enabled = [
            tool.prepare is None or tool.prepare(SimpleNamespace(deps=tools), tool.tool_def)
            is not None for tool in toolset.values()
        ]
        masks.append(sum(1 << i for i, present in enumerate(enabled) if present))
    return {
        "tools": [{"definition": dataclasses.asdict(tool.tool_def), "retries": tool.max_retries}
                  for tool in toolset.values()],
        "availability_masks": masks,
        "instructions_sha256": hashlib.sha256(json.dumps(
            value._writing_instruction_rules, ensure_ascii=False,
        ).encode()).hexdigest(),
        "limits": [dataclasses.asdict(value._usage_limits),
                   dataclasses.asdict(value._deep_research_usage_limits)],
    }


def test_frozen_tool_contract_limits_and_all_512_capability_sets():
    frozen = json.loads((Path(__file__).parent / "fixtures/agent-runner-contract.json").read_text())
    actual = schema_contract(runner())
    assert frozen.pop("base_tree") == BASE_TREE
    for entry in frozen["tools"]:
        definition = entry["definition"]
        definition["sequential"] = definition["name"] not in {"search_web", "read_web_page"}
        if definition["name"] == "save_confirmed_theory_plan":
            definition["description"] = (
                "读取已有正式理论方案；模型声明不能代替真实用户审批。"
            )
    assert actual == frozen


@pytest.mark.parametrize("tool_name", PAYLOADS)
def test_all_registered_tool_results_and_traces_match_frozen_samples(tool_name):
    frozen = json.loads((Path(__file__).parent / "fixtures/agent-tool-samples.json").read_text())
    expected = frozen[tool_name]
    if tool_name == "save_confirmed_theory_plan":
        expected["events"][0]["detail"] = "正在核对已确认理论方案"
    value, events, tools = runner(), [], fake_tools()
    ctx = SimpleNamespace(deps=tools, tool_call_id="frozen-call", run_id=UUID(int=1), run_step=2)
    with value._tool_runtime.activate(on_tool_event=events.append, is_cancelled=None,
                                      writing_preview=None):
        result = asyncio.run(value._agent._function_toolset.tools[tool_name].function_schema.call(
            PAYLOADS[tool_name], ctx,
        ))
    assert {"result": result, "events": [dataclasses.asdict(event) for event in events]} == expected


@pytest.mark.parametrize("tool_name", SHARED_TOOLS)
@pytest.mark.parametrize("failure", ["returned_error", "exception"])
def test_every_shared_registry_invocation_rolls_back_before_terminal_event(
    tmp_path, tool_name, failure,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'tool.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE effects (body TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO effects VALUES ('previous-success')"))
    with Session(engine) as session:
        tools = fake_tools()
        tools.rollback_failed_tool = session.rollback

        def incomplete(*args, **kwargs):
            session.execute(text("INSERT INTO effects VALUES ('half-write')"))
            if failure == "exception":
                raise ValueError("injected after first write")
            return {"error": "injected_failure", "message": "合成失败"}

        setattr(tools, tool_name, incomplete)
        value = runner()
        events = []

        def checkpoint(event):
            events.append(event)
            # Production commits at safe start/terminal event boundaries.
            session.commit()

        ctx = SimpleNamespace(deps=tools, tool_call_id="sdk-call-7", run_id=UUID(int=1), run_step=2)
        # Read wrappers may reject an unexpected error-shaped fake result;
        # the write must already have been rolled back even in that path.
        with (
            value._tool_runtime.activate(
                on_tool_event=checkpoint, is_cancelled=None, writing_preview=None,
            ),
            suppress(ValueError, TypeError, AttributeError, KeyError, ModelRetry),
        ):
            asyncio.run(value._agent._function_toolset.tools[tool_name].function_schema.call(
                PAYLOADS[tool_name], ctx,
            ))
        session.commit()
        assert session.scalars(text("SELECT body FROM effects")).all() == ["previous-success"]
        assert events[0].phase == "started"
    engine.dispose()


@pytest.mark.parametrize("names", [
    ("read_research_material_context", "get_research_analysis", "read_research_document"),
    ("propose_analysis_memo", "propose_case_comparison", "propose_document_creation"),
])
def test_real_sdk_mixed_session_tools_are_serial(tmp_path, names):
    _dispatch_overlap(tmp_path, names, expected=1)


def test_real_sdk_web_only_batch_remains_parallel(tmp_path):
    _dispatch_overlap(tmp_path, ("search_web", "read_web_page"), expected=2)


@pytest.mark.parametrize("failure", ["returned_error", "exception"])
def test_application_checkpoint_cannot_commit_failed_tool_or_erase_delivered_body(
    tmp_path, failure,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'checkpoint.db'}",
                           connect_args={"check_same_thread": False})
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE effects (body TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO effects VALUES ('previous-success')"))
    tools = fake_tools()
    events, body = [], []
    with Session(engine) as session:
        tools.rollback_failed_tool = session.rollback

        def incomplete(**kwargs):
            session.execute(text("INSERT INTO effects VALUES ('half-write')"))
            if failure == "exception":
                raise ValueError("injected after first write")
            return {"error": "injected_failure", "message": "合成失败"}

        tools.propose_analysis_memo = incomplete
        calls = 0

        async def stream(messages, info):
            nonlocal calls
            calls += 1
            if calls == 1:
                yield "已经交付的正文。"
                yield {0: DeltaToolCall(name="propose_analysis_memo",
                                       json_args=json.dumps(PAYLOADS["propose_analysis_memo"]),
                                       tool_call_id="same-attempt-call-1")}
            else:
                raise ConnectionError("synthetic network failure after tool")

        value = runner()
        conversations = ConversationService.in_memory()
        conversations._repository.commit = session.commit
        app = DisciplinaryAgentApplication(
            conversations=conversations, runner=value, tools_factory=lambda: tools,
            rollback=session.rollback,
        )
        with (
            value._agent.override(model=FunctionModel(stream_function=stream)),
            pytest.raises(ConnectionError, match="synthetic network failure"),
        ):
            app.run_turn(user_id=UUID(int=1), conversation_id=None, prompt="继续",
                         idempotency_key="same-request", on_delta=body.append,
                         on_tool_event=events.append)
        run = app.find_run(user_id=UUID(int=1), idempotency_key="same-request")
        assert run.status == "failed"
        assert run.partial_answer == "已经交付的正文。"
        assert "".join(body) == run.partial_answer
        assert any(event.phase == "failed" for event in events)
        assert session.scalars(text("SELECT body FROM effects")).all() == ["previous-success"]
    engine.dispose()


def _dispatch_overlap(tmp_path, names, *, expected):
    engine = create_engine(f"sqlite:///{tmp_path / 'dispatch.db'}",
                           connect_args={"check_same_thread": False})
    tools = fake_tools()
    lock = threading.Lock()
    active = maximum = 0
    calls = []
    with Session(engine) as session:
        session.execute(text("SELECT 1"))
        for name in names:
            original = getattr(tools, name)

            def invoke(*args, _name=name, _original=original, **kwargs):
                nonlocal active, maximum
                with lock:
                    active += 1
                    maximum = max(maximum, active)
                    calls.append(_name)
                try:
                    time.sleep(0.05)
                    if expected == 1:
                        session.execute(text("SELECT 1"))
                    return _original(*args, **kwargs)
                finally:
                    with lock:
                        active -= 1

            setattr(tools, name, invoke)

        async def stream(messages, info):
            if not calls:
                yield {i: DeltaToolCall(name=name, json_args=json.dumps(PAYLOADS[name]),
                                       tool_call_id=f"step-1-call-{i}")
                       for i, name in enumerate(names)}
            else:
                yield "合成正文"

        value = runner()
        with value._agent.override(model=FunctionModel(stream_function=stream)):
            result = value.run_stream(prompt="继续", conversation=(), tools=tools,
                                      on_delta=lambda _: None)
        assert result.answer == "合成正文"
        assert calls == list(names)
        assert maximum == expected
    engine.dispose()


class PreviewRecorder:
    def __init__(self):
        self.calls = []

    def append(self, *args, **kwargs):
        self.calls.append(["append", list(args), kwargs])

    def invalidate(self, *args):
        self.calls.append(["invalidate", list(args)])


def event_scenarios():
    return [
        [PartStartEvent(index=0, part=TextPart(content="正文<think")),
         PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="ing>私有思考</thinking>末尾"))],
        [PartStartEvent(index=0, part=ToolCallPart(tool_name="propose_writing_edit",
                                                args='{"original_text":', tool_call_id="call-a")),
         PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta='"旧"}'))],
        [PartStartEvent(index=0, part=TextPart(content="新一步")),
         PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta="orphan"))],
        [PartStartEvent(index=0, part=ToolCallPart(tool_name="propose_writing_edit",
                                                args="{}", tool_call_id="")),
         PartDeltaEvent(index=0, delta=ToolCallPartDelta(tool_call_id="new-id"))],
    ]


def test_sdk_event_bridge_matches_frozen_body_preview_and_step_reset():
    frozen = json.loads((Path(__file__).parent / "fixtures/agent-stream-events.json").read_text())
    body, preview = [], PreviewRecorder()
    visible = VisibleTextStream(body.append)
    bridge = AgentEventBridge(visible_stream=visible, writing_preview=preview)

    async def consume():
        for scenario in event_scenarios():
            async def events(scenario=scenario):
                for event in scenario:
                    yield event
            await bridge.handle(None, events())
        visible.finish()

    asyncio.run(consume())
    assert {"body": body, "preview": preview.calls} == frozen


def test_stream_error_and_explicit_stop_preserve_received_body():
    for ending in (ConnectionError("offline"), AgentInterrupted("stop")):
        body = []
        visible = VisibleTextStream(body.append)
        bridge = AgentEventBridge(visible_stream=visible, writing_preview=PreviewRecorder())

        async def events(ending=ending):
            yield PartStartEvent(index=0, part=TextPart(content="已经收到的正文"))
            raise ending

        with pytest.raises(type(ending)):
            asyncio.run(bridge.handle(None, events()))
        visible.finish()
        assert "".join(body) == "已经收到的正文"


def test_cancelled_stream_never_delivers_another_event():
    body = []
    bridge = AgentEventBridge(visible_stream=VisibleTextStream(body.append),
                              writing_preview=PreviewRecorder(), is_cancelled=lambda: True)

    async def events():
        yield PartStartEvent(index=0, part=TextPart(content="不能交付"))

    with pytest.raises(AgentInterrupted):
        asyncio.run(bridge.handle(None, events()))
    assert body == []


def test_runtime_scope_resets_callbacks_and_candidate_ids_are_sdk_owned():
    value = runner()
    seen, events = [], []
    tools = fake_tools()
    tools.propose_analysis_memo = lambda **payload: seen.append(payload) or {"status": "candidate"}
    with value._tool_runtime.activate(on_tool_event=events.append, is_cancelled=None,
                                      writing_preview=None):
        for call_id, title in (("step-one", "A"), ("step-two", "B")):
            ctx = SimpleNamespace(deps=tools, tool_call_id=call_id)
            value._run_analysis_tool(ctx, "propose_analysis_memo", {"title": title},
                                     "候选", candidate=True)
    assert [item["tool_call_id"] for item in seen] == ["step-one", "step-two"]
    assert [event.call_id for event in events] == ["step-one"] * 2 + ["step-two"] * 2
    value._tool_runtime.emit(AgentToolEvent(tool="probe", phase="started", call_id="outside"))
    assert len(events) == 4


def test_unknown_provider_usage_remains_unknown_at_route_boundary():
    assert pydantic_runner._completion_usage(SimpleNamespace()) == (None, None)
    assert pydantic_runner._completion_usage(SimpleNamespace(usage=SimpleNamespace(
        input_tokens=17, output_tokens=None,
    ))) == (17, None)


@pytest.mark.parametrize("model_boolean", [False, True])
def test_model_boolean_cannot_authorize_formal_theory_decisions(model_boolean):
    called = []
    workflow = AgentResearchWorkflow(
        bindings=SimpleNamespace(get_research_task_id=lambda **kwargs: UUID(int=2)),
        tasks=SimpleNamespace(get=lambda *args, **kwargs: SimpleNamespace(
            task_id=UUID(int=2), current_theory_plan_id=None,
        )), task_repository=None, phenomena=None, research_start=None,
        matching=SimpleNamespace(record_decisions=lambda **kwargs: called.append(kwargs),
                                 confirm_plan=lambda **kwargs: called.append(kwargs)),
    )
    result = workflow.save_theory_plan(
        user_id=UUID(int=1), conversation_id=UUID(int=3), decisions=[{"action": "adopt"}],
        use_assignments=[], relations=[], user_confirmed=model_boolean,
    )
    assert result["error"] == "user_confirmation_required"
    assert called == []


def test_previously_confirmed_owned_plan_is_read_without_new_decision_write():
    plan = SimpleNamespace(task_id=UUID(int=2), theory_plan_id=UUID(int=4),
                           knowledge_release=SimpleNamespace(knowledge_release_id="frozen"))
    reads = []

    def owned_plan(**scope):
        reads.append(scope)
        return plan

    workflow = AgentResearchWorkflow(
        bindings=SimpleNamespace(get_research_task_id=lambda **kwargs: plan.task_id),
        tasks=SimpleNamespace(get=lambda *args, **kwargs: SimpleNamespace(
            task_id=plan.task_id, current_theory_plan_id=plan.theory_plan_id,
        )), task_repository=None, phenomena=None, research_start=None,
        matching=SimpleNamespace(get_confirmed_plan=owned_plan),
    )
    result = workflow.save_theory_plan(
        user_id=UUID(int=1), conversation_id=UUID(int=3), decisions=[],
        use_assignments=[], relations=[], user_confirmed=True,
    )
    assert result["status"] == "confirmed"
    assert result["theory_plan_id"] == str(plan.theory_plan_id)
    assert all(scope == {"user_id": UUID(int=1), "theory_plan_id": plan.theory_plan_id}
               for scope in reads)


def test_old_tool_receipt_cannot_replace_current_theory_authorization_check():
    tools = fake_tools()
    payload = PAYLOADS["save_confirmed_theory_plan"]
    tools.agent_run_checkpoint = {"tool_summary": [{
        "tool": "save_confirmed_theory_plan", "phase": "finished", "input": payload,
        "output": {"theory_plan_id": "stale-plan", "status": "confirmed"},
    }]}
    tools.save_confirmed_theory_plan = lambda **kwargs: {"error": "user_confirmation_required"}
    value = runner()
    ctx = SimpleNamespace(deps=tools, tool_call_id="new-attempt-call")
    result = asyncio.run(
        value._agent._function_toolset.tools["save_confirmed_theory_plan"].function_schema.call(
            payload, ctx,
        )
    )
    assert result == {"error": "user_confirmation_required"}


def test_only_explicit_business_commands_complete_shared_transaction():
    from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry

    class EmptyCatalog:
        def current_release(self, **kwargs):
            raise LookupError

    commits = []
    registry = KnowledgeToolRegistry(EmptyCatalog(), commit_tool=lambda: commits.append(True))
    completed = []
    for name in PAYLOADS:
        before = len(commits)
        registry.commit_completed_tool(name, {})
        if len(commits) != before:
            completed.append(name)
    assert completed == [
        "propose_analysis_memo", "propose_case_comparison", "start_theory_matching",
        "propose_document_revision", "propose_document_creation",
    ]
    with pytest.raises(TypeError, match="serialized result"):
        registry.commit_completed_tool("propose_analysis_memo", object())
    assert len(commits) == 5


@pytest.mark.parametrize("tool_name", SHARED_TOOLS)
@pytest.mark.parametrize("worker_error", [False, True])
def test_sdk_cancellation_drains_entire_shared_tool_callback(
    tool_name, worker_error,
):
    from test_writing_preview_cancellation import cancellation_checkpoint

    value, tools = runner(), fake_tools()
    release_worker = threading.Event()
    worker_done = threading.Event()
    trace = []
    correlation = {"agent_run_id": UUID(int=99)}

    async def scenario():
        loop = asyncio.get_running_loop()
        callback_entered = asyncio.Event()

        def terminal_callback(event):
            assert pydantic_runner._agent_route_correlation.get() == correlation
            if event.phase != "started":
                try:
                    trace.append("terminal_callback_entered")
                    loop.call_soon_threadsafe(callback_entered.set)
                    assert release_worker.wait(5), "test did not release the callback barrier"
                    if worker_error:
                        raise RuntimeError("synthetic receipt failure")
                finally:
                    trace.append("terminal_callback_returned")
                    worker_done.set()

        token = pydantic_runner._agent_route_correlation.set(correlation)
        try:
            with value._tool_runtime.activate(
                on_tool_event=terminal_callback, is_cancelled=None, writing_preview=None,
            ):
                task = asyncio.create_task(
                    value._agent._function_toolset.tools[tool_name].function_schema.call(
                        PAYLOADS[tool_name],
                        SimpleNamespace(deps=tools, tool_call_id="drain", run_id=UUID(int=1),
                                        run_step=2),
                    )
                )
                try:
                    await asyncio.wait_for(callback_entered.wait(), 5)
                    for _ in range(2):
                        task.cancel()
                        await cancellation_checkpoint()
                        assert not task.done(), "SDK tool outlived its cancelled awaiter"
                    assert not worker_done.is_set()
                finally:
                    release_worker.set()
                    assert await asyncio.to_thread(worker_done.wait, 5)
                    expected = RuntimeError if worker_error else asyncio.CancelledError
                    with pytest.raises(expected):
                        await task
                trace.append("sdk_call_returned")
        finally:
            pydantic_runner._agent_route_correlation.reset(token)

    asyncio.run(scenario())
    assert trace == ["terminal_callback_entered", "terminal_callback_returned", "sdk_call_returned"]


def test_cancel_before_thread_start_does_not_execute_queued_tool():
    from concurrent.futures import ThreadPoolExecutor

    value, tools = runner(), fake_tools()
    occupied, release = threading.Event(), threading.Event()
    calls = []
    tools.read_writing_document = lambda: calls.append("unexpected work")

    async def scenario():
        submitted = asyncio.Event()

        class ObservedExecutor(ThreadPoolExecutor):
            def submit(self, function, *args, **kwargs):
                result = super().submit(function, *args, **kwargs)
                if occupied.is_set():
                    submitted.set()
                return result

        def occupy():
            occupied.set()
            assert release.wait(5), "test did not release the executor"

        executor = ObservedExecutor(max_workers=1)
        executor.submit(occupy)
        assert occupied.wait(5)
        asyncio.get_running_loop().set_default_executor(executor)
        with value._tool_runtime.activate(
            on_tool_event=None, is_cancelled=None, writing_preview=None,
        ):
            task = asyncio.create_task(
                value._agent._function_toolset.tools["read_writing_document"].function_schema.call(
                    {}, SimpleNamespace(deps=tools, tool_call_id="queued"),
                )
            )
            try:
                # Ignore the holder's own submission if it started immediately.
                submitted.clear()
                await asyncio.wait_for(submitted.wait(), 5)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 5)
                assert value._tool_runtime.is_idle()
                assert not release.is_set()
            finally:
                release.set()

    asyncio.run(scenario())
    assert calls == []


def test_native_async_tool_retains_prompt_cancellation_and_finally():
    from pydantic_ai import RunContext

    value = runner()
    entered, exited = asyncio.Event(), []

    @value._tool_runtime.tool(value._agent)
    async def native_async(ctx: RunContext):
        try:
            entered.set()
            await asyncio.Event().wait()
        finally:
            exited.append("cleaned")

    async def scenario():
        task = asyncio.create_task(
            value._agent._function_toolset.tools["native_async"].function_schema.call(
                {}, SimpleNamespace(deps=None),
            )
        )
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 5)

    asyncio.run(scenario())
    assert exited == ["cleaned"]


def test_run_stream_stop_cancels_queued_tool_without_waiting_for_executor(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    value, tools = runner(), fake_tools()
    occupied, release, stop = threading.Event(), threading.Event(), threading.Event()
    calls, trace = [], []
    tools.read_writing_document = lambda: calls.append("unexpected work")
    loop = asyncio.new_event_loop()
    submitted = asyncio.Event()

    class ObservedExecutor(ThreadPoolExecutor):
        record = False

        def submit(self, function, *args, **kwargs):
            result = super().submit(function, *args, **kwargs)
            if self.record:
                trace.append("tool_queued")
                stop.set()
                loop.call_soon_threadsafe(submitted.set)
            return result

    def occupy():
        occupied.set()
        assert release.wait(5), "test did not release the executor"

    executor = ObservedExecutor(max_workers=1)
    executor.submit(occupy)
    assert occupied.wait(5)
    executor.record = True
    loop.set_default_executor(executor)
    monkeypatch.setattr(pydantic_runner._worker_event_loop, "loop", loop, raising=False)
    asyncio.set_event_loop(loop)

    async def monitor_tick(_delay):
        await asyncio.wait_for(submitted.wait(), 5)

    async def stream(messages, info):
        yield {0: DeltaToolCall(
            name="read_writing_document", json_args="{}", tool_call_id="queued-stop",
        )}

    monkeypatch.setattr(pydantic_runner, "async_sleep", monitor_tick)
    try:
        with (
            value._agent.override(model=FunctionModel(stream_function=stream)),
            pytest.raises(AgentInterrupted),
        ):
            value.run_stream(
                prompt="继续", conversation=(), tools=tools, on_delta=lambda _: None,
                is_cancelled=stop.is_set,
            )
        trace.append("runner_returned_before_executor_release")
        assert not release.is_set()
    finally:
        release.set()
        loop.run_until_complete(loop.shutdown_default_executor())
        loop.close()
        asyncio.set_event_loop(None)
    assert calls == []
    assert trace == ["tool_queued", "runner_returned_before_executor_release"]
