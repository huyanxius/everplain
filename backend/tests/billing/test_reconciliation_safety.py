# ruff: noqa: F811
import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DatabaseError
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.modules.billing import BillingReplayBlocked, UnknownPrice


def failed_receipt(runtime):
    run = runtime.start(user_id="user", run_id=uuid4(), fingerprint="synthetic")
    attempt = runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="gpt-6.1-sol",
        input_limit=100, output_limit=100, request_hash="synthetic",
        provider_host="synthetic.test",
    )
    runtime.record_response_received(attempt, "request-safety-1")
    runtime.complete_attempt(
        attempt_id=attempt, outcome="error", failure_code="stream_incomplete",
        provider_response_id="response-safety-1", reasoning_tokens=1,
        finish_reason="stream_incomplete",
    )
    receipt = dict(
        attempt_id=attempt, provider_host="synthetic.test",
        provider_request_id="request-safety-1", model="gpt-6.1-sol",
        input_tokens=10, output_tokens=5, cache_read_tokens=0, cache_write_tokens=0,
    )
    return run, attempt, receipt


def test_reconciliation_rechecks_resumed_operation_inside_write_transaction(wallet, monkeypatch):
    runtime, engine = wallet
    run, attempt, receipt = failed_receipt(runtime)
    delivered = runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="gpt-6.1-sol",
        input_limit=100, output_limit=100, request_hash="fallback",
        provider_host="synthetic.test",
    )
    runtime.complete_attempt(
        attempt_id=delivered, returned_model="gpt-6.1-sol", input_tokens=10, output_tokens=5,
        outcome="success",
    )
    assert runtime.finish(run_id=run, outcome="paused") == "paused"
    with engine.connect() as connection:
        before = dict(connection.execute(text(
            "SELECT * FROM billing_attempts WHERE attempt_id=:id"
        ), {"id": attempt}).mappings().one())
    original = runtime.complete_attempt

    def resumed_before_write(**kwargs):
        runtime.start(user_id="user", run_id=run, fingerprint="resumed", resume=True)
        return original(**kwargs)

    monkeypatch.setattr(runtime, "complete_attempt", resumed_before_write)
    with pytest.raises(BillingReplayBlocked, match="active delivery"):
        runtime.reconcile_usage(**receipt)
    with engine.connect() as connection:
        after = dict(connection.execute(text(
            "SELECT * FROM billing_attempts WHERE attempt_id=:id"
        ), {"id": attempt}).mappings().one())
    assert after == before


def test_reconciliation_is_atomic_cost_only_and_preserves_failed_delivery(wallet):
    runtime, engine = wallet
    run, attempt, receipt = failed_receipt(runtime)
    runtime.finish(run_id=run, outcome="error")
    with engine.connect() as connection:
        operation = dict(connection.execute(text(
            "SELECT * FROM billing_operations"
        )).mappings().one())
    statements = []

    def observe(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", observe)
    try:
        assert runtime.reconcile_usage(**receipt) == "reconciled"
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert statements[0] == "BEGIN IMMEDIATE"
    assert statements[-1].startswith("UPDATE billing_attempts SET")
    assert any("provider_request_id=:receipt" in sql for sql in statements) or any(
        "provider_request_id=?" in sql for sql in statements
    )
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT * FROM billing_attempts WHERE attempt_id=:id"
        ), {"id": attempt}).mappings().one()
        assert row["outcome"] == "error"
        assert row["failure_code"] == "stream_incomplete"
        assert row["finish_reason"] == "stream_incomplete"
        assert row["provider_response_id"] == "response-safety-1"
        assert row["reasoning_tokens"] == 1
        assert row["billable"] == 0
        assert row["usage_state"] == "known"
        assert row["reference_cost_pico"] == 70_000_000
        assert dict(connection.execute(text(
            "SELECT * FROM billing_operations"
        )).mappings().one()) == operation
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == 10000
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
    assert runtime.reconcile_usage(**receipt) == "already_known"


