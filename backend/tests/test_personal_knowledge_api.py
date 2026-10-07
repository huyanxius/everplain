"""Libraries remain private by default and enforce storage and source boundaries."""

from uuid import uuid4

import pytest
from test_research_material_api import _authenticate
from test_shared_knowledge_api import create_library, mutation, upload


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/agent/turns", "POST"),
        (
            "/api/shared-knowledge-bases/00000000-0000-0000-0000-000000000001"
            "/documents/00000000-0000-0000-0000-000000000002/knowledge",
            "PUT",
        ),
    ],
)
def test_configured_frontend_origin_can_preflight_mutations(
    plain_client,
    path: str,
    method: str,
) -> None:
    origin = plain_client.app.state.settings.cors_allowed_origins[0]
    response = plain_client.options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "origin" in response.headers["vary"].lower()
    assert method in response.headers["access-control-allow-methods"].split(", ")
    assert {"content-type", "idempotency-key"} <= {
        header.strip().lower()
        for header in response.headers["access-control-allow-headers"].split(",")
    }


@pytest.mark.parametrize(
    "origin",
    ["http://localhost.evil.example.test:5196", "https://unconfigured.example.test"],
)
def test_unconfigured_origin_cannot_preflight_knowledge_put(
    plain_client,
    origin: str,
) -> None:
    response = plain_client.options(
        "/api/shared-knowledge-bases/00000000-0000-0000-0000-000000000001"
        "/documents/00000000-0000-0000-0000-000000000002/knowledge",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
    assert "origin" in response.headers["vary"].lower()


def test_private_library_ignores_membership_without_explicit_sharing(plain_client):
    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"])
    path = f"/api/shared-knowledge-bases/{kb['id']}"
    assert not kb.get("share_token")
    assert kb["sharing_enabled"] is False
    client.cookies.clear()
    reader = _authenticate(client)
    from qunxue_api.adapters.sqlite.shared_knowledge import (
        SharedKnowledgeBaseRow,
        SharedKnowledgeSubscriptionRow,
    )

    with client.app.state.shared_knowledge_scope() as application:
        row = application.repository.session.get(SharedKnowledgeBaseRow, kb["id"])
        row.sharing_enabled = False
        application.repository.session.add(
            SharedKnowledgeSubscriptionRow(
                user_id=reader["user"]["user_id"], knowledge_base_id=kb["id"]
            )
        )
        application.repository.commit()
    assert client.get(path).status_code == 404
    assert client.get(f"{path}/documents/{doc['id']}/source").status_code == 404
    assert (
        mutation(
            client,
            "post",
            "/api/shared-knowledge-base-subscriptions",
            json={"share_token": "x" * 32},
        ).status_code
        == 404
    )
    assert client.get("/api/shared-knowledge-bases").json()["items"] == []
    assert mutation(client, "patch", path, json={"name": "changed"}).status_code == 404


def test_library_storage_usage_and_delete_release_quota(plain_client):
    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Everplain personal notes")
    quota = client.get("/api/knowledge-storage")
    assert quota.status_code == 200
    assert quota.json()["used_bytes"] == len(b"Everplain personal notes")
    assert quota.json()["library_count"] == 1
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    assert client.get("/api/knowledge-storage").json()["used_bytes"] == 0
    from qunxue_api.adapters.sqlite.shared_knowledge import SharedDocumentRow

    with client.app.state.shared_knowledge_scope() as application:
        row = application.repository.session.get(SharedDocumentRow, doc["id"])
        assert row.content == b""
        assert row.segments == []
        assert row.knowledge is None
        assert row.vectors == {}
        assert application.repository.owned_document(row.owner_user_id, row.id) is None
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}")
    assert client.get("/api/knowledge-storage").json()["library_count"] == 0


def test_personal_library_limit_and_rename(plain_client):
    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    assert (
        mutation(
            client, "patch", f"/api/shared-knowledge-bases/{kb['id']}", json={"name": "My research"}
        ).json()["name"]
        == "My research"
    )
    for _ in range(9):
        create_library(client)
    assert (
        mutation(
            client, "post", "/api/shared-knowledge-bases", json={"name": "Overflow"}
        ).status_code
        == 422
    )


def test_upload_refuses_file_and_text_budgets(plain_client):
    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    path = f"/api/shared-knowledge-bases/{kb['id']}/documents"
    response = mutation(
        client,
        "post",
        path,
        files={"file": ("large.txt", b"x" * (20 * 1024 * 1024 + 1), "text/plain")},
    )
    assert response.status_code == 413
    response = mutation(
        client, "post", path, files={"file": ("long.txt", b"x" * 120001, "text/plain")}
    )
    assert response.status_code == 422
    assert client.get("/api/knowledge-storage").json()["used_bytes"] == 0


