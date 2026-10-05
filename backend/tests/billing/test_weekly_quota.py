from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from qunxue_api.adapters.sqlite.quota_periods import (
    QuotaConfigurationUnavailable,
    ensure_quota_period,
    get_quota_period,
    settle_quota_period,
)

NOW = datetime(2026, 10, 5, 8, tzinfo=UTC)


@pytest.fixture
def wallet(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'quota.db'}",
        connect_args={"timeout": 10, "check_same_thread": False},
    )
    schema = [
        "CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance INTEGER,"
        "quota_period_epoch INTEGER,updated_at TEXT)",
        "CREATE TABLE credit_quota_periods(user_id TEXT,epoch INTEGER,plan_id TEXT,"
        "limit_points INTEGER,started_at TEXT,expires_at TEXT,balance INTEGER,"
        "total_credit_pico TEXT,closed_at TEXT,reason TEXT,PRIMARY KEY(user_id,epoch))",
        "CREATE TABLE billing_operations(run_id TEXT PRIMARY KEY,user_id TEXT,"
        "quota_period_epoch INTEGER,status TEXT)",
        "CREATE TABLE billing_precision(user_id TEXT PRIMARY KEY,total_credit_pico TEXT)",
        "CREATE TABLE credit_ledger(entry_id TEXT PRIMARY KEY,user_id TEXT,run_id TEXT,kind TEXT,"
        "points INTEGER,balance_after INTEGER,quota_period_epoch INTEGER,input_tokens INTEGER,"
        "output_tokens INTEGER,model TEXT,created_at TEXT)",
        "CREATE TABLE billing_precision_adjustments(reset_id TEXT,user_id TEXT,reason TEXT,"
        "before_precision TEXT,delta_precision TEXT,after_precision TEXT,before_balance INTEGER,"
        "delta_points INTEGER,after_balance INTEGER,closed_operation_ids TEXT,created_at TEXT,"
        "PRIMARY KEY(reset_id,user_id))",
        "CREATE TABLE subscriptions(provider_id TEXT,user_id TEXT,plan_id TEXT,status TEXT,"
        "current_period_end TEXT,created_at TEXT,current_period_start TEXT)",
        "INSERT INTO credit_accounts VALUES('u',30,NULL,'2026-10-01')",
        "INSERT INTO billing_precision VALUES('u','250000000000')",
    ]
    with engine.begin() as conn:
        for sql in schema:
            conn.execute(text(sql))
    yield engine
    engine.dispose()


def transaction(engine, fn):
    with engine.connect() as conn:
        conn.execute(text("BEGIN IMMEDIATE"))
        result = fn(conn)
        conn.commit()
        return result


def test_get_does_not_start_first_period(wallet):
    assert transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW, start=False)) is None
    with wallet.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 0


def test_first_message_preserves_history_and_anchors_exact_168_hours(wallet):
    with wallet.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=10000"))
    p = transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW))
    assert p["balance"] == 30 and p["limit_points"] == 30
    assert datetime.fromisoformat(p["expires_at"]) == NOW + timedelta(hours=168)
    before = transaction(
        wallet,
        lambda c: ensure_quota_period(
            c, "u", NOW + timedelta(hours=168) - timedelta(microseconds=1)
        ),
    )
    assert before["epoch"] == 1 and before["balance"] == 30
    after = transaction(
        wallet, lambda c: ensure_quota_period(c, "u", NOW + timedelta(hours=168), start=False)
    )
    assert after["epoch"] == 2 and after["balance"] == 30 and after["total_credit_pico"] == "0"
    with wallet.connect() as conn:
        assert (
            conn.scalar(text("SELECT points FROM credit_ledger WHERE model='quota-activation'"))
            == -9970
        )
        assert get_quota_period(conn, "u", 0)["balance"] == 10000


