import hashlib
from uuid import UUID, uuid4

from sqlalchemy import select, update
from test_knowledge_import import drain, start
from test_research_material_api import _authenticate

from qunxue_api.adapters.sqlite.knowledge_import import ImportAttachmentRow, ImportItemRow
from qunxue_api.adapters.sqlite.shared_knowledge import (
    SharedDocumentRow,
    SharedKnowledgePublicationRow,
)


def setup(c):
    c.app.state.import_worker_enabled = False
    _authenticate(c)


def result(c, batch):
    drain(c)
    return c.get("/api/imports/" + batch["id"]).json()


def source(c, batch, document_id):
    return c.get(
        f"/api/shared-knowledge-bases/{batch['library_id']}/documents/{document_id}/source"
    ).json()


def test_changed_note_updates_same_document_and_only_its_derived_state(plain_client):
    c = plain_client
    setup(c)
    first = result(
        c,
        start(c, [("Vault/A.md", b"# A\noriginal"), ("Vault/B.md", b"# B\nuntouched")], "obsidian"),
    )
    ids = {item["filename"]: item["document_id"] for item in first["items"]}
    old_parse = {}
    with c.app.state.knowledge_import_scope() as app:
        for name, id in ids.items():
            row = app.repository.session.get(SharedDocumentRow, id)
            old_parse[name] = row.parse_id
            row.vectors = {"embedding": {"old": [1.0, 0.5]}}
            row.knowledge = {"summary": name, "topics": [], "relations": []}
            row.knowledge_checkpoints = {"completed": "old"}
            row.knowledge_status, row.index_status = "ready", "ready"
            row.job_token = "stale-lease"
        app.repository.session.commit()
    changed = result(
        c,
        start(c, [("Vault/A.md", b"# A\nchanged"), ("Vault/B.md", b"# B\nuntouched")], "obsidian"),
    )
    assert (changed["updated"], changed["duplicates"], changed["imported"]) == (1, 1, 0)
    assert {item["filename"]: item["document_id"] for item in changed["items"]} == ids
    library = c.get("/api/shared-knowledge-bases/" + first["library_id"]).json()
    assert len(library["documents"]) == 2
    with c.app.state.knowledge_import_scope() as app:
        a = app.repository.session.get(SharedDocumentRow, ids["A.md"])
        b = app.repository.session.get(SharedDocumentRow, ids["B.md"])
        assert a.content == b"# A\nchanged" and a.parse_id != old_parse["A.md"]
        assert a.vectors == {} and a.knowledge is None and a.knowledge_checkpoints == {}
        assert (a.index_status, a.knowledge_status, a.job_token) == ("queued", "queued", None)
        assert b.parse_id == old_parse["B.md"] and b.vectors and b.knowledge
        assert (b.index_status, b.knowledge_status, b.job_token) == (
            "ready",
            "ready",
            "stale-lease",
        )
        stale = app.repository.session.execute(
            update(SharedDocumentRow)
            .where(SharedDocumentRow.id == a.id, SharedDocumentRow.job_token == "stale-lease")
            .values(knowledge={"stale": True})
        )
        assert stale.rowcount == 0
    repeated = result(
        c,
        start(c, [("Vault/A.md", b"# A\nchanged"), ("Vault/B.md", b"# B\nuntouched")], "obsidian"),
    )
    assert repeated["duplicates"] == 2 and repeated["updated"] == 0


