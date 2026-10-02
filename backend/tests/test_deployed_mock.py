"""Explicit public demo mocks providers, never authentication or verification mail."""

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings


def test_demo_clears_paid_provider_routes_but_preserves_real_email():
    settings = Settings(
        _env_file=None,
        demo_mode=True,
        runtime_mode="mock",
        model_api_key="fixture-model-key",
        model_base_url="",
        model_name="",
        embedding_api_key="fixture-embedding",
        embedding_base_url="https://retrieval.example.invalid",
        embedding_model="fixture-embedding-model",
        reranker_api_key="fixture-reranker",
        vision_api_key="fixture-vision",
        transcription_api_key="fixture-transcription",
        web_search_api_key="fixture-search",
        resend_api_key="fixture-real-email-key",
        email_from="Everplain <hello@example.invalid>",
    )
    assert not settings.has_model_api_key
    assert settings.model_name is None
    assert settings.embedding_api_key is None
    assert settings.embedding_base_url is None
    assert settings.reranker_api_key is None
    assert settings.transcription_api_key is None
    assert settings.vision_api_key is None
    assert settings.web_search_api_key is None
    assert settings.model_fallbacks == []
    assert not settings.memory_learning_enabled
    assert settings.has_resend_api_key
    assert settings.resend_api_key.get_secret_value() == "fixture-real-email-key"
    assert settings.max_file_bytes == 5 * 1024 * 1024
    assert settings.max_storage_bytes == 50 * 1024 * 1024


def test_demo_cannot_be_combined_with_real_runtime():
    with pytest.raises(ValidationError, match="demo mode requires"):
        Settings(_env_file=None, demo_mode=True, runtime_mode="base")


def test_deployed_mock_has_no_probe_and_preserves_authentication(plain_client):
    settings = Settings(
        _env_file=None,
        demo_mode=True,
        runtime_mode="mock",
        database_url=plain_client.app.state.settings.database_url,
        model_api_key="fixture-leftover-key",
        model_base_url="https://model.example.invalid",
        model_name="fixture-model",
        embedding_api_key="fixture-partial-key",
        release_revision="mock-demo-test",
    )

    def reject_provider_call(request):
        raise AssertionError("demo must never call a real provider")

    app = create_app(
        settings=settings,
        database=plain_client.app.state.database,
        model_probe_transport=httpx.MockTransport(reject_provider_call),
    )
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["runtime_mode"] == "mock"
        assert response.json()["release_revision"] == "mock-demo-test"
        assert app.state.model_endpoints == ()
        assert app.state.model_router is None
        assert app.state.model_probe_task is None
        assert client.get("/api/session").status_code == 401
        # A claimed email never authenticates a visitor or provisions an administrator.
        result = client.post(
            "/api/session/register",
            json={
                "email": "claimed-owner@example.invalid",
                "password": "fixture-password-123",
                "display_name": "Visitor",
                "verification_code": "000000",
            },
            headers={"Idempotency-Key": "mock-auth-test"},
        )
        assert result.status_code == 422
        assert not getattr(app.state, "account_management_installed", False)
