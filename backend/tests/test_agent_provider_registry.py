"""Offline provider registry contract: no real credentials or upstream calls."""

import pytest
from pydantic import ValidationError

from qunxue_api.adapters.research_agent.model_selection import registered_agent_models
from qunxue_api.modules.agent_conversation import (
    AgentModelSelectionUnavailable,
    resolve_agent_model_selection,
)
from qunxue_api.modules.billing.pricing import PriceBook, UnknownPrice
from qunxue_api.settings import Settings


def settings(**overrides):
    return Settings(
        _env_file=None,
        agent_providers={"unigate": {
            "base_url": "https://synthetic.invalid/custom-api",
            "protocol": "chat_completions", "api_key_env": "EVERPLAIN_UNIGATE_API_KEY",
        }},
        agent_selectable_models=[{
            "model_id": "gemini-3.5-flash", "model": "gemini-3.5-flash",
            "label": "Gemini 3.5 Flash", "provider": "unigate", "capabilities": ["chat"],
        }],
        **overrides,
    )


def test_registry_preserves_explicit_url_model_protocol_and_omits_unknown_reasoning(monkeypatch):
    monkeypatch.delenv("EVERPLAIN_UNIGATE_API_KEY", raising=False)
    choices, routes = registered_agent_models(settings(unigate_api_key="synthetic-test-key"))
    assert choices[0].model_id == "gemini-3.5-flash"
    assert choices[0].reasoning_efforts == ()
    assert choices[0].default_reasoning_effort is None
    selection = resolve_agent_model_selection("gemini-3.5-flash", None, choices)
    assert selection.reasoning_effort is None
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection("gemini-3.5-flash", "high", choices)
    endpoint, protocol = routes[selection.model_id]
    assert protocol == "chat_completions"
    assert endpoint.base_url == "https://synthetic.invalid/custom-api"
    assert endpoint.model == "gemini-3.5-flash"
    assert endpoint.provider == "unigate"
    assert "synthetic-test-key" not in repr(choices) + repr(routes)


def test_registry_does_not_advertise_missing_key_or_mutate_default(monkeypatch):
    monkeypatch.delenv("EVERPLAIN_UNIGATE_API_KEY", raising=False)
    config = settings(unigate_api_key=None)
    assert registered_agent_models(config) == ((), {})
    assert config.model_name is None
    assert config.model_api_key is None


def test_env_reference_is_resolved_without_exposing_it(monkeypatch):
    monkeypatch.setenv("EVERPLAIN_UNIGATE_API_KEY", "synthetic-env-key")
    choices, routes = registered_agent_models(settings())
    assert routes[choices[0].model_id][0].api_key == "synthetic-env-key"


def test_registry_rejects_unsafe_urls_secret_values_and_invented_efforts():
    from qunxue_api.settings import AgentProviderSettings, AgentSelectableModelSettings

    for base in ["https://user:password@example.com", "https://example.com?key=secret"]:
        with pytest.raises(ValidationError):
            AgentProviderSettings(base_url=base, protocol="chat_completions",
                                  api_key_env="EVERPLAIN_UNIGATE_API_KEY")
    with pytest.raises(ValidationError):
        AgentProviderSettings(base_url="https://example.com", protocol="chat_completions",
                              api_key_env="actual-key-not-allowed")
    with pytest.raises(ValidationError):
        AgentSelectableModelSettings(model_id="m", model="m", label="M", provider="p",
                                     default_reasoning_effort="high")


def test_unverified_gemini_price_still_fails_closed():
    book = PriceBook(credits_per_usd=100, version="synthetic")
    with pytest.raises(UnknownPrice):
        book.tariff("gemini-3.5-flash")


def test_no_effort_model_restores_original_turn_after_interruption():
    from uuid import UUID

    from test_agent_model_selection import Runner, Tools

    from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
    from qunxue_api.modules.agent_conversation import (
        AgentInterrupted,
        ConversationService,
    )

    choices, _ = registered_agent_models(settings(unigate_api_key="synthetic"))
    conversations = ConversationService.in_memory()
    selections = []

    class InterruptingRunner(Runner):
        def run(self, **kwargs):
            if len(selections) == 1:
                raise AgentInterrupted("synthetic cancellation")
            return super().run(**kwargs)

    def selected(selection):
        selections.append(selection)
        return InterruptingRunner()

    app = DisciplinaryAgentApplication(
        conversations=conversations, runner=Runner(), tools_factory=Tools,
        model_choices=choices, runner_for_selection=selected,
    )
    args = dict(user_id=UUID(int=9), conversation_id=None, prompt="synthetic",
                idempotency_key="gemini-resume")
    with pytest.raises(AgentInterrupted):
        app.run_turn(**args, model_id="gemini-3.5-flash")
    saved = conversations.find_run(user_id=UUID(int=9), idempotency_key="gemini-resume")
    assert saved.request_snapshot["model_id"] == "gemini-3.5-flash"
    assert saved.request_snapshot["reasoning_effort"] is None
    assert conversations.find_run(user_id=UUID(int=10), idempotency_key="gemini-resume") is None
    app.run_turn(**args)
    assert [s.model_id for s in selections] == ["gemini-3.5-flash"] * 2
    assert all(s.reasoning_effort is None for s in selections)
