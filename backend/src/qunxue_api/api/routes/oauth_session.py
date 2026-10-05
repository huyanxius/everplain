from urllib.parse import urlencode

import httpx2 as httpx
from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from joserfc.errors import JoseError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from qunxue_api.adapters.oauth import OAuthIdentityInvalid
from qunxue_api.adapters.sqlite.identity_repository import SqliteIdentityRepository
from qunxue_api.adapters.sqlite.oauth_transactions import (
    OAUTH_TTL_SECONDS,
    OAuthTransactions,
    safe_return_path,
)
from qunxue_api.api.contracts.oauth import (
    OAuthProvider,
    OAuthProvidersResponse,
    OAuthStartRequest,
    OAuthStartResponse,
)
from qunxue_api.api.routes.session import _set_session_cookie
from qunxue_api.modules.identity import FederatedIdentityConflict, IdentityError

router = APIRouter(prefix="/api/session/oauth", tags=["session"])
_PRIVATE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


def _cookie_name(provider: str) -> str:
    return f"everplain_oauth_{provider}"


def _cookie_path(provider: str) -> str:
    return f"/api/session/oauth/{provider}"


def _require_origin(request: Request) -> None:
    origin = request.app.state.oauth_clients.origin
    if not origin or request.headers.get("origin") != origin:
        raise HTTPException(status_code=403, detail="OAuth requests must originate from this site")


@router.get("/providers", operation_id="get_oauth_providers", response_model=OAuthProvidersResponse)
def providers(request: Request, response: Response) -> OAuthProvidersResponse:
    response.headers.update(_PRIVATE_HEADERS)
    return OAuthProvidersResponse(providers=request.app.state.oauth_clients.enabled)


@router.get(
    "/linked", operation_id="get_linked_oauth_providers", response_model=OAuthProvidersResponse
)
def linked_providers(request: Request, response: Response) -> OAuthProvidersResponse:
    with request.app.state.identity_service_scope() as service:
        current = service.authenticate(
            request.cookies.get(request.app.state.settings.session_cookie_name)
        )
    with request.app.state.database.session() as db:
        providers = SqliteIdentityRepository(db).list_federated_providers(current.user.user_id)
    response.headers.update(_PRIVATE_HEADERS)
    return OAuthProvidersResponse(providers=providers)


async def _start(
    provider: OAuthProvider,
    payload: OAuthStartRequest,
    request: Request,
    response: Response,
    *,
    link: bool,
) -> OAuthStartResponse:
    _require_origin(request)
    clients = request.app.state.oauth_clients
    if provider not in clients.enabled:
        raise HTTPException(status_code=404, detail="OAuth provider unavailable")
    try:
        return_path = safe_return_path(payload.return_path)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid local return path") from error
    session_id = None
    if link:
        with request.app.state.identity_service_scope() as service:
            current = service.authenticate(
                request.cookies.get(request.app.state.settings.session_cookie_name)
            )
            session_id = str(current.session.session_id)
    transactions = OAuthTransactions(request.app.state.database)
    state, browser, verifier, nonce = transactions.create(
        provider=provider,
        return_path=return_path,
        link_session_id=session_id,
    )
    try:
        url = await clients.authorize_url(provider, state=state, verifier=verifier, nonce=nonce)
    except (httpx.HTTPError, OAuthError, OAuthIdentityInvalid):
        transactions.consume(provider=provider, state=state, browser=browser)
        raise HTTPException(status_code=503, detail="OAuth provider unavailable") from None
    response.headers.update(_PRIVATE_HEADERS)
    response.set_cookie(
        _cookie_name(provider),
        browser,
        max_age=OAUTH_TTL_SECONDS,
        path=_cookie_path(provider),
        secure=clients.origin.startswith("https://"),
        httponly=True,
        samesite="lax",
    )
    return OAuthStartResponse(authorization_url=url)


@router.post(
    "/{provider}/start", operation_id="start_oauth_login", response_model=OAuthStartResponse
)
async def start_login(
    provider: OAuthProvider, payload: OAuthStartRequest, request: Request, response: Response
) -> OAuthStartResponse:
    return await _start(provider, payload, request, response, link=False)


