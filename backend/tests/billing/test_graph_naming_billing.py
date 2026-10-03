# ruff: noqa: F811
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.billing_operations import SqliteBillingOperations
from qunxue_api.adapters.model.metering import BillingContextMissing, OperationScope
from qunxue_api.adapters.model.routing import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.research_agent.graph_topic_namer import GraphTopicNamer
from qunxue_api.application.personal_graph import PersonalGraphApplication


def router():
    return ModelRouteExecutor(
        endpoints=(
            ModelEndpoint(
                endpoint_id="synthetic-naming",
                base_url="https://synthetic.test/v1",
                model="gpt-6-luna",
                api_key=None,
                timeout_seconds=1,
            ),
        )
    )


def test_unconfigured_optional_naming_preserves_source_labels_without_http(monkeypatch):
    calls = []
    monkeypatch.setattr(httpx, "post", lambda *a, **k: calls.append(k))

    class Repository:
        state = {}

        def documents(self, user_id):
            return [
                {"id": "document", "title": "Source document", "hash": "synthetic", "vector": [1]}
            ]

        def load(self, user_id):
            return self.state

        def save(self, user_id, state, pending):
            self.state = state
            assert not pending

    repo = Repository()
    app = PersonalGraphApplication(repo, name_topic=GraphTopicNamer(router()))
    app.read = lambda user_id: repo.state
    result = app.refresh("user")
    assert not calls
    assert len(result["assignments"]) == 1
    assert next(iter(result["topics"].values()))["label"] == "Source document"


def test_naming_policy_cannot_charge_users(wallet):
    runtime, _engine = wallet
    factory = SqliteBillingOperations(None, runtime, phase_policies={"graph_topic_naming": "user"})
    with pytest.raises(BillingContextMissing):
        factory.open(user_id="user", run_id=str(uuid4()), payload=[], phase="graph_topic_naming")


@pytest.mark.parametrize(
    "content,expected_status", [('{"topic":"Synthetic title"}', "success"), ("[]", "error")]
)
def test_operator_naming_records_receipt_and_validation_failure(
    wallet, monkeypatch, content, expected_status
):
    runtime, engine = wallet

    class Billing:
        def open(self, **kwargs):
            assert kwargs["phase"] == "graph_topic_naming"
            return OperationScope(
                runtime,
                user_id=kwargs["user_id"],
                run_id=kwargs["run_id"],
                fingerprint="synthetic",
                exempt=True,
            )

    body = {
        "id": "naming-synthetic",
        "model": "gpt-6-luna",
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": 1000,
            "completion_tokens": 100,
            "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
        },
    }

    def response(*args, **kwargs):
        assert kwargs["json"]["max_tokens"] == 1200
        return httpx.Response(200, json=body, request=httpx.Request("POST", args[0]))

    monkeypatch.setattr(httpx, "post", response)
    namer = GraphTopicNamer(router(), billing=Billing())
    if expected_status == "error":
        with pytest.raises(RuntimeError):
            namer([{"id": "topic", "titles": ["Synthetic document"]}])
    else:
        assert namer([{"id": "topic", "titles": ["Synthetic document"]}]) == {
            "topic": "Synthetic title"
        }
    with engine.connect() as c:
        assert c.scalar(text("SELECT balance FROM credit_accounts WHERE user_id='user'")) == 10000
        assert c.scalar(text("SELECT count(*) FROM credit_accounts")) == 1
        row = c.execute(text("SELECT status, exempt FROM billing_operations")).one()
        assert row == (expected_status, 1)
        attempt = c.execute(
            text(
                "SELECT reference_cost_pico, endpoint_id, provider_host, outcome "
                "FROM billing_attempts"
            )
        ).one()
        assert attempt[:3] == (150000000, "synthetic-naming", "synthetic.test")
        assert attempt[3] == ("error" if expected_status == "error" else "success")
