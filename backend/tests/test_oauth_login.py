"""Synthetic provider traffic and real Authlib/JWKS verification; no third-party accounts."""

import logging
from base64 import urlsafe_b64encode
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import copy
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from time import time
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx2 as httpx
import pytest
from joserfc import jwt
from joserfc.jwk import RSAKey
from pydantic import SecretStr
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from qunxue_api.adapters.oauth import OAuthClients
from qunxue_api.adapters.sqlite import UserRow, UserSessionRow
from qunxue_api.adapters.sqlite.account_management_model import AccountPasswordResetRow
from qunxue_api.adapters.sqlite.billing_model import CreditLedgerRow
from qunxue_api.adapters.sqlite.oauth_model import FederatedIdentityRow, OAuthTransactionRow
from qunxue_api.adapters.sqlite.oauth_transactions import OAuthTransactions
from qunxue_api.bootstrap import oauth_client_configuration
from qunxue_api.settings import Settings

ORIGIN = "http://localhost:5196"


class Provider:
    def __init__(self, client):
        self.key = RSAKey.generate_key(2048, parameters={"kid": "synthetic-key"})
        self.claims = {}
        self.signing_key = self.key
        self.subject = "synthetic-subject"
        self.email = "oauth@example.com"
        self.display_name = "Platform Display Name"
        self.github_id = 12345
        self.github_scope = "user:email"
        self.github_verified = True
        self.code_params = {}
        self.exchanges = []
        clients = OAuthClients(
            oauth_client_configuration(
                Settings(
                    _env_file=None,
                    oauth_public_origin=ORIGIN,
                    oauth_google_client_id="synthetic-google-client",
                    oauth_google_client_secret=SecretStr("synthetic-test-only"),
                    oauth_github_client_id="synthetic-github-client",
                    oauth_github_client_secret=SecretStr("synthetic-test-only"),
                )
            )
        )
        client.app.state.oauth_clients = clients
        for name in clients.enabled:
            remote = clients.client(name)
            remote.client_kwargs["transport"] = httpx.MockTransport(self.http)

    def http(self, request):
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": "https://accounts.google.com",
                    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
                    "token_endpoint": "https://oauth2.googleapis.com/token",
                    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
                    "id_token_signing_alg_values_supported": ["RS256"],
                },
            )
        if path == "/oauth2/v3/certs":
            return httpx.Response(200, json={"keys": [self.key.as_dict(private=False)]})
        if path in {"/token", "/login/oauth/access_token"}:
            data = parse_qs(request.content.decode())
            self.exchanges.append(data)
            assert data["redirect_uri"][0].startswith(ORIGIN + "/api/session/oauth/")
            assert data["code_verifier"][0] == self.code_params[data["code"][0]]["verifier"]
            assert request.headers.get("Accept") == "application/json"
            if path == "/login/oauth/access_token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "synthetic-access",
                        "token_type": "Bearer",
                        "scope": self.github_scope,
                    },
                )
            claims = dict(
                iss="https://accounts.google.com",
                aud="synthetic-google-client",
                sub=self.subject,
                exp=int(time()) + 120,
                iat=int(time()),
                email=self.email,
                email_verified=True,
                name=self.display_name,
                nonce=self.code_params[data["code"][0]]["nonce"],
            )
            claims.update(self.claims)
            for key in list(claims):
                if claims[key] is None:
                    del claims[key]
            return httpx.Response(
                200,
                json={
                    "access_token": "synthetic-access",
                    "token_type": "Bearer",
                    "id_token": jwt.encode(
                        {"alg": "RS256", "kid": "synthetic-key"}, claims, self.signing_key
                    ),
                },
            )
        if path == "/user":
            return httpx.Response(
                200,
                json={
                    "id": self.github_id,
                    "email": "untrusted@example.com",
                    "name": self.display_name,
                    "login": "platform-handle",
                },
            )
        if path == "/user/emails":
            return httpx.Response(
                200, json=[{"email": self.email, "primary": True, "verified": self.github_verified}]
            )
        raise AssertionError(f"unexpected synthetic endpoint: {request.url}")

    def start(self, client, provider="google", *, link=False, return_path="/library"):
        response = client.post(
            f"/api/session/oauth/{provider}/{'link' if link else 'start'}",
            headers={"Origin": ORIGIN},
            json={"return_path": return_path},
        )
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        params = parse_qs(urlsplit(response.json()["authorization_url"]).query)
        assert params["code_challenge_method"] == ["S256"]
        assert params["scope"] == ["openid email profile" if provider == "google" else "user:email"]
        assert params["redirect_uri"] == [ORIGIN + f"/api/session/oauth/{provider}/callback"]
        if provider == "google":
            url = urlsplit(response.json()["authorization_url"])
            assert f"{url.scheme}://{url.netloc}{url.path}" == (
                "https://accounts.google.com/o/oauth2/v2/auth"
            )
            assert params["access_type"] == ["online"]
            assert params["prompt"] == ["select_account"]
            assert "client_secret" not in params
        with client.app.state.database.session() as db:
            row = db.scalar(
                select(OAuthTransactionRow).order_by(OAuthTransactionRow.expires_at.desc())
            )
            challenge = (
                urlsafe_b64encode(sha256(row.code_verifier.encode()).digest()).rstrip(b"=").decode()
            )
            assert params["code_challenge"] == [challenge]
            if provider == "google":
                assert params["nonce"] == [row.nonce]
            code = str(uuid4())
            self.code_params[code] = {"verifier": row.code_verifier, "nonce": row.nonce}
        return params["state"][0], code

    def finish(self, client, state, code, provider="google"):
        return client.get(
            f"/api/session/oauth/{provider}/callback",
            params={"state": state, "code": code},
            follow_redirects=False,
        )


