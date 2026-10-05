"""Per-turn product selection; credentials and transports never enter this contract."""

from dataclasses import dataclass
from typing import Literal

AgentReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]
LUNA_REASONING_EFFORTS: tuple[AgentReasoningEffort, ...] = (
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
)


class AgentModelSelectionUnavailable(ValueError):
    """The requested model/effort cannot use a registered server route."""


@dataclass(frozen=True, slots=True)
class AgentModelChoice:
    model_id: str
    label: str
    reasoning_efforts: tuple[AgentReasoningEffort, ...]
    default_reasoning_effort: AgentReasoningEffort | None


@dataclass(frozen=True, slots=True)
class AgentModelSelection:
    model_id: str
    reasoning_effort: AgentReasoningEffort | None


def resolve_agent_model_selection(
    model_id: str | None,
    reasoning_effort: str | None,
    choices: tuple[AgentModelChoice, ...],
) -> AgentModelSelection | None:
    if model_id is None and reasoning_effort is None:
        return None  # Existing clients keep their server-selected runtime and fallback policy.
    choice = next((item for item in choices if item.model_id == model_id), None)
    if choice is None:
        raise AgentModelSelectionUnavailable("所选模型尚未接通可用路由，请重新选择模型。")
    effort = reasoning_effort if reasoning_effort is not None else choice.default_reasoning_effort
    if (effort is None and choice.reasoning_efforts) or (
        effort is not None and effort not in choice.reasoning_efforts
    ):
        raise AgentModelSelectionUnavailable("当前模型路由不支持所选思考强度，请重新选择。")
    return AgentModelSelection(choice.model_id, effort)


MOCK_AGENT_MODEL_CHOICES = (
    AgentModelChoice("gpt-6-luna", "GPT 6 Luna", LUNA_REASONING_EFFORTS, "medium"),
)
