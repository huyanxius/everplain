# ruff: noqa: F811
# Synthetic financial fault/stream checks. No paid provider or production access.
import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel, OperationScope
from qunxue_api.adapters.sqlite.billing_model import CreditRedemptionCodeRow
from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import PriceBook


@pytest.mark.parametrize("finish_reason", ["stop", "length", "content_filter"])
def test_metered_stream_handles_async_context_and_terminal_billing(wallet, finish_reason):
    runtime, engine = wallet
    calls = []

    def reply(request):
        calls.append(request)
        chunks = [
            {
                "choices": [
                    {"index": 0, "delta": {"content": "Partial output"}, "finish_reason": None}
                ]
            },
            {"choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}]},
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 30,
                    "total_tokens": 130,
                    "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                },
            },
        ]
        for c in chunks:
            c.update(
                id="synthetic-stream-finish",
                object="chat.completion.chunk",
                created=1,
                model="gpt-6.1-sol",
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content="".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n",
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as http:
            model = MeteredOpenAIChatModel(
                "gpt-6.1-sol",
                require_billing=True,
                provider=OpenAIProvider(
                    openai_client=AsyncOpenAI(
                        base_url="https://synthetic.test/v1",
                        api_key="synthetic",
                        http_client=http,
                        max_retries=0,
                    )
                ),
                settings={"max_tokens": 100},
            )
            try:
                with OperationScope(
                    runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
                ) as scope:
                    async with Agent(model).run_stream("synthetic") as result:
                        await result.get_output()
                    scope.finish("success")
            except Exception:
                # A terminal rejection must retain cost and waive the user.
                if finish_reason == "stop":
                    raise

    asyncio.run(run())
    assert len(calls) == 1
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT balance FROM credit_accounts WHERE user_id='user'")
        ).scalar()
        assert row == (9995 if finish_reason == "stop" else 10000)
        assert conn.scalar(text("SELECT reference_cost_pico FROM billing_attempts")) == 500000000