def test_knowledge_edits_validate_source_and_relations(plain_client):
    from qunxue_api.adapters.sqlite.shared_knowledge import (
        SharedDocumentRow,
        SharedKnowledgeBaseRow,
        SharedKnowledgeSubscriptionRow,
    )

    client = plain_client
    _authenticate(client)
    owner_cookies = dict(client.cookies)
    kb = create_library(client)
    doc = upload(client, kb["id"], "A durable knowledge base stores sources.")
    path = f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}"
    source = client.get(f"{path}/source").json()["segments"][0]["segment_id"]
    payload = {
        "summary": "Personal notes",
        "topics": [{"title": "Sources", "summary": "Keep the evidence.", "segment_ids": [source]}],
        "relations": [],
    }
    # Wait-free editing is allowed only after generation has settled.
    assert mutation(client, "put", f"{path}/knowledge", json=payload).status_code == 422
    with client.app.state.shared_knowledge_scope() as application:
        row = application.repository.session.get(SharedDocumentRow, doc["id"])
        row.knowledge_status = "failed"
        application.repository.commit()
    bad = {
        **payload,
        "topics": [{**payload["topics"][0], "segment_ids": ["foreign-document-segment"]}],
    }
    assert mutation(client, "put", f"{path}/knowledge", json=bad).status_code == 422
    assert (
        mutation(
            client,
            "put",
            f"{path}/knowledge",
            json={
                **payload,
                "relations": [
                    {
                        "source": "Sources",
                        "target": "Missing",
                        "label": "relates",
                        "segment_ids": [source],
                    }
                ],
            },
        ).status_code
        == 422
    )
    # A direct HTTP mutation is separate from browser preflight authorization.
    origin = client.app.state.settings.cors_allowed_origins[0]

    def edit(value):
        return client.put(
            f"{path}/knowledge",
            json=value,
            headers={"Origin": origin, "Idempotency-Key": str(uuid4())},
        )

    saved = edit(payload)
    assert saved.status_code == 200, saved.text
    assert saved.headers["access-control-allow-origin"] == origin
    assert saved.headers["access-control-allow-credentials"] == "true"
    assert "origin" in saved.headers["vary"].lower()
    assert saved.json()["knowledge"] == payload
    assert saved.json()["knowledge_status"] == "ready"
    assert client.get(f"{path}/source").json()["document"]["knowledge"] == payload

    denied_payload = {**payload, "summary": "Unauthorized change"}
    client.cookies.clear()
    assert edit(denied_payload).status_code == 401
    reader = _authenticate(client)
    assert edit(denied_payload).status_code == 404
    # Seed an existing legacy reader only in the synthetic database.
    with client.app.state.shared_knowledge_scope() as application:
        row = application.repository.session.get(SharedKnowledgeBaseRow, kb["id"])
        row.sharing_enabled = True
        application.repository.session.add(
            SharedKnowledgeSubscriptionRow(
                user_id=reader["user"]["user_id"], knowledge_base_id=kb["id"]
            )
        )
        application.repository.commit()
    assert client.get(f"{path}/source").status_code == 200
    assert edit(denied_payload).status_code == 403
    client.cookies.clear()
    client.cookies.update(owner_cookies)
    assert client.get(f"{path}/source").json()["document"]["knowledge"] == payload


def test_storage_budget_is_atomic_for_concurrent_uploads(plain_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from uuid import UUID

    from qunxue_api.modules.shared_knowledge import SharedKnowledgeValidationError

    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    barrier = Barrier(2)

    def send(_):
        with client.app.state.shared_knowledge_scope() as application:
            library = application.repository.get(UUID(kb["id"]))
            parser = application._parser

            def parse(**kwargs):
                result = parser(**kwargs)
                barrier.wait(timeout=10)
                return result

            application._parser = parse
            application.max_storage_bytes = 7
            try:
                application.upload(
                    library.owner_user_id,
                    library.id,
                    filename="notes.txt",
                    media_type="text/plain",
                    content=b"123456",
                    request_key=str(uuid4()),
                )
                return "saved"
            except SharedKnowledgeValidationError:
                return "quota"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(send, range(2))) == ["quota", "saved"]
    assert client.get("/api/knowledge-storage").json()["used_bytes"] == 6
