"""Isolated tests only: temporary SQLite and HTTP fake transports, never Stripe."""

import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete, func, select

from qunxue_api.adapters.commerce_config import CommerceSettings, build_model_catalog
from qunxue_api.adapters.sqlite.base import Base
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.identity_model import UserRow
from qunxue_api.adapters.sqlite.subscriptions import (
    SqliteSubscriptionRepository,
    SubscriptionCheckoutRow,
    SubscriptionRow,
    SubscriptionWebhookRow,
    has_open_billing_commitment,
)
from qunxue_api.adapters.stripe_subscriptions import StripeSubscriptionGateway
from qunxue_api.api.dependencies import get_current_session
from qunxue_api.api.routes.commerce import router
from qunxue_api.application.subscriptions import SubscriptionApplication
from qunxue_api.modules.subscriptions import PaymentProviderError
from qunxue_api.settings import Settings


def install_commerce(
    app: FastAPI,
    database: Database,
    runtime,
    *,
    config: CommerceSettings | None = None,
    transport: httpx.BaseTransport | None = None,
) -> None:
    config = config or CommerceSettings()

    @contextmanager
    def repository_scope():
        with database.session() as session:
            yield SqliteSubscriptionRepository(session)

    app.state.model_catalog = build_model_catalog(runtime, config)
    app.state.subscription_application = SubscriptionApplication(
        repository_scope,
        StripeSubscriptionGateway(config, transport=transport),
        plans=config.plans(),
        unavailable_reason=config.unavailable_reason,
        success_url=config.stripe_success_url,
        cancel_url=config.stripe_cancel_url,
        portal_return_url=config.stripe_portal_return_url,
    )
    app.include_router(router)


NOW = datetime(2026, 10, 2, tzinfo=UTC)
WEBHOOK_SECRET = "whsec_isolated_fake_only"


def config(**changes):
    return CommerceSettings(
        _env_file=None,
        **(
            {
                "stripe_enabled": True,
                "stripe_secret_key": "sk_test_isolated_fake_only",
                "stripe_webhook_secret": WEBHOOK_SECRET,
                "stripe_success_url": "https://everplain.example/success",
                "stripe_cancel_url": "https://everplain.example/cancel",
                "subscription_plans": [
                    {"id": "personal", "name": "个人方案", "price_id": "price_fake"},
                    {"id": "other", "name": "其他方案", "price_id": "price_other"},
                ],
            }
            | changes
        ),
    )


