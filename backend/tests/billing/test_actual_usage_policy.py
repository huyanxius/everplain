# ruff: noqa: F811
"""Future usage policy; old snapshots and account-reset evidence remain untouched."""

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from test_durable_billing import balance, operation, wallet  # noqa: F401

from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import BillingBudgetExceeded, BillingRouteMismatch


@pytest.fixture
def actual_wallet(wallet):
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v1"
    return runtime, engine


def attempt(runtime, run):
    return runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="gpt-6.1-sol",
        input_limit=1000, output_limit=100, request_hash=str(uuid4()),
        provider_host="synthetic.test",
    )


def complete(runtime, ident, outcome="error", **extra):
    runtime.complete_attempt(
        attempt_id=ident, returned_model="gpt-6.1-sol", input_tokens=1000,
        output_tokens=100, cache_read_tokens=200, cache_write_tokens=300,
        outcome=outcome, **extra,
    )


@pytest.mark.parametrize("outcome", ["success", "error", "limited", "rejected"])
def test_confirmed_usage_is_paid_even_when_delivery_fails(actual_wallet, outcome):
    runtime, engine = actual_wallet
    run = operation(runtime)
    assert runtime.available_balance("user") == 10000
    ident = attempt(runtime, run)
    assert runtime.available_balance("user") == 9965
    complete(runtime, ident, outcome)
    # Actual cost is visible immediately, with no maximum-turn wallet hold.
    assert balance(engine) == runtime.available_balance("user") == 9973
    for terminal in ("error", "error", "cancelled", "success"):
        runtime.finish(run_id=run, outcome=terminal)
    complete(runtime, ident, outcome)
    assert balance(engine) == 9973
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM billing_operations")).mappings().one()
        assert row["hold_points"] == 0
        assert row["credit_pico"] == "27700000000000"
        assert row["charged_points"] == 27
        assert json.loads(row["price_json"])["billing_policy"] == "actual_usage_v1"
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1
        assert conn.execute(text(
            "SELECT input_tokens,output_tokens FROM credit_ledger"
        )).one() == (1000, 100)


