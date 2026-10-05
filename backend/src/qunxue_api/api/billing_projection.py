"""Customer receipts expose usage and reference prices, never procurement records."""

_RETAIL_FIELDS = (
    "points_per_cny", "retail_rate_ppm", "fx_cny_per_usd_micro", "fx_snapshot_id",
    "fx_as_of", "fx_source",
)


def _reference_price_snapshot(snapshot: dict) -> dict:
    public = {
        key: snapshot[key]
        for key in (
            "version", "credits_per_usd", "deepseek_time_basis", "calendar_version",
            "reference_band", "dispatch_at", *_RETAIL_FIELDS,
        )
        if key in snapshot
    }
    public["tariffs"] = {
        model: {
            key: tariff[key]
            for key in (
                "input", "cache_read", "cache_write", "output", "long_threshold",
                "long_rates", "currency", "service_tier", "source", "version",
            )
            if key in tariff
        }
        for model, tariff in snapshot.get("tariffs", {}).items()
    }
    search_price = snapshot.get("tavily_price")
    public["tavily_price"] = (
        {key: search_price[key] for key in ("usd_micro_per_credit", "retail_rate_ppm", "source")
         if key in search_price}
        if search_price is not None else None
    )
    return public


def _customer_attempt(attempt: dict) -> dict:
    public = {
        key: attempt[key]
        for key in (
            "attempt_id", "api_type", "requested_model", "returned_model", "requested_effort",
            "requested_service_tier", "returned_service_tier", "billable", "outcome",
            "usage_state", "input_tokens", "cache_read_tokens", "cache_write_tokens",
            "output_tokens", "reasoning_tokens", "finish_reason", "reference_cost_pico",
            "failure_code", "created_at", "updated_at",
        )
        if key in attempt
    }
    public["price_snapshot"] = _reference_price_snapshot(attempt["price_snapshot"])
    if "search_usage" in attempt:
        public["search_usage"] = {
            key: attempt["search_usage"][key]
            for key in ("credits",)
            if key in attempt["search_usage"]
        }
    return public


def customer_billing_operation(operation: dict) -> dict:
    # Keep the repository's complete audit data intact; only this HTTP view is public.
    public = {
        key: operation[key]
        for key in (
            "operation_id", "outcome", "frozen_points", "points_charged",
            "exact_credit_numerator", "exact_credit_denominator", "original_credit_numerator",
            "original_credit_denominator", "credit_scale", "price_version", "credits_per_usd",
            "reference_currency", "exempt", "created_at",
        )
        if key in operation
    }
    public["retail_snapshot"] = {
        key: operation["retail_snapshot"][key]
        for key in _RETAIL_FIELDS
        if key in operation["retail_snapshot"]
    }
    public["attempts"] = [_customer_attempt(attempt) for attempt in operation["attempts"]]
    return public
