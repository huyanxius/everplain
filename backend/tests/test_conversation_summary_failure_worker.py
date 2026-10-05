"""Safe stage/category metadata, with no provider text or policy changes."""

import logging
import sqlite3
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest

from qunxue_api.application.conversation_summary import ConversationSummaryWorker
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

SECRET = "private-provider-body prompt=private-question api_key=private-credential"


def failure(kind):
    return kind(SECRET)


def wrapped_budget():
    error = ContextSummaryGenerationFailure("model_error")
    error.__cause__ = BillingBudgetExceeded(SECRET, reason="global_risk_limit")
    return error


class Repository:
    def __init__(self, publication=None):
        self.batch = SimpleNamespace(user_id=uuid4(), lease_token=str(uuid4()), fingerprint="safe")
        self.publication = publication
        self.claimed, self.failures = [], []

    def claim(self, **limits):
        self.claimed.append(limits)
        return self.batch

    def complete(self, *args):
        if isinstance(self.publication, Exception):
            raise self.publication
        return self.publication is not False

    def failed(self, batch, **diagnostic):
        assert batch is self.batch
        self.failures.append(diagnostic)


class Billing:
    def __init__(self, *, opening=None, starting=None, settling=None):
        self.opening, self.starting, self.settling = opening, starting, settling
        self.parameters = None

    def open(self, **parameters):
        self.parameters = parameters
        if self.opening:
            raise self.opening
        return self

    def __enter__(self):
        if self.starting:
            raise self.starting
        return self

    def __exit__(self, *args):
        return False

    def finish(self, outcome):
        assert outcome == "success"
        if self.settling:
            raise self.settling


@pytest.mark.parametrize(
    "billing,generation,publication,expected,terminal",
    [
        (Billing(opening=failure(BillingContextMissing)), None, None,
         "billing_open:billing_context_missing", False),
        (Billing(opening=BillingContextMissing(SECRET, reason="phase_policy_missing")), None, None,
         "billing_open:phase_policy_missing", False),
        (Billing(opening=BillingContextMissing(SECRET, reason="billing_runtime_missing")),
         None, None, "billing_open:billing_runtime_missing", False),
        (Billing(starting=failure(BillingReplayBlocked)), None, None,
         "billing_start:billing_replay_blocked", False),
        (Billing(starting=BillingContextMissing(SECRET, reason="phase_policy_missing")),
         None, None, "billing_start:phase_policy_missing", False),
        (None, BillingContextMissing(SECRET, reason="billing_runtime_missing"), None,
         "model:billing_runtime_missing", False),
        (None, wrapped_budget(), None, "model:budget_exceeded", True),
        (None, failure(BillingRouteMismatch), None, "model:billing_route_mismatch", False),
        (None, failure(UnknownTokenUsage), None, "model:usage_unknown", False),
        (None, failure(UnknownPrice), None, "model:price_unknown", False),
        (None, failure(ModelDeliveryRejected), None, "model:delivery_rejected", False),
        (None, ContextSummaryGenerationFailure("http_error", http_status=429), None,
         "model:http_429", False),
        (None, ContextSummaryGenerationFailure("invalid_output"), None,
         "model:invalid_output", False),
        (None, ContextSummaryGenerationFailure("timeout"), None, "model:timeout", False),
        (None, ContextSummaryGenerationFailure("transport_error"), None,
         "model:transport_error", False),
        (None, ContextSummaryGenerationFailure("request_limit"), None,
         "model:request_limit", False),
        (None, ContextSummaryGenerationFailure("model_config"), None,
         "model:model_config", False),
        (None, failure(RuntimeError), None, "model:summary_failed", False),
        (None, None, False, "publish:lease_lost", False),
        (None, None, failure(sqlite3.OperationalError), "publish:storage_error", False),
        (Billing(settling=failure(BillingReplayBlocked)), None, None,
         "settle:billing_replay_blocked", False),
    ],
)
def test_worker_persists_only_fixed_stage_reason_and_preserves_limits(
    billing, generation, publication, expected, terminal, caplog, monkeypatch
):
    from qunxue_api.application import conversation_summary

    # Earlier migration fixtures use fileConfig(disable_existing_loggers=True).
    # Isolate this capture test while preserving and restoring that global state.
    monkeypatch.setattr(conversation_summary.logger, "disabled", False)
    monkeypatch.setattr(conversation_summary.logger, "propagate", True)
    repository = Repository(publication)

    @contextmanager
    def scope():
        yield repository

    def generate(batch):
        assert batch is repository.batch
        if generation:
            raise generation
        return {}, 80, 20

    worker = ConversationSummaryWorker(scope, generate=generate, billing=billing)
    with caplog.at_level(logging.WARNING, logger=conversation_summary.logger.name):
        assert worker.run_once()
    assert repository.claimed == [{"idle_seconds": 600, "daily_calls": 8, "daily_tokens": 64000}]
    extra = {"release_reservation": True} if expected in {
        "billing_open:phase_policy_missing", "billing_open:billing_runtime_missing"
    } else {}
    assert repository.failures == [{"terminal": terminal, "code": expected, **extra}]
    assert len(expected) <= 64
    assert SECRET not in str(repository.failures) and SECRET not in caplog.text
    assert expected in caplog.text
    if billing:
        assert billing.parameters["phase"] == "conversation_summary"