@router.post("/{provider}/link", operation_id="start_oauth_link", response_model=OAuthStartResponse)
async def start_link(
    provider: OAuthProvider, payload: OAuthStartRequest, request: Request, response: Response
) -> OAuthStartResponse:
    return await _start(provider, payload, request, response, link=True)


def _redirect(provider: str, target: str, request: Request) -> RedirectResponse:
    response = RedirectResponse(target, status_code=303, headers=_PRIVATE_HEADERS)
    response.delete_cookie(
        _cookie_name(provider),
        path=_cookie_path(provider),
        secure=bool(
            request.app.state.oauth_clients.origin
            and request.app.state.oauth_clients.origin.startswith("https://")
        ),
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/{provider}/callback", include_in_schema=False)
async def callback(provider: OAuthProvider, request: Request):
    clients = request.app.state.oauth_clients
    failure = "invalid_flow"
    target = "/login"
    try:
        clients.client(provider)
        # Duplicate callback parameters are ambiguous and never accepted.
        if any(len(request.query_params.getlist(key)) != 1 for key in ("state",)):
            raise OAuthIdentityInvalid("ambiguous callback")
        transaction = OAuthTransactions(request.app.state.database).consume(
            provider=provider,
            state=request.query_params.get("state", ""),
            browser=request.cookies.get(_cookie_name(provider), ""),
        )
        if transaction is None:
            raise OAuthIdentityInvalid("invalid flow")
        if transaction.link_session_id:
            target = "/settings?section=security"
        else:
            target = "/login?" + urlencode({"redirect": transaction.return_path})
        if request.query_params.get("error"):
            failure = "cancelled"
            raise OAuthIdentityInvalid("authorization denied")
        codes = request.query_params.getlist("code")
        if len(codes) != 1 or not 1 <= len(codes[0]) <= 2048:
            raise OAuthIdentityInvalid("missing authorization code")
        # Authenticate the exact original session before exchanging a link code.
        if transaction.link_session_id:
            with request.app.state.identity_service_scope() as service:
                current = service.authenticate(
                    request.cookies.get(request.app.state.settings.session_cookie_name)
                )
                if str(current.session.session_id) != transaction.link_session_id:
                    raise OAuthIdentityInvalid("link session changed")
        identity = await clients.identity(
            provider, code=codes[0], verifier=transaction.code_verifier, nonce=transaction.nonce
        )
        with request.app.state.database.session() as db:
            # Serialize the short read/create/link/grant transaction across workers.
            # No database lock is held during provider network calls.
            if db.bind.dialect.name == "sqlite":
                db.execute(text("BEGIN IMMEDIATE"))
            service = request.app.state.build_identity_service(db)
            if transaction.link_session_id:
                current = service.authenticate(
                    request.cookies.get(request.app.state.settings.session_cookie_name)
                )
                if str(current.session.session_id) != transaction.link_session_id:
                    raise OAuthIdentityInvalid("link session changed")
                service.link_federated(
                    current, provider=identity.provider, subject=identity.subject
                )
                grant = None
            else:
                grant = service.login_federated(
                    provider=identity.provider,
                    subject=identity.subject,
                    verified_email=identity.email,
                    user_agent=request.headers.get("user-agent"),
                    ip_address=request.client.host if request.client else None,
                )
        response = _redirect(provider, transaction.return_path, request)
        if grant is not None:
            _set_session_cookie(response, request, grant)
        return response
    except FederatedIdentityConflict:
        failure = "account_link_required"
    except (
        httpx.HTTPError,
        OAuthError,
        JoseError,
        OAuthIdentityInvalid,
        IdentityError,
        ValueError,
        TypeError,
        KeyError,
    ):
        pass
    except SQLAlchemyError:
        failure = "service_unavailable"
    return _redirect(
        provider,
        f"{target}{'&' if '?' in target else '?'}{urlencode({'oauth_error': failure})}",
        request,
    )
