"""Use the existing memory scheduler and configured model, off the request path."""

import logging
from contextlib import nullcontext

from qunxue_api.modules.billing import BillingBudgetExceeded

logger = logging.getLogger(__name__)


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
            with operation as billing:
                output, input_tokens, output_tokens = generate(batch)
                with self.scope() as repository:
                    completed = repository.complete(batch, output, input_tokens, output_tokens)
                if not completed:
                    raise RuntimeError("context_summary_lease_lost")
                if billing:
                    billing.finish("success")
        except Exception as error:
            current, seen, budget_blocked = error, set(), False
            while current is not None and id(current) not in seen:
                seen.add(id(current))
                if isinstance(current, BillingBudgetExceeded):
                    budget_blocked = True
                    break
                current = current.__cause__ or current.__context__
            logger.warning("Recent conversation summary failed; original conversations are intact.")
            with self.scope() as repository:
                repository.failed(
                    batch,
                    terminal=budget_blocked,
                    code="budget_exceeded" if budget_blocked else "summary_failed",
                )
        return True
