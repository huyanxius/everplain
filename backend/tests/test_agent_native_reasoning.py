"""Explicit reasoning mappings against synthetic HTTP, never a live provider.

The native payload fixtures prove serialization, not current gateway acceptance.
Production activation needs evidence for the configured host/path/protocol.
"""

import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai import Agent

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.research_agent import pydantic_runner
from qunxue_api.adapters.research_agent.model_selection import (
    registered_agent_effort_settings,
    registered_agent_models,
)
from qunxue_api.api.contracts.agent import AgentModelChoiceResponse, AgentTurnRequest
from qunxue_api.modules.agent_conversation import (
    AgentModelSelectionUnavailable,
    resolve_agent_model_selection,
)
from qunxue_api.settings import AgentModelEffortSettings, AgentSelectableModelSettings, Settings


def entry(**changes):
    return {
        "model_id": "synthetic-model", "model": "synthetic-upstream",
        "label": "Synthetic model", "provider": "synthetic-provider",
        "reasoning_efforts": ["low", "high"], "default_reasoning_effort": "high",
        "effort_settings": {
            "low": {"extra_body": {"thinking": {"type": "adaptive"},
                                    "output_config": {"effort": "low"}}},
            "high": {"extra_body": {"thinking": {"type": "adaptive"},
                                     "output_config": {"effort": "high"}}},
        },
        **changes,
    }


@pytest.mark.parametrize("changes", [
    {"effort_settings": {}},
    {"reasoning_efforts": ["low", "low"]},
    {"default_reasoning_effort": "medium"},
    {"effort_settings": {"low": {"openai_reasoning_effort": "low"}}},
    {"effort_settings": {"low": {"openai_reasoning_effort": "low"},
                         "high": {"openai_reasoning_effort": "low"}}},
    {"effort_settings": {"low": {"openai_reasoning_effort": "low"},
                         "high": {"extra_body": {"reasoning_effort": "low"}}}},
    {"reasoning_efforts": [], "default_reasoning_effort": None},
])
def test_catalog_cannot_advertise_unmapped_or_duplicate_wire_levels(changes):
    with pytest.raises(ValidationError):
        AgentSelectableModelSettings(**entry(**changes))


@pytest.mark.parametrize("values", [
    {},
    {"openai_reasoning_effort": "ultra"},
    {"extra_body": {"max_tokens": 2000}},
    {"extra_body": {"api_key": "synthetic"}},
    {"openai_reasoning_effort": "high", "extra_body": {"reasoning_effort": "low"}},
    {"extra_body": {"thinking": {}}},
    {"extra_body": {"thinking": None}},
    {"extra_body": {"thinking": {"type": []}}},
    {"extra_body": {"output_config": None}},
    {"extra_body": {"extra_body": None}},
    {"extra_body": {"reasoning_effort": None}},
    {"extra_body": {"reasoning_effort": True}},
    {"extra_body": {"thinking": {"type": "enabled", "budget_tokens": 1000}}},
    {"extra_body": {"output_config": {"effort": "low", "max_tokens": 1000}}},
    {"extra_body": {"extra_body": {"google": {"api_key": "synthetic"}}}},
    {"openai_reasoning_effort": "low", "extra_body": {"output_config": {"effort": "high"}}},
])
def test_wire_config_accepts_only_explicit_reasoning_controls(values):
    with pytest.raises(ValidationError):
        AgentModelEffortSettings(**values)


def test_registered_catalog_stays_public_and_mapping_is_selection_scoped(monkeypatch):
    monkeypatch.setenv("EVERPLAIN_SYNTHETIC_API_KEY", "synthetic")
    settings = Settings(_env_file=None, agent_selectable_models=[entry()], agent_providers={
        "synthetic-provider": {"base_url": "https://synthetic.test/v1",
                               "protocol": "chat_completions",
                               "api_key_env": "EVERPLAIN_SYNTHETIC_API_KEY"},
    })
    choices, routes = registered_agent_models(settings)
    choice = choices[0]
    assert choice.reasoning_efforts == ("low", "high")
    assert choice.default_reasoning_effort == "high"
    public = AgentModelChoiceResponse(
        model_id=choice.model_id, label=choice.label,
        reasoning_efforts=list(choice.reasoning_efforts),
        default_reasoning_effort=choice.default_reasoning_effort,
    ).model_dump()
    assert set(public) == {"model_id", "label", "reasoning_efforts", "default_reasoning_effort"}
    assert "synthetic-provider" not in json.dumps(public)
    assert "extra_body" not in json.dumps(public)
    selection = resolve_agent_model_selection(choice.model_id, "low", choices)
    wire = registered_agent_effort_settings(settings, selection)
    assert wire.extra_body["output_config"] == {"effort": "low"}
    wire.extra_body["output_config"]["effort"] = "changed"
    assert settings.agent_selectable_models[0].effort_settings["low"].extra_body[
        "output_config"
    ] == {"effort": "low"}
    assert routes[selection.model_id][0].model == "synthetic-upstream"
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection(choice.model_id, "medium", choices)


def test_minimal_is_a_valid_contract_value_but_not_valid_for_every_model():
    request = AgentTurnRequest(message="synthetic", model_id="gemini-fixture",
                               reasoning_effort="minimal")
    assert request.reasoning_effort == "minimal"
    from qunxue_api.modules.agent_conversation import MOCK_AGENT_MODEL_CHOICES
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection("gpt-6-luna", "minimal", MOCK_AGENT_MODEL_CHOICES)


