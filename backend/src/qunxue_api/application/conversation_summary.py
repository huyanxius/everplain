"""Use the existing memory scheduler and configured model, off the request path."""

import logging
from contextlib import nullcontext

from qunxue_api.modules.agent_conversation import ContextSummaryGenerationFailure
from qunxue_api.modules.billing import (
    BillingBudgetExceeded,
    BillingContextMissing,
    BillingReplayBlocked,
    BillingRouteMismatch,
    ModelDeliveryRejected,
    UnknownPrice,
    UnknownTokenUsage,
)

logger = logging.getLogger(__name__)


class _SummaryLeaseLost(RuntimeError):
    pass


def _failure_diagnostic(error, stage):
    """Only fixed categories/status numbers; never exception strings or payloads."""
    chain, seen, current = [], set(), error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    reasons = (
        (BillingBudgetExceeded, "budget_exceeded"),
        (BillingContextMissing, "billing_context_missing"),
        (BillingReplayBlocked, "billing_replay_blocked"),
        (BillingRouteMismatch, "billing_route_mismatch"),
        (UnknownTokenUsage, "usage_unknown"),
        (UnknownPrice, "price_unknown"),
        (ModelDeliveryRejected, "delivery_rejected"),
        (_SummaryLeaseLost, "lease_lost"),
    )
    reason = next(
        (code for kind, code in reasons if any(isinstance(item, kind) for item in chain)),
        None,
    )
    if reason == "billing_context_missing":
        missing = next(item for item in chain if isinstance(item, BillingContextMissing))
        supplied = getattr(missing, "reason", None)
        if type(supplied) is str and supplied in {
            "phase_policy_missing", "billing_runtime_missing"
        }:
            reason = supplied
    if reason is None and any(
        any(
            (kind.__module__ == "sqlite3" and kind.__name__ == "Error")
            or (kind.__module__ == "sqlalchemy.exc" and kind.__name__ == "SQLAlchemyError")
            for kind in type(item).__mro__
        )
        for item in chain
    ):
        reason = "storage_error"
    if reason is None:
        generated = next(
            (item for item in chain if isinstance(item, ContextSummaryGenerationFailure)), None
        )
        if generated is not None:
            allowed = {
                "http_error", "timeout", "transport_error", "invalid_output",
                "request_limit", "model_config", "model_error",
            }
            supplied = getattr(generated, "reason", None)
            reason = supplied if type(supplied) is str and supplied in allowed else "model_error"
            status = getattr(generated, "http_status", None)
            if (
                reason == "http_error"
                and type(status) is int
                and 100 <= status <= 599
            ):
                reason = f"http_{status}"
    stage = stage if stage in {
        "billing_open", "billing_start", "model", "publish", "settle"
    } else "unknown_stage"
    return f"{stage}:{reason or 'summary_failed'}", reason == "budget_exceeded"


class ConversationSummaryWorker:
    def __init__(
        self,
        repository_scope,
        *,
        generate=None,
        billing=None,
        idle_seconds=600,
        daily_calls=8,
        daily_tokens=64000,
    ):
        self.scope, self.generate, self.billing = repository_scope, generate, billing
        self.idle_seconds = idle_seconds
        self.daily_calls, self.daily_tokens = daily_calls, daily_tokens

    def run_once(self, *, generate=None):
        generate = generate or self.generate
        if generate is None:
            return False
        with self.scope() as repository:
            batch = repository.claim(
                idle_seconds=self.idle_seconds,
                daily_calls=self.daily_calls,
                daily_tokens=self.daily_tokens,
            )
        if batch is None:
            return False
        stage = "billing_open"
        try:
            operation = (
                self.billing.open(
                    user_id=batch.user_id,
                    run_id=batch.lease_token,
                    payload={"context_fingerprint": batch.fingerprint},
                    phase="memory_learning",
                )
                if self.billing
                else nullcontext()
            )
            stage = "billing_start"
            with operation as billing:
                stage = "model"
                output, input_tokens, output_tokens = generate(batch)
                stage = "publish"
                with self.scope() as repository:
                    completed = repository.complete(batch, output, input_tokens, output_tokens)
                if not completed:
                    raise _SummaryLeaseLost("context_summary_lease_lost")
                stage = "settle"
                if billing:
                    billing.finish("success")
        except Exception as error:
            code, budget_blocked = _failure_diagnostic(error, stage)
            logger.warning(
                "Recent conversation summary failed (code=%s); original conversations are intact.",
                code,
            )
            with self.scope() as repository:
                repository.failed(
                    batch,
                    terminal=budget_blocked,
                    code=code,
                )
        return True