def signature(payload, timestamp=None):
    timestamp = int(NOW.timestamp()) if timestamp is None else timestamp
    signed = str(timestamp).encode() + b"." + payload
    digest = hmac.new(WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1=invalid,v1={digest}"


def event(event_id="evt_one", **changes):
    return json.dumps(
        {
            "id": event_id,
            "type": "customer.subscription.updated",
            "livemode": False,
            "created": int(NOW.timestamp()),
            "data": {"object": {"id": "sub_one"}},
            **changes,
        },
        separators=(",", ":"),
    ).encode()


@pytest.fixture
def store(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'commerce-test.db'}")
    Base.metadata.create_all(
        db.engine,
        tables=[
            UserRow.__table__,
            SubscriptionRow.__table__,
            SubscriptionCheckoutRow.__table__,
            SubscriptionWebhookRow.__table__,
        ],
    )
    users = [uuid4(), uuid4()]
    with db.session() as session:
        for index, user_id in enumerate(users):
            session.add(
                UserRow(
                    user_id=str(user_id),
                    email=f"user{index}@example.test",
                    password_hash="unused",
                    created_at=NOW,
                    updated_at=NOW,
                )
            )
    yield db, users
    db.engine.dispose()


def subscription(user, **changes):
    return {
        "id": "sub_one",
        "customer": "cus_one",
        "status": "active",
        "created": 1780000000,
        "metadata": {"everplain_user_id": str(user)},
        "cancel_at_period_end": False,
        "items": {"data": [{"price": {"id": "price_fake"}, "current_period_end": 1800000000}]},
        **changes,
    }


def make_client(db, transport, settings=None):
    app = FastAPI()
    install_commerce(
        app,
        db,
        Settings(_env_file=None, runtime_mode="mock"),
        config=settings or config(),
        transport=transport,
    )
    app.state.subscription_application.clock = lambda: NOW

    def current(request: Request):
        user = request.headers.get("X-Test-User")
        if not user:
            raise HTTPException(401, "login required")
        from uuid import UUID

        return SimpleNamespace(user=SimpleNamespace(user_id=UUID(user)))

    app.dependency_overrides[get_current_session] = current
    return TestClient(app)


def headers(user, key="checkout-key-one"):
    return {"X-Test-User": str(user), "Idempotency-Key": key}


def test_missing_configuration_and_authenticated_secret_free_reads(store):
    db, users = store
    with make_client(
        db,
        httpx.MockTransport(lambda _: pytest.fail("network attempted")),
        CommerceSettings(_env_file=None),
    ) as client:
        for path in ("/api/models", "/api/subscription"):
            assert client.get(path).status_code == 401
        overview = client.get("/api/subscription", headers=headers(users[0]))
        assert overview.status_code == 200
        payload = overview.json()
        assert payload["available"] is False
        assert payload["unavailable_reason"] == "订阅支付尚未启用"
        assert payload["subscription"] is None
        assert [plan["id"] for plan in payload["plans"]] == ["plus", "pro", "max"]
        assert [plan["weekly_points"] for plan in payload["plans"]] == [200, 400, 1000]
        assert all(plan["period_days"] == 28 for plan in payload["plans"])
        assert client.get("/api/models", headers=headers(users[0])).json() == {"items": []}
        response = client.post(
            "/api/subscription/checkout", json={"plan_id": "personal"}, headers=headers(users[0])
        )
        assert response.status_code == 503


def test_checkout_is_owned_durable_idempotent_and_has_server_controlled_inputs(store):
    db, users = store
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url == "https://api.stripe.com/v1/checkout/sessions"
        return httpx.Response(
            200,
            json={
                "id": f"cs_{len(calls)}",
                "url": "https://checkout.stripe.com/c/pay/fake",
            },
        )

    transport = httpx.MockTransport(handler)
    with make_client(db, transport) as client:
        body = {"plan_id": "personal"}
        first = client.post("/api/subscription/checkout", json=body, headers=headers(users[0]))
        assert first.status_code == 200, first.text
        assert (
            client.get("/api/subscription", headers=headers(users[0])).json()["subscription"]
            is None
        )
        injected = body | {"user_id": str(users[1]), "price_id": "price_injected"}
        assert (
            client.post(
                "/api/subscription/checkout", json=injected, headers=headers(users[0])
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/subscription/checkout", json={"plan_id": "unknown"}, headers=headers(users[0])
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/subscription/checkout", json={"plan_id": "other"}, headers=headers(users[0])
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/api/subscription/checkout", json=body, headers=headers(users[0], "different-key")
            ).status_code
            == 409
        )
    # New app instance, same durable SQLite. No provider call on a successful replay.
    with make_client(db, transport) as restarted:
        replay = restarted.post("/api/subscription/checkout", json=body, headers=headers(users[0]))
        assert replay.json() == first.json()
        other = restarted.post("/api/subscription/checkout", json=body, headers=headers(users[1]))
        assert other.status_code == 200
    assert len(calls) == 2
    first_data = parse_qs(calls[0].content.decode())
    assert first_data["subscription_data[metadata][everplain_user_id]"] == [str(users[0])]
    assert first_data["line_items[0][price]"] == ["price_fake"]
    assert calls[0].headers["Idempotency-Key"] != calls[1].headers["Idempotency-Key"]
    assert "sk_test_" not in first.text


def test_timeout_retry_uses_reserved_parameters_even_after_config_change(store):
    db, users = store
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("fake timeout", request=request)
        return httpx.Response(
            200, json={"id": "cs_retry", "url": "https://checkout.stripe.com/fake"}
        )

    transport = httpx.MockTransport(handler)
    with make_client(db, transport) as client:
        failed = client.post(
            "/api/subscription/checkout", json={"plan_id": "personal"}, headers=headers(users[0])
        )
        assert failed.status_code == 502
    changed = config(
        subscription_plans=[{"id": "personal", "name": "个人", "price_id": "price_new"}]
    )
    with make_client(db, transport, changed) as client:
        result = client.post(
            "/api/subscription/checkout", json={"plan_id": "personal"}, headers=headers(users[0])
        )
        assert result.status_code == 200
    assert calls[0].content == calls[1].content
    assert calls[0].headers["Idempotency-Key"] == calls[1].headers["Idempotency-Key"]


@pytest.mark.parametrize("kind", ["tamper", "stale", "future", "mode", "connect", "missing"])
def test_bad_webhooks_cannot_trigger_remote_calls_or_mutations(store, kind):
    db, _users = store
    payload = event(livemode=True) if kind == "mode" else event()
    if kind == "connect":
        payload = event(account="acct_another")
    stamp = int(NOW.timestamp()) + {"stale": -301, "future": 301}.get(kind, 0)
    sig = signature(payload, stamp)
    if kind == "tamper":
        payload += b" "
    if kind == "missing":
        sig = ""
    with make_client(db, httpx.MockTransport(lambda _: pytest.fail("network attempted"))) as client:
        response = client.post(
            "/api/subscription/webhook", content=payload, headers={"Stripe-Signature": sig}
        )
        assert response.status_code == 400
    with db.session() as session:
        assert session.scalar(select(func.count()).select_from(SubscriptionWebhookRow)) == 0


def test_webhook_deduplicates_durably_and_reads_current_state_for_out_of_order_events(store):
    db, users = store
    remote = subscription(users[0])
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url == "https://api.stripe.com/v1/subscriptions/sub_one"
        return httpx.Response(200, json=remote)

    transport = httpx.MockTransport(handler)
    first = event()
    with make_client(db, transport) as client:
        result = client.post(
            "/api/subscription/webhook",
            content=first,
            headers={"Stripe-Signature": signature(first)},
        )
        assert result.json() == {"received": True, "duplicate": False}
        assert (
            client.get("/api/subscription", headers=headers(users[1])).json()["subscription"]
            is None
        )
    with make_client(db, transport) as client:
        replay = client.post(
            "/api/subscription/webhook",
            content=first,
            headers={"Stripe-Signature": signature(first)},
        )
        assert replay.json()["duplicate"] is True
        assert len(calls) == 1
        for index, status in enumerate(("past_due", "unpaid", "canceled")):
            remote["status"] = status
            # Older event snapshot says active; only current provider state is applied.
            old_event = event(
                f"evt_late{index}",
                created=1,
                data={"object": {"id": "sub_one", "status": "active"}},
            )
            assert (
                client.post(
                    "/api/subscription/webhook",
                    content=old_event,
                    headers={"Stripe-Signature": signature(old_event)},
                ).status_code
                == 200
            )
            overview = client.get("/api/subscription", headers=headers(users[0]))
            assert overview.json()["subscription"]["status"] == status
            assert "customer" not in overview.text and "price_fake" not in overview.text


def test_failed_webhook_rolls_back_claim_and_cross_owner_reassignment_is_rejected(store):
    db, users = store
    remote = subscription(users[0])
    fail = True

    def handler(request):
        if fail:
            return httpx.Response(503, json={"error": "fake provider failure"})
        return httpx.Response(200, json=remote)

    with make_client(db, httpx.MockTransport(handler)) as client:
        payload = event()
        response = client.post(
            "/api/subscription/webhook",
            content=payload,
            headers={"Stripe-Signature": signature(payload)},
        )
        assert response.status_code == 502
        fail = False
        response = client.post(
            "/api/subscription/webhook",
            content=payload,
            headers={"Stripe-Signature": signature(payload)},
        )
        assert response.json()["duplicate"] is False
        remote["metadata"]["everplain_user_id"] = str(users[1])
        wrong = event("evt_wrongowner")
        response = client.post(
            "/api/subscription/webhook",
            content=wrong,
            headers={"Stripe-Signature": signature(wrong)},
        )
        assert response.status_code == 409
        assert (
            client.get("/api/subscription", headers=headers(users[0])).json()["subscription"][
                "status"
            ]
            == "active"
        )
        assert (
            client.get("/api/subscription", headers=headers(users[1])).json()["subscription"]
            is None
        )
    with db.session() as session:
        assert session.scalar(select(func.count()).select_from(SubscriptionWebhookRow)) == 1


def test_account_deletion_cascades_and_delayed_webhook_does_not_restore_data(store):
    db, users = store
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=subscription(users[0])))
    with make_client(db, transport) as client:
        payload = event()
        assert (
            client.post(
                "/api/subscription/webhook",
                content=payload,
                headers={"Stripe-Signature": signature(payload)},
            ).status_code
            == 200
        )
        with db.session() as session:
            session.execute(delete(UserRow).where(UserRow.user_id == str(users[0])))
        delayed = event("evt_delayed")
        assert (
            client.post(
                "/api/subscription/webhook",
                content=delayed,
                headers={"Stripe-Signature": signature(delayed)},
            ).status_code
            == 200
        )
    with db.session() as session:
        assert session.scalar(select(func.count()).select_from(SubscriptionRow)) == 0


