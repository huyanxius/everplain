# ruff: noqa: F811
"""One-time bank RESET transactional and idempotency regressions, synthetic accounts."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from test_account_management_api import client as account_client  # noqa: F401
from test_account_management_api import register

from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.adapters.sqlite.quota_periods import QuotaConfigurationUnavailable
from qunxue_api.modules.billing import CreditCodeUnavailable, CreditService


def generate(database, user):
    with database.session() as session:
        return (
            CreditService(SqliteCreditRepository(session), code_signing_secret="synthetic-secret")
            .generate_redemption_codes(
                actor_user_id=user,
                batch_id=str(uuid4()),
                count=1,
                expires_in_days=7,
            )
            .codes[0]
        )


def test_concurrent_same_user_consumes_code_and_resets_period_once(account_client):
    user = UUID(register(account_client, "concurrent@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    code = generate(db, user)
    now = datetime.now(UTC)
    with db.session() as s:
        s.execute(text("UPDATE credit_accounts SET balance=4 WHERE user_id=:u"), {"u": str(user)})

    def redeem(_):
        with db.session() as s:
            return CreditService(
                SqliteCreditRepository(s, clock=lambda: now), clock=lambda: now
            ).redeem(user_id=user, code=code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(redeem, [0, 1]))
    assert all(r.balance == 30 and r.delta_points == 26 for r in results)
    with db.session() as s:
        assert s.scalar(text("SELECT count(*) FROM credit_ledger WHERE model='bank-reset'")) == 1
        assert (
            s.scalar(
                text("SELECT quota_period_epoch FROM credit_accounts WHERE user_id=:u"),
                {"u": str(user)},
            )
            == 1
        )
        assert (
            s.scalar(
                text("SELECT count(*) FROM credit_quota_periods WHERE user_id=:u"), {"u": str(user)}
            )
            == 2
        )


def test_concurrent_different_users_only_one_can_consume_code(account_client):
    first = UUID(register(account_client, "first@example.com")["user"]["user_id"])
    account_client.cookies.clear()
    second = UUID(register(account_client, "second@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    code = generate(db, first)

    def redeem(user):
        try:
            with db.session() as s:
                return CreditService(SqliteCreditRepository(s)).redeem(user_id=user, code=code)
        except CreditCodeUnavailable:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(redeem, [first, second]))
    assert sum(r is not None for r in results) == 1
    with db.session() as s:
        assert s.scalar(text("SELECT count(*) FROM credit_ledger WHERE model='bank-reset'")) == 1


def test_replayed_code_does_not_restore_balance_or_restart_clock(account_client):
    user = UUID(register(account_client, "replay@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    code = generate(db, user)
    now = datetime.now(UTC)
    with db.session() as s:
        original = CreditService(
            SqliteCreditRepository(s, clock=lambda: now), clock=lambda: now
        ).redeem(user_id=user, code=code)
    with db.session() as s:
        s.execute(text("UPDATE credit_accounts SET balance=11 WHERE user_id=:u"), {"u": str(user)})
    later = now + timedelta(hours=12)
    with db.session() as s:
        replay = CreditService(
            SqliteCreditRepository(s, clock=lambda: later), clock=lambda: later
        ).redeem(user_id=user, code=code)
    assert (
        replay.balance == 11 and replay.quota_period_expires_at == original.quota_period_expires_at
    )


def test_missing_paid_quota_rolls_back_code_consumption(account_client):
    user = UUID(register(account_client, "plus@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    code = generate(db, user)
    now = datetime.now(UTC)
    with db.session() as s:
        s.execute(
            text(
                "INSERT INTO subscriptions(provider_id,user_id,customer_id,plan_id,status,"
                "current_period_end,cancel_at_period_end,created_at) "
                "VALUES('sub',:u,'customer','plus','active',NULL,0,:now)"
            ),
            {"u": str(user), "now": now.isoformat()},
        )
    with pytest.raises(QuotaConfigurationUnavailable), db.session() as s:
        CreditService(SqliteCreditRepository(s)).redeem(user_id=user, code=code)
    with db.session() as s:
        assert s.scalar(text("SELECT redeemed_by_user_id FROM credit_redemption_codes")) is None
        assert (
            s.scalar(text("SELECT balance FROM credit_accounts WHERE user_id=:u"), {"u": str(user)})
            == 30
        )
        assert s.scalar(text("SELECT count(*) FROM credit_quota_periods")) == 0
    with db.session() as s:
        reset = CreditService(SqliteCreditRepository(s, plan_limits={"plus": 75})).redeem(
            user_id=user, code=code
        )
    assert reset.balance == 75 and reset.redeemed_points == 75


def test_legacy_charge_mirrors_current_period_and_reset_fences_old_lease(account_client):
    user = UUID(register(account_client, "legacy-period@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    run = uuid4()
    with db.session() as s:
        service = CreditService(SqliteCreditRepository(s))
        service.reserve(user_id=user, run_id=run)
        entry = service.charge(
            user_id=user, run_id=run, input_tokens=100, output_tokens=25, model="synthetic"
        )
        assert entry.quota_period_epoch == 1
        assert entry.points == -2
    with db.session() as s:
        assert s.scalar(text("SELECT balance FROM credit_quota_periods WHERE epoch=1")) == 28
        assert (
            s.scalar(
                text("SELECT total_credit_pico FROM billing_precision WHERE user_id=:u"),
                {"u": str(user)},
            )
            == "2000000000000"
        )
    old_run = uuid4()
    with db.session() as s:
        CreditService(SqliteCreditRepository(s)).reserve(user_id=user, run_id=old_run)
    code = generate(db, user)
    with db.session() as s:
        CreditService(SqliteCreditRepository(s)).redeem(user_id=user, code=code)
    with pytest.raises(RuntimeError, match="not reserved"), db.session() as s:
        CreditService(SqliteCreditRepository(s)).charge(
            user_id=user,
            run_id=old_run,
            input_tokens=100,
            output_tokens=25,
            model="synthetic",
        )
    with db.session() as s:
        assert (
            s.scalar(text("SELECT balance FROM credit_accounts WHERE user_id=:u"), {"u": str(user)})
            == 30
        )


def test_financial_quota_migration_forbids_destructive_downgrade():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).parents[2] / "migrations/versions/20261005_0600_weekly_quota.py"
    spec = importlib.util.spec_from_file_location("weekly_quota_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(RuntimeError, match="cannot be downgraded"):
        module.downgrade()