def test_failed_replacement_keeps_old_ready_content_assets_and_retries(plain_client):
    c = plain_client
    setup(c)
    first = result(
        c,
        start(
            c,
            [("Vault/A.md", b"# A\n![image](assets/a.png)"), ("Vault/assets/a.png", b"old image")],
            "obsidian",
        ),
    )
    id = first["items"][0]["document_id"]
    asset_url = first["items"][0]["attachments"][0]["url"]
    changed = start(
        c,
        [
            ("Vault/A.md", b"# A\nnew body ![image](assets/a.png)"),
            ("Vault/assets/a.png", b"new image"),
        ],
        "obsidian",
    )
    with c.app.state.knowledge_import_scope() as app:
        app.libraries.max_document_characters = 1
        assert app.run_once()
    failed = c.get("/api/imports/" + changed["id"]).json()
    assert failed["failed"] == 1 and failed["updated"] == 0
    assert c.get(asset_url).content == b"old image"
    assert "new body" not in str(source(c, first, id)["segments"])
    with c.app.state.knowledge_import_scope() as app:
        docs = list(app.repository.session.scalars(select(SharedDocumentRow)))
        assert len(docs) == 1 and docs[0].status == "ready"
    item = failed["items"][0]
    assert (
        c.post(
            f"/api/imports/{changed['id']}/items/{item['id']}/retry",
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 200
    )
    finished = result(c, changed)
    assert finished["updated"] == 1 and finished["items"][0]["document_id"] == id
    assert finished["items"][0]["attempts"] == 2
    assert c.get(asset_url).status_code == 404
    assert c.get(finished["items"][0]["attachments"][0]["url"]).content == b"new image"


def test_attachments_are_binary_safe_owner_only_preserved_in_source_and_deleted(plain_client):
    c = plain_client
    setup(c)
    binary = b"\x89PNG\r\n\x00\xff\xfe"
    markdown = "# A\n![[图.png]] [report](../assets/report.pdf) ![图](../assets/图.png) [[B]]"
    batch = result(
        c,
        start(
            c,
            [
                ("Vault/notes/A.md", markdown.encode()),
                ("Vault/notes/B.md", b"# B\nhello"),
                ("Vault/assets/图.png", binary),
                ("Vault/assets/report.pdf", b"%PDF fixture"),
                ("Vault/.obsidian/private.md", b"# private"),
                ("Vault/.git/config.md", b"# private"),
                ("Vault/node_modules/private.md", b"# private"),
                ("Vault/assets/unreferenced.png", b"unused"),
            ],
            "obsidian",
        ),
    )
    a = next(item for item in batch["items"] if item["filename"] == "A.md")
    assert batch["total"] == 2 and batch["attachment_count"] == 2
    assert batch["attachment_bytes"] == len(binary) + len(b"%PDF fixture")
    assets = {asset["filename"]: asset for asset in a["attachments"]}
    image = assets["图.png"]
    assert image["relative_path"] == "Vault/assets/图.png"
    assert set(image["references"]) == {"../assets/图.png", "图.png"}
    response = c.get(image["url"])
    assert response.content == binary and response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"].startswith("inline;")
    assert (
        c.get(assets["report.pdf"]["url"]).headers["content-disposition"].startswith("attachment;")
    )
    assert source(c, batch, a["document_id"])["attachments"] == a["attachments"]
    with c.app.state.knowledge_import_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, a["document_id"])
        assert row.content == markdown.encode()
        owner = UUID(row.owner_user_id)
        storage = app.libraries.storage(owner)
        assert storage["used_bytes"] == sum(
            len(value) for value in (markdown.encode(), b"# B\nhello", binary, b"%PDF fixture")
        )
        assert all(not row.content for row in app.repository.session.scalars(select(ImportItemRow)))
        assert len(list(app.repository.session.scalars(select(ImportAttachmentRow)))) == 2
    assert (
        c.get(
            image["url"].replace(
                a["document_id"],
                next(item["document_id"] for item in batch["items"] if item["filename"] == "B.md"),
            )
        ).status_code
        == 404
    )
    c.delete(
        f"/api/shared-knowledge-bases/{batch['library_id']}/documents/{a['document_id']}",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert c.get(image["url"]).status_code == 404
    with c.app.state.knowledge_import_scope() as app:
        assert not list(app.repository.session.scalars(select(ImportAttachmentRow)))
    _authenticate(c)
    assert c.get(assets["report.pdf"]["url"]).status_code == 404


def test_asset_only_change_keeps_parse_and_ready_derived_state(plain_client):
    c = plain_client
    setup(c)
    note = b"# A\n![[a.png]]"
    first = result(c, start(c, [("Vault/A.md", note), ("Vault/a.png", b"old")], "obsidian"))
    id = first["items"][0]["document_id"]
    old_url = first["items"][0]["attachments"][0]["url"]
    with c.app.state.knowledge_import_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, id)
        parse_id = row.parse_id
        row.knowledge_status, row.index_status = "ready", "ready"
        row.vectors, row.knowledge = (
            {"embedding": {"old": [1.0]}},
            {"summary": "ready", "topics": [], "relations": []},
        )
        app.repository.session.commit()
    changed = result(c, start(c, [("Vault/A.md", note), ("Vault/a.png", b"new")], "obsidian"))
    assert changed["updated"] == 1 and changed["items"][0]["document_id"] == id
    assert c.get(old_url).status_code == 404
    assert c.get(changed["items"][0]["attachments"][0]["url"]).content == b"new"
    with c.app.state.knowledge_import_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, id)
        assert row.parse_id == parse_id and row.vectors and row.knowledge
        assert (row.knowledge_status, row.index_status) == ("ready", "ready")


