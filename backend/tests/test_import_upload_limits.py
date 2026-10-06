"""Offline transport limits using the actual import route and multipart parser."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette import formparsers

from qunxue_api.adapters.import_sources import parser
from qunxue_api.api.dependencies import get_current_session
from qunxue_api.api.routes import knowledge_import as route


def test_payload_limits_match_the_import_parser():
    assert route.MAX_IMPORT_FILES == parser.MAX_FILES
    assert route.MAX_IMPORT_FILE_BYTES == parser.MAX_FILE_BYTES
    assert route.MAX_IMPORT_TOTAL_BYTES == parser.MAX_TOTAL_BYTES
    assert route.MAX_IMPORT_REQUEST_BYTES == route.MAX_IMPORT_TOTAL_BYTES + 4 * 1024 * 1024


@pytest.fixture
def upload_app():
    received = []

    def start(user_id, source_type, files, library_id, key):
        received.append(files)
        return {
            "id": str(uuid4()),
            "library_id": str(library_id or uuid4()),
            "source_type": source_type,
            "created_at": datetime.now(UTC),
            "items": [],
            "total": len(files),
            "finished": 0,
            "imported": 0,
            "duplicates": 0,
            "failed": 0,
            "status": "processing",
        }

    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(user_id=uuid4())
    )
    app.dependency_overrides[route.application] = lambda: SimpleNamespace(start=start)
    return app, received


@pytest.mark.parametrize("count", [3, 1001, 2000])
def test_accepts_promised_number_of_files(upload_app, count):
    app, received = upload_app
    with TestClient(app) as client:
        response = client.post(
            "/api/imports",
            data={"source_type": "obsidian", "library_id": str(uuid4())},
            files=[
                ("files", (f"资料/{i}.md", b"# synthetic", "text/markdown")) for i in range(count)
            ],
            headers={"Idempotency-Key": str(uuid4())},
        )
    assert response.status_code == 202, response.text
    assert response.json()["total"] == len(received[0]) == count
    assert received[0][0] == ("资料/0.md", b"# synthetic")


def test_rejects_2001_files_before_application(upload_app):
    app, received = upload_app
    with TestClient(app) as client:
        response = client.post(
            "/api/imports",
            data={"source_type": "obsidian"},
            files=[("files", (f"{i}.md", b"x")) for i in range(2001)],
            headers={"Idempotency-Key": str(uuid4())},
        )
    assert response.status_code == 400
    assert "2000" in response.json()["detail"]
    assert not received


def test_rejects_extra_fields_before_application(upload_app):
    app, received = upload_app
    with TestClient(app) as client:
        response = client.post(
            "/api/imports",
            data={"source_type": "obsidian", "library_id": str(uuid4()), "extra": "x"},
            files={"files": ("x.md", b"x")},
            headers={"Idempotency-Key": str(uuid4())},
        )
    assert response.status_code == 400
    assert "Maximum number of fields is 2" in response.json()["detail"]
    assert not received


@pytest.mark.parametrize(
    ("limit", "contents"),
    [("MAX_IMPORT_FILE_BYTES", [b"1234"]), ("MAX_IMPORT_TOTAL_BYTES", [b"12", b"34"])],
)
def test_keeps_file_and_aggregate_payload_limits(upload_app, monkeypatch, limit, contents):
    app, received = upload_app
    monkeypatch.setattr(route, limit, 3)
    with TestClient(app) as client:
        response = client.post(
            "/api/imports",
            data={"source_type": "obsidian"},
            files=[("files", (f"{i}.md", content)) for i, content in enumerate(contents)],
            headers={"Idempotency-Key": str(uuid4())},
        )
    assert response.status_code == 413
    assert response.json()["detail"] == "单文件最多16MB，每批最多64MB"
    assert not received


def test_accepts_full_64_mib_payload_with_bounded_multipart_overhead(upload_app):
    app, received = upload_app
    content = b"a" * route.MAX_IMPORT_FILE_BYTES
    with TestClient(app) as client:
        response = client.post(
            "/api/imports",
            data={"source_type": "obsidian"},
            files=[("files", (f"{i}.md", content)) for i in range(4)],
            headers={"Idempotency-Key": str(uuid4())},
        )
    assert response.status_code == 202, response.text
    assert sum(len(value) for _, value in received[0]) == route.MAX_IMPORT_TOTAL_BYTES


def test_rejects_declared_oversize_without_parsing(upload_app, monkeypatch):
    app, received = upload_app
    monkeypatch.setattr(route, "MAX_IMPORT_REQUEST_BYTES", 100)

    async def unexpected_form(*args, **kwargs):
        pytest.fail("declared oversized request must fail before parsing")

    monkeypatch.setattr(route.ImportUploadRequest, "form", unexpected_form)
    with TestClient(app) as client:
        response = client.post(
            "/api/imports", content=b"x" * 101, headers={"Idempotency-Key": str(uuid4())}
        )
    assert response.status_code == 413
    assert not received


@pytest.mark.parametrize("declared_length", [None, b"1"])
def test_stream_limit_covers_missing_or_false_length_and_closes_files(
    upload_app, monkeypatch, declared_length
):
    app, received = upload_app
    monkeypatch.setattr(route, "MAX_IMPORT_REQUEST_BYTES", 1024)
    opened = []
    original = formparsers.SpooledTemporaryFile

    def temporary_file(*args, **kwargs):
        value = original(*args, **kwargs)
        opened.append(value)
        return value

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", temporary_file)
    chunks = [
        b'--synthetic\r\nContent-Disposition: form-data; name="source_type"\r\n\r\n'
        b'obsidian\r\n--synthetic\r\nContent-Disposition: form-data; name="files"; '
        b'filename="note.md"\r\nContent-Type: text/markdown\r\n\r\n# synthetic\n',
        b"x" * 1024,
        b"\r\n--synthetic--\r\n",
    ]
    headers = [
        (b"content-type", b"multipart/form-data; boundary=synthetic"),
        (b"idempotency-key", str(uuid4()).encode()),
    ]
    if declared_length is not None:
        headers.append((b"content-length", declared_length))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/imports",
        "raw_path": b"/api/imports",
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "server": ("testserver", 80),
        "client": ("testclient", 123),
    }
    messages = []

    async def receive():
        chunk = chunks.pop(0)
        return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}

    async def send(message):
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    assert next(m["status"] for m in messages if m["type"] == "http.response.start") == 413
    assert len(chunks) == 1, "stop reading as soon as the bounded request limit is crossed"
    assert opened and all(file.closed for file in opened)
    assert not received


def test_openapi_contract_remains_typed_multipart(upload_app):
    app, _ = upload_app
    schema = app.openapi()
    operation = schema["paths"]["/api/imports"]["post"]
    assert operation["operationId"] == "create_import_batch"
    body = operation["requestBody"]["content"]["multipart/form-data"]["schema"]
    shape = schema["components"]["schemas"][body["$ref"].rsplit("/", 1)[1]]
    assert shape["properties"]["files"] == {
        "items": {"type": "string", "contentMediaType": "application/octet-stream"},
        "type": "array",
        "title": "Files",
    }
    assert set(shape["required"]) == {"source_type", "files"}


def test_only_creation_route_uses_custom_form_limits():
    custom = [r for r in route.router.routes if r.get_route_handler().__name__ == "bounded_upload"]
    assert len(custom) == 1
    assert custom[0].path == "/api/imports" and custom[0].methods == {"POST"}