def test_redemption_and_new_hold_are_atomic(plain_client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from threading import Event
    from uuid import UUID

    from sqlalchemy import event
    from test_agent_memory import register

    from qunxue_api.adapters.sqlite import billing_repository
    from qunxue_api.modules.billing import Tariff

    engine = plain_client.app.state.database.engine
    user, code, now = UUID(register(plain_client)), uuid4(), datetime.now(UTC)
    with Session(engine) as session:
        session.add(CreditRedemptionCodeRow(
            code_id=str(code), code_hash="atomic-reset-hash", batch_id="synthetic",
            code_index=0, created_by_user_id=str(user), created_at=now,
            expires_at=now + timedelta(days=1),
        ))
        session.commit()
    runtime = DurableBilling(
        engine,
        price_book=PriceBook(credits_per_usd=10000, version="synthetic-reset-rollback", tariffs={
            "synthetic-meter": Tariff(1000000, 1000000, 1000000, 1000000, long_threshold=None),
        }),
        max_attempt_pico=2 * 10**9, max_operation_pico=2 * 10**9,
        daily_budget_pico=10**12, billing_policy="actual_usage_v1", clock=lambda: now,
    )

    def attempt(run):
        return runtime.before_attempt(
            run_id=run, endpoint_id="synthetic", model="synthetic-meter",
            input_limit=1000, output_limit=100, request_hash=str(uuid4()),
        )

    initial = runtime.start(user_id=user, run_id=uuid4(), fingerprint="initial-epoch")
    runtime.complete_attempt(
        attempt_id=attempt(initial), input_tokens=600, output_tokens=0,
        returned_model="synthetic-meter", outcome="success",
    )
    runtime.finish(run_id=initial, outcome="success")

    def snapshot():
        # Inspect before allowing the waiting reservation's legitimate next writes.
        with engine.connect() as connection:
            return {
                table: sorted(connection.execute(text(f"SELECT * FROM {table}")).all(), key=repr)
                for table in (
                    "credit_accounts", "credit_quota_periods", "billing_precision",
                    "credit_ledger", "credit_redemption_codes", "billing_operations",
                    "billing_attempts", "billing_precision_adjustments",
                )
            }

    before = snapshot()
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT balance,quota_period_epoch FROM credit_accounts"
        )).one() == (24, 1)
    attempted, acquired, allow_reservation = Event(), Event(), Event()
    reset_written, injected = Event(), Event()

    class InjectedResetFailure(RuntimeError):
        pass

    def before_execute(_conn, _cursor, statement, _params, _context, _many):
        if statement == "BEGIN IMMEDIATE":
            attempted.set()

    def after_execute(_conn, _cursor, statement, _params, _context, _many):
        if statement == "BEGIN IMMEDIATE":
            acquired.set()
            assert allow_reservation.wait(5), "reservation gate was not released"

    def reserve():
        run = runtime.start(user_id=user, run_id=uuid4(), fingerprint="after-reset-rollback")
        return run, attempt(run)

    original = billing_repository.ensure_quota_period
    event.listen(engine, "before_cursor_execute", before_execute)
    event.listen(engine, "after_cursor_execute", after_execute)
    future = None
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            def fail_after_reset(conn, user_id, reset_now, plan_limits=None, **kwargs):
                nonlocal future
                assert kwargs["reset"] is True
                period = original(conn, user_id, reset_now, plan_limits, **kwargs)
                assert period["epoch"] == 2 and period["balance"] == 30
                assert conn.scalar(text(
                    "SELECT redeemed_by_user_id FROM credit_redemption_codes"
                )) == str(user)
                reset_written.set()
                future = pool.submit(reserve)
                assert attempted.wait(2)
                with pytest.raises(TimeoutError):
                    future.result(timeout=0.05)
                assert not acquired.is_set(), "reservation escaped the RESET writer lock"
                injected.set()
                raise InjectedResetFailure("synthetic failure after RESET writes")

            monkeypatch.setattr(billing_repository, "ensure_quota_period", fail_after_reset)
            try:
                with Session(engine) as session:
                    with pytest.raises(InjectedResetFailure, match="after RESET writes"):
                        SqliteCreditRepository(session).redeem_code(
                            user_id=user, code_hash="atomic-reset-hash", now=now,
                        )
                    assert reset_written.is_set() and injected.is_set()
                    session.rollback()
                    assert acquired.wait(2), "rollback did not release the writer lock"
                    assert snapshot() == before, "failed RESET changed committed financial state"
            finally:
                # Release even after failed assertions so the executor cannot hang.
                allow_reservation.set()
            run, waiting_attempt = future.result(timeout=5)
    finally:
        allow_reservation.set()
        event.remove(engine, "before_cursor_execute", before_execute)
        event.remove(engine, "after_cursor_execute", after_execute)
    with engine.connect() as connection:
        balance = connection.scalar(text("SELECT balance FROM credit_accounts"))
        held = connection.scalar(text(
            "SELECT coalesce(sum(hold_points),0) FROM billing_operations WHERE status='active'"
        ))
        assert balance >= held, f"balance={balance}, holds={held}"
        assert (balance, held) == (24, 11)
        assert connection.scalar(text(
            "SELECT quota_period_epoch FROM billing_operations WHERE run_id=:run"
        ), {"run": run}) == 1
        assert connection.scalar(text(
            "SELECT redeemed_by_user_id FROM credit_redemption_codes"
        )) is None
        assert connection.scalars(text(
            "SELECT epoch FROM credit_quota_periods ORDER BY epoch"
        )).all() == [0, 1]  # Epoch 0 preserves the pre-activation historical snapshot.
    runtime.complete_attempt(
        attempt_id=waiting_attempt, input_tokens=600, output_tokens=0,
        returned_model="synthetic-meter", outcome="success",
    )
    runtime.finish(run_id=run, outcome="success")
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT balance,quota_period_epoch FROM credit_accounts"
        )).one() == (18, 1)
        assert connection.scalar(text(
            "SELECT hold_points FROM billing_operations WHERE run_id=:run"
        ), {"run": run}) == 0


