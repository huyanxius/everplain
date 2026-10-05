"""Authenticated customer receipts must not disclose the operator's procurement data."""

import json
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_account_management_api import register

from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import PriceBook, TavilyPrice


@pytest.mark.parametrize(
    ("retail", "api_type"),
    [(False, "chat_completions"), (True, "chat_completions"), (True, "tavily_search")],
)
@pytest.mark.parametrize("procurement_cost", [None, 1234567])
def test_customer_receipts_keep_usage_and_reference_prices_without_procurement(
    plain_client: TestClient, retail: bool, api_type: str, procurement_cost: int | None,
) -> None:
    client = plain_client
    assert client.get("/api/account/credits").status_code == 401
    user_id = UUID(str(register(client, "billing-privacy@example.com")["user"]["user_id"]))
    assert client.get("/api/account").json()["role"] == "member"
    assert client.get("/api/admin/users").status_code == 403

    book = PriceBook(
        credits_per_usd=10000,
        version="synthetic-public-reference",
        aliases={"private-route-alias": "gpt-6-luna"},
        procurement_estimate_source="private-procurement-source",
    )
    if retail:
        book = replace(
            book, credits_per_usd=None, points_per_cny=100, retail_rate_ppm=100000,
            fx_cny_per_usd_micro=6735100, fx_snapshot_id="synthetic-public-fx",
            fx_as_of="2026-10-04T00:00:00+00:00", fx_source="synthetic-reference-fx",
            tavily_price=TavilyPrice(8000, 100000, "synthetic-reference-search"),
        )
    database = client.app.state.database
    budget = 10**10 if retail else 10**9
    runtime = DurableBilling(
        database.engine, price_book=book, max_attempt_pico=budget,
        max_operation_pico=budget, daily_budget_pico=10**12,
    )
    client.app.state.billing_operations.runtime = runtime
    run_id = str(uuid4())
    runtime.start(user_id=user_id, run_id=run_id, fingerprint="synthetic-customer-receipt")
    search = api_type == "tavily_search"
    attempt_id = runtime.before_attempt(
        run_id=run_id, endpoint_id="private-endpoint", provider_host="private-provider.example",
        model="tavily:basic" if search else "gpt-6-luna", api_type=api_type,
        input_limit=1 if search else 1000, output_limit=0 if search else 100,
        requested_effort=None if search else "high", requested_service_tier="standard",
        request_hash="synthetic-request",
    )
    if search:
        runtime.complete_search_attempt(
            attempt_id=attempt_id, credits=1, receipt="private-provider-receipt", outcome="success",
        )
    else:
        runtime.complete_attempt(
            attempt_id=attempt_id, input_tokens=1000, output_tokens=100,
            cache_read_tokens=200, cache_write_tokens=100, reasoning_tokens=25,
            returned_model="gpt-6-luna", returned_service_tier="standard", finish_reason="stop",
            provider_response_id="private-provider-receipt", outcome="success",
        )
    runtime.finish(run_id=run_id, outcome="success")

    # Persist old snapshots and future internal fields, including nested data. The HTTP
    # projection must whitelist customer facts rather than blacklist today's field names.
    with database.engine.begin() as connection:
        for table in ("billing_operations", "billing_attempts"):
            snapshot = json.loads(connection.scalar(
                text(f"SELECT price_json FROM {table} WHERE run_id=:run"), {"run": run_id},
            ))
            snapshot["vendor_invoice"] = "private-procurement-invoice"
            snapshot["tariffs"]["gpt-6-luna"]["procurement_unit_price"] = 7654321
            snapshot["tariffs"]["gpt-6-luna"]["vendor_invoice"] = "private-tariff-invoice"
            if retail:
                snapshot["tavily_price"]["procurement_unit_price"] = 7654321
                snapshot["tavily_price"]["vendor_invoice"] = "private-search-invoice"
            connection.execute(
                text(f"UPDATE {table} SET price_json=:snapshot WHERE run_id=:run"),
                {"snapshot": json.dumps(snapshot), "run": run_id},
            )
        connection.execute(
            text("UPDATE billing_attempts SET procurement_cost_pico=:cost, "
                 "procurement_status=:status, raw_usage_json=:usage WHERE attempt_id=:attempt"),
            {"cost": procurement_cost, "status": "pending" if procurement_cost is None else "known",
             "usage": json.dumps({"credits": 1, "request_id": "private-provider-receipt",
                                  "vendor_invoice": "private-usage-invoice"}),
             "attempt": attempt_id},
        )

    with database.session() as session:
        _, internal = SqliteCreditRepository(session)._billing_details(user_id, 10, 0)
    response = client.get("/api/account/credits")
    assert response.status_code == 200, response.text
    payload = response.json()
    public = payload["operations"][0]
    receipt = public["attempts"][0]
    for key in (
        "operation_id", "points_charged", "frozen_points", "exact_credit_numerator",
        "exact_credit_denominator", "original_credit_numerator", "original_credit_denominator",
        "credit_scale", "price_version", "credits_per_usd", "reference_currency",
    ):
        assert public[key] == internal[0][key]
    assert public["operation_id"] == run_id
    assert receipt["attempt_id"] == attempt_id
    assert receipt["api_type"] == api_type
    assert receipt["usage_state"] == "known"
    assert receipt["outcome"] == "success"
    assert receipt["billable"] == 1
    assert receipt["reference_cost_pico"] == (8_000_000_000 if search else 134_500_000)
    assert receipt["price_snapshot"]["version"] == book.version
    assert receipt["price_snapshot"]["tariffs"]["gpt-6-luna"]["input"] == 100000
    assert payload["pricing"]["price_version"] == book.version
    if search:
        assert receipt["search_usage"] == {"credits": 1}
        assert receipt["input_tokens"] is receipt["output_tokens"] is None
        assert receipt["price_snapshot"]["tavily_price"] == {
            "usd_micro_per_credit": 8000, "retail_rate_ppm": 100000,
            "source": "synthetic-reference-search",
        }
    else:
        assert (receipt["input_tokens"], receipt["cache_read_tokens"],
                receipt["cache_write_tokens"], receipt["output_tokens"],
                receipt["reasoning_tokens"]) == (1000, 200, 100, 100, 25)
        assert receipt["requested_model"] == receipt["returned_model"] == "gpt-6-luna"
        assert receipt["requested_effort"] == "high"
        assert receipt["returned_service_tier"] == "standard"
        assert receipt["finish_reason"] == "stop"
    if retail:
        assert public["retail_snapshot"]["retail_rate_ppm"] == 100000
        assert receipt["price_snapshot"]["fx_cny_per_usd_micro"] == 6735100
        assert payload["pricing"]["points_per_cny"] == 100
    else:
        assert public["points_charged"] == 1
        assert receipt["price_snapshot"]["credits_per_usd"] == 10000
    for forbidden in (
        "procurement", "vendor_invoice", "1/35", "private-", "aliases", "usage_policies",
        "endpoint_id", "provider_host", "provider_response_id", "price_json", "raw_usage_json",
        "overrun_cost_pico", "reservation_rates",
    ):
        assert forbidden not in response.text

    # A customer request must not delete or rewrite the operator's audit records.
    with database.session() as session:
        _, after = SqliteCreditRepository(session)._billing_details(user_id, 10, 0)
    assert after == internal
    assert after[0]["retail_snapshot"]["procurement_estimate_ratio"] == "1/35"
    audit = after[0]["attempts"][0]
    assert audit["procurement_cost_pico"] == procurement_cost
    assert audit["procurement_status"] == ("pending" if procurement_cost is None else "known")
    assert audit["provider_response_id"] == "private-provider-receipt"
    assert audit["price_snapshot"]["procurement_estimate_source"] == "private-procurement-source"
    assert audit["price_snapshot"]["tariffs"]["gpt-6-luna"]["procurement_unit_price"] == 7654321