def test_model_catalog_has_only_runtime_models_and_explicit_capabilities(monkeypatch):
    monkeypatch.setenv("QUNXUE_STRIPE_ENABLED", "true")
    assert CommerceSettings(_env_file=None).stripe_enabled is False
    runtime = Settings(
        _env_file=None,
        runtime_mode="base",
        model_name="private-model",
        model_base_url="https://models.example",
        model_api_key=SecretStr("fake-key"),
    )
    catalog = build_model_catalog(runtime, CommerceSettings(_env_file=None))
    assert len(catalog) == 1
    assert catalog[0].model == "private-model" and catalog[0].capabilities == ("chat",)
    assert catalog[0].availability == "configured"
    runtime.runtime_mode = "mock"
    assert (
        build_model_catalog(runtime, CommerceSettings(_env_file=None))[0].availability
        == "unavailable"
    )
    configured = CommerceSettings(
        _env_file=None,
        model_catalog=[
            {
                "id": "main",
                "source": "chat:primary",
                "display_name": "主模型",
                "capabilities": ["chat", "tools"],
            },
            {
                "id": "missing",
                "source": "transcription",
                "display_name": "未配置模型",
                "capabilities": ["transcription"],
            },
        ],
    )
    assert [value.id for value in build_model_catalog(runtime, configured)] == ["main"]
    assert "fake-key" not in repr(build_model_catalog(runtime, configured))


