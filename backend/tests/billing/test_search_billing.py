"""Synthetic-only search receipts, exact balances, restart and shared budget tests."""

# ruff: noqa: F811
import json
import sys
from contextlib import suppress
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from fractions import Fraction
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_durable_billing import balance, operation, wallet  # noqa: F401

from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.research_agent.search_metering import metered_tavily_search
from qunxue_api.adapters.research_agent.web_research import OpenWebResearchClient
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import (
    BillingBudgetExceeded,
    BillingContextMissing,
    BillingReplayBlocked,
)
from qunxue_api.modules.billing.pricing import PriceBook, TavilyPrice, UnknownPrice
from qunxue_api.settings import Settings


def book(rate=100000):
    return PriceBook(
        credits_per_usd=None,
        version="synthetic-approved-search",
        points_per_cny=100,
        retail_rate_ppm=100000,
        fx_cny_per_usd_micro=6735100,
        fx_snapshot_id="synthetic-fx",
        fx_as_of="2026-10-04T00:00:00+00:00",
        fx_source="synthetic",
        tavily_price=TavilyPrice(8000, rate, "synthetic-public-reference"),
    )


@pytest.fixture
def search_wallet(wallet):
    runtime, engine = wallet
    runtime.book = book()
    runtime.max_attempt_pico = 20_000_000_000
    runtime.max_operation_pico = 100_000_000_000
    runtime.daily_budget_pico = 1_000_000_000_000
    runtime.max_attempts = 64
    return runtime, engine


def attempt(runtime, run):
    return runtime.before_attempt(
        run_id=run,
        endpoint_id="tavily",
        provider_host="api.tavily.com",
        model="tavily:basic",
        api_type="tavily_search",
        input_limit=1,
        output_limit=0,
        request_hash="synthetic-hash",
    )


def receipt(runtime, run, *, credits=1, request_id=None):
    ident = attempt(runtime, run)
    runtime.complete_search_attempt(
        attempt_id=ident,
        credits=credits,
        receipt=request_id or str(uuid4()),
        outcome="success",
    )
    return ident


def rows(engine):
    with engine.connect() as conn:
        return (
            conn.execute(text("SELECT * FROM billing_attempts ORDER BY created_at"))
            .mappings()
            .all()
        )


def exact(engine):
    with engine.connect() as conn:
        value = conn.scalar(
            text("SELECT total_credit_pico FROM billing_precision WHERE user_id='user'")
        )
        return Fraction(value or 0) / 10**12


def test_approved_reference_price_exactly_0538808_without_per_request_rounding(search_wallet):
    runtime, engine = search_wallet
    for _ in range(2):
        run = operation(runtime)
        receipt(runtime, run)
        runtime.finish(run_id=run, outcome="success")
    assert exact(engine) == Fraction("1.077616")
    assert balance(engine) == 9999
    for row in rows(engine):
        assert row["reference_cost_pico"] == 8_000_000_000
        assert row["procurement_cost_pico"] is None
        assert row["procurement_status"] == "pending"
        assert row["input_tokens"] is row["output_tokens"] is None
        assert json.loads(row["raw_usage_json"])["credits"] == 1
        assert json.loads(row["price_json"])["tavily_price"]["retail_rate_ppm"] == 100000


def test_missing_search_price_blocks_before_provider_dispatch(wallet):
    runtime, _ = wallet
    calls = []
    with (
        OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="test"),
        pytest.raises(UnknownPrice),
    ):
        metered_tavily_search(
            SimpleNamespace(search=lambda *a, **k: calls.append(k)),
            "test",
            {},
            require_billing=True,
        )
    assert not calls


def test_missing_operation_blocks_before_provider_dispatch():
    calls = []
    with pytest.raises(BillingContextMissing):
        metered_tavily_search(
            SimpleNamespace(search=lambda *a, **k: calls.append(k)),
            "test",
            {},
            require_billing=True,
        )
    assert not calls


