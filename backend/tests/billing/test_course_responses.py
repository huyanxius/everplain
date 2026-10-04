"""Offline real-SDK coverage for the registered organization route and cash guard."""

# ruff: noqa: F811
import json
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model import (
    InMemoryModelAttemptRecorder,
    ModelEndpoint,
    ModelRouteExecutor,
)
from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.adapters.research_agent import course_knowledge
from qunxue_api.adapters.research_agent.course_cost import CourseCostLimits
from qunxue_api.bootstrap import create_app
from qunxue_api.modules.shared_knowledge import SharedDocument
from qunxue_api.settings import Settings


@pytest.mark.parametrize("billing_enabled", [False, True])
def test_bootstrap_organization_uses_registered_luna_route(billing_enabled):
    settings = Settings(
        _env_file=None,
        database_url="sqlite:///:memory:",
        runtime_mode="base",
        model_base_url="https://api.modelink.ai/v1",
        model_name="openai/gpt-6-luna",
        model_api_key="synthetic",
        agent_model_protocol="responses",
        agent_model_supported_efforts=("none", "medium"),
        model_reasoning_effort="none",
    )
    if billing_enabled:
        settings = settings.model_copy(
            update={
                "billing_price_version": "synthetic",
                "billing_credits_per_usd": 10000,
                "billing_max_attempt_usd_micro": 20000,
                "billing_max_operation_usd_micro": 100000,
                "billing_daily_budget_usd_micro": 1000000,
                "billing_model_aliases": {"openai/gpt-6-luna": "gpt-6-luna"},
            }
        )
    app = create_app(settings=settings)
    generator = app.state.course_organization_worker.generate
    assert generator.protocol == "responses"
    assert generator.reasoning_effort == "none"
    assert generator.router._endpoints[0].base_url == "https://api.modelink.ai/bypass/openai/v1"
    assert generator.router.endpoint_ids == ("primary",)
    # Ordinary conversation routing and every existing organization cash limit stay intact.
    assert app.state.model_endpoints[0].base_url == settings.model_base_url
    assert generator.cost_limits.budget == (Decimal("0.10") if billing_enabled else None)
    if billing_enabled:
        assert generator.cost_limits.input_rate == Decimal("0.125")
        assert generator.cost_limits.output_rate == Decimal("0.5")
        assert app.state.billing_operations.runtime.max_attempt_pico == 20_000_000_000
        assert app.state.billing_operations.phase_policies == {}
    assert generator.cost_limits.input_tokens == settings.organization_max_input_tokens
    assert generator.cost_limits.retries == settings.organization_max_retries
    app.state.database.engine.dispose()


@pytest.mark.parametrize("protocol", ["responses", "chat_completions"])
def test_organization_real_sdk_preserves_anchors_usage_and_cash_guard(
    wallet, monkeypatch, protocol
):
    runtime, engine = wallet
    runtime.max_attempt_pico = 20_000_000_000
    runtime.max_operation_pico = 100_000_000_000
    calls = []
    recorder = InMemoryModelAttemptRecorder()
    source_id = str(uuid4())

    def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        expected_path = "/v1/responses" if protocol == "responses" else "/v1/chat/completions"
        assert request.url.path == expected_path
        value = json.dumps(
            {
                "summary": "Synthetic summary",
                "topics": [
                    {"title": "Synthetic topic", "summary": "Source only", "segment_ids": ["0"]}
                ],
                "relations": [],
            }
        )
        if protocol == "responses":
            assert payload["store"] is False
            assert payload["reasoning"]["effort"] == "none"
            assert payload["max_output_tokens"] == 3000
            return httpx.Response(
                200,
                json={
                    "id": "resp_synthetic_organization",
                    "object": "response",
                    "created_at": 1,
                    "model": "gpt-6-luna",
                    "status": "completed",
                    "output": [
                        {
                            "type": "function_call",
                            "id": "fc_synthetic",
                            "call_id": "call_synthetic",
                            "name": payload["tools"][0]["name"],
                            "arguments": value,
                            "status": "completed",
                        }
                    ],
                    "usage": {
                        "input_tokens": 1000,
                        "output_tokens": 100,
                        "total_tokens": 1100,
                        "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                        "output_tokens_details": {"reasoning_tokens": 0},
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "chat_synthetic_organization",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-6-luna",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "id": "call_synthetic",
                                    "function": {
                                        "name": payload["tools"][0]["function"]["name"],
                                        "arguments": value,
                                    },
                                }
                            ],
                        },
                    }
                ],
                "usage": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 100,
                    "total_tokens": 1100,
                    "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                },
            },
        )

    def client(**kwargs):
        return AsyncOpenAI(
            **kwargs,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False),
        )

    monkeypatch.setattr(course_knowledge, "AsyncOpenAI", client)
    endpoint = ModelEndpoint("primary", "https://synthetic.test/v1", "gpt-6-luna", "synthetic", 30)
    generator = course_knowledge.CourseKnowledgeGenerator(
        (endpoint,),
        route_executor=ModelRouteExecutor(endpoints=(endpoint,), recorder=recorder),
        protocol=protocol,
        reasoning_effort="none",
        cost_limits=CourseCostLimits(
            budget=Decimal("0.10"),
            input_rate=Decimal("0.1"),
            output_rate=Decimal("0.5"),
            currency="USD",
        ),
    )
    document = SharedDocument(
        uuid4(),
        uuid4(),
        "synthetic.txt",
        "text/plain",
        "synthetic",
        1,
        uuid4(),
        "ready",
        segments=({"segment_id": source_id, "text": "Synthetic source."},),
    )
    saved = {}
    with OperationScope(
        runtime, user_id="user", run_id=str(uuid4()), fingerprint="synthetic"
    ) as operation:
        result = generator(document, on_checkpoint=lambda value: saved.update(value))
        operation.finish("success")
    assert result["topics"][0]["segment_ids"] == [source_id]
    assert len(calls) == len(recorder.list_all()) == 1
    assert recorder.list_all()[0].input_tokens == 1000
    assert recorder.list_all()[0].output_tokens == 100
    assert len(saved["batches"]) == 1
    assert Decimal(saved["cost"]["reserved"]) > 0
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT api_type, requested_model FROM billing_attempts")
        ).one() == (protocol, "gpt-6-luna")
        assert connection.scalar(text("SELECT status FROM billing_operations")) == "success"


