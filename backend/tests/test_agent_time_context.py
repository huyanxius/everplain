from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from qunxue_api.adapters.research_agent import time_context
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner


@pytest.mark.parametrize("agent_name", ["_agent", "_planner_agent"])
def test_time_refreshes_across_midnight_with_history(monkeypatch, agent_name):
    now = datetime(2026, 10, 4, 23, 59, 59, tzinfo=UTC)

    class Clock:
        @staticmethod
        def now(tz):
            assert tz is UTC
            return now

    monkeypatch.setattr(time_context, "datetime", Clock)
    runner = PydanticAIKnowledgeRunner(
        base_url="https://model.example.test/v1",
        api_key="test-key",
        model="test-model",
        timeout_seconds=10,
    )
    seen = []

    def model(messages, info):
        seen.append(info.instructions)
        if info.output_tools:
            return ModelResponse(parts=[ToolCallPart(
                info.output_tools[0].name,
                {"request_type": "conversation", "title": "时间"},
            )])
        return ModelResponse(parts=[TextPart("UTC 时间参考")])

    agent = getattr(runner, agent_name)
    with agent.override(model=FunctionModel(model)):
        first = agent.run_sync("几点了？", deps=SimpleNamespace())
        now = datetime(2026, 10, 5, 0, 0, 1, tzinfo=UTC)
        agent.run_sync("现在呢？", deps=SimpleNamespace(), message_history=first.all_messages())

    assert len(seen) == 2  # No extra model request for time awareness.
    assert "2026-10-04T23:59:59+00:00" in seen[0]
    assert "2026-10-05T00:00:01+00:00" in seen[1]
    assert "2026-10-04T23:59:59+00:00" not in seen[1]
    assert seen[0].split("当前服务器时间：")[0] == seen[1].split("当前服务器时间：")[0]
    assert all(text.count("当前服务器时间：") == 1 for text in seen)
    assert all("UTC" in text and "不代表用户本地时区" in text for text in seen)
    assert all("近期事实仍须检索核实" in text for text in seen)