# Native request examples: exact fields rather than a single SDK enum for every model.
# Gemini uses Google's documented OpenAI native extra_body envelope; Claude uses
# native adaptive/output_config payloads. These fixtures do NOT authorize deployment
# of those fields to UniGate/Qiniu Chat before their passthrough is verified.
CASES = [
    ("gpt-6-luna", "responses", level,
     {"openai_reasoning_effort": level}, {"reasoning": {"effort": level}})
    for level in ("none", "low", "medium", "high", "xhigh", "max")
] + [
    ("gemini-3.5-flash", "chat_completions", level,
     {"extra_body": {"extra_body": {"google": {"thinking_config": {
         "thinking_level": level,
     }}}}},
     {"extra_body": {"google": {"thinking_config": {"thinking_level": level}}}})
    for level in ("minimal", "low", "medium", "high")
] + [
    ("deepseek/deepseek-v4.1-flash", "chat_completions", level,
     {"extra_body": {"thinking": {"type": "disabled"}}} if level == "none" else
     {"openai_reasoning_effort": level, "extra_body": {"thinking": {"type": "enabled"}}},
     {"thinking": {"type": "disabled"}} if level == "none" else
     {"reasoning_effort": level, "thinking": {"type": "enabled"}})
    for level in ("none", "low", "high", "max")
] + [
    ("claude-sonnet-5-5", "chat_completions", level,
     {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": level}}},
     {"thinking": {"type": "adaptive"}, "output_config": {"effort": level}})
    for level in ("low", "medium", "high", "xhigh", "max")
]

# This current gateway capability is binary; enabled is not labeled high.
CASES += [
    ("deepseek/deepseek-v4.1-flash", "chat_completions", level,
     {"extra_body": {"thinking": {"type": mode}}}, {"thinking": {"type": mode}})
    for level, mode in (("none", "disabled"), ("enabled", "enabled"))
]


def test_binary_thinking_has_a_truthful_public_catalog_and_unchanged_luna_validation():
    binary = AgentSelectableModelSettings(**entry(
        reasoning_efforts=["none", "enabled"], default_reasoning_effort="enabled",
        effort_settings={"none": {"extra_body": {"thinking": {"type": "disabled"}}},
                         "enabled": {"extra_body": {"thinking": {"type": "enabled"}}}},
    ))
    assert binary.reasoning_efforts == ("none", "enabled")
    assert AgentTurnRequest(message="hello", model_id=binary.model_id,
                            reasoning_effort="enabled").reasoning_effort == "enabled"
    from qunxue_api.modules.agent_conversation.model_selection import MOCK_AGENT_MODEL_CHOICES

    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection("gpt-6-luna", "enabled", MOCK_AGENT_MODEL_CHOICES)


def reply(request):
    model = json.loads(request.content)["model"]
    if request.url.path.endswith("/responses"):
        response = {
            "id": "synthetic", "object": "response", "created_at": 1,
            "model": model, "status": "completed", "parallel_tool_calls": True,
            "tool_choice": "auto", "tools": [],
            "output": [{"id": "msg", "type": "message", "status": "completed",
                        "role": "assistant", "content": [{"type": "output_text", "text": "OK",
                                                            "annotations": []}]}],
            "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12,
                      "input_tokens_details": {"cached_tokens": 0},
                      "output_tokens_details": {"reasoning_tokens": 0}},
        }
        events = [{"type": "response.created", "response": {
            **response, "output": [], "usage": None, "status": "in_progress",
        }}, {"type": "response.output_text.delta", "item_id": "msg", "output_index": 0,
             "content_index": 0, "delta": "OK"},
            {"type": "response.completed", "response": response}]
    else:
        chunk = {"id": "synthetic", "object": "chat.completion.chunk", "created": 1,
                 "model": model}
        events = [
            {**chunk, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "OK"},
                                  "finish_reason": None}]},
            {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}},
        ]
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="".join(
        "data: " + json.dumps({**event, "sequence_number": index}) + "\n\n"
        for index, event in enumerate(events)
    ) + ("data: [DONE]\n\n" if not request.url.path.endswith("/responses") else ""))


@pytest.mark.parametrize("model,protocol,level,settings,expected", CASES)
def test_each_model_level_emits_exact_registered_native_payload(
    monkeypatch, model, protocol, level, settings, expected,
):
    calls = []

    def record(request):
        calls.append(json.loads(request.content))
        return reply(request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(record), trust_env=False)
    monkeypatch.setattr(pydantic_runner, "AsyncOpenAI",
                        lambda **kwargs: AsyncOpenAI(**kwargs, http_client=http))
    runner = pydantic_runner.PydanticAIKnowledgeRunner(
        base_url="https://synthetic.test/v1", api_key="synthetic", model=model,
        timeout_seconds=30, protocol=protocol,
        reasoning_effort=level, reasoning_settings=AgentModelEffortSettings(**settings),
        route_executor=ModelRouteExecutor(endpoints=(
            ModelEndpoint("primary", "https://synthetic.test/v1", model, None, 30),
        )),
    )
    try:
        assert asyncio.run(Agent(runner._agent.model).run("synthetic")).output == "OK"
    finally:
        asyncio.run(http.aclose())
    assert len(calls) == 1
    payload = calls[0]
    assert payload["model"] == model
    controls = {key: payload[key] for key in (
        "reasoning", "reasoning_effort", "thinking", "output_config", "extra_body",
    ) if key in payload}
    assert controls == expected


def test_native_settings_cannot_leak_to_cross_model_fallback():
    with pytest.raises(ValueError, match="strict-model routing"):
        pydantic_runner.PydanticAIKnowledgeRunner(
            base_url="https://synthetic.test/v1", api_key="synthetic", model="native-fixture",
            timeout_seconds=30, fallback_endpoints=(("https://other.test/v1", "synthetic"),),
            reasoning_settings=AgentModelEffortSettings(openai_reasoning_effort="low"),
        )
