from uuid import uuid4

from sqlalchemy import text
from test_account_management_api import client, register  # noqa: F401


def test_writing_export_and_account_delete(client):  # noqa: F811
    register(client, "writer@example.com")
    source = "这是用户自己的文章。" * 15
    response = client.post(
        "/api/writing/samples",
        headers={"Idempotency-Key": str(uuid4())},
        json={"title": "样文", "genre": "essay", "text": source},
    )
    assert response.status_code == 200, response.text
    response = client.post(
        "/api/writing/documents",
        headers={"Idempotency-Key": str(uuid4())},
        json={"title": "文稿", "genre": "essay", "markdown": "私人文稿"},
    )
    assert response.status_code == 200
    export = client.post(
        "/api/account/data-exports",
        headers={"Idempotency-Key": str(uuid4())},
        json={"format": "json"},
    )
    assert export.status_code == 201, export.text
    records = client.get(export.json()["download_href"]).json()["records"]
    assert records["writing_samples"][0]["text"] == source
    assert records["writing_documents"][0]["markdown"] == "私人文稿"
    deleted = client.post(
        "/api/account/delete",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "current_password": "research-passphrase",
            "confirmation_email": "writer@example.com",
        },
    )
    assert deleted.status_code == 200, deleted.text
    with client.app.state.database.engine.connect() as connection:
        for table in (
            "writing_samples",
            "writing_documents",
            "writing_revisions",
            "writing_operations",
        ):
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
