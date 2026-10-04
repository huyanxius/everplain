"""Personal library uploads retain source identities and idempotent storage."""

from uuid import uuid4

from test_research_material_api import _authenticate


def mutation(client, method, path, **kwargs):
    return getattr(client, method)(path, headers={"Idempotency-Key": str(uuid4())}, **kwargs)


def create_library(client):
    response = mutation(
        client,
        "post",
        "/api/shared-knowledge-bases",
        json={
            "name": "Product research",
            "description": "Private reference documents",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, kb, text="课堂记录统一使用 QX-A17 标记。", filename="课堂.txt"):
    response = mutation(
        client,
        "post",
        f"/api/shared-knowledge-bases/{kb}/documents",
        files={"file": (filename, text.encode(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_upload_uses_source_blocks_without_creating_research(client):
    _authenticate(client)
    kb = create_library(client)
    assert kb["sharing_enabled"] is False
    doc = upload(client, kb["id"])
    assert doc["status"] == "ready"
    source = client.get(f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}/source")
    assert source.status_code == 200
    assert source.json()["segments"][0]["text"] == "课堂记录统一使用 QX-A17 标记。"
    assert source.json()["segments"][0]["locator"]["paragraph"] == 1
    assert client.get("/api/agent/conversations").json()["items"] == []


def test_source_rejects_cross_library_and_cross_document_segment_ids(client):
    _authenticate(client)
    a, b = create_library(client), create_library(client)
    doc_a, doc_b = upload(client, a["id"]), upload(client, b["id"], "不可混入的 B 资料")
    path_a = f"/api/shared-knowledge-bases/{a['id']}/documents/{doc_a['id']}/source"
    source_b = client.get(
        f"/api/shared-knowledge-bases/{b['id']}/documents/{doc_b['id']}/source"
    ).json()
    assert (
        client.get(
            f"/api/shared-knowledge-bases/{a['id']}/documents/{doc_b['id']}/source"
        ).status_code
        == 404
    )
    assert (
        client.get(path_a, params={"segment_id": source_b["segments"][0]["segment_id"]}).status_code
        == 404
    )
    mutation(client, "delete", f"/api/shared-knowledge-bases/{a['id']}/documents/{doc_a['id']}")
    assert client.get(path_a).status_code == 404


def test_create_is_idempotent_and_mutations_require_key(client):
    _authenticate(client)
    body = {"name": "同一门课"}
    assert client.post("/api/shared-knowledge-bases", json=body).status_code == 422
    headers = {"Idempotency-Key": str(uuid4())}
    a = client.post("/api/shared-knowledge-bases", json=body, headers=headers)
    b = client.post("/api/shared-knowledge-bases", json=body, headers=headers)
    assert a.status_code == b.status_code == 201
    assert a.json()["id"] == b.json()["id"]
    assert len(client.get("/api/shared-knowledge-bases").json()["items"]) == 1


def test_pptx_reports_unreadable_slide_numbers(client):
    from io import BytesIO
    from zipfile import ZipFile

    from test_shared_knowledge_pptx import pptx_fixture

    _authenticate(client)
    kb = create_library(client)
    data = BytesIO()
    with ZipFile(BytesIO(pptx_fixture())) as source, ZipFile(data, "w") as target:
        for name in source.namelist():
            content = source.read(name)
            if name == "ppt/slides/slide1.xml":
                content = b'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>'
            target.writestr(name, content)
    result = mutation(
        client,
        "post",
        f"/api/shared-knowledge-bases/{kb['id']}/documents",
        files={"file": ("课堂.pptx", data.getvalue(), "application/octet-stream")},
    )
    assert result.status_code == 201
    assert result.json()["status"] == "ready"
    assert "2" in result.json()["warnings"][0]


def test_upload_retry_does_not_duplicate_or_reattach_removed_file(client):
    _authenticate(client)
    kb = create_library(client)
    path = f"/api/shared-knowledge-bases/{kb['id']}/documents"
    headers = {"Idempotency-Key": str(uuid4())}
    files = {"file": ("课件.txt", b"original", "text/plain")}
    first = client.post(path, headers=headers, files=files)
    retry = client.post(path, headers=headers, files=files)
    assert first.json()["id"] == retry.json()["id"]
    conflict = client.post(
        path, headers=headers, files={"file": ("课件.txt", b"changed", "text/plain")}
    )
    assert conflict.status_code == 422
    mutation(client, "delete", f"{path}/{first.json()['id']}")
    assert client.post(path, headers=headers, files=files).status_code == 201
    assert client.get(f"/api/shared-knowledge-bases/{kb['id']}").json()["documents"] == []


def test_concurrent_upload_retry_has_one_document(client):
    from concurrent.futures import ThreadPoolExecutor

    _authenticate(client)
    kb = create_library(client)
    path = f"/api/shared-knowledge-bases/{kb['id']}/documents"
    headers = {"Idempotency-Key": str(uuid4())}

    def send():
        return client.post(
            path, headers=headers, files={"file": ("课件.txt", b"concurrent", "text/plain")}
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: send(), range(2)))
    assert all(response.status_code == 201 for response in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert len(client.get(f"/api/shared-knowledge-bases/{kb['id']}").json()["documents"]) == 1


def test_upload_rejects_unsupported_or_mismatched_formats(client):
    _authenticate(client)
    kb = create_library(client)
    for filename, mime in [("答案.exe", "application/octet-stream"), ("课件.pptx", "text/plain")]:
        response = mutation(
            client,
            "post",
            f"/api/shared-knowledge-bases/{kb['id']}/documents",
            files={"file": (filename, b"unsupported", mime)},
        )
        assert response.status_code == 422


def test_concurrent_create_retry_has_one_library(client):
    from concurrent.futures import ThreadPoolExecutor

    _authenticate(client)
    headers = {"Idempotency-Key": str(uuid4())}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(
                    "/api/shared-knowledge-bases", headers=headers, json={"name": "同一请求"}
                ),
                range(2),
            )
        )
    assert all(response.status_code == 201 for response in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]


def test_catalog_omits_large_columns_and_source_reads_only_requested_document(client):
    from sqlalchemy import event

    _authenticate(client)
    kb = create_library(client)
    first = upload(client, kb["id"], "first document")
    upload(client, kb["id"], "unrelated document", filename="other.txt")
    statements = []
    engine = client.app.state.database.engine

    def capture(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and "shared_documents" in statement:
            statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        for path in ("/api/shared-knowledge-bases", f"/api/shared-knowledge-bases/{kb['id']}"):
            statements.clear()
            assert client.get(path).status_code == 200
            assert len(statements) == 1
            projection = statements[0][0].split("FROM")[0]
            assert "shared_documents.segments" not in projection
            assert "shared_documents.vectors" not in projection
            assert "shared_documents.knowledge_checkpoints" not in projection

        statements.clear()
        response = client.get(
            f"/api/shared-knowledge-bases/{kb['id']}/documents/{first['id']}/source"
        )
        assert response.status_code == 200
        assert response.json()["segments"][0]["text"] == "first document"
        assert len(statements) == 1
        assert "shared_documents.id = ?" in statements[0][0]
        assert first["id"] in statements[0][1]
        assert "shared_documents.vectors" not in statements[0][0].split("FROM")[0]
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def test_metadata_projection_remains_owner_scoped(client):
    _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"])
    client.post("/api/session/logout")
    _authenticate(client)
    assert client.get("/api/shared-knowledge-bases").json()["items"] == []
    assert client.get(f"/api/shared-knowledge-bases/{kb['id']}").status_code == 404
    assert client.get(
        f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}/source"
    ).status_code == 404