def counts(client):
    with client.app.state.database.session() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (UserRow, UserSessionRow, FederatedIdentityRow)
        )


def register(client, email="oauth@example.com"):
    response = client.post(
        "/api/session/register",
        headers={"Idempotency-Key": str(uuid4())},
        json={"email": email, "password": "email-passphrase"},
    )
    assert response.status_code == 201
    return response.json()


def test_unconfigured_providers_are_hidden_and_not_startable(plain_client):
    response = plain_client.get("/api/session/oauth/providers")
    assert response.json() == {"providers": []}
    assert response.headers["cache-control"] == "no-store"
    assert plain_client.post("/api/session/oauth/google/start", json={}).status_code == 403


def test_google_start_does_not_require_provider_network_even_on_cold_start(plain_client):
    mock = Provider(plain_client)
    remote = plain_client.app.state.oauth_clients.client("google")
    requests = []

    def unavailable(request):
        requests.append(request)
        raise httpx.ConnectTimeout("synthetic-discovery-connect-timeout", request=request)

    remote.client_kwargs["transport"] = httpx.MockTransport(unavailable)
    previous_state = None
    for _ in range(2):
        state, _code = mock.start(plain_client)
        assert state != previous_state
        previous_state = state
        assert plain_client.cookies.get("everplain_oauth_google")
    assert requests == []
    assert counts(plain_client) == (0, 0, 0)


def test_google_login_uses_official_token_and_jwks_endpoints_without_discovery(plain_client):
    mock = Provider(plain_client)
    remote = plain_client.app.state.oauth_clients.client("google")
    assert remote.server_metadata["issuer"] == "https://accounts.google.com"
    assert remote.server_metadata["id_token_signing_alg_values_supported"] == ["RS256"]
    requests = []

    def provider_without_discovery(request):
        requests.append((request.method, str(request.url)))
        if request.url.path == "/.well-known/openid-configuration":
            raise httpx.ConnectTimeout("synthetic-discovery-connect-timeout", request=request)
        return mock.http(request)

    remote.client_kwargs["transport"] = httpx.MockTransport(provider_without_discovery)
    state, code = mock.start(plain_client)
    assert requests == []
    assert mock.finish(plain_client, state, code).headers["location"] == "/library"
    assert counts(plain_client) == (1, 1, 1)
    assert requests == [
        ("POST", "https://oauth2.googleapis.com/token"),
        ("GET", "https://www.googleapis.com/oauth2/v3/certs"),
    ]


