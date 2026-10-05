"""Content-free provider failure diagnostics; never alter exception handling."""

import json
import logging
from uuid import UUID

import httpx
import openai
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError

from .routing import ModelRouteContext, ModelRouteScope, current_model_route_scope

logger = logging.getLogger(__name__)

# Exact class identities and fixed labels: custom subclasses/names are untrusted.
_EXCEPTION_LABELS = (
    (ModelHTTPError, "ModelHTTPError"),
    (ModelAPIError, "ModelAPIError"),
    (openai.APITimeoutError, "APITimeoutError"),
    (openai.APIConnectionError, "APIConnectionError"),
    (openai.APIStatusError, "APIStatusError"),
    (openai.BadRequestError, "BadRequestError"),
    (openai.AuthenticationError, "AuthenticationError"),
    (openai.PermissionDeniedError, "PermissionDeniedError"),
    (openai.NotFoundError, "NotFoundError"),
    (openai.ConflictError, "ConflictError"),
    (openai.UnprocessableEntityError, "UnprocessableEntityError"),
    (openai.RateLimitError, "RateLimitError"),
    (openai.InternalServerError, "InternalServerError"),
    (httpx.ReadTimeout, "ReadTimeout"),
    (httpx.ConnectTimeout, "ConnectTimeout"),
    (httpx.WriteTimeout, "WriteTimeout"),
    (httpx.PoolTimeout, "PoolTimeout"),
    (httpx.TimeoutException, "TimeoutException"),
    (httpx.ConnectError, "ConnectError"),
    (httpx.ReadError, "ReadError"),
    (httpx.WriteError, "WriteError"),
    (httpx.CloseError, "CloseError"),
    (httpx.RemoteProtocolError, "RemoteProtocolError"),
    (httpx.LocalProtocolError, "LocalProtocolError"),
    (httpx.ProxyError, "ProxyError"),
    (httpx.UnsupportedProtocol, "UnsupportedProtocol"),
    (httpx.HTTPStatusError, "HTTPStatusError"),
    (TimeoutError, "TimeoutError"),
    (ConnectionError, "ConnectionError"),
    (ConnectionResetError, "ConnectionResetError"),
    (ConnectionAbortedError, "ConnectionAbortedError"),
    (BrokenPipeError, "BrokenPipeError"),
    (OSError, "OSError"),
)


def _label(error):
    return next((label for cls, label in _EXCEPTION_LABELS if type(error) is cls), "OtherError")


def _exception_slot(error, name):
    # Calling the built-in descriptor bypasses overridden properties and
    # __getattribute__. Never inspect message, body, URL or response objects.
    return BaseException.__dict__[name].__get__(error)


def _uuid(value):
    if type(value) is not UUID:
        return None
    number = value.int
    if type(number) is not int or not 0 <= number < 1 << 128:
        return None
    return str(UUID(int=number))


def log_model_failure(error: BaseException) -> None:
    """Emit fixed metadata only. Diagnostics must not replace the provider error."""
    try:
        chain, seen = [], set()
        current = error
        # Root plus at most four cause/context levels; cycles stop immediately.
        for _ in range(5):
            if not isinstance(current, BaseException) or id(current) in seen:
                break
            seen.add(id(current))
            chain.append(current)
            cause = _exception_slot(current, "__cause__")
            current = cause if cause is not None else _exception_slot(current, "__context__")
        status = None
        for item in chain:
            if _label(item) == "OtherError":
                continue
            value = _exception_slot(item, "__dict__").get("status_code")
            if type(value) is int and 100 <= value <= 599:
                status = value
                break
        scope = current_model_route_scope()
        context = scope.context if type(scope) is ModelRouteScope else None
        if type(context) is not ModelRouteContext:
            context = None
        payload = {
            "error_type": _label(error),
            "cause_types": [_label(item) for item in chain[1:]],
            "http_status": status,
            "route_id": _uuid(context.route_id) if context else None,
            "request_id": _uuid(context.request_id) if context else None,
            "run_id": _uuid(context.agent_run_id) if context else None,
        }
        logger.warning(
            "model_provider_failure %s", json.dumps(payload, sort_keys=True),
            exc_info=False, stack_info=False,
        )
    except Exception:
        # No fallback logging: even logging an internal failure can disclose the
        # original provider exception through chained traceback or formatting.
        pass
