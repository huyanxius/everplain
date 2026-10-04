# ruff: noqa: F811
"""Synthetic ledger only: no model/provider calls or production database."""

from fractions import Fraction

import pytest
from billing_test_support import synthetic_billing_runtime
from sqlalchemy import text
from test_account_management_api import client as account_client  # noqa: F401
from test_account_management_api import register


def test_hold_release_and_fraction_do_not_falsify_settled_remaining(account_client):
    user = register(account_client, "stability@example.com")["user"]["user_id"]
    engine = account_client.app.state.database.engine
    # Existing historical gift is synthetic and preserved, not reset to new signup grant.
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=3000 WHERE user_id=:u"), {"u": user})
        conn.execute(
            text(
                "UPDATE credit_ledger SET points=3000,balance_after=3000 "
                "WHERE user_id=:u AND kind='signup_grant'"
            ),
            {"u": user},
        )
    runtime = synthetic_billing_runtime(engine)
    runtime.max_operation_pico = 3 * 10**10

    def snapshot():
        data = account_client.get("/api/account/credits").json()
        bucket = data["active_usage_buckets"][0]
        return data, bucket

    before, initial = snapshot()
    runtime.start(
        user_id=user, run_id="11111111-1111-4111-8111-111111111111", fingerprint="synthetic"
    )
    held, holding = snapshot()
    runtime.finish(run_id="11111111-1111-4111-8111-111111111111", outcome="cancelled")
    after, released = snapshot()
    assert [
        initial["available_points"],
        holding["available_points"],
        released["available_points"],
    ] == [3000, 2700, 3000]
    assert [before["balance"], held["balance"], after["balance"]] == [3000] * 3
    assert [b["settled_remaining_points"] for b in [initial, holding, released]] == [3000] * 3
    runtime.start(
        user_id=user, run_id="22222222-2222-4222-8222-222222222222", fingerprint="synthetic"
    )
    attempt = runtime.before_attempt(
        run_id="22222222-2222-4222-8222-222222222222",
        endpoint_id="synthetic",
        model="gpt-6-luna",
        input_limit=10,
        output_limit=1,
        request_hash="synthetic",
    )
    runtime.complete_attempt(
        attempt_id=attempt,
        input_tokens=10,
        output_tokens=1,
        cache_read_tokens=0,
        cache_write_tokens=0,
        returned_model="gpt-6-luna",
        outcome="success",
    )
    runtime.finish(run_id="22222222-2222-4222-8222-222222222222", outcome="success")
    settled, bucket = snapshot()
    with engine.connect() as conn:
        exact = (
            Fraction(
                conn.scalar(
                    text("SELECT total_credit_pico FROM billing_precision WHERE user_id=:u"),
                    {"u": user},
                )
            )
            / 10**12
        )
    assert 0 < exact < 1
    assert settled["balance"] == 3000
    assert bucket["settled_remaining_points"] == pytest.approx(float(3000 - exact))
    assert bucket["limit_points"] == 3000
    runtime.finish(run_id="22222222-2222-4222-8222-222222222222", outcome="error")
    refunded, bucket = snapshot()
    assert refunded["balance"] == 3000
    assert bucket["settled_remaining_points"] == 3000
