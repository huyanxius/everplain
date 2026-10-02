"""Exercise real account erasure routes against isolated temporary data only."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_account_management_api import client, register  # noqa: F401

from qunxue_api.adapters.sqlite.subscriptions import SubscriptionCheckoutRow, SubscriptionRow


@pytest.mark.parametrize(
    "status", ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]
)
def test_account_erasure_blocks_nonterminal_subscription(client, status):  # noqa: F811
    register(client, "subscriber@example.test")
    user_id = client.get("/api/session").json()["user"]["user_id"]
    db = client.app.state.database
    with db.session() as session:
        session.add(
            SubscriptionRow(
                provider_id="sub_deletion",
                user_id=user_id,
                customer_id="cus_deletion",
                plan_id="personal",
                status=status,
                current_period_end=None,
                cancel_at_period_end=True,
                created_at=datetime.now(UTC),
            )
        )
    response = client.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "subscriber@example.test",
        },
    )
    assert response.status_code == 409, response.text
    assert "订阅" in response.text
    assert client.get("/api/session").status_code == 200


@pytest.mark.parametrize("status", ["canceled", "incomplete_expired"])
def test_account_erasure_allows_terminal_subscription(client, status):  # noqa: F811
    register(client, "finished@example.test")
    user_id = client.get("/api/session").json()["user"]["user_id"]
    db = client.app.state.database
    with db.session() as session:
        session.add(
            SubscriptionRow(
                provider_id="sub_terminal",
                user_id=user_id,
                customer_id="cus_terminal",
                plan_id="personal",
                status=status,
                current_period_end=None,
                cancel_at_period_end=False,
                created_at=datetime.now(UTC),
            )
        )
    response = client.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "finished@example.test",
        },
    )
    assert response.status_code == 200, response.text
    with db.session() as session:
        assert session.get(SubscriptionRow, "sub_terminal") is None


def test_account_erasure_blocks_an_unexpired_checkout(client):  # noqa: F811
    register(client, "checkout@example.test")
    user_id = client.get("/api/session").json()["user"]["user_id"]
    with client.app.state.database.session() as session:
        session.add(
            SubscriptionCheckoutRow(
                key="fake-request-key",
                user_id=user_id,
                plan_id="personal",
                price_id="price_fake",
                success_url="",
                cancel_url="",
                created_at=datetime.now(UTC),
            )
        )
    response = client.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "checkout@example.test",
        },
    )
    assert response.status_code == 409, response.text
