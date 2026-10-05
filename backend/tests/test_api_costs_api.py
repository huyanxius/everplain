"""Real auth and migrated, synthetic SQLite; no deployment or provider access."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_api_cost_reporting import seed


def register(client):
    response = client.post(
        "/api/session/register", headers={"Idempotency-Key": str(uuid4())},
        json={"email": "cost-admin@synthetic.test", "password": "synthetic-passphrase"},
    )
    assert response.status_code == 201, response.text
    return response.json()["user"]["user_id"]


def promote(client, user_id):
    with client.app.state.database.engine.begin() as conn:
        conn.execute(text("UPDATE users SET role='admin' WHERE user_id=:id"), {"id": user_id})


def test_route_needs_authenticated_active_admin_before_read(plain_client, monkeypatch):
    reads = []
    projection = plain_client.app.state.api_cost_reporting
    real_report = projection.report

    def spy(**kwargs):
        reads.append(kwargs)
        return real_report(**kwargs)

    monkeypatch.setattr(projection, "report", spy)
    assert plain_client.get("/api/admin/api-costs").status_code == 401
    user_id = register(plain_client)
    assert plain_client.get("/api/admin/api-costs").status_code == 403
    assert reads == []
    promote(plain_client, user_id)
    response = plain_client.get("/api/admin/api-costs")
    assert response.status_code == 200, response.text
    assert len(reads) == 1
    with plain_client.app.state.database.engine.begin() as conn:
        conn.execute(text("UPDATE users SET status='disabled' WHERE user_id=:id"), {"id": user_id})
    assert plain_client.get("/api/admin/api-costs").status_code in (401, 403)
    assert len(reads) == 1


def test_admin_scopes_pagination_and_schema_with_ledger_unchanged(plain_client):
    user_id = register(plain_client)
    promote(plain_client, user_id)
    engine = plain_client.app.state.database.engine
    seed(engine, "a", user="operator:model_probe", reference_cost_pico=9007199254740993)
    seed(engine, "b", user=user_id, returned_model="model-b", reasoning_tokens=None)
    with engine.connect() as conn:
        before = conn.execute(text("SELECT * FROM billing_attempts ORDER BY attempt_id")).all()
    response = plain_client.get("/api/admin/api-costs", params={
        "start_date": "2026-10-01", "end_date": "2026-10-05", "group_by": "user_id", "limit": 1,
    })
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    result = response.json()
    assert result["summary"]["reference_cost_pico"] == "9007199254742227"
    assert result["summary"]["actual_procurement_cost_pico"] is None
    assert result["summary"]["reasoning_reported_attempts"] == 1
    assert result["total_groups"] == 2 and result["next_cursor"] == 1
    assert result["timezone"] == "UTC" and result["coverage"] == "durable_billing_attempts_only"
    scoped = plain_client.get("/api/admin/api-costs", params={
        "start_date": "2026-10-05", "end_date": "2026-10-05", "user_id": user_id,
        "model": "model-b", "endpoint_id": "primary", "provider_host": "provider.synthetic.test",
    }).json()
    assert scoped["summary"]["attempt_count"] == 1
    assert scoped["summary"]["reasoning_tokens"] is None
    with engine.connect() as conn:
        after = conn.execute(text("SELECT * FROM billing_attempts ORDER BY attempt_id")).all()
        assert after == before


@pytest.mark.parametrize("params", [
    {"start_date": "2026-10-06", "end_date": "2026-10-05"},
    {"start_date": "2024-01-01", "end_date": "2026-10-05"},
    {"start_date": "not-a-date"}, {"group_by": "key_value"}, {"cursor": -1},
    {"limit": 101}, {"limit": 0}, {"cursor": 10**40}, {"endpoint_id": "x" * 129}, {"model": ""},
])
def test_route_rejects_bad_scope(plain_client, params):
    promote(plain_client, register(plain_client))
    assert plain_client.get("/api/admin/api-costs", params=params).status_code == 422
