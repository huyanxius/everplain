"""Structural contract for validated reasoning controls passed into the adapter."""

from typing import Any, Protocol


class AgentReasoningControls(Protocol):
    google_thinking_level: str | None
    anthropic_effort: str | None
    anthropic_thinking: str | None

    def model_dump(self, **kwargs: Any) -> dict[str, Any]: ...
