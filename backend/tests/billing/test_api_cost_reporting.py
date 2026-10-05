"""Synthetic SQLite fixtures only, without model IO."""
import json
from datetime import date

import pytest
from sqlalchemy import create_engine, text

from qunxue_api.adapters.sqlite.api_cost_reporting import SqliteApiCostReporting
from qunxue_api.adapters.sqlite.durable_billing import create_billing_tables


@pytest.fixture
def engine(tmp_path):
    value = create_engine(f"sqlite:///{tmp_path}/synthetic.db")
    create_billing_tables(value)
    yield value
    value.dispose()


def seed(engine, name, *, user="user-a", operation_status="success", **overrides):
    created = "2026-10-05T12:00:00+00:00"
    row = {
        "attempt_id": name, "run_id": name, "endpoint_id": "primary",
        "request_hash": "never-export-this-hash", "requested_model": "requested-alias",
        "returned_model": "model-a", "outcome": "success", "usage_state": "known",
        "billable": 1, "input_limit": 1000, "output_limit": 100,
        "reserved_cost_pico": 9000, "reference_cost_pico": 1234,
        "input_tokens": 100, "output_tokens": 20, "cache_read_tokens": 30,
        "cache_write_tokens": 10, "reasoning_tokens": 5,
        "provider_host": "provider.synthetic.test", "api_type": "chat_completions",
        "price_json": json.dumps({"version": "historical", "procurement_estimate_ratio": "1/35"}),
        "raw_usage_json": '{"private_payload":"never-export-raw"}',
        "provider_response_id": f"private-receipt-{name}",
        "provider_request_id": f"private-request-{name}",
        "created_at": created, "updated_at": created,
    }
    row.update(overrides)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,hold_points,exempt,"
            "price_json,created_at,updated_at) "
            "VALUES (:id,:user,'synthetic',:status,0,0,'{}',:at,:at)"
        ), {"id": name, "user": user, "status": operation_status, "at": created})
        conn.execute(text(
            f"INSERT INTO billing_attempts ({','.join(row)}) "
            f"VALUES ({','.join(':' + key for key in row)})"
        ), row)


def report(engine, **kwargs):
    return SqliteApiCostReporting(engine).report(
        start_date=date(2026, 10, 1), end_date=date(2026, 10, 5), **kwargs
    )


def test_recorded_costs_no_mutations_or_private_field_export(engine):
    seed(engine, "one", reference_cost_pico=9007199254740993,
         procurement_cost_pico=1111, procurement_status="confirmed")
    seed(engine, "two", outcome="error", billable=0, reference_cost_pico=7)
    with engine.connect() as conn:
        before = conn.execute(text("SELECT * FROM billing_attempts")).all()
    result = report(engine)
    s = result["summary"]
    assert s["reference_cost_pico"] == "9007199254741000"
    assert s["actual_procurement_cost_pico"] is None
    assert s["unverified_procurement_attempts"] == 1
    assert result["procurement_evidence_status"] == "unavailable"
    assert result["key_attribution_available"] is False
    assert (s["input_tokens"], s["output_tokens"]) == (200, 40)
    assert (s["cache_read_tokens"], s["reasoning_tokens"]) == (60, 10)
    assert s["confirmed_token_attempts"] == 2
    assert s["reasoning_reported_attempts"] == 2
    assert result["items"][0]["group_value"] == "model-a"
    encoded = json.dumps(result, default=str)
    for private in ("raw_usage", "private_payload", "private-receipt", "private-request",
                    "never-export", "1/35", "price_json", "request_hash"):
        assert private not in encoded
    with engine.connect() as conn:
        assert conn.execute(text("SELECT * FROM billing_attempts")).all() == before


def test_unknown_unpriced_active_and_not_sent_separate(engine):
    seed(engine, "known")
    seed(engine, "unpriced", usage_state="unpriced", reference_cost_pico=None)
    seed(engine, "active", operation_status="active", usage_state="pending",
         reference_cost_pico=None, input_tokens=9999)
    seed(engine, "unknown", usage_state="unknown", reference_cost_pico=None, input_tokens=9999)
    seed(engine, "not-sent", usage_state="not_sent", reference_cost_pico=0, input_tokens=9999)
    s = report(engine)["summary"]
    assert s["attempt_count"] == 5
    assert s["confirmed_usage_attempts"] == s["confirmed_token_attempts"] == 2
    assert s["input_tokens"] == 200
    assert s["reference_cost_pico"] == "1234"
    assert s["unpriced_attempts"] == 1
    assert s["unknown_usage_attempts"] == 2
    assert s["not_sent_attempts"] == 1
    assert s["active_reserved_attempts"] == 1
    assert s["active_reserved_cost_pico"] == "9000"
    assert s["pending_unknown_attempts"] == 2
    assert s["pending_unknown_cost_pico"] == "18000"