def test_successful_zero_credit_response_is_recorded_without_debit(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    receipt(runtime, run, credits=0)
    assert runtime.finish(run_id=run, outcome="success") == "success"
    assert exact(engine) == 0
    assert balance(engine) == 10000
    assert runtime.operator_risk_pico() == 0


@pytest.mark.parametrize(
    "usage",
    [
        None,
        {},
        {"credits": None},
        {"credits": True},
        {"credits": "1"},
        {"credits": -1},
        {"credits": 0.5},
        {"credits": float("nan")},
        {"credits": 1000001},
    ],
)
def test_missing_or_invalid_credit_usage_never_invents_a_user_charge(search_wallet, usage):
    runtime, engine = search_wallet
    client = SimpleNamespace(
        search=lambda *a, **k: {"usage": usage, "request_id": "synthetic-receipt", "results": []}
    )
    with (
        OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="test"),
        pytest.raises(BillingContextMissing),
    ):
        metered_tavily_search(client, "test", {}, require_billing=True)
    assert exact(engine) == 0
    assert rows(engine)[0]["usage_state"] == "unknown"
    assert runtime.operator_risk_pico() == 8_000_000_000


@pytest.mark.parametrize("receipt_id", [None, "", " ", " id ", 1, True, "x" * 201])
def test_missing_or_invalid_receipt_never_charges(search_wallet, receipt_id):
    runtime, engine = search_wallet
    run = operation(runtime)
    ident = attempt(runtime, run)
    runtime.complete_search_attempt(
        attempt_id=ident, credits=1, receipt=receipt_id, outcome="success"
    )
    runtime.finish(run_id=run, outcome="success")
    assert balance(engine) == 10000
    assert exact(engine) == 0
    assert rows(engine)[0]["usage_state"] == "unknown"


def test_timeout_no_retry_unknown_cost_survives_restart_and_late_receipt(search_wallet):
    runtime, engine = search_wallet
    calls = []

    def fail(*args, **kwargs):
        calls.append(kwargs)
        raise TimeoutError("synthetic")

    run = str(uuid4())
    with (
        OperationScope(runtime, user_id="user", run_id=run, fingerprint="test"),
        pytest.raises(TimeoutError),
    ):
        metered_tavily_search(SimpleNamespace(search=fail), "query", {}, require_billing=True)
    fresh = DurableBilling(
        engine,
        price_book=book(),
        max_attempt_pico=20_000_000_000,
        max_operation_pico=100_000_000_000,
        daily_budget_pico=10**12,
    )
    fresh.recover_stale(before=datetime.now(UTC) + timedelta(days=1))
    assert len(calls) == 1
    assert fresh.operator_risk_pico() == 8_000_000_000
    ident = rows(engine)[0]["attempt_id"]
    fresh.complete_search_attempt(attempt_id=ident, credits=1, receipt="late", outcome="success")
    fresh.finish(run_id=run, outcome="success")
    assert balance(engine) == 10000
    assert not rows(engine)[0]["billable"]
    with pytest.raises(BillingReplayBlocked):
        operation(fresh, run_id=run)


def test_duplicate_receipt_never_charges_twice(search_wallet):
    runtime, engine = search_wallet
    first = operation(runtime)
    receipt(runtime, first, request_id="same-provider-request")
    runtime.finish(run_id=first, outcome="success")
    second = operation(runtime)
    with pytest.raises(BillingReplayBlocked):
        receipt(runtime, second, request_id="same-provider-request")
    assert runtime.finish(run_id=second, outcome="success") == "error"
    assert exact(engine) == Fraction("0.538808")
    assert runtime.operator_risk_pico() == 8_000_000_000


