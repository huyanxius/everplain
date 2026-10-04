"""Offline integration guards; no provider transport is used by these tests."""

from uuid import uuid4

import pytest
from billing_test_support import synthetic_billing_runtime
from sqlalchemy import text
from test_research_material_api import _authenticate
from test_writing import doc, proposal

from qunxue_api import bootstrap
from qunxue_api.adapters.model.metering import current_operation
from qunxue_api.settings import Settings


@pytest.mark.parametrize("failure", ["missing_phase", "missing_runtime", "unknown_price", "budget"])
def test_writing_billing_blocks_before_network_and_preserves_original(plain_client, failure):
    client = plain_client
    _authenticate(client)
    document = doc(client)
    database = client.app.state.database
    # Bind production billing wiring to a synthetic, explicitly funded phase.
    client.app.state.model_endpoints = (object(),)
    billing = client.app.state.billing_operations
    billing.phase_policies = {"course_knowledge": "user", "writing": "operator"}
    billing.runtime = synthetic_billing_runtime(database.engine)
    if failure == "missing_phase":
        billing.phase_policies.pop("writing")
    if failure == "missing_runtime":
        billing.runtime = None
    if failure == "budget":
        billing.runtime.max_attempt_pico = 1
    reached_network = []

    def generate(*args):
        scope = current_operation(required=True)
        scope.before_attempt_payload({
            "model": "unknown-model" if failure == "unknown_price" else "test-model",
            "messages": [{"role": "user", "content": "synthetic request"}],
            "max_tokens": 10,
        })
        reached_network.append(True)
        pytest.fail("billing must block before reaching a provider")

    client.app.state.writing_generate = generate
    response = proposal(client, document)
    expected = {
        "missing_phase": (503, "billing_not_configured"),
        "missing_runtime": (503, "billing_not_configured"),
        "unknown_price": (503, "billing_not_configured"),
        "budget": (429, "billing_budget_exceeded"),
    }
    assert (response.status_code, response.json()["error"]["code"]) == expected[failure]
    assert reached_network == []
    assert billing.phase_policies["course_knowledge"] == "user"
    path = "/api/writing/documents/" + document["document_id"]
    assert client.get(path).json()["markdown"] == document["markdown"]
    assert client.get(path + "/revisions").json()["items"] == []
    with database.engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM billing_attempts")) == 0
        assert connection.scalar(text("SELECT status FROM writing_operations "
                                      "WHERE target LIKE 'revision:%'")) == "failed"


@pytest.mark.parametrize("protocol", ["chat_completions", "responses"])
def test_writing_respects_existing_protocol_and_endpoint_route(plain_client, monkeypatch, protocol):
    captured = []

    class Runner:
        def __init__(self, **kwargs):
            captured.append(kwargs)

        def run_writing_stage(self, instructions, payload, run_id):
            return "计划" if payload["stage"] == "content_plan" else "保留正文。"

    monkeypatch.setattr(bootstrap, "PydanticAIKnowledgeRunner", Runner)
    settings = Settings(
        _env_file=None,
        runtime_mode="base",
        database_url=plain_client.app.state.settings.database_url,
        model_base_url="https://synthetic.test/v1",
        model_api_key="synthetic-only",
        model_name="gpt-6-luna",
        agent_model_protocol=protocol,
        agent_model_supported_efforts=("medium",),
        model_reasoning_effort="medium",
        billing_phase_policies={"course_knowledge": "user"},
    )
    app = bootstrap.create_app(settings=settings, database=plain_client.app.state.database)
    app.state.writing_generate(
        {"genre": "essay", "markdown": "保留正文。"},
        {"action": "rewrite", "instruction": "润色"}, [], uuid4(),
    )
    assert len(captured) == 1
    assert captured[0]["protocol"] == protocol
    assert captured[0]["base_url"] == settings.model_base_url
    assert captured[0]["model"] == settings.model_name
    assert captured[0]["require_billing"] is True
    assert captured[0]["reasoning_effort"] == "medium"
    assert app.state.billing_operations.phase_policies == {"course_knowledge": "user"}
