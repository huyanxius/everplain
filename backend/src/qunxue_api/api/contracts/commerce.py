from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CatalogModelResponse(BaseModel):
    id: str
    display_name: str
    provider: str
    model: str
    capabilities: list[str]
    availability: Literal["configured", "unavailable"]
    unavailable_reason: str | None


class ModelCatalogResponse(BaseModel):
    items: list[CatalogModelResponse]


class SubscriptionPlanResponse(BaseModel):
    id: str
    name: str
    description: str


class SubscriptionResponse(BaseModel):
    plan_id: str | None
    status: str
    current_period_end: datetime | None
    cancel_at_period_end: bool


class SubscriptionOverviewResponse(BaseModel):
    available: bool
    unavailable_reason: str | None
    plans: list[SubscriptionPlanResponse]
    subscription: SubscriptionResponse | None


class SubscriptionCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class SubscriptionCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class SubscriptionWebhookResponse(BaseModel):
    received: bool
    duplicate: bool


class SubscriptionPortalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SubscriptionPortalResponse(BaseModel):
    portal_url: str
