"""Project the existing server endpoint into a small, opt-in product catalog."""

from dataclasses import replace
from urllib.parse import urlsplit, urlunsplit

from qunxue_api.adapters.model import ModelEndpoint
from qunxue_api.modules.agent_conversation import (
    LUNA_REASONING_EFFORTS,
    AgentModelChoice,
    AgentReasoningEffort,
)


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
