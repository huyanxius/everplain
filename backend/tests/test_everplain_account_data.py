"""Private source bytes must be portable and removable with the account."""

import base64
from uuid import uuid4

from test_account_management_api import client, register  # noqa: F401
from test_shared_knowledge_api import create_library, upload


def test_export_includes_original_library_files_and_delete_removes_them(client):  # noqa: F811
    register(client, "portable@example.com")
    kb = create_library(client)
    document = upload(client, kb["id"], "personal source text")
    headers = {"Idempotency-Key": str(uuid4())}
    created = client.post("/api/account/data-exports", headers=headers, json={"format": "json"})
    assert created.status_code == 201, created.text
    response = client.get(created.json()["download_href"])
    assert response.status_code == 200
    rows = response.json()["records"]["shared_documents"]
    exported = next(row for row in rows if row["id"] == document["id"])
    assert base64.b64decode(exported["content"]["base64"]) == b"personal source text"
    deleted = client.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "portable@example.com",
        },
    )
    assert deleted.status_code == 200, deleted.text
    assert client.get("/api/session").status_code == 401
    register(client, "different@example.com")
    assert client.get("/api/shared-knowledge-bases").json()["items"] == []
