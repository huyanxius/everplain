"""Optional Stripe HTTP boundary. Tests inject httpx.MockTransport; no SDK globals."""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from qunxue_api.adapters.commerce_config import CommerceSettings
from qunxue_api.modules.subscriptions import (
    SUBSCRIPTION_STATUSES,
    CheckoutIntent,
    CheckoutResult,
    InvalidWebhook,
    PaymentProviderError,
    Subscription,
    SubscriptionEvent,
)

SUBSCRIPTION_EVENTS = frozenset(
    {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }
)
MAX_WEBHOOK_BYTES = 1024 * 1024


class StripeSubscriptionGateway:
    def __init__(self, settings: CommerceSettings, *, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    def _request(self, method: str, path: str, **kwargs) -> dict:
        key = self.settings.stripe_secret_key
        if key is None:
            raise PaymentProviderError("支付服务尚未配置")
        headers = kwargs.pop("headers", {}) | {"Authorization": f"Bearer {key.get_secret_value()}"}
        try:
            with httpx.Client(
                transport=self.transport,
                timeout=self.settings.stripe_timeout_seconds,
                follow_redirects=False,
                trust_env=False,
            ) as client:
                response = client.request(
                    method,
                    f"https://api.stripe.com/v1/{path}",
                    headers=headers,
                    **kwargs,
                )
                response.raise_for_status()
                value = response.json()
                if not isinstance(value, dict):
                    raise ValueError
                return value
        except (httpx.HTTPError, ValueError) as exc:
            # Never expose Stripe response bodies, secret keys or request headers.
            raise PaymentProviderError("支付服务暂时不可用，请稍后重试") from exc

    def create_checkout(self, intent: CheckoutIntent) -> CheckoutResult:
        data = {
            "mode": "subscription",
            "line_items[0][price]": intent.price_id,
            "line_items[0][quantity]": "1",
            "success_url": intent.success_url,
            "cancel_url": intent.cancel_url,
            "client_reference_id": str(intent.user_id),
            "subscription_data[metadata][everplain_user_id]": str(intent.user_id),
            "subscription_data[metadata][everplain_plan_id]": intent.plan_id,
            # Bound concurrent-checkout reservations to the same expiration at Stripe.
            "expires_at": str(int(intent.created_at.timestamp()) + 3600),
        }
        value = self._request(
            "POST",
            "checkout/sessions",
            data=data,
            headers={"Idempotency-Key": intent.key},
        )
        session_id, url = value.get("id"), value.get("url")
        if not isinstance(session_id, str) or not session_id.startswith("cs_"):
            raise PaymentProviderError("支付服务返回了无效会话")
        if not isinstance(url, str):
            raise PaymentProviderError("支付服务未返回结账链接")
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError as exc:
            raise PaymentProviderError("支付服务返回了无效结账链接") from exc
        if (
            parsed.scheme != "https"
            or parsed.hostname != "checkout.stripe.com"
            or (parsed.username or parsed.password or port not in (None, 443))
        ):
            raise PaymentProviderError("支付服务返回了无效结账链接")
        return CheckoutResult(url, session_id)

    def verify_event(self, payload: bytes, signature: str, now: datetime) -> SubscriptionEvent:
        secret = self.settings.stripe_webhook_secret
        if secret is None or len(payload) > MAX_WEBHOOK_BYTES or len(signature) > 4096:
            raise InvalidWebhook("无效支付通知")
        try:
            parts = [part.strip().split("=", 1) for part in signature.split(",")]
            timestamps = [value for key, value in parts if key == "t"]
            signatures = [value for key, value in parts if key == "v1"]
            if len(timestamps) != 1 or not timestamps[0].isdigit():
                raise ValueError
            timestamp = int(timestamps[0])
            if abs(now.timestamp() - timestamp) > self.settings.stripe_webhook_tolerance_seconds:
                raise ValueError
            signed = timestamps[0].encode("ascii") + b"." + payload
            expected = hmac.new(
                secret.get_secret_value().encode(), signed, hashlib.sha256
            ).hexdigest()
            if not any(hmac.compare_digest(expected, value) for value in signatures):
                raise ValueError
            value = json.loads(payload)
            if not isinstance(value, dict) or value.get("account"):
                raise ValueError
            if value.get("livemode") is not self.settings.stripe_live_mode:
                raise ValueError
            event_id, event_type = value["id"], value["type"]
            if (
                not isinstance(event_id, str)
                or not event_id.startswith("evt_")
                or len(event_id) > 255
            ):
                raise ValueError
            if not isinstance(event_type, str) or len(event_type) > 120:
                raise ValueError
            subscription_id = None
            if event_type in SUBSCRIPTION_EVENTS:
                subscription_id = value["data"]["object"]["id"]
                if not isinstance(subscription_id, str) or not subscription_id.startswith("sub_"):
                    raise ValueError
                if len(subscription_id) > 255:
                    raise ValueError
            return SubscriptionEvent(event_id, event_type, subscription_id)
        except (ValueError, KeyError, TypeError, UnicodeError, OverflowError) as exc:
            raise InvalidWebhook("支付通知签名或内容无效") from exc

    def get_subscription(self, provider_id: str) -> Subscription | None:
        # provider_id came from a verified event, but still restrict path characters.
        if not provider_id.removeprefix("sub_").isalnum():
            raise InvalidWebhook("无效订阅标识")
        value = self._request("GET", f"subscriptions/{provider_id}")
        try:
            if value.get("id") != provider_id:
                raise ValueError
            metadata = value.get("metadata") or {}
            if not isinstance(metadata, dict):
                raise ValueError
            if "everplain_user_id" not in metadata:
                return None  # A different product's subscription in the same merchant account.
            user_id = UUID(metadata["everplain_user_id"])
            customer = value["customer"]
            status = value["status"]
            if not isinstance(customer, str) or not customer.startswith("cus_"):
                raise ValueError
            if status not in SUBSCRIPTION_STATUSES:
                raise ValueError
            items = value["items"]["data"]
            if not isinstance(items, list) or len(items) != 1:
                raise ValueError
            price_id = items[0]["price"]["id"]
            plan = next((p for p in self.settings.plans() if p.price_id == price_id), None)
            end = items[0].get("current_period_end", value.get("current_period_end"))
            cancel = value["cancel_at_period_end"]
            if not isinstance(cancel, bool):
                raise ValueError
            return Subscription(
                user_id=user_id,
                provider_id=provider_id,
                customer_id=customer,
                plan_id=plan.id if plan else None,
                status=status,
                current_period_end=datetime.fromtimestamp(end, UTC) if end is not None else None,
                cancel_at_period_end=cancel,
                created_at=datetime.fromtimestamp(value["created"], UTC),
            )
        except (ValueError, KeyError, TypeError, OverflowError, OSError) as exc:
            raise PaymentProviderError("支付服务返回了无效订阅") from exc

    def create_portal(self, customer_id: str, return_url: str) -> str:
        value = self._request(
            "POST",
            "billing_portal/sessions",
            data={
                "customer": customer_id,
                "return_url": return_url,
            },
        )
        url = value.get("url")
        try:
            if not isinstance(url, str):
                raise ValueError
            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or parsed.hostname != "billing.stripe.com"
                or (parsed.username or parsed.password or parsed.port not in (None, 443))
            ):
                raise ValueError
        except ValueError as exc:
            raise PaymentProviderError("支付服务返回了无效管理链接") from exc
        return url
