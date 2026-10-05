"""Offline real-SDK search -> tool result -> page read -> final reply regression."""

# ruff: noqa: F811
import json
import sys
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model import (
    InMemoryModelAttemptRecorder,
    ModelEndpoint,
    ModelRouteExecutor,
)
from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.adapters.research_agent.web_research import OpenWebResearchClient
from qunxue_api.modules.billing.pricing import PriceBook, TavilyPrice
from qunxue_api.settings import AgentModelCapacitySettings


class EmptyCatalog:
    def current_release(self, **kwargs):
        raise LookupError


def stream_response(output, number):
    body = {
        "id": f"resp_synthetic_{number}",
        "object": "response",
        "created_at": 1,
        "model": "gpt-6-luna",
        "status": "completed",
        "output": output,
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 100,
            "total_tokens": 1100,
            "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 0},
        },
    }
    initial = {**body, "output": [], "usage": None, "status": "in_progress"}
    events = [{"type": "response.created", "response": initial}]
    for index, item in enumerate(output):
        if item["type"] == "function_call":
            events.append(
                {"type": "response.output_item.added", "output_index": index, "item": item}
            )
        else:
            events.append(
                {
                    "type": "response.output_text.delta",
                    "item_id": item["id"],
                    "output_index": index,
                    "content_index": 0,
                    "delta": item["content"][0]["text"],
                }
            )
    events.append({"type": "response.completed", "response": body})
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content="".join(
            "data: " + json.dumps({**event, "sequence_number": index}) + "\n\n"
            for index, event in enumerate(events)
        ),
    )


def tool_call(name, arguments, index):
    return {
        "type": "function_call",
        "id": f"fc_{index}",
        "call_id": f"call_{index}",
        "name": name,
        "arguments": json.dumps(arguments),
        "status": "completed",
    }


