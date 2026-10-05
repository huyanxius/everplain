from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ApiCostGroup = Literal["day", "model", "provider_host", "endpoint_id", "user_id"]


class ApiCostMetrics(BaseModel):
    attempt_count: int
    confirmed_usage_attempts: int
    confirmed_token_attempts: int
    unpriced_attempts: int
    unknown_usage_attempts: int
    not_sent_attempts: int
    active_reserved_attempts: int
    pending_unknown_attempts: int
    missing_token_attempts: int
    unverified_procurement_attempts: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    reasoning_tokens: int | None
    cache_read_reported_attempts: int
    cache_write_reported_attempts: int
    reasoning_reported_attempts: int
    reference_cost_pico: str = Field(description="Persisted reference picoUSD; never invoice cost")
    active_reserved_cost_pico: str
    pending_unknown_cost_pico: str
    actual_procurement_cost_pico: None = Field(
        default=None,
        description="Unavailable: current ledger has no verifiable procurement receipts",
    )


class ApiCostGroupResponse(ApiCostMetrics):
    group_value: str | None


class ApiCostFilters(BaseModel):
    model: str | None
    provider_host: str | None
    endpoint_id: str | None
    user_id: str | None


class ApiCostReportResponse(BaseModel):
    start_date: date
    end_date: date
    timezone: Literal["UTC"]
    date_basis: Literal["attempt_created_at"]
    currency: Literal["USD"]
    group_by: ApiCostGroup
    filters: ApiCostFilters
    summary: ApiCostMetrics
    items: list[ApiCostGroupResponse]
    total_groups: int
    next_cursor: int | None
    procurement_evidence_status: Literal["unavailable"]
    key_attribution_available: Literal[False]
    coverage: Literal["durable_billing_attempts_only"]
    generated_at: datetime
