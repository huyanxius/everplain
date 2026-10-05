"""Read-only projections of persisted attempt evidence, never a second ledger.

Reference prices are the amounts saved at settlement, not today's tariff. The
current ledger has no procurement receipts: even a populated procurement amount
or a provider response ID cannot establish an invoiced purchase cost.
"""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text

_GROUPS = {
    "day": "date(a.created_at)",
    "model": "coalesce(nullif(a.returned_model, ''), a.requested_model)",
    "provider_host": "nullif(a.provider_host, '')",
    "endpoint_id": "a.endpoint_id",
    "user_id": "o.user_id",
}
_FILTERS = {key: expression for key, expression in _GROUPS.items() if key != "day"}
_TOKEN_CONFIRMED = (
    "a.usage_state IN ('known','unpriced') AND a.input_tokens >= 0 "
    "AND a.output_tokens >= 0"
)
_UNKNOWN_COST = "a.reference_cost_pico IS NULL AND a.usage_state != 'not_sent'"
_ACTIVE = f"{_UNKNOWN_COST} AND o.status = 'active'"
_PENDING = f"{_UNKNOWN_COST} AND o.status != 'active'"


def _count(condition):
    return f"coalesce(sum(CASE WHEN {condition} THEN 1 ELSE 0 END),0)"


class _PicoSum:
    """Keep multi-row currency totals exact beyond SQLite's signed integer range."""

    def __init__(self):
        self.total = 0

    def step(self, value):
        if value is not None:
            self.total += int(value)

    def finalize(self):
        return str(self.total)


def _pico_sum(column, condition):
    return (
        "coalesce(api_cost_pico_sum(CASE WHEN "
        f"{condition} THEN a.{column} ELSE 0 END),'0')"
    )


def _sum(column, condition):
    return f"coalesce(sum(CASE WHEN {condition} THEN coalesce(a.{column},0) ELSE 0 END),0)"


_METRICS = {
    "attempt_count": "count(*)",
    "confirmed_usage_attempts": _count("a.usage_state IN ('known','unpriced')"),
    "confirmed_token_attempts": _count(_TOKEN_CONFIRMED),
    "unpriced_attempts": _count("a.usage_state = 'unpriced'"),
    "unknown_usage_attempts": _count("a.usage_state NOT IN ('known','unpriced','not_sent')"),
    "not_sent_attempts": _count("a.usage_state = 'not_sent'"),
    "active_reserved_attempts": _count(_ACTIVE),
    "pending_unknown_attempts": _count(_PENDING),
    "missing_token_attempts": _count(
        "a.usage_state IN ('known','unpriced') "
        "AND (a.input_tokens IS NULL OR a.output_tokens IS NULL "
        "OR a.input_tokens < 0 OR a.output_tokens < 0)"
    ),
    "unverified_procurement_attempts": _count("a.procurement_cost_pico IS NOT NULL"),
    **{column: _sum(column, _TOKEN_CONFIRMED) for column in (
        "input_tokens", "output_tokens",
    )},
    **{f"{prefix}_tokens": (
        f"sum(CASE WHEN {_TOKEN_CONFIRMED} THEN a.{prefix}_tokens END)"
    ) for prefix in ("cache_read", "cache_write", "reasoning")},
    **{f"{prefix}_reported_attempts": _count(
        f"{_TOKEN_CONFIRMED} AND a.{prefix}_tokens IS NOT NULL"
    ) for prefix in ("cache_read", "cache_write", "reasoning")},
    "reference_cost_pico": _pico_sum("reference_cost_pico", "a.usage_state = 'known'"),
    "active_reserved_cost_pico": _pico_sum("reserved_cost_pico", _ACTIVE),
    "pending_unknown_cost_pico": _pico_sum("reserved_cost_pico", _PENDING),
}
_AGGREGATES = ", ".join(f"{expression} AS {name}" for name, expression in _METRICS.items())


def _metrics(row):
    values = dict(row)
    for key in ("reference_cost_pico", "active_reserved_cost_pico", "pending_unknown_cost_pico"):
        # JSON numbers cannot safely represent integer picoUSD in a JS client.
        values[key] = str(values[key])
    values["actual_procurement_cost_pico"] = None
    return values


class SqliteApiCostReporting:
    def __init__(self, engine):
        self.engine = engine

    def report(
        self, *, start_date: date | None = None, end_date: date | None = None,
        group_by="model", model=None, provider_host=None, endpoint_id=None,
        user_id=None, cursor=0, limit=25,
    ):
        today = datetime.now(UTC).date()
        end_date = end_date or today
        start_date = start_date or end_date - timedelta(days=min(29, (end_date - date.min).days))
        if start_date > end_date or (end_date - start_date).days >= 366:
            raise ValueError("日期范围须为1至366天，开始日期不能晚于结束日期")
        if group_by not in _GROUPS or not 0 <= cursor <= 2_147_483_647 or not 1 <= limit <= 100:
            raise ValueError("无效的分组或分页参数")
        filters = {
            "model": model, "provider_host": provider_host,
            "endpoint_id": endpoint_id, "user_id": user_id,
        }
        clauses = ["date(a.created_at) >= :start_date", "date(a.created_at) <= :end_date"]
        params = {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()}
        for field, value in filters.items():
            if value is not None:
                clauses.append(f"{_FILTERS[field]} = :{field}")
                params[field] = value
        source = (
            "FROM billing_attempts a JOIN billing_operations o ON o.run_id = a.run_id WHERE "
            + " AND ".join(clauses)
        )
        group = _GROUPS[group_by]
        # An explicit read transaction keeps totals and paginated groups in one
        # SQLite snapshot even if a late usage receipt is settled concurrently.
        with self.engine.connect() as conn:
            conn.connection.driver_connection.create_aggregate("api_cost_pico_sum", 1, _PicoSum)
            conn.exec_driver_sql("BEGIN")
            summary = _metrics(conn.execute(text(f"SELECT {_AGGREGATES} {source}"), params)
                               .mappings().one())
            total = conn.scalar(text(
                f"SELECT count(*) FROM (SELECT {group} {source} GROUP BY {group})"
            ), params)
            rows = conn.execute(text(
                f"SELECT {group} AS group_value, {_AGGREGATES} {source} "
                f"GROUP BY {group} ORDER BY {group} IS NOT NULL, {group} "
                "LIMIT :limit OFFSET :cursor"
            ), {**params, "limit": limit, "cursor": cursor}).mappings().all()
        return {
            "start_date": start_date, "end_date": end_date, "timezone": "UTC",
            "date_basis": "attempt_created_at", "currency": "USD", "group_by": group_by,
            "filters": filters, "summary": summary, "items": [_metrics(row) for row in rows],
            "total_groups": total,
            "next_cursor": cursor + limit if cursor + limit < total else None,
            "procurement_evidence_status": "unavailable", "key_attribution_available": False,
            "coverage": "durable_billing_attempts_only", "generated_at": datetime.now(UTC),
        }
