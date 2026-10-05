"""Model capacities must come from the actual route, never a global small cap."""

import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.adapters.research_agent.model_capacity import (
    model_capacity_key,
    resolve_agent_model_capacity,
)
from qunxue_api.adapters.research_agent.pydantic_runner import (
    PydanticAIKnowledgeRunner,
    _RetryingOpenAIChatModel,
    _RetryingOpenAIResponsesModel,
)
from qunxue_api.settings import AgentModelCapacitySettings, Settings

QINIU_URL = "https://api.qnaigc.com/v1"
QINIU_MODEL = "deepseek/deepseek-v4.1-flash"


def test_qiniu_exact_model_uses_published_native_capacities():
    capacity = resolve_agent_model_capacity(
        base_url=QINIU_URL, model=QINIU_MODEL, protocol="chat_completions",
    )
    assert capacity.context_window_tokens == 1_000_000
    assert capacity.max_output_tokens == 384_000
    assert capacity.source == "https://www.qiniu.com/ai/models"
    runner = PydanticAIKnowledgeRunner(
        base_url=QINIU_URL, api_key="synthetic", model=QINIU_MODEL,
        timeout_seconds=30,
    )
    assert runner.model_capacity == capacity
    assert runner._agent.model.settings["max_tokens"] == 384_000
    assert runner._usage_limits.request_limit == 12
    assert runner._usage_limits.tool_calls_limit == 20


@pytest.mark.parametrize("base_url,model,protocol", [
    ("https://another-provider.test/v1", QINIU_MODEL, "chat_completions"),
    ("https://api.qnaigc.com/bypass/openai/v1", QINIU_MODEL, "chat_completions"),
    (QINIU_URL, QINIU_MODEL, "responses"),
    (QINIU_URL, "deepseek/deepseek-v4.1-flash-unknown", "chat_completions"),
])
def test_unknown_routes_never_borrow_similarly_named_model_limits(base_url, model, protocol):
    assert resolve_agent_model_capacity(
        base_url=base_url, model=model, protocol=protocol,
    ) is None
    runner = PydanticAIKnowledgeRunner(
        base_url=base_url, api_key="synthetic", model=model,
        timeout_seconds=30, protocol=protocol,
    )
    assert runner.model_capacity is None
    assert "max_tokens" not in runner._agent.model.settings


def test_explicit_provider_capacity_is_parsed_from_environment(monkeypatch):
    route = model_capacity_key(base_url="https://unknown.test/v1/", model="real-model",
                               protocol="responses")
    values = {route: {"context_window_tokens": 160000, "max_output_tokens": 64000,
                      "output_token_parameter": "max_output_tokens",
                      "source": "https://unknown.test/docs/real-model"}}
    monkeypatch.setenv("EVERPLAIN_AGENT_MODEL_CAPACITIES", json.dumps(values))
    settings = Settings(_env_file=None)
    runner = PydanticAIKnowledgeRunner(
        base_url="https://unknown.test/v1", api_key="synthetic", model="real-model",
        timeout_seconds=30, protocol="responses",
        model_capacities=settings.agent_model_capacities,
    )
    assert runner._agent.model.settings["max_tokens"] == 64000
    assert runner.model_capacity.context_window_tokens == 160000


@pytest.mark.parametrize("values", [
    {"context_window_tokens": 100, "max_output_tokens": 101, "output_token_parameter": "max_tokens",
     "source": "official"},
    {"context_window_tokens": 0, "max_output_tokens": 10, "output_token_parameter": "max_tokens",
     "source": "official"},
    {"context_window_tokens": 100, "max_output_tokens": True,
     "output_token_parameter": "max_tokens",
     "source": "official"},
    {"context_window_tokens": 100, "max_output_tokens": 10, "output_token_parameter": "max_tokens",
     "source": " "},
])
def test_invalid_capacity_metadata_is_rejected(values):
    with pytest.raises(ValidationError):
        AgentModelCapacitySettings(**values)


def test_invalid_capacity_route_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, agent_model_capacities={
            "same-name-model": {"context_window_tokens": 100, "max_output_tokens": 10,
                                "output_token_parameter": "max_tokens",
     "source": "official"},
        })


def test_fallback_endpoint_has_its_own_capacity_and_keeps_model_identity():
    runner = PydanticAIKnowledgeRunner(
        base_url=QINIU_URL, api_key="synthetic", model=QINIU_MODEL, timeout_seconds=30,
        fallback_endpoints=(("https://fallback.test/v1", "synthetic", "different-model"),),
    )
    primary = runner._agent.model
    fallback = primary._endpoint_models["fallback-1"]
    assert primary.settings["max_tokens"] == 384000
    assert "max_tokens" not in fallback.settings
    assert fallback.model_name == "different-model"