@pytest.mark.parametrize("content_language", ["english", "chinese"])
def test_full_search_read_reply_with_large_provider_results(wallet, monkeypatch, content_language):
    runtime, engine = wallet
    runtime.max_attempt_pico = 20_000_000_000  # $0.02, deployed guard unchanged
    runtime.max_operation_pico = 100_000_000_000  # $0.10
    runtime.book = PriceBook(
        credits_per_usd=None, version="synthetic-search",
        points_per_cny=100, retail_rate_ppm=100000, fx_cny_per_usd_micro=6735100,
        fx_snapshot_id="synthetic", fx_as_of="2026-10-04T00:00:00+00:00", fx_source="synthetic",
        tavily_price=TavilyPrice(8000, 100000, "synthetic"),
    )
    calls, queries, events, deltas = [], [], [], []
    raw_content = (
        "完整网页正文和导航内容。"
        if content_language == "chinese"
        else "Full article content including navigation. "
    ) * 4000

    class Tavily:
        def __init__(self, **kwargs):
            pass

        def search(self, query, **kwargs):
            queries.append((query, kwargs))
            return {
                "request_id": f"synthetic-search-{len(queries)}",
                "usage": {"credits": 1},
                "results": [
                    {
                        "title": f"Source {index}",
                        "url": f"https://example.org/{query}/{index}",
                        "content": (
                            "真实搜索摘要，不是网页全文。"
                            if content_language == "chinese"
                            else "Relevant concise search extract. "
                        )
                        * 200,
                        "raw_content": raw_content,
                    }
                    for index in range(5)
                ]
            }

    monkeypatch.setitem(sys.modules, "tavily", SimpleNamespace(TavilyClient=Tavily))
    url = "https://example.org/travel/0"

    def reply(request):
        payload = json.loads(request.content)
        assert payload["stream"] is True
        assert payload["reasoning"]["effort"] == "none"
        calls.append(payload)
        if len(calls) == 1:
            output = [
                tool_call("search_web", {"query": q, "limit": 5}, index)
                for index, q in enumerate(["travel", "wellbeing", "identity"])
            ]
        elif len(calls) == 2:
            output = [tool_call("read_web_page", {"url": url}, 3)]
        else:
            output = [
                {
                    "type": "message",
                    "id": "msg_final",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Travel can support wellbeing, with limits to the evidence.",
                            "annotations": [],
                        }
                    ],
                }
            ]
        return stream_response(output, len(calls))

    http = httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False)
    monkeypatch.setattr(
        pydantic_runner, "AsyncOpenAI", lambda **kwargs: AsyncOpenAI(**kwargs, http_client=http)
    )
    recorder = InMemoryModelAttemptRecorder()
    runner = pydantic_runner.PydanticAIKnowledgeRunner(
        base_url="https://synthetic.test/v1",
        api_key="synthetic",
        model="gpt-6-luna",
        protocol="responses",
        reasoning_effort="none",
        timeout_seconds=10,
        require_billing=True,
        model_capacities={
            "https://synthetic.test/v1|responses|gpt-6-luna": AgentModelCapacitySettings(
                context_window_tokens=100000, max_output_tokens=2400,
                output_token_parameter="max_output_tokens",
                source="synthetic test provider contract",
            ),
        },
        route_executor=ModelRouteExecutor(
            endpoints=(
                ModelEndpoint("primary", "https://synthetic.test/v1", "gpt-6-luna", None, 10),
            ),
            recorder=recorder,
            max_input_tokens=32000,
            max_output_tokens=2400,
            max_retries=0,
        ),
    )
    web = OpenWebResearchClient(
        search_api_key="synthetic",
        fetch=lambda _: "<html>synthetic</html>",
        extract=lambda _: "Read evidence about travel and wellbeing. " * 40,
        extract_title=lambda _: "Read source",
    )
    tools = KnowledgeToolRegistry(EmptyCatalog(), web_research=web)
    tools.enable_web_search()
    tools.enable_deep_research()
    with OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="pipeline") as op:
        result = runner.run_stream(
            prompt="Research travel and wellbeing",
            conversation=(),
            tools=tools,
            on_delta=deltas.append,
            on_tool_event=events.append,
            is_cancelled=lambda: False,
        )
        op.finish("success")
    assert result.answer == "".join(deltas)
    assert "Travel can support wellbeing" in result.answer
    assert len(queries) == 3
    assert len(calls) == 3
    outputs = [item for item in calls[1]["input"] if item.get("type") == "function_call_output"]
    assert len(outputs) == 3
    assert {item["call_id"] for item in outputs} == {"call_0", "call_1", "call_2"}
    assert all(len(json.loads(item["output"])) == 5 for item in outputs)
    assert all("raw_content" not in item["output"] for item in outputs)
    assert any(event.tool == "read_web_page" and event.phase == "finished" for event in events)
    assert tools.evidence[f"web:{url}"].excerpt.startswith("Read evidence")
    assert len(recorder.list_all()) == 3
    with engine.connect() as conn:
        assert (
            conn.scalar(text("SELECT count(*) FROM billing_attempts WHERE outcome='success'")) == 6
        )
        assert conn.scalar(text("SELECT count(*) FROM billing_attempts "
                                "WHERE api_type='tavily_search' AND billable=1")) == 3
        assert conn.scalar(text("SELECT status FROM billing_operations")) == "success"


def test_responses_input_estimate_counts_tokens_not_utf8_bytes():
    payload = json.dumps(
        {"instructions": "Synthetic", "input": "中文研究证据。" * 2000}, ensure_ascii=False
    )
    assert len(payload.encode()) > 32000
    assert pydantic_runner._responses_input_token_estimate(payload) < 32000
    assert pydantic_runner._responses_input_token_estimate(" token" * 40000) > 32000
    # Untrusted page text containing tokenizer sentinel strings stays ordinary text.
    assert pydantic_runner._responses_input_token_estimate("<|endoftext|>") > 4096
