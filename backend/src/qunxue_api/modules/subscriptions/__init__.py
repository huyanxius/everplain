"""Subscription primitives, independent of HTTP, storage and payment SDKs."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

TERMINAL_STATUSES = frozenset({"canceled", "incomplete_expired"})
SUBSCRIPTION_STATUSES = frozenset(
    {
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
    }
)


class SubscriptionUnavailable(Exception):
    pass


class SubscriptionConflict(Exception):
    pass


class PaymentProviderError(Exception):
    pass


class InvalidWebhook(ValueError):
    pass


@dataclass(frozen=True)
class SubscriptionPlan:
    id: str
    name: str
    description: str
    price_id: str
    price_cny_fen: int = 0
    weekly_points: int = 0
    period_days: int = 28

    @property
    def period_points(self) -> int:
        return self.weekly_points * 4


# Public allowance catalogue. Procurement rates never belong in this catalogue.
MEMBERSHIP_PLANS = (
    SubscriptionPlan("plus", "Plus", "适合日常阅读、问答与写作", "", 4900, 50),
    SubscriptionPlan("pro", "PRO", "适合持续研究与较高频使用", "", 9900, 100),
    SubscriptionPlan("max", "Max", "适合密集研究与大量文稿工作", "", 24900, 250),
)
MEMBERSHIP_WEEKLY_POINTS = {plan.id: plan.weekly_points for plan in MEMBERSHIP_PLANS}
TOP_UP_POINTS = 50
TOP_UP_PRICE_CNY_FEN = 1500


def membership_plan(plan_id: str) -> SubscriptionPlan:
    for plan in MEMBERSHIP_PLANS:
        if plan.id == plan_id:
            return plan
    raise ValueError("unknown membership plan")


@dataclass(frozen=True)
class CheckoutResult:
    checkout_url: str
    session_id: str


@dataclass(frozen=True)
class CheckoutIntent:
    key: str
    user_id: UUID
    plan_id: str
    price_id: str
    success_url: str
    cancel_url: str
    created_at: datetime
    result: CheckoutResult | None = None


@dataclass(frozen=True)
class Subscription:
    user_id: UUID
    provider_id: str
    customer_id: str
    plan_id: str | None
    status: str
    current_period_end: datetime | None
    cancel_at_period_end: bool
    created_at: datetime


@dataclass(frozen=True)
class SubscriptionEvent:
    id: str
    type: str
    subscription_id: str | None


class SubscriptionGateway(Protocol):
    def create_checkout(self, intent: CheckoutIntent) -> CheckoutResult: ...
    def verify_event(self, payload: bytes, signature: str, now: datetime) -> SubscriptionEvent: ...
    def get_subscription(self, provider_id: str) -> Subscription | None: ...
    def create_portal(self, customer_id: str, return_url: str) -> str: ...


class SubscriptionRepository(Protocol):
    def get(self, user_id: UUID) -> Subscription | None: ...
    def reserve_checkout(self, intent: CheckoutIntent) -> CheckoutIntent: ...
    def complete_checkout(self, intent: CheckoutIntent, result: CheckoutResult) -> None: ...
    def claim_event(self, event: SubscriptionEvent, now: datetime) -> bool: ...
    def save_subscription(self, value: Subscription) -> None: ...