@pytest.mark.parametrize("provider", ["google", "github"])
def test_verified_login_grants_normal_cookie_once_and_preserves_user(plain_client, provider):
    mock = Provider(plain_client)
    assert plain_client.get("/api/session/oauth/providers").json()["providers"] == [
        "google",
        "github",
    ]
    state, code = mock.start(plain_client, provider)
    response = mock.finish(plain_client, state, code, provider)
    assert response.status_code == 303
    assert response.headers["location"] == "/library"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "synthetic-access" not in response.text + str(response.headers)
    assert counts(plain_client) == (1, 1, 1)
    first_user = plain_client.get("/api/session").json()["user"]["user_id"]
    replay = mock.finish(plain_client, state, code, provider)
    assert "invalid_flow" in replay.headers["location"]
    assert len(mock.exchanges) == 1
    plain_client.cookies.clear()
    mock.email = "changed-email@example.com"
    state, code = mock.start(plain_client, provider)
    assert mock.finish(plain_client, state, code, provider).headers["location"] == "/library"
    assert counts(plain_client) == (1, 2, 1)
    assert plain_client.get("/api/session").json()["user"]["user_id"] == first_user
    with plain_client.app.state.database.session() as db:
        grants = db.scalars(select(CreditLedgerRow).where(CreditLedgerRow.kind == "signup_grant"))
        assert sum(row.points for row in grants) == 30


@pytest.mark.parametrize(
    "claims",
    [
        {"iss": "https://evil.example"},
        {"aud": "another-client"},
        {"nonce": "wrong"},
        {"nonce": None},
        {"nonce": "wrong", "nonce_supported": False},
        {"exp": int(time()) - 120},
        {"exp": None},
        {"email_verified": False},
        {"email_verified": "true"},
        {"email_verified": 1},
        {"email": None},
        {"sub": None},
    ],
)
def test_google_rejects_invalid_signed_claims_without_creating_accounts(plain_client, claims):
    mock = Provider(plain_client)
    mock.claims = claims
    state, code = mock.start(plain_client)
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert counts(plain_client) == (0, 0, 0)


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "/%2f%2fevil.example",
        "/%5cevil.example",
        "/%0aevil",
        "/api/session",
    ],
)
def test_start_rejects_open_redirects(plain_client, path):
    Provider(plain_client)
    response = plain_client.post(
        "/api/session/oauth/google/start", headers={"Origin": ORIGIN}, json={"return_path": path}
    )
    assert response.status_code == 422


