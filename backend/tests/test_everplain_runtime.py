"""Product boundaries: no inherited public knowledge or cross-product defaults."""

from qunxue_api.settings import Settings


def test_everplain_environment_controls_independent_storage(monkeypatch, tmp_path):
    target = f"sqlite:///{tmp_path / 'everplain.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", target)
    settings = Settings(_env_file=None)
    assert settings.database_url == target
    assert settings.session_cookie_name != "qunxue_session"
    assert settings.web_search_profile == "generic"


def test_personal_instance_has_no_public_catalog_routes(plain_client):
    for path in ["/api/knowledge", "/api/knowledge/graph", "/api/phenomena/examples"]:
        assert plain_client.get(path).status_code == 404
    assert not any(
        path.startswith("/api/knowledge/") for path in plain_client.app.openapi()["paths"]
    )


def test_health_does_not_publish_a_discipline_release(plain_client):
    response = plain_client.get("/api/health")
    assert response.status_code == 200, response.text
    assert response.json()["knowledge_release_id"] is None
    assert response.json()["service"] == "Everplain API"


def test_legacy_environment_cannot_override_personal_instance(monkeypatch, tmp_path):
    config = tmp_path / ".env"
    target = f"sqlite:///{tmp_path / 'personal.db'}"
    config.write_text(f"EVERPLAIN_DATABASE_URL={target}\n")
    monkeypatch.setenv("QUNXUE_DATABASE_URL", "sqlite:///other-product.db")
    monkeypatch.setenv("QUNXUE_SESSION_COOKIE_NAME", "other_product_session")
    monkeypatch.setenv("QUNXUE_ACCOUNT_INITIAL_ADMIN_EMAIL", "other@example.com")
    settings = Settings(_env_file=config)
    assert settings.database_url == target
    assert settings.session_cookie_name == "everplain_session"
    assert settings.account_initial_admin_email == ""
