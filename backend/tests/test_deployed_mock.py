"""Missing model keys never select a mock business backend."""

from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from qunxue_api.adapters.research_agent.web_research import OpenWebResearchClient
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings
from test_registration_email_verification import RecordingEmailProvider, _send_code
from test_shared_knowledge_api import create_library, upload


def test_only_absent_model_keys_fall_back_and_non_model_config_survives():
    settings = Settings(
        _env_file=None,
        allow_model_fallback=True,
        runtime_mode="base",
        model_base_url="",
        model_name="",
        embedding_base_url="",
        web_search_api_key="fixture-search",
        resend_api_key="fixture-real-email-key",
        email_from="Everplain <hello@example.invalid>",
    )
    assert not settings.has_model_api_key
    assert settings.model_name is None
    assert settings.embedding_base_url is None
    assert settings.web_search_api_key.get_secret_value() == "fixture-search"
    assert settings.resend_api_key.get_secret_value() == "fixture-real-email-key"
    assert settings.max_storage_bytes == 500 * 1024 * 1024
    configured = Settings(
        _env_file=None,
        allow_model_fallback=True,
        runtime_mode="base",
        model_api_key="fixture-model",
        model_base_url="https://model.example.invalid/v1",
        model_name="configured-model",
    )
    assert configured.has_model_api_key
    assert configured.model_name == "configured-model"


def test_fallback_requires_real_backend_mode():
    with pytest.raises(ValidationError, match="requires runtime_mode=base"):
        Settings(_env_file=None, allow_model_fallback=True, runtime_mode="mock")


def test_unconfigured_search_fails_instead_of_returning_fake_results():
    with pytest.raises(ValueError, match="缺少有效配置"):
        OpenWebResearchClient(search_provider="tavily").search("real search")


def test_real_auth_library_storage_survive_application_restart(plain_client):
    settings = Settings(
        _env_file=None,
        allow_model_fallback=True,
        runtime_mode="base",
        database_url=plain_client.app.state.settings.database_url,
        release_revision="model-only-fallback-test",
    )

    def reject_provider_call(request):
        raise AssertionError("unconfigured models must never call a provider")

    app = create_app(
        settings=settings,
        database=plain_client.app.state.database,
        model_probe_transport=httpx.MockTransport(reject_provider_call),
    )
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["runtime_mode"] == "mock"  # Existing field describes MODEL capability.
        assert health.json()["release_revision"] == "model-only-fallback-test"
        assert app.state.settings.runtime_mode == "base"
        assert app.state.model_router is None
        assert app.state.model_probe_task is None
        assert client.get("/api/session").status_code == 401
        assert (
            client.post(
                "/api/session/register",
                headers={"Idempotency-Key": str(uuid4())},
                json={
                    "email": "owner@example.invalid",
                    "password": "fixture-password-123",
                    "verification_code": "000000",
                },
            ).status_code
            == 422
        )
        email = RecordingEmailProvider()  # Test-only delivery transport; production uses Resend.
        code = _send_code(client, email, "owner@example.invalid")
        registered = client.post(
            "/api/session/register",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "email": "owner@example.invalid",
                "password": "fixture-password-123",
                "verification_code": code,
            },
        )
        assert registered.status_code == 201, registered.text
        kb = create_library(client)
        doc = upload(client, kb["id"], "Persisted real private source", "private.txt")
        with app.state.personal_graph_scope() as graph:
            assert not graph.repository.mock
        assert not getattr(app.state, "account_management_installed", False)
        with app.state.disciplinary_agent_scope() as agent:
            turn = agent.run_turn(
                user_id=UUID(registered.json()["user"]["user_id"]),
                conversation_id=None, prompt="你好", idempotency_key=str(uuid4()),
            )
        conversation_id = turn.conversation.conversation_id
        cookies = dict(client.cookies)
    # New engine and application, same on-disk DB; no in-memory fixture repository.
    reopened = Database(settings.database_url)
    try:
        with TestClient(create_app(settings=settings, database=reopened)) as client:
            client.cookies.update(cookies)
            assert client.get("/api/session").status_code == 200
            conversation = client.get(f"/api/agent/conversations/{conversation_id}")
            assert conversation.status_code == 200
            assert "模型 API 未配置" in str(conversation.json())
            source = client.get(
                f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}/source"
            )
            assert source.status_code == 200
            assert source.json()["segments"][0]["text"] == "Persisted real private source"
    finally:
        reopened.engine.dispose()