def test_receipt_replay_is_idempotent(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    ident = receipt(runtime, run, request_id="once")
    for _ in range(2):
        runtime.complete_search_attempt(
            attempt_id=ident, credits=1, receipt="once", outcome="success"
        )
        runtime.finish(run_id=run, outcome="success")
    assert exact(engine) == Fraction("0.538808")
    assert len(rows(engine)) == 1


def test_overrun_is_recorded_stops_delivery_and_does_not_charge(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    with pytest.raises(BillingBudgetExceeded):
        receipt(runtime, run, credits=2)
    assert runtime.finish(run_id=run, outcome="success") == "error"
    assert balance(engine) == 10000
    assert rows(engine)[0]["reference_cost_pico"] == 16_000_000_000
    assert rows(engine)[0]["overrun_cost_pico"] == 8_000_000_000


def test_paused_then_resumed_keeps_original_search_price_and_refunds_exactly(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    receipt(runtime, run)
    runtime.finish(run_id=run, outcome="paused")
    runtime.book = book(rate=1000000)
    runtime.start(user_id="user", run_id=run, fingerprint="continuation", resume=True)
    receipt(runtime, run)
    runtime.finish(run_id=run, outcome="success")
    assert exact(engine) == Fraction("1.077616")
    runtime.finish(run_id=run, outcome="error")
    runtime.finish(run_id=run, outcome="error")
    assert exact(engine) == 0
    assert balance(engine) == 10000
    assert runtime.operator_risk_pico() == 16_000_000_000


def test_cross_run_fractional_refund_does_not_recharge_carried_fraction(search_wallet):
    runtime, engine = search_wallet
    first, second = operation(runtime), operation(runtime)
    for run in (first, second):
        receipt(runtime, run)
        runtime.finish(run_id=run, outcome="success")
    assert balance(engine) == 9999
    runtime.finish(run_id=first, outcome="error")
    assert balance(engine) == 10000
    third = operation(runtime)
    receipt(runtime, third)
    runtime.finish(run_id=third, outcome="success")
    assert balance(engine) == 9999
    assert exact(engine) == Fraction("1.077616")


def test_mixed_model_and_search_share_operation_cash_budget(search_wallet):
    runtime, engine = search_wallet
    runtime.max_operation_pico = 9_000_000_000
    run = operation(runtime)
    receipt(runtime, run)
    with pytest.raises(BillingBudgetExceeded):
        runtime.before_attempt(
            run_id=run,
            endpoint_id="model",
            model="gpt-6.1-sol",
            input_limit=1000,
            output_limit=100,
            request_hash="test",
        )
    assert len(rows(engine)) == 1


def test_search_and_model_use_separate_retail_multipliers(search_wallet):
    runtime, engine = search_wallet
    runtime.book = book(rate=1000000)
    run = operation(runtime)
    receipt(runtime, run)
    ident = runtime.before_attempt(
        run_id=run,
        endpoint_id="model",
        model="gpt-6-luna",
        input_limit=1000,
        output_limit=100,
        request_hash="test",
    )
    runtime.complete_attempt(
        attempt_id=ident,
        input_tokens=1000,
        output_tokens=100,
        returned_model="gpt-6-luna",
        outcome="success",
    )
    runtime.finish(run_id=run, outcome="success")
    assert exact(engine) == Fraction("5.38808") + Fraction("0.01010265")


def test_search_obeys_daily_cash_attempt_and_credit_limits(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    runtime.daily_budget_pico = 7_000_000_000
    with pytest.raises(BillingBudgetExceeded):
        attempt(runtime, run)
    runtime.daily_budget_pico = 10**12
    runtime.max_attempt_pico = 7_000_000_000
    with pytest.raises(BillingBudgetExceeded):
        attempt(runtime, run)
    assert rows(engine) == []


def test_insufficient_credit_prevents_request(search_wallet):
    runtime, engine = search_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=1"))
    run = operation(runtime)
    receipt(runtime, run)
    with pytest.raises(BillingBudgetExceeded):
        attempt(runtime, run)
    assert len(rows(engine)) == 1


def test_operator_exemption_records_reference_cost_without_charge(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime, exempt=True)
    receipt(runtime, run)
    runtime.finish(run_id=run, outcome="success")
    assert balance(engine) == 10000
    assert exact(engine) == 0
    assert runtime.operator_risk_pico() == 8_000_000_000


def test_real_adapter_bounds_results_and_preserves_p0_snippets(search_wallet, monkeypatch):
    runtime, engine = search_wallet
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def search(self, query, **kwargs):
            calls.append(kwargs)
            return {
                "usage": {"credits": 1},
                "request_id": str(uuid4()),
                "results": [
                    {
                        "title": "中" * 500,
                        "url": "https://example.org/article",
                        "content": "文" * 2000,
                        "raw_content": "must not enter history" * 1000,
                    }
                ],
            }

    monkeypatch.setitem(sys.modules, "tavily", SimpleNamespace(TavilyClient=Client))
    with OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="test") as op:
        result = OpenWebResearchClient(
            search_api_key="synthetic", require_search_billing=True
        ).search("query", limit=50)
        op.finish("success")
    assert calls[0]["max_results"] == 20
    assert calls[0]["include_usage"] is True
    assert calls[0]["include_raw_content"] is False
    assert calls[0]["auto_parameters"] is False
    assert calls[0]["search_depth"] == "basic"
    assert len(result[0]["snippet"].encode()) <= 800
    assert len(result[0]["title"].encode()) <= 500
    assert exact(engine) == Fraction("0.538808")


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"usd_micro_per_credit": 8000, "retail_rate_ppm": 100000},
        {"usd_micro_per_credit": True, "retail_rate_ppm": 100000, "source": "test"},
        {"usd_micro_per_credit": "8000", "retail_rate_ppm": 100000, "source": "test"},
        {"usd_micro_per_credit": 8000, "retail_rate_ppm": 0, "source": "test"},
        {"usd_micro_per_credit": 8000, "retail_rate_ppm": 100000, "source": " "},
    ],
)
def test_partial_or_invalid_price_configuration_fails_closed(config):
    with pytest.raises(ValueError):
        Settings(_env_file=None, billing_tavily_price=config)


