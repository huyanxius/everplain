# ruff: noqa: F811
"""Small signup-only regression; historical balances and redemption are unchanged."""

from datetime import UTC, datetime
from fractions import Fraction
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from test_account_management_api import client as account_client  # noqa: F401
from test_account_management_api import register

from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.modules.billing import SIGNUP_GRANT, WELCOME_GRANT, CreditService


def test_signup_floor_is_bound_to_approved_retail_snapshot():
    assert 2 * Fraction(67351, 10000) * Fraction(1, 10) * 100 // 1 == SIGNUP_GRANT
    assert SIGNUP_GRANT == 134
    assert WELCOME_GRANT == 10000


def test_signup_grant_is_once_and_existing_balance_is_not_rewritten(account_client):
    registered = register(account_client, "once@example.com")
    user = UUID(registered["user"]["user_id"])
    with account_client.app.state.database.session() as session:
        repository = SqliteCreditRepository(session)
        assert repository.ensure_welcome_grant(
            user_id=user, points=10000, now=datetime.now(UTC)
        ).balance == 134
        # An established historical gift remains intact after this code change.
        session.execute(text("UPDATE credit_accounts SET balance=3000 WHERE user_id=:u"),
                        {"u": str(user)})
        session.execute(text("UPDATE credit_ledger SET points=3000,balance_after=3000 "
                             "WHERE user_id=:u AND kind='signup_grant'"), {"u": str(user)})
        session.expire_all()
        assert repository.ensure_welcome_grant(
            user_id=user, points=SIGNUP_GRANT, now=datetime.now(UTC)
        ).balance == 3000
        assert session.scalar(text("SELECT count(*) FROM credit_ledger "
                                   "WHERE user_id=:u AND kind='signup_grant'"),
                              {"u": str(user)}) == 1


@pytest.mark.parametrize("path", ["summary", "reserve"])
def test_missing_account_free_fallback_is_134_not_redemption_amount(account_client, path):
    registered = register(account_client, f"missing-{path}@example.com")
    user = UUID(registered["user"]["user_id"])
    with account_client.app.state.database.session() as session:
        session.execute(text("DELETE FROM credit_ledger WHERE user_id=:u"), {"u": str(user)})
        session.execute(text("DELETE FROM credit_accounts WHERE user_id=:u"), {"u": str(user)})
        repository = SqliteCreditRepository(session)
        if path == "summary":
            summary = CreditService(repository).summary(user_id=user)
        else:
            repository.reserve_usage(user_id=user, run_id=uuid4(), now=datetime.now(UTC))
            summary = repository.get_summary(user_id=user, limit=1)
        assert summary.balance == 134
        assert session.scalar(text("SELECT points FROM credit_ledger "
                                   "WHERE user_id=:u AND kind='signup_grant'"),
                              {"u": str(user)}) == 134
