"""Fault-inject real Agent analysis repositories and result serialization."""

import json
from uuid import UUID

import pytest
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from sqlalchemy import select, update
from test_research_material_api import _authenticate, _task

from qunxue_api.adapters.research_agent import document_tools
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner
from qunxue_api.adapters.research_agent.tool_runtime import AgentToolCommitFailure
from qunxue_api.adapters.sqlite import AgentRunRow
from qunxue_api.adapters.sqlite.research_analysis_model import (
    ResearchAnalysisWriteRequestRow,
    ResearchMemoRow,
)
from qunxue_api.modules.agent_conversation import AgentInterrupted


@pytest.mark.parametrize("failure_stage", ["after_reservation", "after_candidate_flush"])
def test_real_analysis_failure_keeps_prior_candidate_and_output_only(
    plain_client, monkeypatch, failure_stage,
):
    client = plain_client
    user_id = UUID(_authenticate(client)["user"]["user_id"])
    task_id = UUID(_task(client))
    calls, body, events = 0, [], []

    async def model_stream(messages, info):
        nonlocal calls
        calls += 1
        if calls <= 2:
            assert "propose_analysis_memo" in [tool.name for tool in info.function_tools]
            if calls == 1:
                yield "已保存的合成正文。"
            yield {0: DeltaToolCall(
                name="propose_analysis_memo", tool_call_id=f"candidate-{calls}",
                json_args=json.dumps({
                    "title": "first-success" if calls == 1 else "second-failure",
                    "content": "A synthetic candidate awaiting user review.",
                    "memo_kind": "analytic", "annotation_ids": [],
                }),
            )}
        else:
            raise ConnectionError("synthetic model disconnection")

    runner = PydanticAIKnowledgeRunner(base_url="http://model.invalid", api_key=None,
                                     model="synthetic", timeout_seconds=5, model_api_mock=True)
    with client.app.state.disciplinary_agent_scope() as app:
        tools = app._tools_factory()
        original_add = tools._analysis._analysis.add_memo
        original_payload = document_tools._candidate_analysis_payload

        def fail_add(candidate):
            if candidate.title == "second-failure" and failure_stage == "after_reservation":
                raise RuntimeError("synthetic storage failure after reserved write")
            return original_add(candidate)

        def fail_payload(candidate):
            if candidate.title == "second-failure" and failure_stage == "after_candidate_flush":
                raise RuntimeError("synthetic serialization failure after candidate write")
            return original_payload(candidate)

        monkeypatch.setattr(tools._analysis._analysis, "add_memo", fail_add)
        monkeypatch.setattr(document_tools, "_candidate_analysis_payload", fail_payload)
        app._tools_factory = lambda: tools
        app._runner = runner
        with (
            runner._agent.override(model=FunctionModel(stream_function=model_stream)),
            pytest.raises(ConnectionError, match="synthetic model disconnection"),
        ):
            app.run_turn(user_id=user_id, conversation_id=None, task_id=task_id,
                         workspace="research", prompt="继续", idempotency_key="transaction-probe",
                         on_delta=body.append, on_tool_event=events.append)
        run = app.find_run(user_id=user_id, idempotency_key="transaction-probe")
        assert run.status == "failed"
        assert run.partial_answer == "已保存的合成正文。"
        assert "".join(body) == run.partial_answer
    with client.app.state.database.session() as session:
        memos = list(session.scalars(select(ResearchMemoRow)))
        receipts = list(session.scalars(select(ResearchAnalysisWriteRequestRow)))
        assert [memo.title for memo in memos] == ["first-success"]
        assert len(receipts) == 1
        assert memos[0].tool_call_id == "candidate-1"
        assert receipts[0].result_id == memos[0].memo_id
    assert [event.phase for event in events if event.tool == "propose_analysis_memo"] == [
        "started", "finished", "started", "failed",
    ]


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("failure_stage", [
    "returned_error", "after_reservation", "after_serialization", "command_commit",
    "lease_replaced", "cancelled",
])
def test_completed_command_owner_preserves_prior_result_without_stream_callbacks(
    plain_client, monkeypatch, streaming, failure_stage,
):
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart

    client = plain_client
    user_id = UUID(_authenticate(client)["user"]["user_id"])
    task_id = UUID(_task(client))
    number = 0
    events = []

    def response(messages, info):
        nonlocal number
        number += 1
        if number > 2:
            return ModelResponse(parts=[TextPart("Completed after the rejected command.")])
        return ModelResponse(parts=[ToolCallPart(
            tool_name="propose_analysis_memo", tool_call_id=f"owner-call-{number}",
            args={"title": "prior-success" if number == 1 else "failing-next",
                  "content": "Synthetic command owner regression.",
                  "memo_kind": "analytic", "annotation_ids": []},
        )])

    async def response_stream(messages, info):
        item = response(messages, info).parts[0]
        if isinstance(item, ToolCallPart):
            yield {0: DeltaToolCall(name=item.tool_name, tool_call_id=item.tool_call_id,
                                   json_args=json.dumps(item.args))}
        else:
            yield item.content

    runner = PydanticAIKnowledgeRunner(base_url="http://model.invalid", api_key=None,
                                     model="synthetic", timeout_seconds=5, model_api_mock=True)
    with client.app.state.disciplinary_agent_scope() as app:
        tools = app._tools_factory()
        add = tools._analysis._analysis.add_memo
        serialize = document_tools._candidate_analysis_payload
        propose = tools.propose_analysis_memo
        bind_completion = tools.bind_tool_command_completion
        commit_calls = 0

        def fail_add(candidate):
            if candidate.title == "failing-next" and failure_stage == "after_reservation":
                raise ValueError("injected after reservation")
            return add(candidate)

        def fail_serialize(candidate):
            if candidate.title == "failing-next" and failure_stage == "after_serialization":
                raise ValueError("injected after serialization")
            return serialize(candidate)

        def returned_error(**payload):
            if (payload["title"] == "failing-next"
                    and failure_stage in {"lease_replaced", "cancelled"}):
                with client.app.state.database.session() as other:
                    values = ({"lease_token": "replacement-lease"}
                              if failure_stage == "lease_replaced"
                              else {"cancel_requested": True})
                    other.execute(update(AgentRunRow).where(
                        AgentRunRow.run_id == str(tools._agent_run_id),
                    ).values(**values))
            result = propose(**payload)
            if payload["title"] == "failing-next" and failure_stage == "returned_error":
                return {"error": "injected", "message": "Rejected after preparing the candidate."}
            return result

        def bind_faulty_completion(complete):
            def fail_commit():
                nonlocal commit_calls
                commit_calls += 1
                if commit_calls == 2 and failure_stage == "command_commit":
                    raise RuntimeError("injected command commit failure")
                return complete()
            bind_completion(fail_commit)

        monkeypatch.setattr(tools._analysis._analysis, "add_memo", fail_add)
        monkeypatch.setattr(document_tools, "_candidate_analysis_payload", fail_serialize)
        monkeypatch.setattr(tools, "propose_analysis_memo", returned_error)
        monkeypatch.setattr(tools, "bind_tool_command_completion", bind_faulty_completion)
        app._tools_factory = lambda: tools
        app._runner = runner
        model = (FunctionModel(stream_function=response_stream) if streaming
                 else FunctionModel(function=response))
        aborts = failure_stage in {"command_commit", "lease_replaced", "cancelled"}
        from contextlib import nullcontext
        expected = (AgentToolCommitFailure if failure_stage == "command_commit"
                    else AgentInterrupted)
        with (
            runner._agent.override(model=model),
            pytest.raises(expected) if aborts else nullcontext(),
        ):
            result = app.run_turn(
                user_id=user_id, conversation_id=None, task_id=task_id,
                workspace="research", prompt="继续", idempotency_key="command-owner",
                on_delta=(lambda _: None) if streaming else None,
                on_tool_event=events.append,
            )
        if aborts:
            assert number == 2, "unacknowledged command completion must not run another model step"
        else:
            assert result.result.answer == "Completed after the rejected command."
    with client.app.state.database.session() as session:
        memos = list(session.scalars(select(ResearchMemoRow)))
        receipts = list(session.scalars(select(ResearchAnalysisWriteRequestRow)))
        assert [memo.title for memo in memos] == ["prior-success"]
        assert [memo.tool_call_id for memo in memos] == ["owner-call-1"]
        assert len(receipts) == 1 and receipts[0].result_id == memos[0].memo_id
    if streaming:
        expected_phases = ["started", "finished", "started"] + ([] if aborts else ["failed"])
        assert [event.phase for event in events if event.tool == "propose_analysis_memo"] == (
            expected_phases
        )