def test_unchanged_reimport_needs_no_free_capacity_and_retains_no_extra_assets(plain_client):
    c = plain_client
    setup(c)
    files = [("Vault/A.md", b"# A\n![[a.png]]"), ("Vault/a.png", b"image")]
    first = result(c, start(c, files, "obsidian"))
    with c.app.state.knowledge_import_scope() as app:
        user_id = UUID(
            app.repository.session.get(
                SharedDocumentRow, first["items"][0]["document_id"]
            ).owner_user_id
        )
        app.libraries.max_storage_bytes = app.libraries.storage(user_id)["used_bytes"]
        unchanged = app.start(user_id, "obsidian", files)
        assert unchanged["duplicates"] == 1 and unchanged["status"] == "completed"
        assert app.repository.retained_bytes(user_id) == 0
        assert len(list(app.repository.session.scalars(select(ImportAttachmentRow)))) == 1
        import pytest

        with pytest.raises(ValueError, match="存储空间不足"):
            app.start(
                user_id,
                "obsidian",
                [("Vault/A.md", b"# changed\n![[a.png]]"), ("Vault/a.png", b"new image")],
            )


def test_batch_request_key_replays_same_request_and_rejects_changed_payload(plain_client):
    c = plain_client
    setup(c)
    key = str(uuid4())

    def submit(value, header=key):
        return c.post(
            "/api/imports",
            data={"source_type": "obsidian"},
            files=[("files", ("Vault/A.md", value, "text/markdown"))],
            headers={"Idempotency-Key": header},
        )

    first = submit(b"# A")
    again = submit(b"# A")
    assert (
        first.status_code == again.status_code == 202 and first.json()["id"] == again.json()["id"]
    )
    changed = submit(b"# Changed")
    assert changed.status_code == 422
    assert len(c.get("/api/imports").json()["items"]) == 1
    _authenticate(c)
    other = submit(b"# Other owner")
    assert other.status_code == 202 and other.json()["id"] != first.json()["id"]


def test_source_identity_is_owner_scoped_for_updates(plain_client):
    c = plain_client
    setup(c)
    first = result(c, start(c, [("Vault/A.md", b"# A")], "obsidian"))
    id = first["items"][0]["document_id"]
    _authenticate(c)
    second = result(c, start(c, [("Vault/A.md", b"# Other")], "obsidian"))
    assert second["imported"] == 1 and second["updated"] == 0
    assert second["items"][0]["document_id"] != id
    assert (
        c.get(
            f"/api/shared-knowledge-bases/{first['library_id']}/documents/{id}/source"
        ).status_code
        == 404
    )


def test_replacement_removes_changed_document_from_public_snapshot(plain_client):
    from datetime import UTC, datetime

    c = plain_client
    setup(c)
    first = result(c, start(c, [("Vault/A.md", b"# A"), ("Vault/B.md", b"# B")], "obsidian"))
    ids = {item["filename"]: item["document_id"] for item in first["items"]}
    with c.app.state.knowledge_import_scope() as app:
        app.repository.session.add(
            SharedKnowledgePublicationRow(
                knowledge_base_id=first["library_id"],
                title="Public",
                description="",
                topics=[],
                document_ids=list(ids.values()),
                request_key="published",
                published_at=datetime.now(UTC),
            )
        )
        app.repository.session.commit()
    result(c, start(c, [("Vault/A.md", b"# A\nnew private body")], "obsidian"))
    with c.app.state.knowledge_import_scope() as app:
        publication = app.repository.session.get(SharedKnowledgePublicationRow, first["library_id"])
        assert publication.document_ids == [ids["B.md"]]
        assert (
            app.repository.session.get(SharedDocumentRow, ids["A.md"]).content_hash
            == hashlib.sha256(b"# A\nnew private body").hexdigest()
        )