def test_search_and_missing_counters_not_invented(engine):
    seed(engine, "search", api_type="tavily_search", returned_model="tavily:basic",
         input_tokens=None, output_tokens=None, cache_read_tokens=None,
         cache_write_tokens=None, reasoning_tokens=None)
    seed(engine, "legacy", cache_read_tokens=None, cache_write_tokens=None, reasoning_tokens=None)
    s = report(engine)["summary"]
    assert s["confirmed_usage_attempts"] == 2
    assert s["confirmed_token_attempts"] == s["missing_token_attempts"] == 1
    assert s["input_tokens"] == 100
    assert s["cache_read_tokens"] is s["reasoning_tokens"] is None
    assert s["reasoning_reported_attempts"] == 0
    assert s["reference_cost_pico"] == "2468"


@pytest.mark.parametrize("field,value", [
    ("model", "model-a"), ("provider_host", "provider.synthetic.test"),
    ("endpoint_id", "primary"), ("user_id", "user-a"),
])
def test_exact_filters_and_group_dimensions(engine, field, value):
    seed(engine, "matching")
    seed(engine, "other", returned_model="model-b", provider_host="other.synthetic.test",
         endpoint_id="fallback-1", user="user-b")
    result = report(engine, group_by=field, **{field: value})
    assert result["summary"]["attempt_count"] == 1
    assert result["items"][0]["group_value"] == value
    assert result["filters"][field] == value
    assert report(engine, **{field: "' OR 1=1 --"})["summary"]["attempt_count"] == 0


def test_pagination_scope_totals_and_null_groups(engine):
    seed(engine, "one", provider_host=None)
    seed(engine, "two", provider_host="b.synthetic.test")
    seed(engine, "three", provider_host="a.synthetic.test")
    first = report(engine, group_by="provider_host", limit=1)
    assert first["items"][0]["group_value"] is None
    assert first["total_groups"] == 3
    assert first["next_cursor"] == 1
    second = report(engine, group_by="provider_host", limit=1, cursor=1)
    assert second["items"][0]["group_value"] == "a.synthetic.test"
    assert first["summary"] == second["summary"]
    assert second["summary"]["attempt_count"] == 3
    assert report(engine, group_by="provider_host", limit=1, cursor=2)["next_cursor"] is None
    assert report(engine, cursor=100)["items"] == []


def test_utc_created_date_not_late_receipt_date(engine):
    seed(engine, "early", created_at="2026-10-01T00:00:00Z", updated_at="2026-11-01T00:00:00Z")
    seed(engine, "late", created_at="2026-10-05T23:59:59.999999Z")
    seed(engine, "offset", created_at="2026-10-06T07:00:00+08:00")
    seed(engine, "excluded", created_at="2026-10-06T00:00:00Z")
    result = report(engine, group_by="day")
    assert [(r["group_value"], r["attempt_count"]) for r in result["items"]] == [
        ("2026-10-01", 1), ("2026-10-05", 2),
    ]
    assert result["date_basis"] == "attempt_created_at"


def test_empty_report_and_default_scope(engine):
    result = SqliteApiCostReporting(engine).report(end_date=date(2026, 10, 5))
    assert result["start_date"] == date(2026, 9, 6)
    assert result["summary"]["reference_cost_pico"] == "0"
    assert result["summary"]["actual_procurement_cost_pico"] is None
    assert result["total_groups"] == 0
    assert result["items"] == []
    assert result["next_cursor"] is None


@pytest.mark.parametrize("kwargs", [
    {"start_date": date(2026, 10, 6), "end_date": date(2026, 10, 5)},
    {"start_date": date(2024, 1, 1), "end_date": date(2026, 10, 5)},
    {"group_by": "a.user_id; DROP TABLE billing_attempts"}, {"cursor": -1},
    {"limit": 0}, {"limit": 101},
])
def test_invalid_scope_rejected(engine, kwargs):
    with pytest.raises(ValueError):
        SqliteApiCostReporting(engine).report(**kwargs)


def test_money_sum_beyond_sqlite_integer_limit_remains_exact(engine):
    seed(engine, "large-a", reference_cost_pico=9_000_000_000_000_000_000)
    seed(engine, "large-b", reference_cost_pico=9_000_000_000_000_000_000)
    assert report(engine)["summary"]["reference_cost_pico"] == "18000000000000000000"


def test_earliest_legal_end_date_does_not_underflow(engine):
    value = SqliteApiCostReporting(engine).report(end_date=date.min)
    assert value["start_date"] == date.min