def test_upload_organize_index_persists_real_sdk_result_without_duplicate_calls(
    plain_client, monkeypatch
):
    from billing_test_support import configure_synthetic_billing
    from test_research_material_api import _authenticate
    from test_shared_knowledge_api import create_library, upload

    from qunxue_api.adapters.sqlite.shared_knowledge import SharedDocumentRow

    client = plain_client
    configure_synthetic_billing(client.app, phase="course_knowledge")
    _authenticate(client)
    library = create_library(client)
    document = upload(client, library["id"])
    calls = []

    def reply(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert request.url.path == "/bypass/openai/v1/responses"
        assert payload["store"] is False
        assert payload["reasoning"]["effort"] == "none"
        return httpx.Response(
            200,
            json={
                "id": "resp_worker_synthetic",
                "object": "response",
                "created_at": 1,
                "model": "gpt-6-luna",
                "status": "completed",
                "output": [
                    {
                        "type": "function_call",
                        "id": "fc_worker",
                        "call_id": "call_worker",
                        "name": payload["tools"][0]["name"],
                        "status": "completed",
                        "arguments": json.dumps(
                            {
                                "summary": "Synthetic summary",
                                "topics": [
                                    {
                                        "title": "Synthetic topic",
                                        "summary": "Source only",
                                        "segment_ids": ["0"],
                                    }
                                ],
                                "relations": [],
                            }
                        ),
                    }
                ],
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 100,
                    "total_tokens": 1100,
                    "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 0},
                },
            },
        )

    def sdk_client(**kwargs):
        return AsyncOpenAI(
            **kwargs,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False),
        )

    class Embedder:
        calls = 0

        def embed_documents(self, values):
            self.calls += 1
            return [[1.0, 0.5] for _ in values]

    monkeypatch.setattr(course_knowledge, "AsyncOpenAI", sdk_client)
    endpoint = ModelEndpoint(
        "primary", "https://synthetic.test/bypass/openai/v1", "gpt-6-luna", "synthetic", 30
    )
    worker = client.app.state.course_organization_worker
    worker.generate = course_knowledge.CourseKnowledgeGenerator(
        (endpoint,),
        protocol="responses",
        reasoning_effort="none",
        cost_limits=CourseCostLimits(
            budget=Decimal("0.10"),
            input_rate=Decimal("0.1"),
            output_rate=Decimal("0.5"),
            currency="USD",
        ),
    )
    worker.embedder, worker.embedding_model = Embedder(), "synthetic-embedding"
    assert worker.run_once()
    assert worker.run_once()
    assert not worker.run_once()
    result = client.get(f"/api/shared-knowledge-bases/{library['id']}").json()["documents"][0]
    assert result["knowledge_status"] == result["index_status"] == "ready"
    assert len(calls) == worker.embedder.calls == 1
    with client.app.state.shared_knowledge_scope() as application:
        row = application.repository.session.get(SharedDocumentRow, document["id"])
        assert row.knowledge["topics"][0]["segment_ids"] == [row.segments[0]["segment_id"]]
        assert len(row.knowledge_checkpoints["batches"]) == 1
        assert row.job_token is None
        assert row.vectors["synthetic-embedding"]
        assert row.content
    with client.app.state.database.engine.connect() as connection:
        assert connection.scalar(text("SELECT status FROM billing_operations")) == "success"
        assert connection.scalar(text("SELECT api_type FROM billing_attempts")) == "responses"
