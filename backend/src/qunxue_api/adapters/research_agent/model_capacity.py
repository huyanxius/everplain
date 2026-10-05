"""Verified route-specific upstream capacity metadata for the Agent bridge.

Never use a conservative tokenizer estimate as a local admission veto. The
provider owns the actual context boundary. Output parameters use its native
maximum where documented; unknown capacities stay unknown, not 2400/3000.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

OutputTokenParameter = Literal[
    "max_tokens", "max_completion_tokens", "max_output_tokens", "maxOutputTokens"
]


class AgentModelCapacityMetadata(Protocol):
    """Capacity input supplied by composition, without importing configuration."""

    @property
    def context_window_tokens(self) -> int: ...

    @property
    def max_output_tokens(self) -> int: ...

    @property
    def output_token_parameter(self) -> OutputTokenParameter: ...

    @property
    def source(self) -> str: ...


@dataclass(frozen=True)
class AgentModelCapacity:
    """Immutable upstream facts used by the model adapter."""

    context_window_tokens: int
    max_output_tokens: int
    output_token_parameter: OutputTokenParameter
    source: str

QINIU_MODEL_SOURCE = "https://www.qiniu.com/ai/models"
DEEPSEEK_MODEL_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing/"


def model_capacity_key(*, base_url: str, model: str, protocol: str) -> str:
    return f"{base_url.rstrip('/')}|{protocol}|{model}"


def resolve_agent_model_capacity(
    *,
    base_url: str,
    model: str,
    protocol: str,
    configured: Mapping[str, AgentModelCapacityMetadata] | None = None,
) -> AgentModelCapacity | None:
    key = model_capacity_key(base_url=base_url, model=model, protocol=protocol)
    if configured and key in configured:
        metadata = configured[key]
        return AgentModelCapacity(
            context_window_tokens=metadata.context_window_tokens,
            max_output_tokens=metadata.max_output_tokens,
            output_token_parameter=metadata.output_token_parameter,
            source=metadata.source,
        )
    # Snapshot checked 2026-10-05: Qiniu's exact catalog model_constraints.
    # Zero default/cap fields mean unspecified, never unlimited. The published
    # Chat route is not evidence that its Responses route has identical caps.
    if (
        base_url.rstrip('/') in {"https://api.qnaigc.com", "https://api.qnaigc.com/v1"}
        and protocol == "chat_completions"
        and model in {"deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash"}
    ):
        return AgentModelCapacity(
            context_window_tokens=1_000_000,
            max_output_tokens=384_000,
            output_token_parameter="max_tokens",
            source=QINIU_MODEL_SOURCE,
        )
    # This is DeepSeek's own documented route, not a proxy-model-name guess.
    if (
        base_url.rstrip('/') in {"https://api.deepseek.com", "https://api.deepseek.com/v1"}
        and protocol in {"chat_completions", "responses"}
        and model in {"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"}
    ):
        return AgentModelCapacity(
            context_window_tokens=1_000_000,
            max_output_tokens=384_000,
            output_token_parameter=(
                "max_tokens" if protocol == "chat_completions" else "max_output_tokens"
            ),
            source=DEEPSEEK_MODEL_SOURCE,
        )
    return None
