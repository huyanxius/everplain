"""Identity-only OAuth clients. Provider tokens never leave this adapter or get persisted."""

import logging

import httpx2
from authlib.integrations.starlette_client import OAuth, OAuthError
from joserfc.errors import JoseError

from qunxue_api.modules.identity import (
    OAuthClientConfiguration,
    OAuthIdentityInvalid,
    OAuthProviderUnavailable,
    VerifiedOAuthIdentity,
)

PROVIDERS = ("google", "github")
logger = logging.getLogger(__name__)


class OAuthClients:
    def __init__(self, configuration: OAuthClientConfiguration) -> None:
        self.origin = configuration.origin
        self._registry = OAuth()
        self.enabled: list[str] = []
        for credentials in configuration.providers:
            provider, client_id, secret = (
                credentials.provider,
                credentials.client_id,
                credentials.client_secret,
            )
            if provider not in PROVIDERS:
                raise ValueError("unknown OAuth provider")
            if not self.origin or not client_id or not secret or not secret.strip():
                continue
            if self.origin.startswith("https://") and not configuration.secure_session_cookie:
                raise ValueError("HTTPS OAuth requires secure application session cookies")
            common = dict(
                client_id=client_id,
                client_secret=secret,
                client_kwargs={
                    "code_challenge_method": "S256",
                    "timeout": 15,
                    "token_endpoint_auth_method": "client_secret_post",
                },
            )
            if provider == "google":
                common["client_kwargs"]["scope"] = "openid email profile"
                self._registry.register(
                    provider,
                    **common,
                    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                )
            else:
                common["client_kwargs"]["scope"] = "user:email"
                self._registry.register(
                    provider,
                    **common,
                    authorize_url="https://github.com/login/oauth/authorize",
                    access_token_url="https://github.com/login/oauth/access_token",
                    api_base_url="https://api.github.com/",
                    access_token_params={"headers": {"Accept": "application/json"}},
                )
            self.enabled.append(provider)

    def client(self, provider: str):
        if provider not in self.enabled:
            raise OAuthIdentityInvalid("provider unavailable")
        return self._registry.create_client(provider)

    def callback_url(self, provider: str) -> str:
        self.client(provider)
        return f"{self.origin}/api/session/oauth/{provider}/callback"

    async def _authorize_url(self, provider: str, *, state: str, verifier: str, nonce: str) -> str:
        params = dict(state=state, code_verifier=verifier)
        if provider == "google":
            params.update(nonce=nonce, access_type="online", prompt="select_account")
        else:
            params["prompt"] = "select_account"
        result = await self.client(provider).create_authorization_url(
            self.callback_url(provider),
            **params,
        )
        return result["url"]

    async def _identity(
        self, provider: str, *, code: str, verifier: str, nonce: str
    ) -> VerifiedOAuthIdentity:
        client = self.client(provider)
        token = await client.fetch_access_token(
            redirect_uri=self.callback_url(provider),
            code=code,
            code_verifier=verifier,
        )
        if provider == "google":
            info = await client.parse_id_token(
                token,
                nonce=nonce,
                leeway=30,
                claims_options={
                    "iss": {
                        "essential": True,
                        "values": ["https://accounts.google.com", "accounts.google.com"],
                    },
                    "aud": {"essential": True, "value": client.client_id},
                    # Explicit claim constraint also guards nonce_supported=false bypasses.
                    "nonce": {"essential": True, "value": nonce},
                    "email": {"essential": True},
                    "email_verified": {"essential": True, "validate": lambda _c, v: v is True},
                },
            )
            subject, email = info.get("sub"), info.get("email")
            display_name = info.get("name")
        else:
            scopes = set(str(token.get("scope", "")).replace(",", " ").split())
            if scopes != {"user:email"}:
                raise OAuthIdentityInvalid("unexpected granted scopes")
            headers = {
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            response = await client.get("user", token=token, headers=headers)
            response.raise_for_status()
            user = response.json()
            if type(user.get("id")) is not int or user["id"] <= 0:
                raise OAuthIdentityInvalid("missing GitHub subject")
            subject = str(user["id"])
            display_name = user.get("name") or user.get("login")
            response = await client.get("user/emails", token=token, headers=headers)
            response.raise_for_status()
            emails = response.json()
            if not isinstance(emails, list):
                raise OAuthIdentityInvalid("invalid GitHub email response")
            email = next(
                (
                    item.get("email")
                    for item in emails
                    if isinstance(item, dict)
                    and item.get("primary") is True
                    and item.get("verified") is True
                ),
                None,
            )
        if (
            not isinstance(subject, str)
            or not 1 <= len(subject) <= 255
            or not isinstance(email, str)
            or not 3 <= len(email) <= 320
        ):
            raise OAuthIdentityInvalid("missing verified identity")
        return VerifiedOAuthIdentity(
            provider=provider,
            subject=subject,
            email=email,
            display_name=display_name.strip()[:80] if isinstance(display_name, str) else None,
        )

    async def authorize_url(self, provider: str, *, state: str, verifier: str, nonce: str) -> str:
        try:
            return await self._authorize_url(provider, state=state, verifier=verifier, nonce=nonce)
        except (
            httpx2.HTTPError,
            OAuthError,
            OAuthIdentityInvalid,
            ValueError,
            TypeError,
            KeyError,
        ) as error:
            self._record_failure(provider, "authorization", error)
            raise OAuthProviderUnavailable("OAuth provider unavailable") from error

    async def identity(
        self, provider: str, *, code: str, verifier: str, nonce: str
    ) -> VerifiedOAuthIdentity:
        try:
            return await self._identity(provider, code=code, verifier=verifier, nonce=nonce)
        except (httpx2.HTTPError, OAuthError, JoseError, ValueError, TypeError, KeyError) as error:
            self._record_failure(provider, "identity", error)
            raise OAuthProviderUnavailable("OAuth provider verification failed") from error

    @staticmethod
    def _record_failure(provider: str, operation: str, error: Exception) -> None:
        # Error descriptions, URLs and traceback locals can contain provider
        # codes/tokens/secrets. Only bounded categories reach the operational log.
        code = getattr(error, "error", None)
        known_codes = {
            "invalid_client",
            "invalid_grant",
            "invalid_request",
            "access_denied",
            "temporarily_unavailable",
            "server_error",
            "unauthorized_client",
        }
        logger.warning(
            "OAuth provider request failed provider=%s operation=%s category=%s code=%s "
            "cause_category=%s",
            provider,
            operation,
            type(error).__name__,
            code if isinstance(code, str) and code in known_codes else "unspecified",
            type(error.__cause__).__name__ if error.__cause__ else "unspecified",
        )