def test_storage_wrapper_and_cyclic_cause_do_not_copy_exception_data(caplog):
    from qunxue_api.application.conversation_summary import _failure_diagnostic

    error = RuntimeError(SECRET)
    error.__cause__ = error
    assert _failure_diagnostic(error, SECRET) == ("unknown_stage:summary_failed", False)
    from sqlalchemy.exc import OperationalError

    error = OperationalError(SECRET, {"credential": SECRET}, sqlite3.OperationalError(SECRET))
    assert _failure_diagnostic(error, "publish") == ("publish:storage_error", False)
    assert SECRET not in caplog.text


def test_untrusted_or_mutated_diagnostic_fields_fail_closed_without_echoing_text():
    from qunxue_api.application.conversation_summary import _failure_diagnostic

    error = BillingContextMissing(SECRET, reason={"private": SECRET})
    assert _failure_diagnostic(error, "billing_open") == (
        "billing_open:billing_context_missing", False
    )
    generated = ContextSummaryGenerationFailure("http_error", http_status=429)
    generated.reason = [SECRET]
    generated.http_status = SECRET
    assert _failure_diagnostic(generated, "model") == ("model:model_error", False)


@pytest.mark.parametrize("missing", ["phase", "runtime"])
def test_real_billing_guards_record_exact_stage_without_calling_generator(
    plain_client, missing, caplog
):
    from datetime import UTC, datetime
    from uuid import UUID

    from billing_test_support import configure_synthetic_billing
    from sqlalchemy import text
    from test_agent_memory import register
    from test_conversation_context import seed

    from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow, MemoryUsageRow

    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    if missing == "phase":
        configure_synthetic_billing(plain_client.app, phase="agent_answer")
        plain_client.app.state.billing_operations.phase_policies.pop("conversation_summary", None)
        reason = "phase_policy_missing"
    else:
        assert plain_client.app.state.billing_operations.runtime is None
        policies = plain_client.app.state.billing_operations.phase_policies
        policies["conversation_summary"] = "operator"
        reason = "billing_runtime_missing"
    generated = []

    def forbidden_generate(batch):
        generated.append(batch)
        raise AssertionError("A billing guard must run before generation")

    worker = plain_client.app.state.context_summary_worker
    worker.idle_seconds = 0
    worker.billing = plain_client.app.state.billing_operations
    worker.generate = forbidden_generate
    with caplog.at_level(logging.WARNING):
        assert worker.run_once()
    assert generated == []
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.last_error == f"billing_open:{reason}"
        assert row.attempts == 0 and row.retry_after is not None
        assert row.lease_token is None and row.lease_until is None
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        assert usage.calls == 0 and usage.budget_tokens == 0
        assert session.scalar(text("SELECT count(*) FROM billing_operations")) == 0
        assert session.scalar(text("SELECT count(*) FROM billing_attempts")) == 0
    assert SECRET not in caplog.text