def test_public_and_shared_sources_do_not_expose_private_attachment_urls(plain_client):
    c = plain_client
    setup(c)
    batch = result(
        c,
        start(
            c, [("Vault/A.md", b"# A\n![[a.png]]"), ("Vault/a.png", b"private image")], "obsidian"
        ),
    )
    item = batch["items"][0]
    assert (
        c.put(
            f"/api/shared-knowledge-bases/{batch['library_id']}/publication",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "title": "Public",
                "description": "",
                "topics": [],
                "confirm_public_content": True,
            },
        ).status_code
        == 200
    )
    public_path = (
        f"/api/public-knowledge-directory/{batch['library_id']}"
        f"/documents/{item['document_id']}/source"
    )
    assert c.get(public_path).json()["attachments"] == []
    edited = result(
        c,
        start(
            c,
            [
                ("Vault/A.md", b"# A\nnew private body ![[a.png]]"),
                ("Vault/a.png", b"private image"),
            ],
            "obsidian",
        ),
    )
    assert edited["updated"] == 1
    assert c.get(public_path).status_code == 404
    update = c.patch(
        f"/api/shared-knowledge-bases/{batch['library_id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"sharing_enabled": True},
    )
    assert update.status_code == 200
    token = update.json()["share_token"]
    _authenticate(c)
    joined = c.post(
        "/api/shared-knowledge-base-subscriptions",
        headers={"Idempotency-Key": str(uuid4())},
        json={"share_token": token},
    )
    assert joined.status_code == 200
    assert source(c, batch, item["document_id"])["attachments"] == []
    assert c.get(edited["items"][0]["attachments"][0]["url"]).status_code == 404


def test_imported_attachment_account_export_and_erasure(plain_client):
    import base64

    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c, email="portable-import@example.test")
    batch = result(
        c,
        start(
            c, [("Vault/A.md", b"# A\n![[a.png]]"), ("Vault/a.png", b"private image")], "obsidian"
        ),
    )
    created = c.post(
        "/api/account/data-exports",
        headers={"Idempotency-Key": str(uuid4())},
        json={"format": "json"},
    )
    assert created.status_code == 201, created.text
    exported = c.get(created.json()["download_href"]).json()["records"]
    assert (
        base64.b64decode(exported["import_attachments"][0]["content"]["base64"]) == b"private image"
    )
    deleted = c.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "portable-import@example.test",
        },
    )
    assert deleted.status_code == 200, deleted.text
    with c.app.state.database.session() as session:
        assert not list(session.scalars(select(ImportAttachmentRow)))
        assert not list(session.scalars(select(ImportItemRow)))
    assert c.get(batch["items"][0]["attachments"][0]["url"]).status_code == 401


def test_url_only_bookmark_refetches_and_updates_changed_body(plain_client):
    c = plain_client
    setup(c)
    reads = []

    def fetch(url):
        reads.append(url)
        return "# Actual title\nOriginal article body."

    c.app.state.import_fetch_text = fetch
    files = [("bookmarks.html", b'<a href="https://example.org/article">Article</a>')]
    first = result(c, start(c, files, "chrome"))
    id = first["items"][0]["document_id"]
    same = result(c, start(c, files, "chrome"))
    assert reads == ["https://example.org/article", "https://example.org/article"]
    assert same["duplicates"] == 1 and same["items"][0]["document_id"] == id
    c.app.state.import_fetch_text = lambda url: "# Actual title\nUpdated article body."
    changed = result(c, start(c, files, "chrome"))
    assert changed["updated"] == 1 and changed["items"][0]["document_id"] == id
    assert "Updated article body" in str(source(c, first, id)["segments"])