def test_config_and_provider_response_validation():
    with pytest.raises(ValidationError):
        config(stripe_success_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        config(
            subscription_plans=[
                {"id": "a", "name": "A", "price_id": "price_x"},
                {"id": "b", "name": "B", "price_id": "price_x"},
            ]
        )
    assert config(stripe_webhook_secret=None).unavailable_reason is not None
    gateway = StripeSubscriptionGateway(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"id": "cs_unsafe", "url": "https://evil.example"}),
        ),
    )
    from qunxue_api.modules.subscriptions import CheckoutIntent

    with pytest.raises(PaymentProviderError):
        gateway.create_checkout(
            CheckoutIntent("key", uuid4(), "personal", "price_fake", "", "", NOW)
        )


def test_replay_window_does_not_create_another_remote_checkout(store):
    db, users = store
    now = NOW
    calls = []

    @contextmanager
    def scope():
        with db.session() as session:
            yield SqliteSubscriptionRepository(session)

    class Gateway:
        def create_checkout(self, intent):
            calls.append(intent)
            raise PaymentProviderError("fake uncertain response")

    from qunxue_api.modules.subscriptions import SubscriptionConflict

    app = SubscriptionApplication(
        scope,
        Gateway(),
        plans=config().plans(),
        unavailable_reason=None,
        success_url="",
        cancel_url="",
        clock=lambda: now,
    )
    with pytest.raises(PaymentProviderError):
        app.checkout(users[0], "personal", "same-request-key")
    now += timedelta(minutes=26)
    with pytest.raises(SubscriptionConflict):
        app.checkout(users[0], "personal", "same-request-key")
    assert len(calls) == 1


def test_huge_signature_timestamp_is_rejected_as_invalid(store):
    db, _users = store
    payload = event()
    sig = "t=" + "9" * 2000 + ",v1=" + "a" * 64
    with make_client(db, httpx.MockTransport(lambda _: pytest.fail("network attempted"))) as client:
        response = client.post(
            "/api/subscription/webhook", content=payload, headers={"Stripe-Signature": sig}
        )
        assert response.status_code == 400


