# ruff: noqa: F811
"""Cross-period financial safety, including pre-policy delivery refunds."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_durable_billing import balance, wallet  # noqa: F401

from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period
from qunxue_api.modules.billing import (
    BillingContextMissing,
    BillingReplayBlocked,
    PriceBook,
    Tariff,
)


@pytest.fixture
def epoch_wallet(wallet):
    runtime, engine = wallet
    now = [datetime(2026, 10, 5, 8, tzinfo=UTC)]
    runtime.clock = lambda: now[0]
    runtime.billing_policy = "actual_usage_v1"
    runtime.book = PriceBook(credits_per_usd=10000, version="synthetic-period",
                            tariffs={"synthetic-meter": Tariff(
                                1000000, 1000000, 1000000, 1000000, long_threshold=None
                            )})
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE credit_accounts ADD COLUMN quota_period_epoch INTEGER"))
        conn.execute(text("ALTER TABLE credit_ledger ADD COLUMN quota_period_epoch INTEGER"))
        conn.execute(text("UPDATE credit_accounts SET balance=30"))
        conn.execute(text("CREATE TABLE credit_quota_periods (user_id TEXT, epoch INTEGER, "
                          "plan_id TEXT,limit_points INTEGER,started_at TEXT,expires_at TEXT, "
                          "balance INTEGER,total_credit_pico TEXT,closed_at TEXT,reason TEXT, "
                          "PRIMARY KEY(user_id,epoch))"))
        conn.execute(text("CREATE TABLE billing_precision_adjustments (reset_id TEXT,user_id TEXT,"
                          "reason TEXT,before_precision TEXT,delta_precision TEXT,"
                          "after_precision TEXT,before_balance INTEGER,delta_points INTEGER,"
                          "after_balance INTEGER,closed_operation_ids TEXT,created_at TEXT,"
                          "PRIMARY KEY(reset_id,user_id))"))
    return runtime, engine, now


def start(runtime):
    return runtime.start(user_id="user", run_id=uuid4(), fingerprint="synthetic")


def attempt(runtime, run):
    return runtime.before_attempt(run_id=run, endpoint_id="primary", model="synthetic-meter",
                                  input_limit=1000, output_limit=100, request_hash=str(uuid4()))


def complete(runtime, ident, tokens=600, outcome="error"):
    runtime.complete_attempt(attempt_id=ident, input_tokens=tokens, output_tokens=0,
                             returned_model="synthetic-meter", outcome=outcome)


def reset(runtime, now):
    with runtime._transaction() as conn:
        return ensure_quota_period(conn, "user", now, reset=True, receipt_id=str(uuid4()))


@pytest.mark.parametrize("boundary", ["renewal", "bank_reset"])
def test_late_confirmed_failure_debits_only_original_epoch(epoch_wallet, boundary):
    runtime, engine, now = epoch_wallet
    run = start(runtime)
    complete(runtime, attempt(runtime, run))
    late = attempt(runtime, run)
    assert balance(engine) == 24
    if boundary == "renewal":
        now[0] += timedelta(days=7)
        new_run = start(runtime)
    else:
        reset(runtime, now[0])
        new_run = start(runtime)
    assert balance(engine) == runtime.available_balance("user") == 30
    complete(runtime, late, tokens=1000)
    runtime.finish(run_id=run, outcome="error")
    complete(runtime, late, tokens=1000)
    assert balance(engine) == runtime.available_balance("user") == 30
    with engine.connect() as conn:
        periods = conn.execute(text("SELECT epoch,balance,total_credit_pico "
                                    "FROM credit_quota_periods WHERE epoch>0 ORDER BY epoch")).all()
        assert periods == [(1, 14, "16000000000000"), (2, 30, "0")]
        assert conn.scalar(text("SELECT total_credit_pico FROM billing_precision")) == "0"
        assert conn.execute(text("SELECT points,balance_after,quota_period_epoch "
                                 "FROM credit_ledger "
                                 "WHERE kind='usage' ORDER BY rowid")).all() == [
            (-6, 24, 1), (-10, 14, 1),
        ]
        assert conn.scalar(text("SELECT quota_period_epoch FROM billing_operations "
                                "WHERE run_id=:run"), {"run": new_run}) == 2


def test_old_delivery_refund_after_reset_stays_in_the_old_epoch(epoch_wallet):
    runtime, engine, now = epoch_wallet
    runtime.billing_policy = "delivery_v1"
    # A legacy operation can predate the first quota epoch entirely.
    run = start(runtime)
    complete(runtime, attempt(runtime, run), outcome="success")
    assert runtime.finish(run_id=run, outcome="paused") == "paused"
    assert balance(engine) == 24
    reset(runtime, now[0])
    assert runtime.finish(run_id=run, outcome="cancelled") == "refunded"
    assert balance(engine) == 30
    with engine.connect() as conn:
        assert conn.execute(text("SELECT epoch,balance,total_credit_pico "
                                 "FROM credit_quota_periods ORDER BY epoch")).all() == [
            (0, 30, "0"), (1, 30, "0"),
        ]
        assert conn.scalar(text("SELECT total_credit_pico FROM billing_precision")) == "0"
        assert conn.execute(text("SELECT points,balance_after,quota_period_epoch "
                                 "FROM credit_ledger "
                                 "WHERE model='billing-refund'")).one() == (6, 30, 0)


@pytest.mark.parametrize("policy", ["actual_usage_v1", "delivery_v1"])
def test_paused_scope_cannot_resume_against_another_period(epoch_wallet, policy):
    runtime, _, now = epoch_wallet
    runtime.billing_policy = policy
    run = start(runtime)
    complete(runtime, attempt(runtime, run), outcome="success")
    runtime.finish(run_id=run, outcome="paused")
    reset(runtime, now[0])
    with pytest.raises(BillingReplayBlocked, match="expired quota period"):
        runtime.start(user_id="user", run_id=run, fingerprint="resumed", resume=True)


def test_unknown_old_attempt_keeps_cost_risk_without_holding_new_quota(epoch_wallet):
    runtime, engine, now = epoch_wallet
    run = start(runtime)
    unknown = attempt(runtime, run)
    reset(runtime, now[0])
    assert runtime.available_balance("user") == 30
    runtime.complete_attempt(attempt_id=unknown, outcome="error")
    runtime.finish(run_id=run, outcome="error")
    assert balance(engine) == runtime.available_balance("user") == 30
    assert runtime.risk_breakdown()["pending_unknown"] == 1100000000


def test_operator_scope_does_not_start_personal_period(epoch_wallet):
    runtime, engine, _ = epoch_wallet
    runtime.start(user_id="user", run_id=uuid4(), fingerprint="operator", exempt=True)
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 0
        assert conn.scalar(text("SELECT quota_period_epoch FROM credit_accounts")) is None


def test_background_user_scope_cannot_start_first_personal_period(epoch_wallet):
    runtime, engine, _ = epoch_wallet
    with pytest.raises(BillingContextMissing) as error:
        runtime.start(user_id="user", run_id=uuid4(), fingerprint="memory", quota_start=False)
    assert error.value.reason == "quota_period_not_started"
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 0
        assert conn.scalar(text("SELECT count(*) FROM billing_operations")) == 0
    start(runtime)
    runtime.start(user_id="user", run_id=uuid4(), fingerprint="memory", quota_start=False)
