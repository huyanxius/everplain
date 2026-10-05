"""Project the existing server endpoint into a small, opt-in product catalog."""

from dataclasses import replace
from urllib.parse import urlsplit, urlunsplit

from qunxue_api.adapters.model import ModelEndpoint
from qunxue_api.modules.agent_conversation import (
    LUNA_REASONING_EFFORTS,
    AgentModelChoice,
    AgentModelSelection,
    AgentReasoningEffort,
)
from qunxue_api.settings import AgentModelEffortSettings


def selectable_agent_model(
    endpoint: ModelEndpoint | None,
    *,
    protocol: str,
    supported_efforts: tuple[AgentReasoningEffort, ...],
    default_effort: str | None,
) -> tuple[tuple[AgentModelChoice, ...], ModelEndpoint | None]:
    # An SDK-wide enum or the public model name is not proof of provider support.
    # The operator explicitly registers this provider/protocol's verified subset.
    if (
        endpoint is None
        or protocol != "responses"
        or endpoint.model not in {"gpt-6-luna", "openai/gpt-6-luna"}
        or not supported_efforts
    ):
        return (), None
    efforts = tuple(effort for effort in LUNA_REASONING_EFFORTS if effort in supported_efforts)
    if len(efforts) != len(set(supported_efforts)):
        raise ValueError("unsupported Luna reasoning effort in server configuration")
    default = next((item for item in efforts if item == default_effort), None)
    if default is None:
        default = "medium" if "medium" in efforts else efforts[0]
    parsed = urlsplit(endpoint.base_url)
    if parsed.hostname in {"api.modelink.ai", "api.qnaigc.com"}:
        # Published native-protocol path, same configured host/key. No new URL source.
        # https://docs.modelink.ai/api-endpoints/overview
        if parsed.path.rstrip("/") not in {"", "/v1", "/bypass/openai/v1"}:
            raise ValueError("Modelink Responses route requires its published base path")
        parsed = parsed._replace(path="/bypass/openai/v1")
    return (
        (AgentModelChoice("gpt-6-luna", "GPT 6 Luna", efforts, default),),
        replace(endpoint, base_url=urlunsplit(parsed).rstrip("/")),
    )


def registered_agent_models(settings):
    """Resolve operator-registered routes; missing secrets never yield selectable entries."""
    import os

    choices = []
    routes = {}
    seen = set()
    for entry in settings.agent_selectable_models:
        if entry.model_id in seen or entry.model_id == "gpt-6-luna":
            raise ValueError("additional model identifiers must be unique and preserve Luna")
        seen.add(entry.model_id)
        provider = settings.agent_providers.get(entry.provider)
        if provider is None:
            raise ValueError("selectable model references an unregistered provider")
        secret = os.environ.get(provider.api_key_env)
        attribute = provider.api_key_env.removeprefix("EVERPLAIN_").lower()
        configured = getattr(settings, attribute, None)
        if not secret and configured is not None:
            secret = configured.get_secret_value()
        if not secret or not secret.strip():
            continue
        choices.append(AgentModelChoice(
            entry.model_id, entry.label, entry.reasoning_efforts, entry.default_reasoning_effort,
        ))
        # Each selected model has a strict single-endpoint route, never a cross-model fallback.
        routes[entry.model_id] = (ModelEndpoint(
            endpoint_id="primary", base_url=provider.base_url, model=entry.model,
            api_key=secret, timeout_seconds=settings.model_timeout_seconds, provider=entry.provider,
        ), provider.protocol)
    return tuple(choices), routes


def registered_agent_effort_settings(settings, selection: AgentModelSelection):
    """Keep upstream controls on the server and scoped to the selected strict route."""
    entry = next((item for item in settings.agent_selectable_models
                  if item.model_id == selection.model_id), None)
    if entry is None or not entry.effort_settings:
        return None  # Legacy Luna and models with no advertised controls retain their wire.
    if selection.reasoning_effort not in entry.effort_settings:
        raise ValueError("selected reasoning level has no registered upstream wire control")
    return AgentModelEffortSettings.model_validate(
        entry.effort_settings[selection.reasoning_effort].model_dump()
    )
