# ruff: noqa: F811
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from test_account_management_api import client as account_client  # noqa: F401
from test_account_management_api import login_admin, register

from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.modules.billing import CreditCodeBatchConflict, CreditCodeUnavailable, CreditService


def service(session, now):
    return CreditService(
        SqliteCreditRepository(session, clock=lambda: now),
        clock=lambda: now,
        code_signing_secret="synthetic-membership-signing-secret",
    )


def generate(database, user, now, plan="plus", batch=None):
    with database.session() as session:
        return (
            service(session, now)
            .generate_redemption_codes(
                actor_user_id=user,
                batch_id=batch or str(uuid4()),
                count=1,
                expires_in_days=365,
                plan_id=plan,
            )
            .codes[0]
        )


def redeem(database, user, code, now):
    with database.session() as session:
        return service(session, now).redeem(user_id=user, code=code)


def summary(database, user, now):
    with database.session() as session:
        return service(session, now).summary(user_id=user)


@pytest.mark.parametrize("plan,weekly", [("plus", 200), ("pro", 400), ("max", 1000)])
def test_membership_has_four_weekly_grants_then_returns_to_free(account_client, plan, weekly):
    user = UUID(register(account_client, f"{plan}@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    now = datetime.now(UTC)
    code = generate(db, user, now, plan)
    receipt = redeem(db, user, code, now)
    assert receipt.action == "membership" and receipt.plan_id == plan
    assert receipt.membership_starts_at == now
    assert receipt.membership_expires_at == now + timedelta(days=28)
    for week in range(4):
        value = summary(db, user, now + timedelta(days=week * 7))
        assert value.balance == weekly
        assert value.quota_plan_id == plan
        assert value.quota_period_expires_at == now + timedelta(days=(week + 1) * 7)
        with db.session() as session:
            session.execute(
                text("UPDATE credit_accounts SET balance=0 WHERE user_id=:u"), {"u": str(user)}
            )
    value = summary(db, user, now + timedelta(days=28))
    assert value.balance == 30 and value.quota_plan_id == "free"


def test_renewal_queues_without_erasing_remaining_allowance_and_is_idempotent(account_client):
    user = UUID(register(account_client, "queue@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    now = datetime.now(UTC)
    redeem(db, user, generate(db, user, now), now)
    with db.session() as session:
        session.execute(
            text("UPDATE credit_accounts SET balance=17 WHERE user_id=:u"), {"u": str(user)}
        )
    second = generate(db, user, now, "max")
    a = redeem(db, user, second, now + timedelta(days=1))
    b = redeem(db, user, second, now + timedelta(days=1))
    assert a.balance == b.balance == 17
    assert a.delta_points == b.delta_points == 0
    assert a.membership_starts_at == b.membership_starts_at == now + timedelta(days=28)
    assert a.membership_expires_at == b.membership_expires_at == now + timedelta(days=56)
    value = summary(db, user, now + timedelta(days=28))
    assert value.balance == 1000 and value.quota_plan_id == "max"
    assert value.quota_period_expires_at == now + timedelta(days=35)
    assert summary(db, user, now + timedelta(days=56)).quota_plan_id == "free"


def test_same_batch_cannot_change_plan(account_client):
    user = UUID(register(account_client, "batch@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    now = datetime.now(UTC)
    batch = str(uuid4())
    generate(db, user, now, "plus", batch)
    with pytest.raises(CreditCodeBatchConflict):
        generate(db, user, now, "max", batch)


def test_only_one_account_can_redeem_membership_code(account_client):
    first = UUID(register(account_client, "one@example.com")["user"]["user_id"])
    account_client.cookies.clear()
    second = UUID(register(account_client, "two@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    now = datetime.now(UTC)
    code = generate(db, first, now)

    def claim(user):
        try:
            return redeem(db, user, code, now)
        except CreditCodeUnavailable:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (first, second)))
    assert sum(value is not None for value in results) == 1
    with db.session() as session:
        assert session.scalar(text("SELECT count(*) FROM subscriptions")) == 1


def test_bank_reset_does_not_extend_membership_expiry(account_client):
    user = UUID(register(account_client, "reset@example.com")["user"]["user_id"])
    db = account_client.app.state.database
    now = datetime.now(UTC)
    redeem(db, user, generate(db, user, now), now)
    reset = generate(db, user, now, None)
    receipt = redeem(db, user, reset, now + timedelta(days=26))
    assert receipt.quota_period_expires_at == now + timedelta(days=28)
    assert summary(db, user, now + timedelta(days=28)).quota_plan_id == "free"


def test_admin_can_issue_membership_and_member_can_redeem_without_payment(account_client):
    login_admin(account_client)
    issued = account_client.post(
        "/api/admin/credit-redemption-codes",
        headers={"Idempotency-Key": str(uuid4())},
        json={"count": 1, "expires_in_days": 30, "plan_id": "pro"},
    )
    assert issued.status_code == 201, issued.text
    assert issued.json()["action"] == "membership"
    assert issued.json()["plan_id"] == "pro"
    account_client.cookies.clear()
    register(account_client, "http-member@example.com")
    redeemed = account_client.post(
        "/api/account/credit-redemptions",
        headers={"Idempotency-Key": str(uuid4())},
        json={"code": issued.json()["codes"][0]},
    )
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["action"] == "membership"
    assert redeemed.json()["balance"] == 400
    assert redeemed.json()["membership_expires_at"]
    overview = account_client.get("/api/subscription").json()
    assert overview["available"] is False
    assert overview["subscription"]["status"] == "active"
    assert overview["subscription"]["plan_id"] == "pro"
    assert overview["subscription"]["current_period_start"]
    assert account_client.get("/api/account/credits").json()["balance"] == 400
    rejected = account_client.post(
        "/api/admin/credit-redemption-codes",
        headers={"Idempotency-Key": str(uuid4())},
        json={"count": 1, "expires_in_days": 30, "plan_id": "max"},
    )
    assert rejected.status_code == 403


def test_generated_points_match_configured_public_allowance(account_client):
    user = UUID(register(account_client, "configured@example.com")["user"]["user_id"])
    now = datetime.now(UTC)
    with account_client.app.state.database.session() as session:
        svc = CreditService(
            SqliteCreditRepository(session, plan_limits={"plus": 70}, clock=lambda: now),
            plan_limits={"plus": 70},
            clock=lambda: now,
            code_signing_secret="synthetic-configured-plan-secret",
        )
        batch = svc.generate_redemption_codes(
            actor_user_id=user,
            batch_id=str(uuid4()),
            count=1,
            expires_in_days=7,
            plan_id="plus",
        )
        assert batch.points == 70
        assert svc.redeem(user_id=user, code=batch.codes[0]).balance == 70
