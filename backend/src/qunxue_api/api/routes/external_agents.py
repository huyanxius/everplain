"""Owner-managed connection keys and a deliberately small MCP 2025-11-25 HTTP surface."""

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from qunxue_api.api.contracts.external_agents import (
    ExternalAgentConnectionCreate,
    ExternalAgentConnectionGrant,
    ExternalAgentConnectionList,
    ExternalAgentConnectionResponse,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.application.external_agents import ExternalAgentApplication
from qunxue_api.modules.external_agents import (
    ConnectionUnauthorized,
    ConnectionUnavailable,
    ConnectionValidationError,
)

router = APIRouter(tags=["external-agents"])
PROTOCOL_VERSION = "2025-11-25"
MAX_REQUEST_BYTES = 64 * 1024


def application(request: Request):
    with request.app.state.external_agents_scope() as app:
        yield app


Application = Annotated[ExternalAgentApplication, Depends(application)]


def _response(app, connection):
    return ExternalAgentConnectionResponse(
        connection_id=connection.connection_id,
        name=connection.name,
        library_ids=list(connection.library_ids),
        created_at=connection.created_at,
        expires_at=connection.expires_at,
        revoked_at=connection.revoked_at,
        status=connection.status(app.service.clock()),
    )


def _http_error(exc):
    if isinstance(exc, ConnectionUnauthorized):
        return HTTPException(401, str(exc))
    if isinstance(exc, ConnectionUnavailable):
        return HTTPException(404, str(exc))
    return HTTPException(422, str(exc))


@router.get(
    "/api/external-agents/connections",
    response_model=ExternalAgentConnectionList,
    operation_id="list_external_agent_connections",
)
def list_connections(current: CurrentSessionDependency, app: Application, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        connections = app.connections(current.user.user_id)
    except ConnectionUnauthorized as exc:
        raise _http_error(exc) from exc
    return ExternalAgentConnectionList(connections=[_response(app, value) for value in connections])


@router.post(
    "/api/external-agents/connections",
    response_model=ExternalAgentConnectionGrant,
    status_code=201,
    operation_id="create_external_agent_connection",
)
def create_connection(
    payload: ExternalAgentConnectionCreate,
    current: CurrentSessionDependency,
    app: Application,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    try:
        grant = app.create(current.user.user_id, **payload.model_dump())
    except (ConnectionUnauthorized, ConnectionUnavailable, ConnectionValidationError) as exc:
        raise _http_error(exc) from exc
    return ExternalAgentConnectionGrant(
        connection=_response(app, grant.connection), secret=grant.secret
    )


@router.delete(
    "/api/external-agents/connections/{connection_id}",
    response_model=ExternalAgentConnectionResponse,
    operation_id="revoke_external_agent_connection",
)
def revoke_connection(
    connection_id: UUID,
    current: CurrentSessionDependency,
    app: Application,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return _response(app, app.revoke(current.user.user_id, connection_id))
    except (ConnectionUnauthorized, ConnectionUnavailable) as exc:
        raise _http_error(exc) from exc


class EmptyArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListDocumentsArguments(EmptyArguments):
    library_id: UUID
    offset: int = Field(default=0, ge=0, strict=True)
    limit: int = Field(default=50, ge=1, le=100, strict=True)


class SearchDocumentsArguments(EmptyArguments):
    query: str = Field(min_length=1, max_length=200)
    library_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=50, strict=True)


class ReadDocumentArguments(EmptyArguments):
    library_id: UUID
    document_id: UUID
    offset: int = Field(default=0, ge=0, strict=True)
    limit: int = Field(default=12000, ge=1, le=20000, strict=True)


TOOLS = {
    "list_libraries": (EmptyArguments, "列出此连接明确授权且仍由账号所有者拥有的知识库。"),
    "list_documents": (ListDocumentsArguments, "列出授权知识库中已解析的资料；支持分页。"),
    "search_documents": (
        SearchDocumentsArguments,
        "在授权资料原文中进行本地文字搜索，无外部模型请求。",
    ),
    "read_document": (ReadDocumentArguments, "分页读取指定授权资料的已解析原文与来源定位。"),
}


def _rpc_error(request_id, code, message, status=200):
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def _rpc_result(request_id, result):
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "result": result},
        headers={"Cache-Control": "no-store"},
    )


def _mcp_access(request, app):
    # Do not trust Host or forwarded headers to turn arbitrary Origins into an allowlist.
    origin = request.headers.get("origin")
    allowed = getattr(request.app.state.settings, "cors_allowed_origins", ())
    if origin is not None and origin not in allowed:
        raise HTTPException(403, "Origin is not allowed")
    authorization = request.headers.get("authorization", "")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            401,
            "A connection bearer key is required",
            headers={
                "WWW-Authenticate": 'Bearer realm="everplain-mcp"',
                "Cache-Control": "no-store",
            },
        )
    secret = parts[1]
    try:
        app.authenticate(secret)
    except ConnectionUnauthorized as exc:
        raise HTTPException(
            401,
            str(exc),
            headers={
                "WWW-Authenticate": 'Bearer realm="everplain-mcp"',
                "Cache-Control": "no-store",
            },
        ) from exc
    version = request.headers.get("mcp-protocol-version")
    if version is not None and version != PROTOCOL_VERSION:
        raise HTTPException(400, "Unsupported MCP protocol version")
    return secret