def test_browser_origin_state_binding_expiry_and_denied_callback(plain_client):
    mock = Provider(plain_client)
    assert (
        plain_client.post(
            "/api/session/oauth/google/start", headers={"Origin": "https://evil"}, json={}
        ).status_code
        == 403
    )
    assert plain_client.post("/api/session/oauth/google/start", json={}).status_code == 403
    state, code = mock.start(plain_client)
    browser = plain_client.cookies.get("everplain_oauth_google")
    plain_client.cookies.clear()
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert not mock.exchanges
    plain_client.cookies.set("everplain_oauth_google", browser, path="/api/session/oauth/google")
    with plain_client.app.state.database.session() as db:
        row = db.scalar(select(OAuthTransactionRow))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    state, code = mock.start(plain_client)
    denied = plain_client.get(
        "/api/session/oauth/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert "cancelled" in denied.headers["location"]
    assert counts(plain_client) == (0, 0, 0)
    assert not mock.exchanges


def test_same_email_creates_separate_provider_account_and_explicit_binding_still_works(
    plain_client,
):
    mock = Provider(plain_client)
    original = register(plain_client)
    original_id = original["user"]["user_id"]
    plain_client.cookies.clear()
    assert (
        plain_client.post(
            "/api/session/oauth/google/link", headers={"Origin": ORIGIN}, json={}
        ).status_code
        == 401
    )
    state, code = mock.start(plain_client)
    assert mock.finish(plain_client, state, code).headers["location"] == "/library"
    provider_user = plain_client.get("/api/session").json()["user"]
    assert provider_user["user_id"] != original_id
    assert provider_user["email"] is None and provider_user["login_mode"] == "federated"
    assert provider_user["display_name"] == mock.display_name
    assert counts(plain_client) == (2, 2, 1)
    plain_client.cookies.clear()
    local = plain_client.post(
        "/api/session/login",
        headers={"Idempotency-Key": str(uuid4())},
        json={"email": mock.email, "password": "email-passphrase"},
    )
    assert local.status_code == 200 and local.json()["user"]["user_id"] == original_id
    assert local.json()["user"]["login_mode"] == "email_password"
    state, code = mock.start(plain_client, link=True)
    assert "account_link_required" in mock.finish(plain_client, state, code).headers["location"]
    assert plain_client.get("/api/session/oauth/linked").json() == {"providers": []}
    mock.subject = "explicitly-linked-subject"
    state, code = mock.start(plain_client, link=True, return_path="/settings")
    assert mock.finish(plain_client, state, code).headers["location"] == "/settings"
    assert plain_client.get("/api/session/oauth/linked").json() == {"providers": ["google"]}
    plain_client.cookies.clear()
    state, code = mock.start(plain_client)
    assert mock.finish(plain_client, state, code).headers["location"] == "/library"
    assert plain_client.get("/api/session").json()["user"]["user_id"] == original_id


def test_google_and_github_same_contact_email_remain_separate_accounts(plain_client):
    mock = Provider(plain_client)
    users = []
    for provider in ("google", "github"):
        plain_client.cookies.clear()
        state, code = mock.start(plain_client, provider)
        assert mock.finish(plain_client, state, code, provider).headers["location"] == "/library"
        user = plain_client.get("/api/session").json()["user"]
        users.append(user["user_id"])
        assert user["email"] is None and user["login_mode"] == "federated"
        assert user["display_name"] == mock.display_name
        assert plain_client.get("/api/session/oauth/linked").json() == {"providers": [provider]}
    assert users[0] != users[1] and counts(plain_client) == (2, 2, 2)
    with plain_client.app.state.database.session() as db:
        assert {row.verified_email for row in db.scalars(select(FederatedIdentityRow))} == {
            mock.email
        }
        assert sum(db.scalars(select(CreditLedgerRow.points))) == 60
    plain_client.cookies.clear()
    assert (
        plain_client.post(
            "/api/session/login",
            headers={"Idempotency-Key": str(uuid4())},
            json={"email": mock.email, "password": "guessed-password"},
        ).status_code
        == 401
    )
    assert register(plain_client)["user"]["user_id"] not in users


def test_link_requires_the_original_live_session_and_cannot_take_other_identity(plain_client):
    mock = Provider(plain_client)
    state, code = mock.start(plain_client)
    mock.finish(plain_client, state, code)
    plain_client.cookies.clear()
    register(plain_client, "another@example.com")
    state, code = mock.start(plain_client, link=True)
    assert "account_link_required" in mock.finish(plain_client, state, code).headers["location"]
    assert counts(plain_client)[2] == 1
    mock.subject = "another-subject"
    state, code = mock.start(plain_client, link=True)
    plain_client.cookies.clear()
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert counts(plain_client)[2] == 1


@pytest.mark.parametrize("case", ["unverified", "broad_scope", "missing_subject"])
def test_github_rejects_unverified_identity_or_overbroad_access(plain_client, case):
    mock = Provider(plain_client)
    if case == "unverified":
        mock.github_verified = False
    elif case == "broad_scope":
        mock.github_scope = "user:email,repo"
    else:
        mock.github_id = None
    state, code = mock.start(plain_client, "github")
    assert "invalid_flow" in mock.finish(plain_client, state, code, "github").headers["location"]
    assert counts(plain_client) == (0, 0, 0)


def test_atomic_state_claim_and_concurrent_subject_login(plain_client):
    database = plain_client.app.state.database
    transactions = OAuthTransactions(database)
    state, browser, *_ = transactions.create(
        provider="google", return_path="/app", link_session_id=None
    )

    def claim(_):
        return transactions.consume(provider="google", state=state, browser=browser)

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(value is not None for value in pool.map(claim, range(4))) == 1

    def sign_in(_):
        with database.session() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            grant = plain_client.app.state.build_identity_service(db).login_federated(
                provider="google", subject="concurrent-subject", verified_email="race@example.com"
            )
            return grant.authenticated.user.user_id

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert len(set(pool.map(sign_in, range(4)))) == 1
    assert counts(plain_client) == (1, 4, 1)


def test_wrong_signature_and_disabled_users_cannot_log_in(plain_client):
    mock = Provider(plain_client)
    mock.signing_key = RSAKey.generate_key(2048, parameters={"kid": "synthetic-key"})
    state, code = mock.start(plain_client)
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert counts(plain_client) == (0, 0, 0)
    mock.signing_key = mock.key
    state, code = mock.start(plain_client)
    assert mock.finish(plain_client, state, code).headers["location"] == "/library"
    plain_client.cookies.clear()
    with plain_client.app.state.database.session() as db:
        user = db.scalar(select(UserRow))
        user.status = "disabled"
    state, code = mock.start(plain_client)
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert counts(plain_client) == (1, 1, 1)


def test_cross_provider_and_duplicate_callback_parameters_cannot_replay(plain_client):
    mock = Provider(plain_client)
    state, code = mock.start(plain_client)
    # Even transplanting the browser cookie cannot change the transaction's provider.
    browser = plain_client.cookies.get("everplain_oauth_google")
    plain_client.cookies.set("everplain_oauth_github", browser, path="/api/session/oauth/github")
    assert "invalid_flow" in mock.finish(plain_client, state, code, "github").headers["location"]
    assert not mock.exchanges
    response = plain_client.get(
        "/api/session/oauth/google/callback",
        params=[("state", state), ("code", code), ("code", "extra")],
        follow_redirects=False,
    )
    assert "invalid_flow" in response.headers["location"]
    assert not mock.exchanges
    assert counts(plain_client) == (0, 0, 0)
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]


