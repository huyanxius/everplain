from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from qunxue_api.api.contracts.oauth import (
    OAuthProvider,
    OAuthProvidersResponse,
    OAuthStartRequest,
    OAuthStartResponse,
)
from qunxue_api.api.routes.session import _set_session_cookie
from qunxue_api.application.oauth_login import OAuthLoginApplication
from qunxue_api.modules.identity import (
    OAUTH_TTL_SECONDS,
    OAuthProviderUnavailable,
    OAuthStorageUnavailable,
)

router = APIRouter(prefix="/api/session/oauth", tags=["session"])
_PRIVATE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


def _application(request: Request) -> OAuthLoginApplication:
    return request.app.state.oauth_application


def _credential(request: Request) -> str | None:
    return request.cookies.get(request.app.state.settings.session_cookie_name)


def _secure_oauth_cookie(request: Request) -> bool:
    origin = _application(request).origin
    return bool(origin and origin.startswith("https://"))


def _cookie_name(provider: str, request: Request) -> str:
    prefix = "__Host-" if _secure_oauth_cookie(request) else ""
    return f"{prefix}everplain_oauth_{provider}"


def _cookie_path(provider: str, request: Request) -> str:
    # __Host- requires Path=/ and no Domain; browsers reject sibling-domain tossing.
    return "/" if _secure_oauth_cookie(request) else f"/api/session/oauth/{provider}"


def _require_origin(request: Request) -> None:
    origin = _application(request).origin
    if not origin or request.headers.get("origin") != origin:
        raise HTTPException(status_code=403, detail="OAuth requests must originate from this site")


@router.get("/providers", operation_id="get_oauth_providers", response_model=OAuthProvidersResponse)
def providers(request: Request, response: Response) -> OAuthProvidersResponse:
    response.headers.update(_PRIVATE_HEADERS)
    return OAuthProvidersResponse(providers=_application(request).providers)


@router.get(
    "/linked", operation_id="get_linked_oauth_providers", response_model=OAuthProvidersResponse
)
def linked_providers(request: Request, response: Response) -> OAuthProvidersResponse:
    providers = _application(request).linked_providers(_credential(request))
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
    application = _application(request)
    if provider not in application.providers:
        raise HTTPException(status_code=404, detail="OAuth provider unavailable")
    try:
        started = await application.start(
            provider=provider,
            return_path=payload.return_path,
            credential=_credential(request),
            link=link,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid local return path") from error
    except (OAuthProviderUnavailable, OAuthStorageUnavailable):
        raise HTTPException(status_code=503, detail="OAuth provider unavailable") from None
    response.headers.update(_PRIVATE_HEADERS)
    response.set_cookie(
        _cookie_name(provider, request),
        started.browser_credential,
        max_age=OAUTH_TTL_SECONDS,
        path=_cookie_path(provider, request),
        secure=_secure_oauth_cookie(request),
        httponly=True,
        samesite="lax",
    )
    return OAuthStartResponse(authorization_url=started.authorization_url)


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
        _cookie_name(provider, request),
        path=_cookie_path(provider, request),
        secure=_secure_oauth_cookie(request),
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/{provider}/callback", include_in_schema=False)
async def callback(provider: OAuthProvider, request: Request):
    states = request.query_params.getlist("state")
    codes = request.query_params.getlist("code")
    completed = await _application(request).complete(
        provider=provider,
        state=states[0] if len(states) == 1 else "",
        browser=request.cookies.get(_cookie_name(provider, request), ""),
        code=codes[0] if len(codes) == 1 else None,
        denied=bool(request.query_params.get("error")),
        credential=_credential(request),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    response = _redirect(provider, completed.target, request)
    if completed.grant is not None:
        _set_session_cookie(response, request, completed.grant)
    return response
