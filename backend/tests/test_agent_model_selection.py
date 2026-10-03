"""Offline contracts and run-local selection; these tests never invoke a provider."""

from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic import ValidationError

from qunxue_api.adapters.model import ModelEndpoint
from qunxue_api.adapters.research_agent.model_selection import selectable_agent_model
from qunxue_api.api.contracts.agent import AgentTurnRequest
from qunxue_api.api.routes.agent import _conversation
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import (
    LUNA_REASONING_EFFORTS,
    MOCK_AGENT_MODEL_CHOICES,
    AgentInterrupted,
    AgentModelSelectionUnavailable,
    AgentResearchEvent,
    AgentRunResult,
    AgentRuntimeIdentity,
    ConversationService,
    resolve_agent_model_selection,
)
from qunxue_api.settings import Settings


@pytest.mark.parametrize("effort", LUNA_REASONING_EFFORTS)
def test_only_documented_luna_efforts_are_accepted(effort):
    result = resolve_agent_model_selection("gpt-6-luna", effort, MOCK_AGENT_MODEL_CHOICES)
    assert result.reasoning_effort == effort


@pytest.mark.parametrize(
    "model,effort",
    [
        ("unknown", "high"),
        ("gpt-6-luna", "minimal"),
        ("gpt-6-luna", "ultra"),
        (None, "medium"),
    ],
)
def test_unknown_model_and_effort_fail_closed(model, effort):
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection(model, effort, MOCK_AGENT_MODEL_CHOICES)


def test_omitted_selection_preserves_legacy_runtime_and_default_is_medium():
    assert resolve_agent_model_selection(None, None, ()) is None
    assert (
        resolve_agent_model_selection("gpt-6-luna", None, MOCK_AGENT_MODEL_CHOICES).reasoning_effort
        == "medium"
    )
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection("gpt-6-luna", "medium", ())


@pytest.mark.parametrize(
    "extra",
    [
        {"provider": "other"},
        {"api_key": "synthetic"},
        {"base_url": "https://other.invalid"},
        {"model": "other"},
        {"reasoning_effort": "minimal"},
        {"reasoning_effort": "high"},
    ],
)
def test_client_cannot_supply_provider_configuration_or_effort_without_model(extra):
    with pytest.raises(ValidationError):
        AgentTurnRequest(message="synthetic", **extra)


def endpoint(base_url="https://api.modelink.ai/v1", model="openai/gpt-6-luna"):
    return ModelEndpoint("primary", base_url, model, "synthetic", 30)


def test_catalog_uses_configured_subset_and_documented_responses_path():
    original = endpoint()
    choices, selected = selectable_agent_model(
        original,
        protocol="responses",
        supported_efforts=("low", "medium", "high"),
        default_effort="medium",
    )
    assert selected.base_url == "https://api.modelink.ai/bypass/openai/v1"
    assert selected.api_key == original.api_key
    assert selected.model == original.model
    assert original.base_url == "https://api.modelink.ai/v1"
    assert choices[0].reasoning_efforts == ("low", "medium", "high")
    with pytest.raises(AgentModelSelectionUnavailable):
        resolve_agent_model_selection("gpt-6-luna", "max", choices)
    assert "synthetic" not in repr(choices)


@pytest.mark.parametrize("url", ["https://api.openai.com/v1", "https://synthetic.test/v1"])
def test_explicit_responses_protocol_keeps_other_server_base_urls(url):
    _, selected = selectable_agent_model(
        endpoint(url, "gpt-6-luna"),
        protocol="responses",
        supported_efforts=("medium",),
        default_effort="medium",
    )
    assert selected.base_url == url


@pytest.mark.parametrize(
    "protocol,efforts,model",
    [
        ("chat_completions", ("medium",), "gpt-6-luna"),
        ("responses", (), "gpt-6-luna"),
        ("responses", ("medium",), "deepseek-v4-flash"),
    ],
)
def test_unregistered_or_incompatible_routes_are_not_advertised(protocol, efforts, model):
    assert selectable_agent_model(
        endpoint(model=model), protocol=protocol, supported_efforts=efforts, default_effort="medium"
    ) == ((), None)


def test_settings_require_a_model_specific_effort_subset():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, agent_model_supported_efforts=("minimal",))
    assert Settings(_env_file=None).agent_model_supported_efforts == ()


class Tools:
    release = SimpleNamespace(knowledge_release_id="release-a")
    evidence = {}


class Runner:
    runtime_identity = AgentRuntimeIdentity("synthetic", "default-test-model")

    def run(self, **kwargs):
        return AgentRunResult(
            "synthetic answer", (), "release-a", "synthetic", self.runtime_identity.model
        )


