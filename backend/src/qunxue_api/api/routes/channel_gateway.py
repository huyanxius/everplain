"""Opt-in channel control plane; gateway credentials never become user credentials."""

import hmac
import logging
import threading
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from qunxue_api.api.billing_errors import billing_error
from qunxue_api.api.contracts.channel_gateway import (
    ChannelBindingResponse,
    ChannelDeliveryResponse,
    ChannelDispatchRequest,
    ChannelDispatchResponse,
    ChannelGatewayInfoResponse,
    ChannelLinkCodeRequest,
    ChannelLinkCodeResponse,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.application.channel_gateway import ChannelGatewayApplication
from qunxue_api.modules.agent_conversation import AgentInterrupted, RunAlreadyActive
from qunxue_api.modules.billing import BillingFailure, CreditRunInProgress, CreditsDepleted
from qunxue_api.modules.channel_gateway import (
    ChannelEvent,
    GatewayBusy,
    GatewayConflict,
    GatewayDenied,
)

router = APIRouter(tags=["channel-gateway"])
logger = logging.getLogger(__name__)


def application(request: Request):
    with request.app.state.channel_gateway_scope() as app:
        yield app


Application = Annotated[ChannelGatewayApplication, Depends(application)]


def configured(request, gateway_id):
    return request.app.state.settings.channel_gateway_credentials.get(gateway_id)


def authenticate_gateway(request: Request):
    gateway_id = request.headers.get("x-everplain-gateway", "")
    expected = configured(request, gateway_id)
    bearer = request.headers.get("authorization", "")
    if (
        expected is None
        or not bearer.startswith("Bearer ")
        or not hmac.compare_digest(bearer[7:].encode(), expected.get_secret_value().encode())
    ):
        raise HTTPException(401, "Gateway authentication required")
    return gateway_id


GatewayIdentity = Annotated[str, Depends(authenticate_gateway)]


def require_same_origin(request: Request):
    origin = request.headers.get("origin")
    if (
        origin is not None and origin not in request.app.state.settings.cors_allowed_origins
    ) or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Origin is not allowed")


@router.get(
    "/api/channels/gateways",
    response_model=list[ChannelGatewayInfoResponse],
    operation_id="list_channel_gateways",
)
def list_gateways(
    current: CurrentSessionDependency, request: Request, response: Response, app: Application
):
    response.headers["Cache-Control"] = "no-store"
    try:
        app.active_user(current.user.user_id)
    except GatewayDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    settings = request.app.state.settings
    result = []
    for identity in sorted(settings.channel_gateway_credentials):
        platform, bot_id, *_ = identity.split(":")
        display = settings.channel_gateway_display.get(identity)
        result.append(
            ChannelGatewayInfoResponse(
                gateway_id=identity,
                platform=platform,
                name=display.name
                if display
                else f"{'Telegram' if platform == 'telegram' else '飞书'} · {bot_id}",
                bot_url=display.bot_url if display else None,
            )
        )
    return result


@router.delete(
    "/api/channels/link-codes",
    dependencies=[Depends(require_same_origin)],
    status_code=204,
    operation_id="cancel_channel_link_codes",
)
def cancel_link_codes(
    current: CurrentSessionDependency,
    app: Application,
    gateway_id: str = Query(min_length=1, max_length=200),
):
    try:
        app.cancel_codes(current.user.user_id, gateway_id)
    except GatewayDenied as exc:
        raise HTTPException(403, str(exc)) from exc


@router.post(
    "/api/channels/link-codes",
    dependencies=[Depends(require_same_origin)],
    response_model=ChannelLinkCodeResponse,
    status_code=201,
    operation_id="create_channel_link_code",
)
def create_link_code(
    payload: ChannelLinkCodeRequest,
    current: CurrentSessionDependency,
    request: Request,
    response: Response,
    app: Application,
):
    response.headers["Cache-Control"] = "no-store"
    if configured(request, payload.gateway_id) is None:
        raise HTTPException(404, "Gateway is not configured")
    try:
        return app.create_code(current.user.user_id, payload.gateway_id)
    except GatewayDenied as exc:
        raise HTTPException(403, str(exc)) from exc


@router.get(
    "/api/channels/bindings",
    response_model=list[ChannelBindingResponse],
    operation_id="list_channel_bindings",
)
def list_bindings(current: CurrentSessionDependency, response: Response, app: Application):
    response.headers["Cache-Control"] = "no-store"
    try:
        return [
            ChannelBindingResponse(
                binding_id=row.binding_id,
                gateway_id=row.gateway_id,
                subject_id=row.subject_id,
                created_at=row.created_at,
            )
            for row in app.bindings(current.user.user_id)
        ]
    except GatewayDenied as exc:
        raise HTTPException(403, str(exc)) from exc


@router.delete(
    "/api/channels/bindings/{binding_id}",
    dependencies=[Depends(require_same_origin)],
    status_code=204,
    operation_id="revoke_channel_binding",
)
def revoke_binding(binding_id: UUID, current: CurrentSessionDependency, app: Application):
    try:
        app.revoke(current.user.user_id, binding_id)
    except GatewayDenied as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post(
    "/api/channel-gateway/dispatch",
    response_model=ChannelDispatchResponse,
    responses={202: {"model": ChannelDispatchResponse,
                     "description": "Durably admitted; read the event cursor for completion"}},
    operation_id="dispatch_channel_message",
)
def dispatch(
    payload: ChannelDispatchRequest,
    gateway_id: GatewayIdentity,
    request: Request,
    response: Response,
    app: Application,
):
    response.headers["Cache-Control"] = "no-store"
    event = ChannelEvent(**payload.model_dump())
    if event.gateway_id != gateway_id:
        raise HTTPException(403, "Gateway identity mismatch")
    try:
        if request.headers.get("prefer") == "respond-async":
            prepared = app.prepare(event, runtime_scope=request.app.state.disciplinary_agent_scope)
            if prepared[3] is not None:
                return ChannelDispatchResponse(event_key=event.event_key, text=prepared[3])
            # Reservation commits before headers. The gateway's durable inbox owns
            # replay after process loss; a GET never starts a provider operation.
            gateway_scope = request.app.state.channel_gateway_scope
            runtime_scope = request.app.state.disciplinary_agent_scope

            def execute():
                try:
                    with gateway_scope() as gateway:
                        gateway.dispatch(event, gateway_scope=gateway_scope,
                                         runtime_scope=runtime_scope, prepared=prepared)
                except Exception as error:
                    logger.error("Channel execution failed: %s", type(error).__name__)

            threading.Thread(target=execute, daemon=True, name="channel-agent-execution").start()
            response.status_code = 202
            return ChannelDispatchResponse(event_key=event.event_key, state="processing")
        answer = app.dispatch(
            event,
            gateway_scope=request.app.state.channel_gateway_scope,
            runtime_scope=request.app.state.disciplinary_agent_scope,
        )
    except GatewayDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except GatewayConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except (GatewayBusy, RunAlreadyActive, CreditRunInProgress) as exc:
        raise HTTPException(429, "A turn is already running", headers={"Retry-After": "5"}) from exc
    except CreditsDepleted as exc:
        raise HTTPException(402, "积分不足，请在 Everplain 查看用量。") from exc
    except BillingFailure as exc:
        status, _, message = billing_error(exc)
        raise HTTPException(status, message) from exc
    except AgentInterrupted as exc:
        raise HTTPException(503, "Generation interrupted; retry the same event") from exc
    except Exception as exc:
        # Do not log payloads or exception text: they may contain a binding code,
        # private prompt, model output, or an upstream secret-bearing URL.
        logger.error("Channel dispatch failed: %s", type(exc).__name__)
        raise HTTPException(503, "Agent temporarily unavailable") from exc
    return ChannelDispatchResponse(event_key=event.event_key, text=answer)


@router.get(
    "/api/channel-gateway/events/{event_key}",
    response_model=ChannelDispatchResponse,
    operation_id="read_channel_message_output",
)
def read_output(event_key: str, gateway_id: GatewayIdentity, request: Request,
                response: Response, app: Application, after: int = Query(0, ge=0)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return app.output(gateway_id, event_key, after=after,
                          runtime_scope=request.app.state.disciplinary_agent_scope)
    except GatewayDenied as error:
        raise HTTPException(404, "Message unavailable") from error


@router.get(
    "/api/channel-gateway/events/{event_key}/delivery",
    response_model=ChannelDeliveryResponse,
    operation_id="authorize_channel_delivery",
)
def authorize_delivery(
    event_key: str, gateway_id: GatewayIdentity, request: Request,
    response: Response, app: Application
):
    response.headers["Cache-Control"] = "no-store"
    return ChannelDeliveryResponse(allowed=app.can_deliver(
        gateway_id, event_key, runtime_scope=request.app.state.disciplinary_agent_scope
    ))
