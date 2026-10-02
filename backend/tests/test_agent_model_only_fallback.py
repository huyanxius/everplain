from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic_ai import Agent

from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner
from qunxue_api.adapters.research_agent.unconfigured_model import (
    MODEL_API_MOCK_NAME,
    MODEL_API_MOCK_RESPONSE,
)


def _runner(*, model_api_mock: bool) -> PydanticAIKnowledgeRunner:
    return PydanticAIKnowledgeRunner(
        base_url="https://model.example.test/v1",
        api_key=None,
        model="configured-model",
        timeout_seconds=10,
        model_api_mock=model_api_mock,
    )


def _tools() -> SimpleNamespace:
    return SimpleNamespace(
        release=SimpleNamespace(knowledge_release_id="personal-test"),
        evidence={},
        selected_evidence_ids=(),
        research_map_enabled=False,
        web_search_enabled=True,
        memory=SimpleNamespace(
            context="",
            can_write=True,
            change=Mock(side_effect=AssertionError("fallback must not change memory")),
        ),
    )


@pytest.mark.parametrize("stream", [False, True])
def test_model_only_fallback_runs_real_agent_without_provider_or_tool_mutation(
    monkeypatch, stream
):
    client = Mock(side_effect=AssertionError("fallback must not create a model client"))
    monkeypatch.setattr(pydantic_runner, "AsyncOpenAI", client)
    runner = _runner(model_api_mock=True)
    assert isinstance(runner._agent, Agent)
    assert {"change_memory", "search_knowledge", "update_research_map"} <= set(
        runner._agent._function_toolset.tools
    )
    run = Mock(wraps=runner._agent.run_sync)
    monkeypatch.setattr(runner._agent, "run_sync", run)
    tools = _tools()
    deltas = []
    kwargs = {"prompt": "请研究本周新闻并记住结论", "conversation": (), "tools": tools}
    if stream:
        result = runner.run_stream(**kwargs, on_delta=deltas.append)
        assert "".join(deltas) == MODEL_API_MOCK_RESPONSE
    else:
        result = runner.run(**kwargs)
    run.assert_called_once()
    client.assert_not_called()
    tools.memory.change.assert_not_called()
    assert result.answer == MODEL_API_MOCK_RESPONSE
    assert result.citations == ()
    assert result.provider == runner.runtime_identity.provider == "pydantic-ai"
    assert result.model == runner.runtime_identity.model == MODEL_API_MOCK_NAME


def test_model_only_fallback_uses_real_planner_without_fabricating_a_research_plan(monkeypatch):
    client = Mock(side_effect=AssertionError("fallback must not create a model client"))
    monkeypatch.setattr(pydantic_runner, "AsyncOpenAI", client)
    runner = _runner(model_api_mock=True)
    plan = Mock(wraps=runner._planner_agent.run)
    monkeypatch.setattr(runner._planner_agent, "run", plan)
    events, titles = [], []
    runner.prepare_research(
        prompt="研究本周新闻",
        conversation=(),
        tools=_tools(),
        on_event=events.append,
        on_title=titles.append,
    )
    plan.assert_called_once()
    assert events == titles == []
    client.assert_not_called()


def test_model_only_fallback_requires_explicit_selection(monkeypatch):
    client = Mock(side_effect=RuntimeError("real model selected"))
    monkeypatch.setattr(pydantic_runner, "AsyncOpenAI", client)
    with pytest.raises(RuntimeError, match="real model selected"):
        _runner(model_api_mock=False)
    client.assert_called_once()
