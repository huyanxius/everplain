# ruff: noqa: F811
import json
from uuid import uuid4

import pytest
from conftest import alembic_config  # noqa: F401
from sqlalchemy import text
from test_account_management_api import client, register  # noqa: F401

from qunxue_api.adapters.model import ModelGateway
from qunxue_api.adapters.model.openai_compatible_provider import OpenAICompatibleModelProvider
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import PriceBook


@pytest.mark.parametrize("mode", ["success", "unconfigured", "persistence_failure"])
def test_existing_extraction_route_meter_owner_persistence_and_replay(client, monkeypatch, mode):
    register(client, "synthetic-research@example.com")
    assert client.get("/api/account/credits").status_code == 200
    database = client.app.state.database
    if mode != "unconfigured":
        client.app.state.billing_operations.runtime = DurableBilling(
            database.engine,
            price_book=PriceBook(credits_per_usd=10000, version="synthetic-research"),
            max_attempt_pico=10**11,
            max_operation_pico=10**11,
            daily_budget_pico=10**12,
        )
    provider = OpenAICompatibleModelProvider(
        base_url="https://synthetic.test/v1",
        api_key=None,
        model="gpt-6-luna",
        timeout_seconds=1,
        capability_tier="base",
        require_billing=True,
    )
    client.app.state.model_gateway = ModelGateway(
        provider=provider,
        recorder=client.app.state.model_invocation_recorder,
        contract_version="synthetic",
    )
    calls = []

    class Response:
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            output = {
                "status": "ok",
                "knowledge_release_id": None,
                "theory_ids": [],
                "output": {
                    "phenomenon": "Synthetic phenomenon",
                    "research_intent": None,
                    "context": None,
                    "source_ref_ids": [],
                },
            }
            return json.dumps(
                {
                    "id": "synthetic-extraction",
                    "model": "gpt-6-luna",
                    "choices": [
                        {"message": {"content": json.dumps(output)}, "finish_reason": "stop"}
                    ],
                    "usage": {
                        "prompt_tokens": 1000,
                        "completion_tokens": 100,
                        "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                    },
                }
            ).encode()

    def transport(request, **kwargs):
        calls.append(request)
        return Response()

    monkeypatch.setattr("qunxue_api.adapters.model.openai_compatible_provider.urlopen", transport)
    headers = {"Idempotency-Key": str(uuid4())}
    created = client.post(
        "/api/research-tasks", json={"entry_type": "direct_input"}, headers=headers
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["task_id"]
    submitted = client.post(
        f"/api/research-tasks/{task_id}/inputs/direct",
        headers=headers,
        json={"phenomenon": "Synthetic input", "research_intent": None, "context": None},
    )
    assert submitted.status_code == 200
    if mode == "persistence_failure":

        def failed_save(self, **kwargs):
            raise RuntimeError("synthetic save failure")

        monkeypatch.setattr(
            "qunxue_api.modules.research_intake.PhenomenonService.save_candidate", failed_save
        )
    url = f"/api/research-tasks/{task_id}/phenomenon-candidates"
    args = dict(headers=headers, json={"expected_task_version": 1, "requested_count": 1})
    if mode == "persistence_failure":
        with pytest.raises(RuntimeError, match="synthetic save failure"):
            client.post(url, **args)
    else:
        result = client.post(url, **args)
        assert result.status_code == (503 if mode == "unconfigured" else 200), result.text
        if mode == "success":
            assert client.post(url, **args).json() == result.json()
    assert len(calls) == (0 if mode == "unconfigured" else 1)

    with database.engine.connect() as c:
        assert c.scalar(text("SELECT balance FROM credit_accounts")) == (
            2999 if mode == "success" else 3000
        )
        if calls:
            row = c.execute(
                text(
                    "SELECT b.user_id, u.user_id, b.status, b.exempt "
                    "FROM billing_operations b JOIN users u ON u.user_id=b.user_id"
                )
            ).one()
            assert row[0] == row[1] and row[3] == 0
            assert row[2] == ("success" if mode == "success" else "error")
            assert c.scalar(text("SELECT reference_cost_pico FROM billing_attempts")) == 150000000
    register(client, "synthetic-other-owner@example.com")
    other = client.post(url, **args)
    assert other.status_code in {403, 404}
    assert len(calls) == (0 if mode == "unconfigured" else 1)


def test_personal_product_keeps_matching_routes_unmounted_and_uncharged(client, monkeypatch):
    register(client, "synthetic-unmounted@example.com")
    paths = client.app.openapi()["paths"]
    assert "/api/research-tasks/{task_id}/match-runs" not in paths
    assert "/api/match-runs/{match_run_id}/candidates/{candidate_id}/retry" not in paths
    calls = []
    monkeypatch.setattr(
        "qunxue_api.adapters.model.openai_compatible_provider.urlopen",
        lambda *args, **kwargs: calls.append(args),
    )
    headers = {"Idempotency-Key": str(uuid4())}
    for url in [
        f"/api/research-tasks/{uuid4()}/match-runs",
        f"/api/match-runs/{uuid4()}/candidates/{uuid4()}/retry",
    ]:
        assert client.post(url, headers=headers, json={}).status_code == 404
    assert not calls
    with client.app.state.database.engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM billing_operations")) == 0
