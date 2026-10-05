"""Reproduce the pinned pre-quota app's incompatible writes using synthetic SQLite.

Run with the backend dependencies and candidate backend/src on PYTHONPATH.
This review creates only temporary test databases; it never accesses production.
"""

import argparse
import hashlib
import importlib.util
import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.adapters.sqlite.quota_periods import ensure_quota_period
from qunxue_api.modules.billing import PriceBook, Tariff

ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_DURABLE_SHA256 = "8760b4a3bb3dd199480e451ae105050ca1e12d1614e0893491c2dc50d7da5b4c"
NOW = datetime(2026, 10, 5, 10, tzinfo=UTC)
BOOK = PriceBook(credits_per_usd=10000, version="synthetic-two-app", tariffs={
    "synthetic-meter": Tariff(1000000, 1000000, 1000000, 1000000, long_threshold=None),
})


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture(path, previous, migration):
    engine = create_engine("sqlite:///" + str(path))
    with engine.begin() as conn:
        for sql in (
            "CREATE TABLE users(user_id TEXT PRIMARY KEY)",
            "INSERT INTO users VALUES ('user')",
            "CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance INTEGER,"
            "updated_at TEXT)",
            "INSERT INTO credit_accounts VALUES ('user',30,'')",
            "CREATE TABLE credit_ledger(entry_id TEXT PRIMARY KEY,user_id TEXT,"
            "run_id TEXT UNIQUE,kind TEXT,points INTEGER,balance_after INTEGER,"
            "input_tokens INTEGER,output_tokens INTEGER,model TEXT,created_at TEXT)",
        ):
            conn.execute(text(sql))
    previous.create_billing_tables(engine)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration.upgrade()
    kwargs = dict(price_book=BOOK, max_attempt_pico=2 * 10**9,
                  max_operation_pico=2 * 10**9, daily_budget_pico=10**12, clock=lambda: NOW)
    return engine, previous.DurableBilling(engine, **kwargs), DurableBilling(
        engine, **kwargs, billing_policy="actual_usage_v1"
    )


def consume(runtime, outcome="success"):
    run = runtime.start(user_id="user", run_id=uuid4(), fingerprint="synthetic")
    attempt = runtime.before_attempt(
        run_id=run, endpoint_id="primary", model="synthetic-meter", input_limit=1000,
        output_limit=100, request_hash=str(uuid4()),
    )
    runtime.complete_attempt(
        attempt_id=attempt, input_tokens=600, output_tokens=0,
        returned_model="synthetic-meter", outcome="success",
    )
    runtime.finish(run_id=run, outcome=outcome)
    return run


def snapshot(engine):
    with engine.connect() as conn:
        return dict(
            account=dict(conn.execute(text(
                "SELECT balance,quota_period_epoch FROM credit_accounts"
            )).mappings().one()),
            precision=conn.scalar(text("SELECT total_credit_pico FROM billing_precision")),
            periods=[dict(row) for row in conn.execute(text(
                "SELECT epoch,balance,total_credit_pico FROM credit_quota_periods ORDER BY epoch"
            )).mappings()],
            ledger=[dict(row) for row in conn.execute(text(
                "SELECT points,balance_after,model,quota_period_epoch "
                "FROM credit_ledger ORDER BY rowid"
            )).mappings()],
        )


def review(previous, migration, directory):
    engine, old, new = fixture(directory / "old-write.db", previous, migration)
    try:
        with new._transaction() as conn:
            ensure_quota_period(conn, "user", NOW)
        consume(old)
        before = snapshot(engine)
        assert before["account"]["balance"] == 24 and before["periods"][1]["balance"] == 30
        consume(new)
        after = snapshot(engine)
        assert after["account"]["balance"] == 24  # Combined consumption requires 18.
        assert after["precision"] == "6000000000000"  # Combined precision requires 12e12.
        print(json.dumps(dict(case="old_write_reupgrade", compatible=False,
                              before=before, after=after), sort_keys=True))
    finally:
        engine.dispose()
    engine, old, new = fixture(directory / "late-refund.db", previous, migration)
    try:
        run = consume(old, "paused")
        with new._transaction() as conn:
            ensure_quota_period(conn, "user", NOW, reset=True, receipt_id="synthetic-reset")
        before = snapshot(engine)
        assert old.finish(run_id=run, outcome="cancelled") == "refunded"
        after = snapshot(engine)
        assert after["account"]["balance"] == 36 and after["precision"] == "-6000000000000"
        assert after["periods"] == before["periods"]
        print(json.dumps(dict(case="old_late_refund_after_reset", compatible=False,
                              before=before, after=after), sort_keys=True))
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous-durable", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.previous_durable.read_bytes()).hexdigest() != PREVIOUS_DURABLE_SHA256:
        raise ValueError("previous source must match the exact published 7f revision")
    previous = load("quota_review_previous_durable", args.previous_durable)
    migration = load(
        "quota_review_0600", ROOT / "backend/migrations/versions/20261005_0600_weekly_quota.py"
    )
    with tempfile.TemporaryDirectory(prefix="everplain-quota-review-") as directory:
        review(previous, migration, Path(directory))


if __name__ == "__main__":
    main()
