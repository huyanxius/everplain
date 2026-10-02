"""Offline protocol and authorization tests; no model, provider, or live MCP client calls."""

import hashlib
import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text, update

from qunxue_api.adapters.sqlite.base import Base
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.external_agents import (
    ExternalAgentConnectionRow,
    SqliteExternalAgentRepository,
)
from qunxue_api.adapters.sqlite.identity_model import UserRow
from qunxue_api.adapters.sqlite.identity_repository import SqliteIdentityRepository
from qunxue_api.adapters.sqlite.shared_knowledge import (
    SharedDocumentRow,
    SharedKnowledgeBaseRow,
    SharedKnowledgeDocumentRow,
    SqliteSharedKnowledgeRepository,
)
from qunxue_api.api.dependencies import get_current_session
from qunxue_api.api.routes.external_agents import router
from qunxue_api.application.external_agents import ExternalAgentApplication
from qunxue_api.modules.external_agents import ExternalAgentService
from qunxue_api.modules.shared_knowledge import SharedKnowledgeService

NOW = datetime(2026, 10, 2, tzinfo=UTC)
PATH = "/api/external-agents/connections"


@pytest.fixture
def external(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'external.db'}")
    Base.metadata.create_all(
        db.engine,
        tables=[
            UserRow.__table__,
            SharedKnowledgeBaseRow.__table__,
            SharedDocumentRow.__table__,
            SharedKnowledgeDocumentRow.__table__,
            ExternalAgentConnectionRow.__table__,
        ],
    )
    alice, bob, owned, unselected, foreign, document, private_doc, foreign_doc = (
        uuid4() for _ in range(8)
    )
    with db.session() as session:
        for owner in (alice, bob):
            session.add(
                UserRow(
                    user_id=str(owner),
                    email=f"{owner}@example.test",
                    password_hash="unused-test-only",
                    display_name=None,
                    role="member",
                    status="active",
                    version=1,
                    created_at=NOW,
                    updated_at=NOW,
                )
            )
        session.flush()
        for library_id, owner in ((owned, alice), (unselected, alice), (foreign, bob)):
            session.add(
                SharedKnowledgeBaseRow(
                    id=str(library_id),
                    owner_user_id=str(owner),
                    request_key=str(library_id),
                    name=f"Library {library_id}",
                    description="Local test fixture",
                    share_token=str(uuid4()),
                    sharing_enabled=False,
                    created_at=NOW,
                    updated_at=NOW,
                )
            )
        session.flush()
        for doc_id, owner, library_id, content in (
            (document, alice, owned, "alpha matching content " * 1000),
            (private_doc, alice, unselected, "unselected confidential alpha"),
            (foreign_doc, bob, foreign, "foreign confidential alpha"),
        ):
            session.add(
                SharedDocumentRow(
                    id=str(doc_id),
                    owner_user_id=str(owner),
                    request_key=str(doc_id),
                    filename=f"{doc_id}.txt",
                    media_type="text/plain",
                    content_hash="a" * 64,
                    content=content.encode(),
                    size_bytes=len(content),
                    parse_id=str(uuid4()),
                    status="ready",
                    segments=[
                        {
                            "segment_id": f"segment-{doc_id}",
                            "text": content,
                            "locator": {"kind": "text", "line": 1},
                        }
                    ],
                    created_at=NOW,
                )
            )
            session.flush()
            session.add(
                SharedKnowledgeDocumentRow(
                    knowledge_base_id=str(library_id), document_id=str(doc_id)
                )
            )
    app = FastAPI()
    clock = [NOW]

    @contextmanager
    def scope():
        with db.session() as session:
            yield ExternalAgentApplication(
                ExternalAgentService(
                    SqliteExternalAgentRepository(session), clock=lambda: clock[0]
                ),
                identities=SqliteIdentityRepository(session),
                libraries=SharedKnowledgeService(SqliteSharedKnowledgeRepository(session)),
            )

    def current(request: Request):
        owner = request.headers.get("x-test-user")
        if owner not in {str(alice), str(bob)}:
            raise HTTPException(401, "Session required")
        with db.session() as session:
            return SimpleNamespace(user=SqliteIdentityRepository(session).get_user(owner))

    app.state.external_agents_scope = scope
    app.state.settings = SimpleNamespace(cors_allowed_origins=("https://everplain.example",))
    app.dependency_overrides[get_current_session] = current
    app.include_router(router)
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client,
            database=db,
            alice=alice,
            bob=bob,
            owned=owned,
            unselected=unselected,
            foreign=foreign,
            document=document,
            private_doc=private_doc,
            foreign_doc=foreign_doc,
            clock=clock,
            scope=scope,
        )
    db.engine.dispose()


