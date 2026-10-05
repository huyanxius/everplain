"""Source-linked, model-generated recent activity; never durable user facts."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True)
class ContextSummaryBatch:
    user_id: UUID
    lease_token: str
    fingerprint: str
    sources: tuple[dict, ...]
    usage_day: str
    omitted_messages: int = 0


class ContextSummaryRepository(Protocol):
    def claim(
        self, *, idle_seconds: int, daily_calls: int, daily_tokens: int
    ) -> ContextSummaryBatch | None: ...

    def complete(
        self, batch: ContextSummaryBatch, output: dict, input_tokens: int, output_tokens: int
    ) -> bool: ...

    def failed(
        self, batch: ContextSummaryBatch, *, terminal: bool = False, code: str = "summary_failed"
    ) -> None: ...