def test_live_credential_cannot_enable_test_mode(store):
    db, users = store
    settings = config(stripe_secret_key="sk_live_fake_mismatched")
    assert settings.unavailable_reason == "订阅支付密钥与运行模式不一致"
    with make_client(
        db, httpx.MockTransport(lambda _: pytest.fail("network attempted")), settings
    ) as client:
        response = client.post(
            "/api/subscription/checkout", json={"plan_id": "personal"}, headers=headers(users[0])
        )
        assert response.status_code == 503


def test_account_erasure_guard_covers_active_subscriptions_and_pending_checkout(store):
    db, users = store
    with db.session() as session:
        assert has_open_billing_commitment(session, users[0], NOW) is False
    with make_client(db, httpx.MockTransport(lambda _: httpx.Response(503))) as client:
        assert (
            client.post(
                "/api/subscription/checkout",
                json={"plan_id": "personal"},
                headers=headers(users[0]),
            ).status_code
            == 502
        )
    with db.session() as session:
        assert has_open_billing_commitment(session, users[0], NOW) is True
        assert has_open_billing_commitment(session, users[1], NOW) is False
        assert has_open_billing_commitment(session, users[0], NOW + timedelta(hours=2)) is False
    with make_client(
        db, httpx.MockTransport(lambda _: httpx.Response(200, json=subscription(users[0])))
    ) as client:
        payload = event()
        assert (
            client.post(
                "/api/subscription/webhook",
                content=payload,
                headers={"Stripe-Signature": signature(payload)},
            ).status_code
            == 200
        )
    with db.session() as session:
        assert has_open_billing_commitment(session, users[0], NOW + timedelta(hours=2)) is True


def test_portal_uses_only_current_users_customer_and_configured_return_url(store):
    db, users = store
    calls = []

    def handler(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=subscription(users[0]))
        assert request.url == "https://api.stripe.com/v1/billing_portal/sessions"
        return httpx.Response(200, json={"url": "https://billing.stripe.com/p/session/fake"})

    settings = config(stripe_portal_return_url="https://everplain.example/account")
    with make_client(db, httpx.MockTransport(handler), settings) as client:
        assert client.post("/api/subscription/portal").status_code == 401
        assert client.post("/api/subscription/portal", headers=headers(users[0])).status_code == 409
        payload = event()
        assert (
            client.post(
                "/api/subscription/webhook",
                content=payload,
                headers={"Stripe-Signature": signature(payload)},
            ).status_code
            == 200
        )
        assert client.post("/api/subscription/portal", headers=headers(users[1])).status_code == 409
        hostile = client.post(
            "/api/subscription/portal",
            headers=headers(users[0]),
            json={"customer": "cus_other", "return_url": "https://evil.example"},
        )
        assert hostile.status_code == 422
        result = client.post("/api/subscription/portal", headers=headers(users[0]))
        assert result.json() == {"portal_url": "https://billing.stripe.com/p/session/fake"}
        assert parse_qs(calls[-1].content.decode()) == {
            "customer": ["cus_one"],
            "return_url": ["https://everplain.example/account"],
        }
        assert len(calls) == 2
    # No portal URL configured means no request, even for an existing subscription.
    with make_client(db, httpx.MockTransport(lambda _: pytest.fail("network attempted"))) as client:
        assert client.post("/api/subscription/portal", headers=headers(users[0])).status_code == 503


def test_portal_failure_and_untrusted_redirect_are_not_exposed(store):
    db, users = store
    fail = False
    invalid = False

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json=subscription(users[0]))
        if fail:
            return httpx.Response(503, json={"error": "private provider details"})
        return httpx.Response(200, json={"url": "https://evil.example" if invalid else None})

    with make_client(
        db,
        httpx.MockTransport(handler),
        config(stripe_portal_return_url="https://everplain.example/account"),
    ) as client:
        payload = event()
        assert (
            client.post(
                "/api/subscription/webhook",
                content=payload,
                headers={"Stripe-Signature": signature(payload)},
            ).status_code
            == 200
        )
        for values in [(True, False), (False, True), (False, False)]:
            fail, invalid = values
            response = client.post("/api/subscription/portal", headers=headers(users[0]))
            assert response.status_code == 502
            assert "private provider" not in response.text and "evil.example" not in response.text