def test_old_snapshot_round_trip_and_no_schema_migration(search_wallet):
    runtime, _ = search_wallet
    old = json.loads(runtime._snapshot(replace(runtime.book, tavily_price=None)))
    del old["tavily_price"]
    parsed = runtime._book(json.dumps(old))
    assert parsed.tavily_price is None
    assert parsed.credit_numerator(10**12) == runtime.book.credit_numerator(10**12)


def test_actual_tavily_sdk_transmits_include_usage_once(search_wallet, monkeypatch):
    import requests

    from qunxue_api.adapters.research_agent.web_research import _search_tavily

    runtime, engine = search_wallet
    calls = []

    def post(session, url, **kwargs):
        calls.append((url, json.loads(kwargs["data"])))
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps(
            {
                "request_id": "real-sdk-fake-wire",
                "usage": {"credits": 1},
                "results": [],
            }
        ).encode()
        return response

    monkeypatch.setattr(requests.Session, "post", post)
    with OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="sdk") as op:
        assert (
            list(_search_tavily("synthetic", 200, api_key="fake", timeout=12, require_billing=True))
            == []
        )
        op.finish("success")
    assert len(calls) == 1
    assert calls[0][0] == "https://api.tavily.com/search"
    assert calls[0][1]["include_usage"] is True
    assert calls[0][1]["search_depth"] == "basic"
    assert calls[0][1]["auto_parameters"] is False
    assert calls[0][1]["max_results"] == 20
    assert exact(engine) == Fraction("0.538808")


def test_same_query_new_provider_requests_have_distinct_receipts(search_wallet):
    runtime, engine = search_wallet
    run = operation(runtime)
    receipt(runtime, run, request_id="request-1")
    receipt(runtime, run, request_id="request-2")
    runtime.finish(run_id=run, outcome="success")
    assert len(rows(engine)) == 2
    assert exact(engine) == Fraction("1.077616")


def test_cancelled_scope_cannot_dispatch_and_creates_no_attempt(search_wallet):
    runtime, engine = search_wallet
    calls = []

    def cancelled():
        raise RuntimeError("cancelled")

    with (
        OperationScope(
            runtime,
            user_id="user",
            run_id=str(uuid4()),
            fingerprint="cancel",
            before_network=cancelled,
        ),
        pytest.raises(RuntimeError, match="cancelled"),
    ):
        metered_tavily_search(
            SimpleNamespace(search=lambda *a, **k: calls.append(k)),
            "query",
            {},
            require_billing=True,
        )
    assert not calls
    assert not rows(engine)


