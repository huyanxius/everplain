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