def test_swapping_logged_in_account_cannot_complete_an_old_link(plain_client):
    mock = Provider(plain_client)
    register(plain_client, "first@example.com")
    state, code = mock.start(plain_client, link=True)
    # Preserve the OAuth binding cookie while replacing the application session.
    plain_client.cookies.delete("everplain_session")
    register(plain_client, "second@example.com")
    assert "invalid_flow" in mock.finish(plain_client, state, code).headers["location"]
    assert not mock.exchanges
    assert counts(plain_client) == (2, 2, 0)


def test_account_identity_and_grant_roll_back_together_on_failure(plain_client, monkeypatch):
    mock = Provider(plain_client)
    factory = plain_client.app.state.build_identity_service

    def broken(db):
        service = factory(db)

        def fail(_user):
            raise SQLAlchemyError("synthetic transaction failure")

        service._repository._on_user_created = fail
        return service

    monkeypatch.setattr(plain_client.app.state, "build_identity_service", broken)
    state, code = mock.start(plain_client)
    response = mock.finish(plain_client, state, code)
    assert "service_unavailable" in response.headers["location"]
    assert "synthetic transaction failure" not in response.text + str(response.headers)
    assert counts(plain_client) == (0, 0, 0)
    with plain_client.app.state.database.session() as db:
        assert db.scalar(select(func.count()).select_from(CreditLedgerRow)) == 0
        assert db.scalar(select(func.count()).select_from(OAuthTransactionRow)) == 0