def test_renewal_preserves_cadence_without_stacking_missed_grants(wallet):
    transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW))
    later = NOW + timedelta(days=25, hours=3)
    p = transaction(wallet, lambda c: ensure_quota_period(c, "u", later))
    assert datetime.fromisoformat(p["started_at"]) == NOW + timedelta(days=21)
    assert datetime.fromisoformat(p["expires_at"]) == NOW + timedelta(days=28)
    assert p["balance"] == 30
    with wallet.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM credit_ledger")) == 2


@pytest.mark.parametrize("initial", [0, 12, 30, 10000])
def test_bank_reset_replaces_not_adds_and_audits_net_delta(wallet, initial):
    with wallet.begin() as c:
        c.execute(text("UPDATE credit_accounts SET balance=:b"), {"b": initial})
        c.execute(text("INSERT INTO billing_operations VALUES('old','u',NULL,'active')"))
    p = transaction(
        wallet, lambda c: ensure_quota_period(c, "u", NOW, reset=True, receipt_id="code")
    )
    assert p["balance"] == 30 and p["total_credit_pico"] == "0"
    with wallet.connect() as c:
        assert (
            c.scalar(text("SELECT points FROM credit_ledger WHERE entry_id='code'")) == 30 - initial
        )
        assert c.scalar(text("SELECT quota_period_epoch FROM billing_operations")) == 0
        assert get_quota_period(c, "u", 0)["balance"] == initial
        assert (
            c.scalar(text("SELECT delta_precision FROM billing_precision_adjustments"))
            == "-250000000000"
        )


def test_old_inflight_settlement_cannot_consume_reset_quota(wallet):
    first = transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW))
    reset = transaction(
        wallet,
        lambda c: ensure_quota_period(
            c, "u", NOW + timedelta(hours=1), reset=True, receipt_id="code"
        ),
    )
    transaction(
        wallet, lambda c: settle_quota_period(c, "u", first["epoch"], 22, "8250000000000", NOW)
    )
    with wallet.connect() as c:
        assert c.scalar(text("SELECT balance FROM credit_accounts")) == reset["balance"] == 30
        assert c.scalar(text("SELECT total_credit_pico FROM billing_precision")) == "0"
        assert get_quota_period(c, "u", 1)["balance"] == 22


def test_concurrent_first_messages_and_renewals_grant_once(wallet):
    def start(at):
        return transaction(wallet, lambda c: ensure_quota_period(c, "u", at))["epoch"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(start, [NOW, NOW])) == [1, 1]
        assert list(pool.map(start, [NOW + timedelta(days=7)] * 2)) == [2, 2]
    with wallet.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 3
        assert c.scalar(text("SELECT count(*) FROM credit_ledger")) == 2


def test_current_paid_plan_requires_configuration_and_uses_configured_limit(wallet):
    with wallet.begin() as c:
        c.execute(
            text(
                "INSERT INTO subscriptions(provider_id,user_id,plan_id,status,"
                "current_period_end,created_at) VALUES('s','u','custom-paid','active',NULL,:now)"
            ),
            {"now": NOW.isoformat()},
        )
    with pytest.raises(QuotaConfigurationUnavailable):
        transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW, reset=True))
    p = transaction(
        wallet, lambda c: ensure_quota_period(c, "u", NOW, {"custom-paid": 75}, reset=True)
    )
    assert p["balance"] == 75 and p["limit_points"] == 75 and p["plan_id"] == "custom-paid"


def test_plan_change_is_resolved_at_renewal(wallet):
    transaction(wallet, lambda c: ensure_quota_period(c, "u", NOW))
    with wallet.begin() as c:
        c.execute(
            text(
                "INSERT INTO subscriptions(provider_id,user_id,plan_id,status,"
                "current_period_end,created_at) VALUES('s','u','plus','trialing',NULL,:now)"
            ),
            {"now": NOW.isoformat()},
        )
    p = transaction(
        wallet, lambda c: ensure_quota_period(c, "u", NOW + timedelta(days=7), {"plus": 75})
    )
    assert p["balance"] == 75 and p["plan_id"] == "plus"