def test_actual_sdk_timeout_is_one_attempt_and_remains_operator_risk(search_wallet, monkeypatch):
    import requests
    from tavily.errors import TimeoutError as TavilyTimeout

    from qunxue_api.adapters.research_agent.web_research import _search_tavily

    runtime, engine = search_wallet
    calls = []

    def post(*args, **kwargs):
        calls.append(1)
        raise requests.exceptions.Timeout("synthetic")

    monkeypatch.setattr(requests.Session, "post", post)
    with (
        OperationScope(runtime, user_id="user", run_id=str(uuid4()), fingerprint="sdk-timeout"),
        pytest.raises(TavilyTimeout),
    ):
        list(_search_tavily("synthetic", 5, api_key="fake", timeout=12, require_billing=True))
    assert len(calls) == len(rows(engine)) == 1
    assert exact(engine) == 0
    assert runtime.operator_risk_pico() == 8_000_000_000


def test_environment_json_reaches_runtime_without_implicit_rate(monkeypatch, tmp_path):
    from qunxue_api.adapters.sqlite.database import Database
    from qunxue_api.bootstrap import _billing_runtime

    monkeypatch.setenv(
        "EVERPLAIN_BILLING_TAVILY_PRICE",
        json.dumps(
            {
                "usd_micro_per_credit": 8000,
                "retail_rate_ppm": 100000,
                "source": "synthetic",
            }
        ),
    )
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path}/config.db",
        billing_price_version="synthetic",
        billing_max_attempt_usd_micro=20000,
        billing_max_operation_usd_micro=100000,
        billing_daily_budget_usd_micro=1000000,
        billing_fx_cny_per_usd_micro=6735100,
        billing_fx_snapshot_id="synthetic",
        billing_fx_as_of="2026-10-04T00:00:00+00:00",
        billing_fx_source="synthetic",
    )
    database = Database(settings.database_url)
    try:
        runtime = _billing_runtime(settings, database)
        assert runtime.book.tavily_price == TavilyPrice(8000, 100000, "synthetic")
        assert runtime.book.search_credit_numerator(8_000_000_000) / 10**12 == Fraction("0.538808")
        assert runtime.max_attempt_pico == 20_000_000_000
        assert runtime.max_operation_pico == 100_000_000_000
    finally:
        database.engine.dispose()


def test_concurrent_identical_receipt_is_observed_once(search_wallet):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    runtime, engine = search_wallet
    runs = [operation(runtime) for _ in range(2)]
    attempts = [attempt(runtime, run) for run in runs]
    barrier = Barrier(2)

    def settle(index):
        barrier.wait(timeout=5)
        with suppress(BillingReplayBlocked):
            runtime.complete_search_attempt(
                attempt_id=attempts[index],
                credits=1,
                receipt="one-provider-receipt",
                outcome="success",
            )
        return runtime.finish(run_id=runs[index], outcome="success")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(settle, range(2)))
    assert sorted(results) == ["error", "success"]
    assert exact(engine) == Fraction("0.538808")
    assert sum(row["reference_cost_pico"] for row in rows(engine)) == 8_000_000_000


def test_two_concurrent_searches_cannot_overspend_one_point(search_wallet):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    runtime, engine = search_wallet
    with engine.begin() as conn:
        conn.execute(text("UPDATE credit_accounts SET balance=1"))
    run = operation(runtime)
    barrier = Barrier(2)

    def reserve(_):
        barrier.wait(timeout=5)
        try:
            return attempt(runtime, run)
        except BillingBudgetExceeded:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(reserve, range(2)))
    assert sum(item is not None for item in attempts) == 1
    assert len(rows(engine)) == 1


def test_attempt_details_expose_provider_units_without_fake_tokens(search_wallet):
    from sqlalchemy.orm import Session

    from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository

    runtime, engine = search_wallet
    run = operation(runtime)
    receipt(runtime, run, request_id="visible-synthetic-receipt")
    runtime.finish(run_id=run, outcome="success")
    with Session(engine) as session:
        frozen, operations = SqliteCreditRepository(session)._billing_details("user", 50, 0)
    assert frozen == 0
    item = operations[0]["attempts"][0]
    assert item["api_type"] == "tavily_search"
    assert item["search_usage"] == {"credits": 1, "request_id": "visible-synthetic-receipt"}
    assert item["input_tokens"] is item["output_tokens"] is None
    assert item["procurement_cost_pico"] is None
    assert item["price_snapshot"]["tavily_price"]["retail_rate_ppm"] == 100000