def test_selection_is_run_local_and_is_recovered_from_original_snapshot():
    conversations = ConversationService.in_memory()
    selected = []
    interrupt_first = True

    class SelectedRunner(Runner):
        runtime_identity = AgentRuntimeIdentity("synthetic", "gpt-6-luna")

        def run(self, **kwargs):
            nonlocal interrupt_first
            if interrupt_first:
                interrupt_first = False
                raise AgentInterrupted("synthetic interruption")
            return super().run(**kwargs)

    def factory(selection):
        selected.append(selection)
        return SelectedRunner()

    application = DisciplinaryAgentApplication(
        conversations=conversations,
        runner=Runner(),
        tools_factory=Tools,
        model_choices=MOCK_AGENT_MODEL_CHOICES,
        runner_for_selection=factory,
    )
    args = dict(
        user_id=UUID(int=1),
        conversation_id=None,
        prompt="synthetic",
        idempotency_key="selection-resume",
    )
    with pytest.raises(AgentInterrupted):
        application.run_turn(**args, model_id="gpt-6-luna", reasoning_effort="high")
    saved = conversations.find_run(user_id=UUID(int=1), idempotency_key="selection-resume")
    assert saved.request_snapshot["model_id"] == "gpt-6-luna"
    assert saved.request_snapshot["reasoning_effort"] == "high"
    recovery = (
        _conversation(
            conversations.get_conversation(
                user_id=UUID(int=1),
                conversation_id=saved.conversation_id,
            )
        )
        .unfinished_runs[0]
        .request
    )
    assert recovery.reasoning_effort == "high"
    assert "_execution_prompt" not in recovery.model_dump()

    # An unrelated, omitted selection still runs the original default.
    legacy = application.run_turn(**{**args, "idempotency_key": "legacy-default"})
    assert legacy.result.model == "default-test-model"
    resumed = application.run_turn(**args, model_id="gpt-6-luna", reasoning_effort="low")
    assert resumed.result.model == "gpt-6-luna"
    assert [item.reasoning_effort for item in selected] == ["high", "high"]
    assert application._runner.runtime_identity.model == "default-test-model"


def test_invalid_selection_is_rejected_before_starting_run_or_credit_checks():
    class Credits:
        def ensure_can_start(self, **kwargs):
            pytest.fail("credit check must not run for an invalid model choice")

    application = DisciplinaryAgentApplication(
        conversations=ConversationService.in_memory(),
        runner=Runner(),
        tools_factory=Tools,
        credits=Credits(),
        model_choices=MOCK_AGENT_MODEL_CHOICES,
    )
    with pytest.raises(AgentModelSelectionUnavailable):
        application.run_turn(
            user_id=UUID(int=1),
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="invalid",
            model_id="unregistered",
            reasoning_effort="medium",
        )


def register(client):
    response = client.post(
        "/api/session/register",
        json={
            "email": "model-selection@example.com",
            "password": "password-123",
            "display_name": "模型测试",
        },
        headers={"Idempotency-Key": "register-selection"},
    )
    assert response.status_code == 201


def test_model_catalog_requires_authentication_and_mock_catalog_is_explicit(plain_client):
    assert plain_client.get("/api/agent/models").status_code == 401
    register(plain_client)
    response = plain_client.get("/api/agent/models")
    assert response.status_code == 200
    assert response.json()["runtime_mode"] == "mock"
    assert response.json()["items"] == [
        {
            "model_id": "gpt-6-luna",
            "label": "GPT 6 Luna",
            "reasoning_efforts": list(LUNA_REASONING_EFFORTS),
            "default_reasoning_effort": "medium",
        }
    ]


@pytest.mark.parametrize(
    "fields",
    [
        {"model_id": "unknown"},
        {"model_id": "gpt-6-luna", "reasoning_effort": "minimal"},
        {"model_id": "gpt-6-luna", "api_key": "synthetic"},
    ],
)
def test_invalid_api_selections_return_422_before_sse(plain_client, fields):
    register(plain_client)
    response = plain_client.post(
        "/api/agent/turns",
        json={"message": "synthetic", **fields},
        headers={"Idempotency-Key": "invalid-choice"},
    )
    assert response.status_code == 422
    assert "text/event-stream" not in response.headers.get("content-type", "")


def test_mock_selection_runs_through_isolated_deterministic_backend(plain_client):
    register(plain_client)
    response = plain_client.post(
        "/api/agent/turns",
        json={"message": "synthetic", "model_id": "gpt-6-luna", "reasoning_effort": "high"},
        headers={"Idempotency-Key": "mock-choice"},
    )
    assert response.status_code == 200
    assert "event: turn_completed" in response.text
    assert '"runtime_mode": "mock"' in response.text


def test_selected_runner_handles_planner_and_confirmation_with_original_effort():
    selected = []
    calls = []

    class PlanningRunner(Runner):
        def prepare_research(self, *, on_event, **kwargs):
            calls.append("plan")
            on_event(
                AgentResearchEvent(kind="plan", payload={"title": "synthetic", "steps": ["step"]})
            )

        def run(self, **kwargs):
            calls.append("answer")
            return super().run(**kwargs)

    def factory(selection):
        selected.append(selection.reasoning_effort)
        return PlanningRunner()

    application = DisciplinaryAgentApplication(
        conversations=ConversationService.in_memory(),
        runner=Runner(),
        tools_factory=Tools,
        model_choices=MOCK_AGENT_MODEL_CHOICES,
        runner_for_selection=factory,
    )
    args = dict(
        user_id=UUID(int=1),
        conversation_id=None,
        prompt="synthetic",
        idempotency_key="planning",
        mode="deep_research",
        model_id="gpt-6-luna",
    )
    pending = application.run_turn(**args, reasoning_effort="high")
    assert pending.pending_research["state"] == "awaiting_plan_confirmation"
    result = application.run_turn(
        **args,
        reasoning_effort="low",
        deep_research_run_id=pending.run_id,
        deep_research_action="confirm",
    )
    assert result.turn is not None
    assert selected == ["high", "high"]
    assert calls == ["plan", "answer"]