def test_redemption_writer_lock_allows_waiting_reservation_to_progress(plain_client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from threading import Event
    from uuid import UUID

    from sqlalchemy import event
    from test_agent_memory import register

    from qunxue_api.adapters.sqlite import billing_repository
    from qunxue_api.modules.billing import Tariff

    user, code = UUID(register(plain_client)), uuid4()
    engine = plain_client.app.state.database.engine  # Actual 0600/0610 migrated schema.
    now = datetime.now(UTC)
    with Session(engine) as s:
        s.add(
            CreditRedemptionCodeRow(
                code_id=str(code),
                code_hash="progress-hash",
                batch_id="synthetic",
                code_index=0,
                created_by_user_id=str(user),
                created_at=now,
                expires_at=now + timedelta(days=1),
            )
        )
        s.commit()
    runtime = DurableBilling(
        engine,
        price_book=PriceBook(credits_per_usd=10000, version="synthetic-reset-lock", tariffs={
            "synthetic-meter": Tariff(1000000, 1000000, 1000000, 1000000, long_threshold=None),
        }),
        max_attempt_pico=2 * 10**9,
        max_operation_pico=2 * 10**9,
        daily_budget_pico=10**12,
        billing_policy="actual_usage_v1",
        clock=lambda: now,
    )
    initial_run = runtime.start(user_id=user, run_id=uuid4(), fingerprint="first-valid-message")

    def attempt(run):
        return runtime.before_attempt(run_id=run, endpoint_id="synthetic",
                                      model="synthetic-meter", input_limit=1000, output_limit=100,
                                      request_hash=str(uuid4()))

    runtime.complete_attempt(attempt_id=attempt(initial_run), input_tokens=600, output_tokens=0,
                             returned_model="synthetic-meter", outcome="success")
    runtime.finish(run_id=initial_run, outcome="success")
    with engine.connect() as c:
        assert c.execute(text("SELECT balance,quota_period_epoch FROM credit_accounts")).one() \
            == (24, 1)
        assert c.scalar(text("SELECT limit_points FROM credit_quota_periods WHERE epoch=1")) == 30

    attempted, reset_seen = Event(), Event()

    def before_execute(_conn, _cursor, statement, _params, _context, _many):
        if statement == "BEGIN IMMEDIATE":
            attempted.set()

    event.listen(engine, "before_cursor_execute", before_execute)

    def reserve():
        run = runtime.start(user_id=user, run_id=uuid4(), fingerprint="waiting-reservation")
        return run, attempt(run)

    future = None
    original = billing_repository.ensure_quota_period
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            def at_period_reset(conn, user_id, reset_now, plan_limits=None, **kwargs):
                nonlocal future
                assert kwargs["reset"] is True
                reset_seen.set()
                future = pool.submit(reserve)
                assert attempted.wait(2)
                with pytest.raises(TimeoutError):
                    future.result(timeout=0.05)  # BEGIN IMMEDIATE waits on RESET's writer lock.
                return original(conn, user_id, reset_now, plan_limits, **kwargs)

            monkeypatch.setattr(billing_repository, "ensure_quota_period", at_period_reset)
            with Session(engine) as s:
                redemption = SqliteCreditRepository(s).redeem_code(
                    user_id=user, code_hash="progress-hash", now=now
                )
                assert reset_seen.is_set()
                s.commit()
                assert redemption.balance == redemption.redeemed_points == 30
                assert redemption.delta_points == 6
            run, waiting_attempt = future.result(timeout=5)
    finally:
        event.remove(engine, "before_cursor_execute", before_execute)
    with engine.connect() as c:
        balance = c.scalar(text("SELECT balance FROM credit_accounts"))
        held = c.scalar(
            text("SELECT sum(hold_points) FROM billing_operations WHERE status='active'")
        )
        assert balance == 30 and held == 11
        assert c.scalar(text("SELECT quota_period_epoch FROM billing_operations WHERE run_id=:run"),
                        {"run": run}) == 2
        assert c.scalar(text("SELECT balance FROM credit_quota_periods WHERE epoch=1")) == 24
        assert c.scalar(text("SELECT redeemed_by_user_id FROM credit_redemption_codes")) == str(
            user
        )
    runtime.complete_attempt(attempt_id=waiting_attempt, input_tokens=600, output_tokens=0,
                             returned_model="synthetic-meter", outcome="success")
    runtime.finish(run_id=run, outcome="success")
    with engine.connect() as c:
        assert c.execute(text("SELECT balance,quota_period_epoch FROM credit_accounts")).one() \
            == (24, 2)
        assert c.scalar(text("SELECT hold_points FROM billing_operations WHERE run_id=:run"),
                        {"run": run}) == 0


def test_bill_details_expose_actual_usage_locked_prices_and_pending_cash(wallet):
    runtime, engine = wallet
    with OperationScope(
        runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
    ) as scope:
        attempt = scope.before_attempt_payload(
            {"model": "gpt-6-luna", "messages": [], "max_tokens": 100},
            provider_host="synthetic.test",
        )
        scope.complete(
            attempt,
            {
                "id": "invoice-synthetic",
                "model": "gpt-6-luna",
                "choices": [],
                "usage": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 100,
                    "prompt_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 100},
                },
            },
            outcome="success",
        )
        scope.finish("success")
    with Session(engine) as session:
        frozen, operations = SqliteCreditRepository(session)._billing_details("user", 1, 0)
    assert frozen == 0
    operation = operations[0]
    assert operation["points_charged"] == 1
    receipt = operation["attempts"][0]
    assert (receipt["requested_model"], receipt["returned_model"]) == ("gpt-6-luna", "gpt-6-luna")
    assert (
        receipt["input_tokens"],
        receipt["cache_read_tokens"],
        receipt["cache_write_tokens"],
        receipt["output_tokens"],
    ) == (1000, 200, 100, 100)
    assert receipt["reference_cost_pico"] == 134500000
    assert receipt["procurement_cost_pico"] is None
    assert receipt["procurement_status"] == "pending"
    assert receipt["price_snapshot"]["version"] == "synthetic"
    assert receipt["price_snapshot"]["credits_per_usd"] == 10000
