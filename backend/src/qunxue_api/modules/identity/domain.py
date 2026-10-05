from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class AccountRole(StrEnum):
    MEMBER = "member"
    ADMIN = "admin"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"
    DEACTIVATED = "deactivated"


class AccountLoginMode(StrEnum):
    EMAIL_PASSWORD = "email_password"
    FEDERATED = "federated"


@dataclass(frozen=True, slots=True)
class User:
    user_id: UUID
    email: str | None
    password_hash: str
    display_name: str | None
    created_at: datetime
    updated_at: datetime
    role: AccountRole = AccountRole.MEMBER
    status: AccountStatus = AccountStatus.ACTIVE
    version: int = 1
    last_login_at: datetime | None = None
    deactivated_at: datetime | None = None
    login_mode: AccountLoginMode = AccountLoginMode.EMAIL_PASSWORD


@dataclass(frozen=True, slots=True)
class UserSession:
    session_id: UUID
    user_id: UUID
    token_digest: str
    version: int
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    last_seen_at: datetime | None = None
    user_agent: str | None = None
    ip_address: str | None = None
    revoked_reason: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    session: UserSession
    user: User


@dataclass(frozen=True, slots=True)
class SessionGrant:
    authenticated: AuthenticatedSession
    credential: str


@dataclass(frozen=True, slots=True)
class RegistrationVerification:
    email: str
    code_hash: str
    expires_at: datetime
    resend_available_at: datetime
    attempts_remaining: int


@dataclass(frozen=True, slots=True)
class FederatedIdentity:
    provider: str
    subject: str
    user_id: UUID
    created_at: datetime
    verified_email: str | None = None


OAUTH_TTL_SECONDS = 600


@dataclass(frozen=True, slots=True)
class OAuthProviderCredentials:
    provider: str
    client_id: str | None
    client_secret: str | None = field(repr=False)


@dataclass(frozen=True, slots=True)
class OAuthClientConfiguration:
    origin: str | None
    secure_session_cookie: bool
    providers: tuple[OAuthProviderCredentials, ...]


@dataclass(frozen=True, slots=True)
class VerifiedOAuthIdentity:
    provider: str
    subject: str
    email: str
    display_name: str | None = None


@dataclass(frozen=True, slots=True)
class OAuthTransaction:
    provider: str
    code_verifier: str
    nonce: str
    return_path: str
    link_session_id: str | None
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class OAuthStart:
    authorization_url: str
    browser_credential: str


@dataclass(frozen=True, slots=True)
class OAuthCompletion:
    target: str
    grant: SessionGrant | None = None