def test_proven_not_sent_cannot_be_reset_by_later_model_completion(wallet):
    runtime, engine = wallet
    run = runtime.start(user_id="user", run_id=uuid4(), fingerprint="synthetic")
    attempt = runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="gpt-6.1-sol",
        input_limit=100, output_limit=100, request_hash="synthetic",
        provider_host="synthetic.test",
    )
    assert runtime.release_proven_not_sent(attempt)
    with engine.connect() as connection:
        before = dict(connection.execute(text("SELECT * FROM billing_attempts")).mappings().one())
    runtime.complete_attempt(attempt_id=attempt, outcome="error", failure_code="APIConnectionError")
    runtime.complete_attempt(
        attempt_id=attempt, outcome="success", returned_model="gpt-6.1-sol",
        input_tokens=10, output_tokens=5,
    )
    with engine.connect() as connection:
        assert dict(connection.execute(text(
            "SELECT * FROM billing_attempts"
        )).mappings().one()) == before
    assert runtime.operator_risk_pico() == 0


def test_reconciliation_rejects_ambiguous_request_ids(wallet):
    runtime, _ = wallet
    run, _, receipt = failed_receipt(runtime)
    duplicate = runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="gpt-6.1-sol",
        input_limit=100, output_limit=100, request_hash="duplicate",
        provider_host="synthetic.test",
    )
    runtime.record_response_received(duplicate, receipt["provider_request_id"])
    runtime.finish(run_id=run, outcome="error")
    risk = runtime.operator_risk_pico()
    with pytest.raises(BillingReplayBlocked, match="ambiguous"):
        runtime.reconcile_usage(**receipt)
    assert runtime.operator_risk_pico() == risk


def test_reconciliation_cannot_silently_price_unsupported_saved_service_tier(wallet):
    runtime, engine = wallet
    run, attempt, receipt = failed_receipt(runtime)
    runtime.complete_attempt(
        attempt_id=attempt, outcome="error", failure_code="stream_incomplete",
        returned_service_tier="flex",
    )
    runtime.finish(run_id=run, outcome="error")
    with pytest.raises(UnknownPrice):
        runtime.reconcile_usage(**receipt)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT * FROM billing_attempts")).mappings().one()
        assert row["returned_service_tier"] == "flex"
        assert row["reference_cost_pico"] is None
        assert row["usage_state"] == "unpriced"
        assert row["outcome"] == "error"
        assert row["failure_code"] == "stream_incomplete"


def test_cost_reconciliation_preserves_account_reset_evidence_and_terminal_fence(wallet):
    runtime, engine = wallet
    run, _, receipt = failed_receipt(runtime)
    runtime.finish(run_id=run, outcome="error")
    with engine.begin() as connection:
        connection.connection.driver_connection.executescript(
            (Path(__file__).parents[1] / "fixtures/billing_reset_schema.sql").read_text()
        )
        connection.execute(text(
            "INSERT INTO billing_precision_adjustments VALUES "
            "('reset','user','synthetic','0','0','0',10000,0,10000,:runs,'synthetic')"
        ), {"runs": json.dumps([run])})
        before = connection.execute(text("SELECT * FROM billing_precision_adjustments")).all()
        fence = connection.scalar(text(
            "SELECT sql FROM sqlite_master WHERE name='billing_reset_terminal_fence'"
        ))
    assert runtime.reconcile_usage(**receipt) == "reconciled"
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT * FROM billing_precision_adjustments"
        )).all() == before
        assert connection.scalar(text(
            "SELECT sql FROM sqlite_master WHERE name='billing_reset_terminal_fence'"
        )) == fence
        assert connection.scalar(text("SELECT balance FROM credit_accounts")) == 10000
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
    with pytest.raises(DatabaseError, match="predates account reset"), engine.begin() as connection:
        connection.execute(text("UPDATE billing_operations SET status='active' WHERE run_id=:run"),
                           {"run": run})
