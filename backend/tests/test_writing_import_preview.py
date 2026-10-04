"""Read-only import previews, all prose is synthetic."""

from test_research_material_api import _authenticate


def preview(client, text, filename="合集.txt"):
    return client.post(
        "/api/writing/samples/preview", files={"file": (filename, text.encode(), "text/plain")}
    )


def test_preview_requires_authentication(plain_client):
    assert preview(plain_client, "合成样文").status_code == 401


def test_mixed_preview_does_not_save_or_assign_genres(plain_client):
    c = plain_client
    _authenticate(c)
    text = (
        "1. 随笔\n\n"
        + "雨停之后我沿着河岸慢慢走回去。" * 8
        + "\n\n2. 小说\n\n"
        + "旅人望向站台另一头，没有说话。" * 8
        + "\n\n删去的：\n\n"
        + "这一段合成文字已经被作者弃用。" * 8
    )
    response = preview(c, text)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 3
    assert all("genre" not in item or item["genre"] is None for item in items)
    assert items[-1]["excluded_reason"]
    assert "弃用" in items[-1]["text"]
    assert c.get("/api/writing/summary").json()["sample_count"] == 0


def test_internal_chapters_are_not_counted_as_independent_articles(plain_client):
    c = plain_client
    _authenticate(c)
    text = (
        "读书报告\n\n一、引言\n\n"
        + "本节交代阅读的问题。" * 10
        + "\n\n二、讨论\n\n"
        + "本节讨论阅读的证据。" * 10
    )
    response = preview(c, text)
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert "二、讨论" in response.json()["items"][0]["text"]


def test_old_single_upload_response_is_compatible(plain_client):
    c = plain_client
    _authenticate(c)
    text = "清晨的雨声落在窗外，我把书放回原来的地方。" * 8
    response = c.post(
        "/api/writing/samples/upload",
        data={"genre": "essay"},
        files={"file": ("单篇.txt", text.encode(), "text/plain")},
        headers={"Idempotency-Key": "legacy-upload"},
    )
    assert response.status_code == 200
    assert response.json()["genre"] == "essay"
    assert "sample_id" in response.json()
    assert "items" not in response.json()


def test_preview_rejects_oversized_and_unsupported_files(plain_client):
    c = plain_client
    _authenticate(c)
    assert preview(c, "<html>text</html>", "bad.html").status_code == 422
    assert preview(c, "x" * (5 * 1024 * 1024 + 1)).status_code == 413