@router.get("/api/mcp", include_in_schema=False)
def mcp_no_stream(request: Request, app: Application):
    _mcp_access(request, app)
    return Response(status_code=405, headers={"Allow": "POST", "Cache-Control": "no-store"})


@router.post("/api/mcp", operation_id="external_agent_mcp", response_model=None)
async def mcp(request: Request, app: Application):
    secret = _mcp_access(request, app)
    if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
        return _rpc_error(None, -32600, "Content-Type must be application/json", 415)
    accept = request.headers.get("accept", "")
    accepted = {part.split(";", 1)[0].strip() for part in accept.split(",")}
    if not {"application/json", "text/event-stream"} <= accepted:
        return _rpc_error(
            None, -32600, "Accept must include application/json and text/event-stream", 406
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_REQUEST_BYTES:
            return _rpc_error(None, -32600, "Request is too large", 413)
    try:
        message = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return _rpc_error(None, -32700, "Parse error", 400)
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _rpc_error(None, -32600, "Invalid request", 400)
    request_id = message.get("id")
    if "id" in message and (type(request_id) not in (str, int)):
        return _rpc_error(None, -32600, "Invalid request id", 400)
    method = message.get("method")
    if not isinstance(method, str):
        return _rpc_error(request_id, -32600, "Invalid request", 400)
    params = message.get("params", {})
    if not isinstance(params, dict):
        return _rpc_error(request_id, -32602, "Invalid params", 400)
    if "id" not in message:
        if method in {"notifications/initialized", "notifications/cancelled"}:
            return Response(status_code=202, headers={"Cache-Control": "no-store"})
        return Response(status_code=400, headers={"Cache-Control": "no-store"})
    if method == "initialize":
        client_info = params.get("clientInfo")
        if (
            not isinstance(params.get("protocolVersion"), str)
            or not isinstance(params.get("capabilities"), dict)
            or not isinstance(client_info, dict)
            or not isinstance(client_info.get("name"), str)
            or not isinstance(client_info.get("version"), str)
        ):
            return _rpc_error(request_id, -32602, "Invalid initialize params")
        return _rpc_result(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "everplain-readonly", "version": "1.0.0"},
                "instructions": "Read-only access to explicitly selected personal libraries.",
            },
        )
    if method == "ping":
        return _rpc_result(request_id, {})
    if method == "tools/list":
        if params.get("cursor") is not None:
            return _rpc_error(request_id, -32602, "No cursor is supported for this tool list")
        return _rpc_result(
            request_id,
            {
                "tools": [
                    {
                        "name": name,
                        "description": description,
                        "inputSchema": schema.model_json_schema(),
                        "annotations": {
                            "readOnlyHint": True,
                            "destructiveHint": False,
                            "idempotentHint": True,
                            "openWorldHint": False,
                        },
                    }
                    for name, (schema, description) in TOOLS.items()
                ]
            },
        )
    if method != "tools/call":
        return _rpc_error(request_id, -32601, "Method not found")
    name = params.get("name")
    if not isinstance(name, str) or name not in TOOLS:
        return _rpc_error(request_id, -32602, "Unknown tool")
    try:
        arguments = TOOLS[name][0].model_validate(params.get("arguments", {})).model_dump()
    except ValidationError:
        return _rpc_error(request_id, -32602, "Invalid tool arguments")
    try:
        result = getattr(app, name)(secret, **arguments)
    except ConnectionUnauthorized as exc:
        raise _http_error(exc) from exc
    except (ConnectionUnavailable, ConnectionValidationError) as exc:
        return _rpc_result(
            request_id,
            {
                "content": [{"type": "text", "text": str(exc)}],
                "isError": True,
            },
        )
    return _rpc_result(
        request_id,
        {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
            "structuredContent": result,
            "isError": False,
        },
    )