@pytest.mark.parametrize("protocol", ["chat_completions", "responses"])
def test_wire_keeps_native_output_cap_and_long_input_despite_legacy_router_limits(protocol):
    calls = []
    # Longer than the former 32k estimate, with output beyond both old product caps.
    prompt = "资料 token" * 40000
    answer = "正文" * 5000

    def reply(request):
        calls.append(json.loads(request.content))
        if protocol == "chat_completions":
            chunks = [{
                "id": "synthetic", "object": "chat.completion.chunk", "created": 1,
                "model": "synthetic-model",
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": part},
                             "finish_reason": None}],
            } for part in (answer[:3000], answer[3000:7000], answer[7000:])]
            chunks.append({
                "id": "synthetic", "object": "chat.completion.chunk", "created": 1,
                "model": "synthetic-model",
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 120000, "completion_tokens": 10000,
                          "total_tokens": 130000},
            })
            return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                 text="".join("data: " + json.dumps(c) + "\n\n" for c in chunks)
                                 + "data: [DONE]\n\n")
        # The metered Responses boundary deliberately drains SSE even for request().
        response = {
            "id": "synthetic", "object": "response", "created_at": 1,
            "model": "synthetic-model", "status": "completed", "parallel_tool_calls": True,
            "tool_choice": "auto", "tools": [],
            "output": [{"id": "msg", "type": "message", "status": "completed",
                        "role": "assistant", "content": [{"type": "output_text", "text": answer,
                                                            "annotations": []}]}],
            "usage": {"input_tokens": 120000, "output_tokens": 10000, "total_tokens": 130000,
                      "input_tokens_details": {"cached_tokens": 0},
                      "output_tokens_details": {"reasoning_tokens": 0}},
        }
        initial = {**response, "output": [], "usage": None, "status": "in_progress"}
        events = [{"type": "response.created", "response": initial}]
        events.extend({"type": "response.output_text.delta", "item_id": "msg",
                       "output_index": 0, "content_index": 0, "delta": part}
                      for part in (answer[:3000], answer[3000:7000], answer[7000:]))
        events.append({"type": "response.completed", "response": response})
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                             text="".join("data: " + json.dumps({**e, "sequence_number": n})
                                          + "\n\n" for n, e in enumerate(events)))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False) as http:
            provider = OpenAIProvider(openai_client=AsyncOpenAI(
                api_key="synthetic", base_url="https://synthetic.test/v1", http_client=http,
                max_retries=0,
            ))
            model_class = (_RetryingOpenAIChatModel if protocol == "chat_completions"
                           else _RetryingOpenAIResponsesModel)
            model = model_class(
                "synthetic-model", provider=provider, settings={"max_tokens": 384000},
                **({"native_output_parameters": {"primary": "max_tokens"}}
                   if protocol == "chat_completions" else {}),
                route_executor=ModelRouteExecutor(
                    endpoints=(ModelEndpoint("primary", "https://synthetic.test/v1",
                                             "synthetic-model", None, 30),),
                    max_input_tokens=10, max_output_tokens=3000,
                ),
            )
            result = await Agent(model).run(prompt)
            assert result.output == answer

    asyncio.run(run())
    assert len(calls) == 1
    wire_cap = "max_tokens" if protocol == "chat_completions" else "max_output_tokens"
    assert calls[0][wire_cap] == 384000
    if protocol == "chat_completions":
        assert "max_completion_tokens" not in calls[0]
    assert prompt in json.dumps(calls[0], ensure_ascii=False)


def test_exact_qiniu_runner_streams_complete_answer_and_documented_wire_parameter(monkeypatch):
    calls, deltas = [], []
    answer = "服务端正文" * 1600

    class EmptyCatalog:
        def current_release(self, **kwargs):
            raise LookupError

    def reply(request):
        calls.append(json.loads(request.content))
        chunks = [{
            "id": "qiniu-synthetic", "object": "chat.completion.chunk", "created": 1,
            "model": QINIU_MODEL,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": part},
                         "finish_reason": None}],
        } for part in (answer[:3000], answer[3000:7000], answer[7000:])]
        chunks.append({
            "id": "qiniu-synthetic", "object": "chat.completion.chunk", "created": 1,
            "model": QINIU_MODEL,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10000, "completion_tokens": 7500,
                      "total_tokens": 17500},
        })
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                             text="".join("data: " + json.dumps(c) + "\n\n" for c in chunks)
                             + "data: [DONE]\n\n")

    http = httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False)
    monkeypatch.setattr(pydantic_runner, "AsyncOpenAI",
                        lambda **kwargs: AsyncOpenAI(**kwargs, http_client=http))
    runner = PydanticAIKnowledgeRunner(
        base_url=QINIU_URL, api_key="synthetic", model=QINIU_MODEL, timeout_seconds=30,
        route_executor=ModelRouteExecutor(endpoints=(
            ModelEndpoint("primary", QINIU_URL, QINIU_MODEL, None, 30),
        )),
    )
    try:
        result = runner.run_stream(
            prompt="直接回答测试正文", conversation=(), tools=KnowledgeToolRegistry(EmptyCatalog()),
            on_delta=deltas.append,
        )
    finally:
        asyncio.run(http.aclose())
    assert result.answer == answer == "".join(deltas)
    assert len(deltas) > 1
    assert len(calls) == 1
    assert calls[0]["model"] == QINIU_MODEL
    assert calls[0]["max_tokens"] == 384000
    assert "max_completion_tokens" not in calls[0]