@pytest.mark.parametrize(
    "origin",
    [
        "http://evil.example",
        "https://example.com/path",
        "https://user@example.com",
        "https://example.com?x=1",
        "https://example.com:bad",
        " https://example.com",
        "https://exa mple.com",
        "https://example.com:0",
    ],
)
def test_configuration_rejects_unsafe_public_origins(origin):
    with pytest.raises(ValueError):
        Settings(_env_file=None, oauth_public_origin=origin)


def test_partial_configuration_stays_disabled_and_https_needs_secure_cookies():
    assert (
        OAuthClients(
            oauth_client_configuration(
                Settings(
                    _env_file=None,
                    oauth_public_origin="https://example.com",
                    oauth_google_client_id="id-only",
                )
            )
        ).enabled
        == []
    )
    assert (
        OAuthClients(
            oauth_client_configuration(Settings(_env_file=None, oauth_public_origin=""))
        ).enabled
        == []
    )
    with pytest.raises(ValueError, match="secure"):
        OAuthClients(
            oauth_client_configuration(
                Settings(
                    _env_file=None,
                    oauth_public_origin="https://example.com",
                    oauth_google_client_id="synthetic",
                    oauth_google_client_secret=SecretStr("synthetic"),
                )
            )
        )


def test_oauth_only_account_cannot_gain_password_login_through_reset(plain_client, monkeypatch):
    mock = Provider(plain_client)
    state, code = mock.start(plain_client)
    mock.finish(plain_client, state, code)
    user_id = plain_client.get("/api/session").json()["user"]["user_id"]
    oauth_cookie = plain_client.cookies.get("everplain_session")
    assert (
        plain_client.post(
            f"/api/admin/users/{user_id}/password-reset-links",
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )
    assert (
        plain_client.post(
            "/api/account/password/change",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "current_password": "guessed-password",
                "new_password": "new-password-for-oauth",
                "revoke_other_sessions": True,
            },
        ).status_code
        == 401
    )
    original_scope = plain_client.app.state.account_management_service_scope

    @contextmanager
    def signing_scope():
        with original_scope() as service:
            service._password_reset_signing_secret = b"synthetic-reset-signing-only"
            yield service

    monkeypatch.setattr(plain_client.app.state, "account_management_service_scope", signing_scope)
    plain_client.cookies.clear()
    admin = register(plain_client, "synthetic-admin@example.com")
    with plain_client.app.state.database.session() as db:
        db.get(UserRow, admin["user"]["user_id"]).role = "admin"
    assert (
        plain_client.post(
            f"/api/admin/users/{user_id}/password-reset-links",
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 410
    )
    token = "synthetic-old-reset-token-for-oauth-only-account"
    now = datetime.now(UTC)
    with plain_client.app.state.database.session() as db:
        db.add(
            AccountPasswordResetRow(
                reset_id=str(uuid4()),
                user_id=user_id,
                token_digest=sha256(token.encode()).hexdigest(),
                requested_by_user_id=admin["user"]["user_id"],
                created_at=now,
                expires_at=now + timedelta(minutes=10),
                used_at=None,
            )
        )
    plain_client.cookies.clear()
    consumed = plain_client.post(
        "/api/account/password-resets/consume",
        headers={"Idempotency-Key": str(uuid4())},
        json={"token": token, "new_password": "new-password-for-oauth"},
    )
    assert consumed.status_code == 410
    with plain_client.app.state.database.session() as db:
        assert db.get(UserRow, user_id).password_hash == "!oauth-only"
        assert db.scalar(select(AccountPasswordResetRow)).used_at is None
    plain_client.cookies.set("everplain_session", oauth_cookie)
    assert plain_client.get("/api/session").status_code == 200
    plain_client.cookies.clear()
    assert (
        plain_client.post(
            "/api/session/login",
            headers={"Idempotency-Key": str(uuid4())},
            json={"email": mock.email, "password": "new-password-for-oauth"},
        ).status_code
        == 401
    )
    state, code = mock.start(plain_client)
    assert mock.finish(plain_client, state, code).headers["location"] == "/library"
    assert plain_client.get("/api/session").json()["user"]["user_id"] == user_id


def test_https_oauth_cookie_is_host_bound_and_plain_cookie_cannot_satisfy_state(plain_client):
    mock = Provider(plain_client)
    origin = "https://testserver"
    clients = OAuthClients(
        oauth_client_configuration(
            Settings(
                _env_file=None,
                oauth_public_origin=origin,
                session_cookie_secure=True,
                oauth_google_client_id="synthetic-google-client",
                oauth_google_client_secret=SecretStr("synthetic-test-only"),
            )
        )
    )
    clients.client("google").client_kwargs["transport"] = httpx.MockTransport(mock.http)
    plain_client.app.state.oauth_clients = clients
    plain_client.base_url = origin
    started = plain_client.post(
        "/api/session/oauth/google/start", headers={"Origin": origin}, json={}
    )
    assert started.status_code == 200
    cookie = started.headers["set-cookie"]
    assert cookie.startswith("__Host-everplain_oauth_google=")
    assert "Path=/;" in cookie and "Secure" in cookie and "HttpOnly" in cookie
    assert "SameSite=lax" in cookie and "Domain=" not in cookie
    state = parse_qs(urlsplit(started.json()["authorization_url"]).query)["state"][0]
    browser = plain_client.cookies.get("__Host-everplain_oauth_google")
    original_cookie = copy(
        next(
            cookie
            for cookie in plain_client.cookies.jar
            if cookie.name == "__Host-everplain_oauth_google"
        )
    )
    plain_client.cookies.clear()
    # A transplanted legacy unprefixed cookie is never used in HTTPS mode.
    plain_client.cookies.set("everplain_oauth_google", browser, path="/")
    rejected = plain_client.get(
        "/api/session/oauth/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert "invalid_flow" in rejected.headers["location"]
    assert rejected.headers["set-cookie"].startswith("__Host-everplain_oauth_google=")
    assert "Path=/;" in rejected.headers["set-cookie"]
    assert "Secure" in rejected.headers["set-cookie"]
    with plain_client.app.state.database.session() as db:
        assert db.scalar(select(func.count()).select_from(OAuthTransactionRow)) == 1
    plain_client.cookies.jar.set_cookie(original_cookie)
    accepted = plain_client.get(
        "/api/session/oauth/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert "cancelled" in accepted.headers["location"]
    with plain_client.app.state.database.session() as db:
        assert db.scalar(select(func.count()).select_from(OAuthTransactionRow)) == 0
    assert not mock.exchanges


@pytest.fixture
def operational_loggers(monkeypatch):
    # Alembic fileConfig in the synthetic migration fixture disables imported
    # application loggers; production migrations and API run in separate processes.
    for name in ("qunxue_api.adapters.oauth", "qunxue_api.application.oauth_login"):
        monkeypatch.setattr(logging.getLogger(name), "disabled", False)


def test_provider_authorization_failure_is_diagnosable_without_logging_credentials(
    plain_client, monkeypatch, caplog, operational_loggers
):
    mock = Provider(plain_client)
    client = plain_client.app.state.oauth_clients.client("google")
    marker = "synthetic-token-code-secret-must-not-be-logged"

    async def unavailable(*args, **kwargs):
        raise ValueError(marker)

    monkeypatch.setattr(client, "create_authorization_url", unavailable)
    with caplog.at_level("WARNING"):
        response = plain_client.post(
            "/api/session/oauth/google/start",
            headers={"Origin": ORIGIN},
            json={"return_path": "/library"},
        )
    assert response.status_code == 503
    assert "provider=google operation=authorization category=ValueError" in caplog.text
    assert marker not in caplog.text
    assert "synthetic-test-only" not in caplog.text
    assert plain_client.cookies.get("everplain_oauth_google") is None
    with plain_client.app.state.database.session() as db:
        assert db.scalar(select(func.count()).select_from(OAuthTransactionRow)) == 0
    assert not mock.exchanges


def test_callback_reports_missing_browser_binder_without_leaking_flow(
    plain_client, caplog, operational_loggers
):
    mock = Provider(plain_client)
    state, code = mock.start(plain_client, "github")
    binder = plain_client.cookies.get("everplain_oauth_github")
    plain_client.cookies.clear()
    with caplog.at_level("WARNING"):
        response = mock.finish(plain_client, state, code, "github")
    assert "invalid_flow" in response.headers["location"]
    assert "provider=github stage=state_validation" in caplog.text
    assert "browser_cookie_present=False" in caplog.text
    assert all(value not in caplog.text for value in (state, code, binder))
    assert not mock.exchanges


@pytest.mark.parametrize(
    ("provider", "failed_path", "error_type", "endpoint"),
    [
        ("github", "/login/oauth/access_token", httpx.ReadTimeout, "github_token"),
        ("google", "/token", httpx.ConnectTimeout, "google_token"),
        ("google", "/oauth2/v3/certs", httpx.ConnectTimeout, "google_jwks"),
    ],
)
def test_callback_provider_failure_is_distinct_from_state_validation(
    plain_client, caplog, operational_loggers, provider, failed_path, error_type, endpoint
):
    mock = Provider(plain_client)
    remote = plain_client.app.state.oauth_clients.client(provider)
    marker = "synthetic-code-client-secret-redacted"

    def unavailable(request):
        if request.url.path == failed_path:
            raise error_type(marker, request=request)
        return mock.http(request)

    remote.client_kwargs["transport"] = httpx.MockTransport(unavailable)
    state, code = mock.start(plain_client, provider)
    binder = plain_client.cookies.get(f"everplain_oauth_{provider}")
    with caplog.at_level("WARNING"):
        response = mock.finish(plain_client, state, code, provider)
    assert "invalid_flow" in response.headers["location"]
    assert f"provider={provider} operation=identity category={error_type.__name__}" in caplog.text
    assert f"endpoint={endpoint}" in caplog.text
    assert f"provider={provider} stage=provider_identity" in caplog.text
    assert "browser_cookie_present=True" in caplog.text
    assert all(value not in caplog.text for value in (state, code, binder, marker))
    assert counts(plain_client) == (0, 0, 0)
    assert plain_client.cookies.get("everplain_session") is None
    with plain_client.app.state.database.session() as db:
        assert db.scalar(select(func.count()).select_from(OAuthTransactionRow)) == 0


@pytest.mark.parametrize("url", [None, "https://untrusted.example/private?code=secret-code"])
def test_oauth_failure_endpoint_never_logs_unknown_urls(caplog, operational_loggers, url):
    error = httpx.ConnectTimeout("secret-error-detail")
    if url is not None:
        error.request = httpx.Request("GET", url, headers={"Authorization": "Bearer secret-token"})
    with caplog.at_level("WARNING"):
        OAuthClients._record_failure("google", "identity", error)
    assert "category=ConnectTimeout" in caplog.text
    assert "endpoint=unknown" in caplog.text
    assert all(
        value not in caplog.text
        for value in (
            "untrusted.example",
            "/private",
            "secret-code",
            "secret-error-detail",
            "secret-token",
        )
    )
