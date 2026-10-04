from uuid import uuid4

from fastapi import HTTPException
from test_research_material_api import _authenticate
from test_writing import doc, proposal


def test_writing_conflict_and_unavailable_messages_reach_standard_envelope(plain_client):
    c = plain_client
    _authenticate(c)
    document = doc(c)
    path = "/api/writing/documents/" + document["document_id"]
    body = {"expected_version": 1, "markdown": "新正文"}
    assert c.patch(path, headers={"Idempotency-Key": str(uuid4())}, json=body).status_code == 200
    response = c.patch(path, headers={"Idempotency-Key": str(uuid4())}, json=body)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert response.json()["error"]["message"] == "文稿已更新，请刷新后重试；你的修改没有覆盖原文"
    response = proposal(c, dict(document, version=2))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "capability_unavailable"
    assert (
        response.json()["error"]["message"] == "当前尚未配置可用模型，文稿已保存；没有生成模拟修订"
    )


def test_unexpected_writing_value_error_never_exposes_private_detail(plain_client):
    c = plain_client
    _authenticate(c)
    document = doc(c)

    def fail(*args):
        raise ValueError("private-provider-debug-secret")

    c.app.state.writing_generate = fail
    response = proposal(c, document)
    assert response.status_code == 422
    assert "private-provider-debug-secret" not in response.text
    assert response.json()["error"]["message"] == "输入不符合写作要求，请检查文件格式、长度或选区"


def test_arbitrary_http_exception_is_still_redacted_even_in_writing(plain_client):
    c = plain_client
    _authenticate(c)
    document = doc(c)

    def fail(*args):
        raise HTTPException(503, "private-http-debug-secret")

    c.app.state.writing_generate = fail
    response = proposal(c, document)
    assert response.status_code == 503
    assert "private-http-debug-secret" not in response.text
    assert response.json()["error"]["message"] == "Internal server error."