def test_validation_retry_keeps_confirmed_cost_and_shared_fraction(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    first = attempt(runtime, run)
    complete(runtime, first, "success")
    runtime.mark_attempt_error(first, "output_validation_retry")
    second = attempt(runtime, run)
    complete(runtime, second, "success")
    runtime.finish(run_id=run, outcome="success")
    assert balance(engine) == 9945
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT sum(billable) FROM billing_attempts")) == 2
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 2
        assert conn.execute(text(
            "SELECT sum(input_tokens),sum(output_tokens) FROM credit_ledger"
        )).one() == (2000, 200)
        assert conn.scalar(text("SELECT total_credit_pico FROM billing_precision")) == (
            "55400000000000"
        )


def test_unknown_failure_releases_wallet_without_erasing_operator_risk(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    ident = attempt(runtime, run)
    runtime.complete_attempt(attempt_id=ident, outcome="error", failure_code="stream_incomplete")
    assert runtime.available_balance("user") == 10000
    assert runtime.operator_risk_pico() == 3500000000
    runtime.finish(run_id=run, outcome="error")
    assert len(runtime.pending_reconciliation()) == 1
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT reference_cost_pico FROM billing_attempts")) is None
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
    assert balance(engine) == 10000


def test_proven_not_sent_releases_capacity_and_never_charges(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    ident = attempt(runtime, run)
    assert runtime.release_proven_not_sent(ident)
    complete(runtime, ident)
    assert runtime.available_balance("user") == balance(engine) == 10000
    assert runtime.operator_risk_pico() == 0


def test_two_open_turns_only_reserve_budget_for_actual_outbound_attempts(actual_wallet):
    runtime, engine = actual_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=35"))
    first, second = operation(runtime), operation(runtime)
    first_attempt = attempt(runtime, first)
    with pytest.raises(BillingBudgetExceeded):
        attempt(runtime, second)
    runtime.complete_attempt(attempt_id=first_attempt, outcome="error")
    next_attempt = attempt(runtime, second)
    complete(runtime, next_attempt)
    assert balance(engine) == 8
    with pytest.raises(BillingBudgetExceeded):
        attempt(runtime, first)
    runtime.finish(run_id=first, outcome="error")
    runtime.finish(run_id=second, outcome="error")
    assert runtime.available_balance("user") == 8


def test_simultaneous_outbound_claims_cannot_spend_same_balance(actual_wallet):
    runtime, engine = actual_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=35"))
    runs = [operation(runtime), operation(runtime)]

    def claim(run):
        try:
            return attempt(runtime, run)
        except BillingBudgetExceeded:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim, runs))
    assert sum(c is not None for c in claims) == 1
    assert runtime.available_balance("user") == 0
    for run in runs:
        runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == runtime.available_balance("user") == 35


def test_receipt_and_charge_survive_restart_and_stale_recovery(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    complete(runtime, attempt(runtime, run))
    unknown = attempt(runtime, run)
    restarted = DurableBilling(
        engine, price_book=runtime.book, max_attempt_pico=runtime.max_attempt_pico,
        max_operation_pico=runtime.max_operation_pico, daily_budget_pico=runtime.daily_budget_pico,
    )
    restarted.recover_stale(before=datetime.now(UTC) + timedelta(days=1))
    assert balance(engine) == restarted.available_balance("user") == 9973
    # A late callback reconciles cost but never revives a closed operation or bills twice.
    complete(restarted, unknown)
    restarted.finish(run_id=run, outcome="success")
    assert balance(engine) == 9973
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1


def test_duplicate_provider_receipt_cannot_charge_twice(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    complete(runtime, attempt(runtime, run), provider_response_id="synthetic-unique")
    duplicate = attempt(runtime, run)
    with pytest.raises(IntegrityError):
        complete(runtime, duplicate, provider_response_id="synthetic-unique")
    runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == runtime.available_balance("user") == 9973
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1


def test_old_snapshots_keep_their_delivery_policy_without_retroactive_debit(wallet):
    runtime, engine = wallet
    run = operation(runtime)
    old_attempt = attempt(runtime, run)
    # Also cover genuine deployed snapshots written before a policy field existed.
    with engine.begin() as conn:
        conn.execute(text("UPDATE billing_operations SET price_json=json_remove("
                          "price_json,'$.billing_policy')"))
    runtime.billing_policy = "actual_usage_v1"
    complete(runtime, old_attempt)
    runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == 10000
    new_run = operation(runtime)
    complete(runtime, attempt(runtime, new_run))
    runtime.finish(run_id=new_run, outcome="error")
    assert balance(engine) == 9973


def test_daily_risk_guard_is_preserved_and_known_cost_replaces_maximum(actual_wallet):
    runtime, _ = actual_wallet
    runtime.daily_budget_pico = 5_000_000_000
    run = operation(runtime)
    complete(runtime, attempt(runtime, run))
    assert runtime.risk_breakdown() == {
        "known_today": 2770000000, "active_reserved": 0, "pending_unknown": 0,
    }
    with pytest.raises(BillingBudgetExceeded) as error:
        attempt(runtime, run)
    assert error.value.reason == "service_budget_exceeded"


def test_all_failed_paid_attempts_cannot_be_reported_as_success(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    complete(runtime, attempt(runtime, run))
    assert runtime.finish(run_id=run, outcome="success") == "error"
    assert balance(engine) == runtime.available_balance("user") == 9973


def test_exempt_operator_usage_remains_operator_funded(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime, exempt=True)
    complete(runtime, attempt(runtime, run))
    runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == 10000
    assert runtime.operator_risk_pico() == 2770000000


def test_startup_releases_recent_actual_request_without_waiving_known_cost(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    complete(runtime, attempt(runtime, run))
    attempt(runtime, run)
    runtime.recover_stale(before=datetime.now(UTC) - timedelta(minutes=30),
                          recover_actual_usage=True)
    assert balance(engine) == runtime.available_balance("user") == 9973
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT status FROM billing_operations")) == "error"
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1
    assert runtime.risk_breakdown()["pending_unknown"] == 3500000000


def test_sqlite_application_finalizer_failure_still_pays_confirmed_usage(plain_client):
    from dataclasses import replace
    from uuid import UUID

    from test_application_metering import Runner
    from test_phase_billing_p0 import build_application, register_with_phase_budget

    class FailingRunner(Runner):
        def run(self, **kwargs):
            super().run(**kwargs)
            raise RuntimeError("synthetic application failure")

    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    with database.session() as session:
        application, runtime, _ = build_application(database, session, runner=FailingRunner())
        runtime.billing_policy = "actual_usage_v1"
        # This real migrated account now starts a Free30 period on its first
        # accepted message. Keep the synthetic provider cap affordable within it.
        runtime.book = replace(runtime.book, credits_per_usd=1000)
        with pytest.raises(RuntimeError, match="synthetic application failure"):
            application.run_turn(user_id=user, conversation_id=None, prompt="synthetic",
                                 idempotency_key="actual-failure")
        assert runtime.available_balance(user) == 21
        assert session.scalar(text("SELECT total_credit_pico FROM billing_precision")) == (
            "9200000000000"
        )
        assert session.scalar(text("SELECT status FROM billing_operations")) == "error"
        assert session.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 1
        assert session.scalar(text(
            "SELECT count(*) FROM agent_messages WHERE role='assistant'"
        )) == 0


def test_process_exit_after_receipt_cannot_lose_or_repeat_actual_charge(actual_wallet):
    runtime, engine = actual_wallet
    process = subprocess.run([
        sys.executable, "-c", """
import os, sys
from sqlalchemy import create_engine
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import PriceBook
runtime = DurableBilling(create_engine(sys.argv[1]),
    price_book=PriceBook(credits_per_usd=10000, version='synthetic'),
    max_attempt_pico=10**11, max_operation_pico=10**11, daily_budget_pico=10**12)
runtime.start(user_id='user', run_id='process-kill', fingerprint='synthetic')
ident = runtime.before_attempt(run_id='process-kill', endpoint_id='primary',
    model='gpt-6.1-sol', input_limit=1000, output_limit=100, request_hash='synthetic')
runtime.complete_attempt(attempt_id=ident, returned_model='gpt-6.1-sol',
    input_tokens=1000, output_tokens=100, cache_read_tokens=200, cache_write_tokens=300,
    outcome='error', failure_code='stream_cancelled')
os._exit(73)
""", engine.url.render_as_string()], capture_output=True, text=True, check=False)
    assert process.returncode == 73, process.stderr
    assert balance(engine) == runtime.available_balance("user") == 9973
    runtime.recover_stale(before=datetime.now(UTC) - timedelta(minutes=30),
                          recover_actual_usage=True)
    runtime.finish(run_id="process-kill", outcome="error")
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 1
        assert conn.scalar(text("SELECT status FROM billing_operations")) == "error"


def test_receipt_and_debit_rollback_together_then_safe_retry_charges_once(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    ident = attempt(runtime, run)

    def fail_debit(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE credit_accounts SET balance=balance-"):
            raise RuntimeError("synthetic interrupted financial write")

    event.listen(engine, "before_cursor_execute", fail_debit)
    try:
        with pytest.raises(RuntimeError, match="synthetic interrupted financial write"):
            complete(runtime, ident)
    finally:
        event.remove(engine, "before_cursor_execute", fail_debit)
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT usage_state FROM billing_attempts")) == "unknown"
        assert conn.scalar(text("SELECT count(*) FROM credit_ledger")) == 0
        assert conn.scalar(text("SELECT count(*) FROM billing_precision")) == 0
    assert balance(engine) == 10000
    complete(runtime, ident)
    complete(runtime, ident)
    assert balance(engine) == runtime.available_balance("user") == 9973


def test_returned_model_mismatch_still_cannot_charge_unrequested_model(actual_wallet):
    runtime, engine = actual_wallet
    run = operation(runtime)
    with pytest.raises(BillingRouteMismatch):
        runtime.complete_attempt(
            attempt_id=attempt(runtime, run), returned_model="gpt-6-luna",
            input_tokens=1000, output_tokens=100, outcome="success",
        )
    runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == runtime.available_balance("user") == 10000
