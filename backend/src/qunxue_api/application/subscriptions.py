"""Explicit transaction boundaries around remote subscription operations."""

import hashlib
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID

from qunxue_api.modules.subscriptions import (
    CheckoutIntent,
    CheckoutResult,
    Subscription,
    SubscriptionConflict,
    SubscriptionGateway,
    SubscriptionPlan,
    SubscriptionRepository,
    SubscriptionUnavailable,
)


class SubscriptionApplication:
    def __init__(
        self,
        repository_scope: Callable[[], AbstractContextManager[SubscriptionRepository]],
        gateway: SubscriptionGateway,
        *,
        plans: tuple[SubscriptionPlan, ...],
        unavailable_reason: str | None,
        success_url: str,
        cancel_url: str,
        portal_return_url: str = "",
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        plan_limits: Mapping[str, int] | None = None,
    ):
        self.repository_scope = repository_scope
        self.gateway = gateway
        self.plans = plans
        self.unavailable_reason = unavailable_reason
        self.success_url = success_url
        self.cancel_url = cancel_url
        self.clock = clock
        self.portal_return_url = portal_return_url
        self.plan_limits = dict(plan_limits or {})

    def get(self, user_id: UUID) -> Subscription | None:
        with self.repository_scope() as repository:
            value = repository.get(user_id)
        if value and value.provider_id.startswith("membership:"):
            now = self.clock()
            if value.current_period_end is not None and value.current_period_end <= now:
                return replace(value, status="expired")
            if value.current_period_start is not None and value.current_period_start > now:
                return replace(value, status="scheduled")
        return value

    def checkout(self, user_id: UUID, plan_id: str, key: str) -> CheckoutResult:
        self._require_available()
        plan = next((plan for plan in self.plans if plan.id == plan_id), None)
        if plan is None:
            raise ValueError("请选择已配置的订阅方案")
        if not 8 <= len(key) <= 128:
            raise ValueError("无效重复请求标识")
        # User scoping avoids collisions or cross-account session disclosure.
        request_key = hashlib.sha256(f"everplain:{user_id}:{key}".encode()).hexdigest()
        intent = CheckoutIntent(
            request_key,
            user_id,
            plan.id,
            plan.price_id,
            self.success_url,
            self.cancel_url,
            self.clock(),
        )
        with self.repository_scope() as repository:
            intent = repository.reserve_checkout(intent)
        # Reservation is committed before the network call. A timeout may still have
        # created a Stripe session; retries reuse identical persisted parameters/key.
        if intent.result:
            return intent.result
        result = self.gateway.create_checkout(intent)
        with self.repository_scope() as repository:
            repository.complete_checkout(intent, result)
        return result

    def portal(self, user_id: UUID) -> str:
        self._require_available()
        if not self.portal_return_url:
            raise SubscriptionUnavailable("订阅管理入口尚未配置")
        subscription = self.get(user_id)
        if subscription is None:
            raise SubscriptionConflict("当前账号尚无可管理的订阅")
        return self.gateway.create_portal(subscription.customer_id, self.portal_return_url)

    def webhook(self, payload: bytes, signature: str) -> bool:
        self._require_available()
        now = self.clock()
        event = self.gateway.verify_event(payload, signature, now)
        with self.repository_scope() as repository:
            if not repository.claim_event(event, now):
                return True
            if event.subscription_id:
                # The event insert serializes SQLite writers. Read Stripe's current
                # state under this lock, not stale snapshots or event timestamps.
                # On fetch/save failure the entire transaction (including claim) rolls back.
                subscription = self.gateway.get_subscription(event.subscription_id)
                if subscription:
                    repository.save_subscription(subscription)
        return False

    def _require_available(self):
        if self.unavailable_reason:
            raise SubscriptionUnavailable(self.unavailable_reason)