def test_stale_import_attempt_cannot_complete_or_fail_reclaimed_item(plain_client):
    from datetime import UTC, datetime, timedelta

    import pytest

    from qunxue_api.modules.knowledge_import import ImportUnavailable

    c = plain_client
    setup(c)
    batch = start(c, [("Vault/A.md", b"# A")], "obsidian")
    with c.app.state.knowledge_import_scope() as first:
        old = first.repository.claim()
        row = first.repository.session.get(ImportItemRow, old["id"])
        row.started_at = datetime.now(UTC) - timedelta(minutes=6)
        first.repository.session.commit()
        with c.app.state.knowledge_import_scope() as second:
            fresh = second.repository.claim()
            assert fresh["attempts"] == 2
        with pytest.raises(ImportUnavailable):
            first.repository.complete(old, uuid4())
        first.repository.fail(old, "stale failure")
        current = first.repository.get(old["user_id"], batch["id"])["items"][0]
        assert (
            current["status"] == "running" and current["attempts"] == 2 and current["error"] is None
        )


def test_legacy_import_gains_new_attachment_without_reparsing_note(plain_client):
    from qunxue_api.adapters.sqlite.knowledge_import import ImportSourceRow

    c = plain_client
    setup(c)
    note = b"# A\n![[a.png]]"
    batch = result(c, start(c, [("Vault/A.md", note)], "obsidian"))
    id = batch["items"][0]["document_id"]
    with c.app.state.knowledge_import_scope() as app:
        row = app.repository.session.scalar(select(ImportSourceRow))
        row.details = {key: value for key, value in row.details.items() if key != "fingerprint"}
        parse_id = app.repository.session.get(SharedDocumentRow, id).parse_id
        app.repository.session.commit()
    updated = result(c, start(c, [("Vault/A.md", note), ("Vault/a.png", b"new image")], "obsidian"))
    assert updated["updated"] == 1 and updated["attachment_count"] == 1
    assert c.get(updated["items"][0]["attachments"][0]["url"]).content == b"new image"
    with c.app.state.knowledge_import_scope() as app:
        assert app.repository.session.get(SharedDocumentRow, id).parse_id == parse_id


def test_asset_only_update_cannot_attach_to_a_full_second_library(plain_client):
    from test_shared_knowledge_api import create_library, upload

    c = plain_client
    setup(c)
    files = [("Vault/A.md", b"# A\n![[a.png]]"), ("Vault/a.png", b"old")]
    first = result(c, start(c, files, "obsidian"))
    second = create_library(c)
    upload(c, second["id"], "another note", "B.txt")
    pending = start(
        c, [("Vault/A.md", files[0][1]), ("Vault/a.png", b"new")], "obsidian", second["id"]
    )
    with c.app.state.knowledge_import_scope() as app:
        app.libraries.max_documents_per_library = 1
        assert app.run_once()
    failed = c.get("/api/imports/" + pending["id"]).json()
    assert failed["failed"] == 1 and failed["updated"] == 0
    assert c.get(first["items"][0]["attachments"][0]["url"]).content == b"old"
    assert len(c.get("/api/shared-knowledge-bases/" + second["id"]).json()["documents"]) == 1


def test_account_import_erasure_preserves_other_owners_sources_and_assets(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c, email="first-import@example.test")
    first = result(
        c, start(c, [("Vault/A.md", b"# A\n![[a.png]]"), ("Vault/a.png", b"first")], "obsidian")
    )
    _authenticate(c, email="second-import@example.test")
    second = result(
        c,
        start(c, [("Vault/A.md", b"# Other\n![[a.png]]"), ("Vault/a.png", b"second")], "obsidian"),
    )
    assert (
        c.post(
            "/api/session/login",
            headers={"Idempotency-Key": str(uuid4())},
            json={"email": "first-import@example.test", "password": "research-passphrase"},
        ).status_code
        == 200
    )
    deleted = c.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "first-import@example.test",
        },
    )
    assert deleted.status_code == 200
    assert (
        c.post(
            "/api/session/login",
            headers={"Idempotency-Key": str(uuid4())},
            json={"email": "second-import@example.test", "password": "research-passphrase"},
        ).status_code
        == 200
    )
    assert c.get(second["items"][0]["attachments"][0]["url"]).content == b"second"
    assert c.get(first["items"][0]["attachments"][0]["url"]).status_code == 404
    assert c.get("/api/imports/" + second["id"]).status_code == 200
    with c.app.state.database.session() as session:
        assets = list(session.scalars(select(ImportAttachmentRow)))
        assert len(assets) == 1 and assets[0].content == b"second"
