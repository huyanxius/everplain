"""Explicit invitations and public snapshots never change default private ownership."""

from uuid import UUID

from test_research_material_api import _authenticate
from test_shared_knowledge_api import create_library, mutation, upload


def switch(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


def enable(client, kb):
    return mutation(
        client, "patch", f"/api/shared-knowledge-bases/{kb['id']}", json={"sharing_enabled": True}
    ).json()


def join(client, token):
    return mutation(
        client, "post", "/api/shared-knowledge-base-subscriptions", json={"share_token": token}
    )


def publish(client, kb, **changes):
    return mutation(
        client,
        "put",
        f"/api/shared-knowledge-bases/{kb['id']}/publication",
        json={
            "title": "Published topic",
            "description": "Safe public summary",
            "topics": ["research"],
            "confirm_public_content": True,
            **changes,
        },
    )


def test_invite_read_only_leave_revoke_and_fresh_reenable(plain_client):
    client = plain_client
    _authenticate(client)
    owner = dict(client.cookies)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Private source")
    path = f"/api/shared-knowledge-bases/{kb['id']}"
    source = f"{path}/documents/{doc['id']}/source"
    assert "share_token" not in kb
    assert client.get("/api/public-knowledge-directory").json() == {"items": []}
    shared = enable(client, kb)
    token = shared["share_token"]
    client.cookies.clear()
    _authenticate(client)
    reader = dict(client.cookies)
    assert client.get(source).status_code == 404
    assert join(client, token).json()["added"] is True
    assert join(client, token).json()["added"] is False
    projection = client.get(path).json()
    assert projection["viewer_access"] == "reader"
    assert "share_token" not in projection
    assert client.get(source).status_code == 200
    assert mutation(client, "patch", path, json={"name": "hijack"}).status_code == 403
    assert mutation(client, "delete", path).status_code == 404
    assert publish(client, kb).status_code == 403
    assert client.get("/api/knowledge-storage").json()["library_count"] == 0
    mutation(client, "delete", f"/api/shared-knowledge-base-subscriptions/{kb['id']}")
    assert client.get(source).status_code == 404
    join(client, token)
    switch(client, owner)
    mutation(client, "patch", path, json={"sharing_enabled": False})
    switch(client, reader)
    assert client.get(source).status_code == 404
    assert join(client, token).status_code == 404
    assert client.get("/api/shared-knowledge-bases").json()["items"] == []
    switch(client, owner)
    renewed = enable(client, kb)
    assert renewed["share_token"] != token
    switch(client, reader)
    assert client.get(source).status_code == 404
    assert join(client, token).status_code == 404
    assert join(client, renewed["share_token"]).status_code == 200
    assert client.get(source).status_code == 200


def test_public_snapshot_requires_confirmation_and_never_includes_new_uploads(plain_client):
    client = plain_client
    _authenticate(client)
    owner = dict(client.cookies)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Explicitly public text")
    public = f"/api/public-knowledge-directory/{kb['id']}"
    source = f"{public}/documents/{doc['id']}/source"
    assert publish(client, kb, confirm_public_content=False).status_code == 422
    assert client.get(source).status_code == 404
    published = publish(client, kb)
    assert published.status_code == 200, published.text
    assert published.headers["Cache-Control"] == "no-store"
    assert published.json()["document_count"] == 1
    later = upload(client, kb["id"], "New private secret", filename="private.txt")
    client.cookies.clear()
    directory = client.get("/api/public-knowledge-directory").json()
    assert len(directory["items"]) == 1
    assert directory["items"][0]["title"] == "Published topic"
    assert "Product research" not in str(directory)
    assert "share_token" not in str(directory)
    assert "document_ids" not in str(directory)
    detail = client.get(public).json()
    assert [item["id"] for item in detail["documents"]] == [doc["id"]]
    assert client.get(source).json()["knowledge_base_name"] == "Published topic"
    assert client.get(f"{public}/documents/{later['id']}/source").status_code == 404
    assert client.get(f"/api/shared-knowledge-bases/{kb['id']}").status_code == 401
    switch(client, owner)
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/publication")
    client.cookies.clear()
    assert client.get(source).status_code == 404
    assert client.get(public).status_code == 404
    assert client.get("/api/public-knowledge-directory").json() == {"items": []}


def test_public_snapshots_recheck_document_membership_and_owner_status(plain_client):
    from qunxue_api.adapters.sqlite.identity_model import UserRow

    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Public then removed")
    publish(client, kb)
    path = f"/api/public-knowledge-directory/{kb['id']}"
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    assert client.get(f"{path}/documents/{doc['id']}/source").status_code == 404
    assert client.get(path).json()["publication"]["document_count"] == 0
    with client.app.state.shared_knowledge_scope() as app:
        user = app.repository.session.get(UserRow, identity["user"]["user_id"])
        user.status = "disabled"
        app.repository.commit()
    client.cookies.clear()
    assert client.get(path).status_code == 404
    assert client.get("/api/public-knowledge-directory").json() == {"items": []}


def test_owner_delete_removes_publication_and_readers(plain_client):
    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    upload(client, kb["id"])
    publish(client, kb)
    assert mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}").status_code == 204
    assert client.get(f"/api/public-knowledge-directory/{kb['id']}").status_code == 404
    with client.app.state.shared_knowledge_scope() as app:
        assert app.repository.publication(UUID(kb["id"])) is None


def test_migration_does_not_activate_ignored_legacy_grants(tmp_path, monkeypatch, alembic_config):
    from datetime import UTC, datetime
    from uuid import uuid4

    from alembic import command
    from sqlalchemy import func, select

    from qunxue_api.adapters.sqlite.database import Database
    from qunxue_api.adapters.sqlite.identity_model import UserRow
    from qunxue_api.adapters.sqlite.shared_knowledge import (
        SharedKnowledgeBaseRow,
        SharedKnowledgeSubscriptionRow,
    )

    url = f"sqlite:///{tmp_path / 'legacy-sharing.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", url)
    command.upgrade(alembic_config, "20261002_0470")
    database = Database(url)
    now = datetime.now(UTC)
    owner, reader, kb = (str(uuid4()) for _ in range(3))
    with database.session() as session:
        for user_id in (owner, reader):
            session.add(
                UserRow(
                    user_id=user_id,
                    email=f"{user_id}@example.test",
                    password_hash="fixture",
                    created_at=now,
                    updated_at=now,
                )
            )
        session.flush()
        session.add(
            SharedKnowledgeBaseRow(
                id=kb,
                owner_user_id=owner,
                request_key="legacy",
                name="Private data",
                description="Keep intact",
                share_token="ignored-old-invite",
                sharing_enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
        session.flush()
        session.add(SharedKnowledgeSubscriptionRow(user_id=reader, knowledge_base_id=kb))
    command.upgrade(alembic_config, "20261002_0480")
    with database.session() as session:
        library = session.get(SharedKnowledgeBaseRow, kb)
        assert library.sharing_enabled is False
        assert library.name == "Private data"
        assert session.scalar(select(func.count()).select_from(SharedKnowledgeSubscriptionRow)) == 0
    database.engine.dispose()
