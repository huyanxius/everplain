"""A configured protocol/capability controls the catalog and SDK; names do not."""

import pytest
from pydantic import ValidationError

from qunxue_api.adapters.research_agent.model_selection import registered_agent_models
from qunxue_api.settings import AgentModelEffortSettings, Settings


def native_config(protocol):
    google = protocol == "gemini_generate_content"
    levels = ["minimal", "low", "medium", "high"] if google else ["low", "medium", "high", "max"]
    controls = {
        level: {"google_thinking_level": level}
        if google
        else {"anthropic_effort": level, "anthropic_thinking": "adaptive"}
        for level in levels
    }
    return {
        "agent_providers": {
            "native": {
                "base_url": "https://synthetic.invalid",
                "protocol": protocol,
                "api_key_env": "EVERPLAIN_SYNTHETIC_API_KEY",
            }
        },
        "agent_selectable_models": [
            {
                "model_id": "configured-model",
                "label": "Configured",
                "provider": "native",
                "model": "exact-upstream-id",
                "reasoning_efforts": levels,
                "default_reasoning_effort": "medium" if google else "high",
                "effort_settings": controls,
            }
        ],
        "agent_model_capacities": {
            f"https://synthetic.invalid|{protocol}|exact-upstream-id": {
                "context_window_tokens": 1000,
                "max_output_tokens": 512,
                "output_token_parameter": "maxOutputTokens" if google else "max_tokens",
                "source": "synthetic-contract-only",
            }
        },
    }


@pytest.mark.parametrize("protocol", ["gemini_generate_content", "anthropic_messages"])
def test_native_protocols_are_explicit_and_catalog_does_not_expose_wire_or_secret(
    monkeypatch, protocol
):
    monkeypatch.setenv("EVERPLAIN_SYNTHETIC_API_KEY", "synthetic")
    settings = Settings(_env_file=None, **native_config(protocol))
    choices, routes = registered_agent_models(settings)
    assert choices[0].model_id == "configured-model"
    assert routes["configured-model"][1] == protocol
    assert "effort_settings" not in repr(choices[0])
    assert "synthetic" not in repr(choices[0])
    assert "none" not in choices[0].reasoning_efforts


@pytest.mark.parametrize("protocol", ["anthropic_messages"])
def test_native_routes_require_verified_exact_route_capacity(protocol):
    config = native_config(protocol)
    config["agent_model_capacities"] = {}
    with pytest.raises(ValidationError, match="verified explicit max_tokens"):
        Settings(_env_file=None, **config)


def test_google_without_verified_capacity_preserves_native_omission():
    config = native_config("gemini_generate_content")
    config["agent_model_capacities"] = {}
    assert Settings(_env_file=None, **config).agent_model_capacities == {}


@pytest.mark.parametrize("protocol", ["chat_completions", "responses", "anthropic_messages"])
def test_google_controls_cannot_be_advertised_on_another_protocol(protocol):
    config = native_config("gemini_generate_content")
    config["agent_providers"]["native"]["protocol"] = protocol
    with pytest.raises(ValidationError, match="match the provider protocol"):
        Settings(_env_file=None, **config)


@pytest.mark.parametrize(
    "fields",
    [
        {"google_thinking_level": "high", "openai_reasoning_effort": "high"},
        {
            "google_thinking_level": "high",
            "anthropic_effort": "high",
            "anthropic_thinking": "adaptive",
        },
        {"anthropic_effort": "high"},
        {"anthropic_effort": "max", "anthropic_thinking": "between_tools"},
        {"anthropic_thinking": "adaptive"},
    ],
)
def test_native_effort_controls_reject_competing_or_incomplete_settings(fields):
    with pytest.raises(ValidationError):
        AgentModelEffortSettings(**fields)
