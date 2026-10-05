from uuid import uuid4

from test_research_material_api import _authenticate


def start(c, files, source="markdown", library=None):
    data = {"source_type": source}
    if library:
        data["library_id"] = library
    r = c.post(
        "/api/imports",
        data=data,
        files=[("files", (name, text, "application/octet-stream")) for name, text in files],
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 202, r.text
    return r.json()


def drain(c):
    for _ in range(30):
        if not c.app.state.run_import_once():
            return
    raise AssertionError("queue did not drain")


def test_markdown_import_dedup_source_and_wikilinks(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    files = [("vault/A.md", b"# First\n\nSee [[B]]"), ("vault/B.md", b"# Second\n\nA useful note.")]
    first = start(c, files)
    drain(c)
    done = c.get("/api/imports/" + first["id"]).json()
    assert done["status"] == "completed" and done["imported"] == 2
    second = start(c, files)
    drain(c)
    again = c.get("/api/imports/" + second["id"]).json()
    assert again["duplicates"] == 2 and again["imported"] == 0
    library = c.get("/api/shared-knowledge-bases/" + first["library_id"]).json()
    assert len(library["documents"]) == 2
    from sqlalchemy import select

    from qunxue_api.adapters.sqlite.knowledge_import import ImportItemRow, ImportSourceRow

    with c.app.state.knowledge_import_scope() as app:
        source = next(
            x
            for x in app.repository.session.scalars(select(ImportSourceRow))
            if x.relative_path.endswith("A.md")
        )
        assert source.details["wiki_links"] == ["B"]
        assert all(not x.content for x in app.repository.session.scalars(select(ImportItemRow)))


def test_bookmark_partial_failure_can_retry_one_item(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)

    def fetch(url):
        if url.endswith("/bad"):
            raise ValueError("该网页已失效")
        return "A real extracted article body."

    c.app.state.import_fetch_text = fetch
    html = b'<DL><DT><A HREF="https://example.org/good">Good</A><DT><A HREF="https://example.org/bad">Bad</A></DL>'
    batch = start(c, [("bookmarks.html", html)], "chrome")
    drain(c)
    value = c.get("/api/imports/" + batch["id"]).json()
    assert value["status"] == "partial" and value["imported"] == 1 and value["failed"] == 1
    bad = next(x for x in value["items"] if x["status"] == "failed")
    assert bad["error"] == "该网页已失效"
    c.app.state.import_fetch_text = lambda url: "Recovered article."
    retry = c.post(
        f"/api/imports/{batch['id']}/items/{bad['id']}/retry",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert retry.status_code == 200
    drain(c)
    value = c.get("/api/imports/" + batch["id"]).json()
    assert value["status"] == "completed" and value["imported"] == 2
    assert max(x["attempts"] for x in value["items"]) == 2


def test_batches_and_retry_are_owner_scoped(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    batch = start(c, [("private.md", b"# Private")])
    _authenticate(c)
    assert c.get("/api/imports/" + batch["id"]).status_code == 404
    assert c.get("/api/imports").json()["items"] == []
    assert (
        c.post(
            f"/api/imports/{batch['id']}/items/{batch['items'][0]['id']}/retry",
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 404
    )


def test_web_fetch_rejects_private_dns_and_credential_urls(monkeypatch):
    import pytest

    from qunxue_api.adapters.import_sources.fetch import public_url

    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))])
    for url in (
        "https://example.test/article",
        "https://user:password@example.org",
        "file:///tmp/a",
    ):
        with pytest.raises(ValueError):
            public_url(url)


def test_reimport_after_delete_creates_fresh_source_without_resurrecting_empty_file(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    first = start(c, [("note.md", b"# A note\nOriginal source")])
    drain(c)
    item = c.get("/api/imports/" + first["id"]).json()["items"][0]
    c.delete(
        f"/api/shared-knowledge-bases/{first['library_id']}/documents/{item['document_id']}",
        headers={"Idempotency-Key": str(uuid4())},
    )
    second = start(c, [("note.md", b"# A note\nOriginal source")])
    drain(c)
    restored = c.get("/api/imports/" + second["id"]).json()["items"][0]
    assert restored["status"] == "imported"
    assert restored["document_id"] != item["document_id"]


def test_image_keeps_owner_only_asset_and_erases_on_document_delete(plain_client):
    from qunxue_api.adapters.media_import import ImageImportAdapter

    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)

    class Vision:
        def describe(self, **kwargs):
            return {"text": "图片中的文字", "description": "一张测试图片"}

    c.app.state.media_import_gateway.image = ImageImportAdapter(provider=Vision())
    batch = start(c, [("image.png", b"fake-image-fixture")], "image")
    drain(c)
    item = c.get("/api/imports/" + batch["id"]).json()["items"][0]
    assert item["status"] == "imported"
    asset = "/api/imports/assets/" + item["document_id"]
    assert c.get(asset).content == b"fake-image-fixture"
    c.delete(
        f"/api/shared-knowledge-bases/{batch['library_id']}/documents/{item['document_id']}",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert c.get(asset).status_code == 404


def test_clip_preserves_url_identity_and_deduplicates_repeated_capture(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    payload = {
        "url": "https://example.org/article",
        "title": "An article",
        "html": "<article><h1>Title</h1><p>A saved article body.</p></article>",
    }
    first = c.post("/api/imports/clip", json=payload, headers={"Idempotency-Key": str(uuid4())})
    assert first.status_code == 202, first.text
    drain(c)
    second = c.post("/api/imports/clip", json=payload, headers={"Idempotency-Key": str(uuid4())})
    drain(c)
    batch = c.get("/api/imports/" + second.json()["id"]).json()
    assert batch["duplicates"] == 1


def test_public_bilibili_discovery_expands_durable_batch_and_imports_transcript(plain_client):
    from qunxue_api.adapters.media_import import FavoritesReport, ImportItem, ImportResult

    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    item = ImportItem(
        source_key="bilibili:BV123",
        title="Public video",
        filename="video.txt",
        content=b"metadata only",
        source_url="https://www.bilibili.com/video/BV123",
        relative_path="video",
    )

    class Favorites:
        def enumerate_public_favorites(self, uid):
            return FavoritesReport(items=(item,))

    class Video:
        def import_video(self, url):
            from dataclasses import replace

            return ImportResult(item=replace(item, content=b"Real subtitle fixture text."))

    c.app.state.media_import_gateway.favorites = Favorites()
    c.app.state.media_import_gateway.video = Video()
    created = c.post(
        "/api/imports/bilibili", json={"uid": "123"}, headers={"Idempotency-Key": str(uuid4())}
    )
    assert created.status_code == 202, created.text
    drain(c)
    batch = c.get("/api/imports/" + created.json()["id"]).json()
    assert batch["imported"] == 1 and batch["total"] == 1
    source = c.get(
        f"/api/shared-knowledge-bases/{batch['library_id']}/documents/{batch['items'][0]['document_id']}/source"
    ).json()
    assert "Real subtitle fixture" in str(source["segments"])
    assert "metadata only" not in str(source["segments"])


def test_fifty_bookmarks_keep_failed_items_and_continue_importing(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)

    def fetch(url):
        if int(url.rsplit("/", 1)[1]) >= 5:
            raise ValueError("未读取到网页正文，请收藏当前页面。")
        return "A real article body, with useful details and a source to preserve."

    c.app.state.import_fetch_text = fetch
    html = (
        "<DL>"
        + "".join(f'<DT><A HREF="https://example.org/{i}">Bookmark {i}</A>' for i in range(50))
        + "</DL>"
    )
    batch = start(c, [("bookmarks.html", html.encode())], "chrome")
    assert batch["total"] == 50
    for _ in range(51):
        if not c.app.state.run_import_once():
            break
    result = c.get("/api/imports/" + batch["id"]).json()
    assert result["total"] == 50 and result["finished"] == 50
    assert result["imported"] == 5 and result["failed"] == 45
    assert len(result["items"]) == 50
    library = c.get("/api/shared-knowledge-bases/" + batch["library_id"]).json()
    assert len(library["documents"]) == 5
    assert all(doc["filename"].startswith("Bookmark ") for doc in library["documents"])


def test_generic_bookmark_gets_body_title_without_changing_named_bookmarks(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    c.app.state.import_fetch_text = lambda url: "# Townscaper\n\nA free-form town building game."
    html = (
        b'<DL><DT><A HREF="https://example.org/one">bookmark-59</A>'
        b'<DT><A HREF="https://example.org/two">My custom title</A></DL>'
    )
    batch = start(c, [("bookmarks.html", html)], "chrome")
    drain(c)
    library = c.get("/api/shared-knowledge-bases/" + batch["library_id"]).json()
    assert {doc["filename"] for doc in library["documents"]} == {
        "Townscaper.md",
        "My custom title.md",
    }
