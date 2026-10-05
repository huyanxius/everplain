"""Source-linked, model-generated recent activity; never durable user facts."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


class ContextSummaryGenerationFailure(RuntimeError):
    """Content-free model failure facts, with the original cause kept internally."""

    _reasons = frozenset(
        {
            "http_error",
            "timeout",
            "transport_error",
            "invalid_output",
            "request_limit",
            "model_config",
            "model_error",
        }
    )

    def __init__(self, reason: str, *, http_status: int | None = None):
        if type(reason) is not str or reason not in self._reasons:
            raise ValueError("invalid_context_summary_failure_reason")
        if http_status is not None and (
            type(http_status) is not int or not 100 <= http_status <= 599
        ):
            raise ValueError("invalid_context_summary_http_status")
        self.reason, self.http_status = reason, http_status
        super().__init__("context_summary_generation_failed")


@dataclass(frozen=True)
class ContextSummaryBatch:
    user_id: UUID
    lease_token: str
    fingerprint: str
    sources: tuple[dict, ...]
    usage_day: str
    omitted_messages: int = 0
    reserved_tokens: int = 24000
    reservation_kind: str = "legacy_fixed"


class ContextSummaryRepository(Protocol):
    def claim(
        self, *, idle_seconds: int, daily_calls: int, daily_tokens: int,
        reservation_estimator: Callable[[tuple[dict, ...], int], int] | None = None,
    ) -> ContextSummaryBatch | None: ...

    def complete(
        self, batch: ContextSummaryBatch, output: dict,
        input_tokens: int | None, output_tokens: int | None,
    ) -> bool: ...

    def failed(
        self, batch: ContextSummaryBatch, *, terminal: bool = False, code: str = "summary_failed",
        release_reservation: bool = False,
    ) -> None: ...

    def reconcile_failed_usage(self, batch: ContextSummaryBatch) -> bool: ...
