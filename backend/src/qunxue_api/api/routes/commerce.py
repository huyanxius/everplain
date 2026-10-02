from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from qunxue_api.api.contracts.commerce import (
    ModelCatalogResponse,
    SubscriptionCheckoutRequest,
    SubscriptionCheckoutResponse,
    SubscriptionOverviewResponse,
    SubscriptionPortalRequest,
    SubscriptionPortalResponse,
    SubscriptionWebhookResponse,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.subscriptions import SubscriptionApplication
from qunxue_api.modules.subscriptions import (
    InvalidWebhook,
    PaymentProviderError,
    SubscriptionConflict,
    SubscriptionUnavailable,
)

router = APIRouter(prefix="/api", tags=["commerce"])
_MAX_WEBHOOK_BYTES = 1024 * 1024


def application(request: Request) -> SubscriptionApplication:
    return request.app.state.subscription_application


Application = Annotated[SubscriptionApplication, Depends(application)]


def _http_error(exc: Exception) -> HTTPException:
    code = (
        503
        if isinstance(exc, SubscriptionUnavailable)
        else (
            502
            if isinstance(exc, PaymentProviderError)
            else (409 if isinstance(exc, SubscriptionConflict) else 400)
        )
    )
    return HTTPException(code, str(exc))


@router.get("/models", response_model=ModelCatalogResponse, operation_id="get_model_catalog")
def get_model_catalog(request: Request, current: CurrentSessionDependency):
    return {"items": [asdict(value) for value in request.app.state.model_catalog]}


@router.get(
    "/subscription",
    response_model=SubscriptionOverviewResponse,
    operation_id="get_subscription",
)
def get_subscription(current: CurrentSessionDependency, app: Application):
    value = app.get(current.user.user_id)
    return {
        "available": app.unavailable_reason is None,
        "unavailable_reason": app.unavailable_reason,
        "plans": [{"id": p.id, "name": p.name, "description": p.description} for p in app.plans],
        "subscription": {
            "plan_id": value.plan_id,
            "status": value.status,
            "current_period_end": value.current_period_end,
            "cancel_at_period_end": value.cancel_at_period_end,
        }
        if value
        else None,
    }


@router.post(
    "/subscription/checkout",
    response_model=SubscriptionCheckoutResponse,
    operation_id="create_subscription_checkout",
)
def create_subscription_checkout(
    payload: SubscriptionCheckoutRequest,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    try:
        return asdict(app.checkout(current.user.user_id, payload.plan_id, key))
    except (SubscriptionUnavailable, SubscriptionConflict, PaymentProviderError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.post(
    "/subscription/webhook",
    response_model=SubscriptionWebhookResponse,
    operation_id="receive_subscription_webhook",
)
async def receive_subscription_webhook(
    request: Request,
    app: Application,
    signature: Annotated[str, Header(alias="Stripe-Signature", max_length=4096)] = "",
):
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > _MAX_WEBHOOK_BYTES:
            raise HTTPException(413, "支付通知过大")
        payload.extend(chunk)
    try:
        duplicate = await run_in_threadpool(app.webhook, bytes(payload), signature)
        return {"received": True, "duplicate": duplicate}
    except (
        SubscriptionUnavailable,
        SubscriptionConflict,
        PaymentProviderError,
        InvalidWebhook,
    ) as exc:
        raise _http_error(exc) from exc


@router.post(
    "/subscription/portal",
    response_model=SubscriptionPortalResponse,
    operation_id="create_subscription_portal",
)
def create_subscription_portal(
    current: CurrentSessionDependency,
    app: Application,
    payload: SubscriptionPortalRequest | None = None,
):
    try:
        return {"portal_url": app.portal(current.user.user_id)}
    except (SubscriptionUnavailable, SubscriptionConflict, PaymentProviderError) as exc:
        raise _http_error(exc) from exc