def create(external, **changes):
    return external.client.post(
        PATH,
        headers={"x-test-user": str(external.alice)},
        json={
            "name": "My local agent",
            "library_ids": [str(external.owned)],
            "expires_at": (NOW + timedelta(days=30)).isoformat(),
            **changes,
        },
    )


def headers(secret):
    return {
        "Authorization": f"Bearer {secret}",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
    }


def rpc(external, secret, method, params=None, request_id=1, **options):
    return external.client.post(
        "/api/mcp",
        headers=headers(secret),
        json={
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params or {},
        },
        **options,
    )


def call(external, secret, name, **arguments):
    return rpc(external, secret, "tools/call", {"name": name, "arguments": arguments})


def test_secret_returned_once_only_hash_is_persisted(external):
    assert external.client.get(PATH).status_code == 401
    with external.database.session() as session:
        assert session.scalar(select(ExternalAgentConnectionRow)) is None
    result = create(external)
    assert result.status_code == 201, result.text
    assert result.headers["cache-control"] == "no-store"
    grant = result.json()
    assert grant["secret"].startswith("ep_mcp_")
    assert grant["connection"]["status"] == "active"
    assert grant["mcp_endpoint"] == "/api/mcp"
    with external.database.session() as session:
        row = session.scalar(select(ExternalAgentConnectionRow))
        assert row.token_hash == hashlib.sha256(grant["secret"].encode()).hexdigest()
        dumped = repr(session.execute(text("SELECT * FROM external_agent_connections")).all())
        assert grant["secret"] not in dumped
    listed = external.client.get(PATH, headers={"x-test-user": str(external.alice)})
    assert listed.json()["connections"] == [grant["connection"]]
    assert grant["secret"] not in listed.text
    assert "token_hash" not in listed.text
    assert external.client.get(PATH, headers={"x-test-user": str(external.bob)}).json() == {
        "connections": [],
        "mcp_endpoint": "/api/mcp",
    }
    with external.scope() as app:
        assert grant["secret"] not in repr(app.authenticate(grant["secret"]))


@pytest.mark.parametrize(
    "changes",
    [
        {"library_ids": []},
        {"name": " "},
        {"expires_at": "2026-10-02T00:00:00"},
        {"expires_at": NOW.isoformat()},
        {"expires_at": (NOW + timedelta(days=366)).isoformat()},
        {"unexpected": "not allowed"},
    ],
)
def test_explicit_bounded_scope_and_expiry_required(external, changes):
    assert create(external, **changes).status_code == 422


def test_foreign_and_nonexistent_libraries_cannot_create_keys(external):
    for library_id in (external.foreign, uuid4()):
        assert create(external, library_ids=[str(library_id)]).status_code == 404
    with external.database.session() as session:
        assert session.scalar(select(ExternalAgentConnectionRow)) is None


def test_initialize_list_and_read_only_tool_contract(external):
    secret = create(external).json()["secret"]
    response = rpc(
        external,
        secret,
        "initialize",
        {
            "protocolVersion": "2099-01-01",
            "capabilities": {},
            "clientInfo": {"name": "offline-test", "version": "1"},
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["protocolVersion"] == "2025-11-25"
    assert response.json()["result"]["capabilities"] == {"tools": {"listChanged": False}}
    initialized = external.client.post(
        "/api/mcp",
        headers=headers(secret),
        json={
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        },
    )
    assert initialized.status_code == 202 and initialized.content == b""
    tools = rpc(external, secret, "tools/list").json()["result"]["tools"]
    assert {tool["name"] for tool in tools} == {
        "list_libraries",
        "list_documents",
        "search_documents",
        "read_document",
    }
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
    assert all(tool["inputSchema"]["additionalProperties"] is False for tool in tools)
    assert rpc(external, secret, "ping").json()["result"] == {}
    assert external.client.get("/api/mcp", headers=headers(secret)).status_code == 405
    assert call(external, secret, "delete_document").json()["error"]["code"] == -32602
    assert rpc(external, secret, "resources/list").json()["error"]["code"] == -32601


def test_scope_excludes_other_own_and_foreign_documents(external):
    secret = create(external).json()["secret"]
    libraries = call(external, secret, "list_libraries").json()["result"]["structuredContent"]
    assert [kb["library_id"] for kb in libraries["libraries"]] == [str(external.owned)]
    docs = call(external, secret, "list_documents", library_id=str(external.owned)).json()
    assert [doc["document_id"] for doc in docs["result"]["structuredContent"]["documents"]] == [
        str(external.document)
    ]
    search = call(external, secret, "search_documents", query="alpha")
    assert str(external.private_doc) not in search.text
    assert str(external.foreign_doc) not in search.text
    assert search.json()["result"]["structuredContent"]["matches"][0]["locator"] == {
        "kind": "text",
        "line": 1,
    }
    for library_id, document_id in (
        (external.unselected, external.private_doc),
        (external.foreign, external.foreign_doc),
        (external.owned, external.private_doc),
        (external.owned, external.foreign_doc),
    ):
        result = call(
            external,
            secret,
            "read_document",
            library_id=str(library_id),
            document_id=str(document_id),
        ).json()["result"]
        assert result["isError"] is True
        assert "confidential" not in json.dumps(result)
    bad_scope = call(
        external, secret, "search_documents", query="alpha", library_id=str(external.unselected)
    )
    assert bad_scope.json()["result"]["isError"] is True


def test_read_pagination_retains_source_and_never_truncates_silently(external):
    secret = create(external).json()["secret"]
    first = call(
        external,
        secret,
        "read_document",
        library_id=str(external.owned),
        document_id=str(external.document),
        limit=20000,
    ).json()["result"]["structuredContent"]
    assert len(first["text"]) == 20000
    assert first["next_offset"] == 20000
    assert first["sources"][0]["start"] == 0
    second = call(
        external,
        secret,
        "read_document",
        library_id=str(external.owned),
        document_id=str(external.document),
        offset=first["next_offset"],
    ).json()["result"]
    assert second["structuredContent"]["next_offset"] is None
    assert first["text"] + second["structuredContent"]["text"] == "alpha matching content " * 1000


def test_detach_removes_access_even_when_document_bytes_remain(external):
    secret = create(external).json()["secret"]
    with external.database.session() as session:
        session.execute(
            delete(SharedKnowledgeDocumentRow).where(
                SharedKnowledgeDocumentRow.document_id == str(external.document)
            )
        )
    result = call(
        external,
        secret,
        "read_document",
        library_id=str(external.owned),
        document_id=str(external.document),
    ).json()["result"]
    assert result["isError"] is True
    assert call(external, secret, "search_documents", query="alpha").json()["result"][
        "structuredContent"
    ] == {"matches": []}


@pytest.mark.parametrize("change", ["deleted", "transferred"])
def test_library_current_owner_and_deletion_checked_each_call(external, change):
    secret = create(external).json()["secret"]
    with external.database.session() as session:
        row = session.get(SharedKnowledgeBaseRow, str(external.owned))
        if change == "deleted":
            row.deleted_at = NOW
        else:
            row.owner_user_id = str(external.bob)
    assert call(external, secret, "list_libraries").json()["result"]["structuredContent"] == {
        "libraries": []
    }
    result = call(
        external,
        secret,
        "read_document",
        library_id=str(external.owned),
        document_id=str(external.document),
    ).json()["result"]
    assert result["isError"] is True


def test_foreign_document_link_does_not_grant_access(external):
    secret = create(external).json()["secret"]
    with external.database.session() as session:
        session.add(
            SharedKnowledgeDocumentRow(
                knowledge_base_id=str(external.owned), document_id=str(external.foreign_doc)
            )
        )
    assert (
        str(external.foreign_doc)
        not in call(external, secret, "list_documents", library_id=str(external.owned)).text
    )
    assert (
        "foreign confidential" not in call(external, secret, "search_documents", query="alpha").text
    )
    result = call(
        external,
        secret,
        "read_document",
        library_id=str(external.owned),
        document_id=str(external.foreign_doc),
    ).json()["result"]
    assert result["isError"] is True


@pytest.mark.parametrize("status", ["disabled", "deactivated"])
def test_account_status_rechecked_on_every_mcp_call(external, status):
    grant = create(external).json()
    with external.database.session() as session:
        session.execute(
            update(UserRow).where(UserRow.user_id == str(external.alice)).values(status=status)
        )
    for method in ("initialize", "tools/list", "ping"):
        assert rpc(external, grant["secret"], method).status_code == 401
    assert call(external, grant["secret"], "list_libraries").status_code == 401
    assert create(external).status_code == 401


def test_revoke_is_owner_only_idempotent_and_immediate(external):
    grant = create(external).json()
    target = f"{PATH}/{grant['connection']['connection_id']}"
    assert (
        external.client.delete(target, headers={"x-test-user": str(external.bob)}).status_code
        == 404
    )
    assert call(external, grant["secret"], "list_libraries").status_code == 200
    revoked = external.client.delete(target, headers={"x-test-user": str(external.alice)})
    assert revoked.status_code == 200 and revoked.json()["status"] == "revoked"
    assert grant["secret"] not in revoked.text
    assert external.client.delete(target, headers={"x-test-user": str(external.alice)}).json() == (
        revoked.json()
    )
    for method in ("initialize", "tools/list", "ping"):
        assert rpc(external, grant["secret"], method).status_code == 401
    assert (
        call(
            external,
            grant["secret"],
            "read_document",
            library_id=str(external.owned),
            document_id=str(external.document),
        ).status_code
        == 401
    )


def test_expiry_boundary_rejects_key_and_lists_expired(external):
    grant = create(external).json()
    external.clock[0] = NOW + timedelta(days=30)
    assert rpc(external, grant["secret"], "tools/list").status_code == 401
    listed = external.client.get(PATH, headers={"x-test-user": str(external.alice)}).json()
    assert listed["connections"][0]["status"] == "expired"


def test_transport_auth_origin_and_version_validation(external):
    secret = create(external).json()["secret"]
    for authorization in (None, "Bearer wrong", "Basic ignored", "Bearer " + secret + " extra"):
        request_headers = headers(secret)
        if authorization is None:
            request_headers.pop("Authorization")
        else:
            request_headers["Authorization"] = authorization
        response = external.client.post("/api/mcp", headers=request_headers, json={})
        assert response.status_code == 401
    rejected = external.client.post(
        "/api/mcp",
        headers={
            **headers(secret),
            "Origin": "https://attacker.example",
            "Host": "attacker.example",
        },
        json={},
    )
    assert rejected.status_code == 403
    allowed = external.client.post(
        "/api/mcp",
        headers={
            **headers(secret),
            "Origin": "https://everplain.example",
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert allowed.status_code == 200
    assert (
        external.client.post(
            "/api/mcp",
            headers={
                **headers(secret),
                "MCP-Protocol-Version": "unsupported",
            },
            json={},
        ).status_code
        == 400
    )
    assert (
        external.client.post(
            "/api/mcp",
            headers={
                **headers(secret),
                "Accept": "application/json",
            },
            json={},
        ).status_code
        == 406
    )
    assert (
        external.client.post("/api/mcp", headers=headers(secret), content="{}").status_code == 415
    )
    oversized = external.client.post(
        "/api/mcp",
        headers={
            **headers(secret),
            "Content-Type": "application/json",
        },
        content=" " * (64 * 1024 + 1),
    )
    assert oversized.status_code == 413
    # A logged-in owner session cannot replace an explicitly created bearer key.
    assert (
        external.client.post(
            "/api/mcp", headers={"x-test-user": str(external.alice)}, json={}
        ).status_code
        == 401
    )


@pytest.mark.parametrize(
    "message,code",
    [
        ([], -32600),
        ({"jsonrpc": "1.0", "id": 1, "method": "ping"}, -32600),
        ({"jsonrpc": "2.0", "id": True, "method": "ping"}, -32600),
        ({"jsonrpc": "2.0", "id": None, "method": "ping"}, -32600),
        ({"jsonrpc": "2.0", "id": 1, "method": {}}, -32600),
        ({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": []}, -32602),
    ],
)
def test_jsonrpc_invalid_messages(external, message, code):
    secret = create(external).json()["secret"]
    result = external.client.post("/api/mcp", headers=headers(secret), json=message)
    assert result.json()["error"]["code"] == code


def test_jsonrpc_bad_json_params_and_notifications(external):
    secret = create(external).json()["secret"]
    bad_json = external.client.post(
        "/api/mcp",
        headers={
            **headers(secret),
            "Content-Type": "application/json",
        },
        content="{",
    )
    assert bad_json.json()["error"]["code"] == -32700
    assert rpc(external, secret, "initialize").json()["error"]["code"] == -32602
    for arguments in (
        {},
        {"library_id": "not-a-uuid"},
        {
            "library_id": str(external.owned),
            "limit": True,
        },
        {"library_id": str(external.owned), "limit": 101},
        {
            "library_id": str(external.owned),
            "owner_user_id": str(external.bob),
        },
    ):
        assert (
            call(external, secret, "list_documents", **arguments).json()["error"]["code"] == -32602
        )
    assert (
        call(external, secret, "search_documents", query="  ").json()["result"]["isError"] is True
    )
    result = external.client.post(
        "/api/mcp",
        headers=headers(secret),
        json={
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": "list_libraries"},
        },
    )
    assert result.status_code == 400 and result.content == b""


def test_connection_credentials_are_cascaded_when_owner_is_removed(external):
    grant = create(external).json()
    with external.database.session() as session:
        session.execute(
            delete(SharedKnowledgeDocumentRow).where(
                SharedKnowledgeDocumentRow.knowledge_base_id.in_(
                    [str(external.owned), str(external.unselected)]
                )
            )
        )
        session.execute(
            delete(SharedDocumentRow).where(SharedDocumentRow.owner_user_id == str(external.alice))
        )
        session.execute(
            delete(SharedKnowledgeBaseRow).where(
                SharedKnowledgeBaseRow.owner_user_id == str(external.alice)
            )
        )
        session.execute(delete(UserRow).where(UserRow.user_id == str(external.alice)))
    with external.database.session() as session:
        assert session.scalar(select(ExternalAgentConnectionRow)) is None
    assert rpc(external, grant["secret"], "tools/list").status_code == 401


def test_key_scope_is_immutable_and_new_libraries_are_not_implicitly_added(external):
    grant = create(external, library_ids=[str(external.owned), str(external.owned)]).json()
    assert grant["connection"]["library_ids"] == [str(external.owned)]
    target = f"{PATH}/{grant['connection']['connection_id']}"
    assert (
        external.client.patch(
            target,
            headers={"x-test-user": str(external.alice)},
            json={"library_ids": [str(external.owned), str(external.unselected)]},
        ).status_code
        == 405
    )
    result = call(external, grant["secret"], "list_documents", library_id=str(external.unselected))
    assert result.json()["result"]["isError"] is True


def test_saved_hash_is_not_a_usable_credential(external):
    grant = create(external).json()
    digest = hashlib.sha256(grant["secret"].encode()).hexdigest()
    assert rpc(external, digest, "tools/list").status_code == 401
    different = create(external).json()
    assert different["secret"] != grant["secret"]
    assert different["connection"]["connection_id"] != grant["connection"]["connection_id"]
