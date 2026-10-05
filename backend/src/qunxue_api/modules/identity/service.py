import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from math import ceil
from secrets import randbelow, token_urlsafe
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4

from qunxue_api.modules.identity.domain import (
    AccountLoginMode,
    AccountStatus,
    AuthenticatedSession,
    FederatedIdentity,
    RegistrationVerification,
    SessionGrant,
    User,
    UserSession,
)
from qunxue_api.modules.identity.errors import (
    EmailAlreadyRegistered,
    FederatedIdentityConflict,
    InvalidCredentials,
    InvalidEmail,
    InvalidVerificationCode,
    Unauthenticated,
    VerificationCodeRateLimited,
)
from qunxue_api.modules.identity.ports import EmailProvider, IdentityRepository, PasswordHasher

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_VERIFICATION_TTL = timedelta(minutes=5)
_VERIFICATION_COOLDOWN = timedelta(seconds=60)
_VERIFICATION_ATTEMPTS = 5
_OAUTH_ONLY_PASSWORD_HASH = "!oauth-only"


class IdentityService:
    def __init__(
        self,
        repository: IdentityRepository,
        password_hasher: PasswordHasher,
        *,
        invalid_password_hash: str,
        session_ttl: timedelta,
        email_provider: EmailProvider | None = None,
        id_factory: Callable[[], UUID] = uuid4,
        credential_factory: Callable[[], str] | None = None,
        clock: Callable[[], datetime] | None = None,
        verification_code_factory: Callable[[], str] | None = None,
        require_email_verification: bool = True,
    ) -> None:
        self._repository = repository
        self._password_hasher = password_hasher
        self._email_provider = email_provider
        self._invalid_password_hash = invalid_password_hash
        self._session_ttl = session_ttl
        self._id_factory = id_factory
        self._credential_factory = credential_factory or (lambda: token_urlsafe(32))
        self._clock = clock or (lambda: datetime.now(UTC))
        self._verification_code_factory = verification_code_factory or self._generate_code
        self._require_email_verification = require_email_verification

    def send_registration_code(self, *, email: str) -> None:
        normalized_email = self._normalize_email(email)
        now = self._clock()
        current = self._repository.get_registration_verification(normalized_email)
        if current is not None and current.resend_available_at > now:
            retry_after = max(1, ceil((current.resend_available_at - now).total_seconds()))
            raise VerificationCodeRateLimited(retry_after)

        code = self._verification_code_factory()
        verification = RegistrationVerification(
            email=normalized_email,
            code_hash=self._password_hasher.hash(code),
            expires_at=now + _VERIFICATION_TTL,
            resend_available_at=now + _VERIFICATION_COOLDOWN,
            attempts_remaining=_VERIFICATION_ATTEMPTS,
        )
        self._repository.save_registration_verification(verification)
        if self._email_provider is None:
            from qunxue_api.modules.identity.errors import EmailDeliveryUnavailable

            raise EmailDeliveryUnavailable
        self._email_provider.send_verification_code(normalized_email, code)

    def register(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None,
        verification_code: str | None = None,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> SessionGrant:
        normalized_email = self._normalize_email(email)
        if self._require_email_verification:
            self._consume_registration_code(normalized_email, verification_code)
        if self._repository.get_user_by_email(normalized_email) is not None:
            raise EmailAlreadyRegistered

        now = self._clock()
        user = User(
            user_id=self._id_factory(),
            email=normalized_email,
            password_hash=self._password_hasher.hash(password),
            display_name=display_name.strip() if display_name else None,
            created_at=now,
            updated_at=now,
        )
        persisted = self._repository.add_user(user)
        return self._grant(
            persisted,
            now,
            user_agent=user_agent,
            ip_address=ip_address,
        )

    def _consume_registration_code(self, email: str, code: str | None) -> None:
        verification = self._repository.get_registration_verification(email)
        now = self._clock()
        if (
            verification is None
            or verification.expires_at <= now
            or verification.attempts_remaining <= 0
            or code is None
        ):
            raise InvalidVerificationCode

        if not self._password_hasher.verify(verification.code_hash, code):
            self._repository.save_registration_verification(
                RegistrationVerification(
                    email=verification.email,
                    code_hash=verification.code_hash,
                    expires_at=verification.expires_at,
                    resend_available_at=verification.resend_available_at,
                    attempts_remaining=verification.attempts_remaining - 1,
                )
            )
            raise InvalidVerificationCode
        self._repository.delete_registration_verification(email)

    def login(
        self,
        *,
        email: str,
        password: str,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> SessionGrant:
        normalized_email = email.strip().casefold()
        user = self._repository.get_user_by_email(normalized_email)
        oauth_only = user is not None and (
            user.login_mode is AccountLoginMode.FEDERATED
            or user.password_hash == _OAUTH_ONLY_PASSWORD_HASH
        )
        password_hash = (
            user.password_hash
            if user is not None and not oauth_only
            else self._invalid_password_hash
        )
        valid = self._password_hasher.verify(password_hash, password)
        if not valid or user is None or oauth_only or user.status is not AccountStatus.ACTIVE:
            raise InvalidCredentials
        now = self._clock()
        user = self._repository.record_login(user.user_id, now)
        return self._grant(
            user,
            now,
            user_agent=user_agent,
            ip_address=ip_address,
        )

    def login_federated(
        self,
        *,
        provider: str,
        subject: str,
        verified_email: str,
        display_name: str | None = None,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> SessionGrant:
        """Called only after the provider adapter has validated the identity."""
        identity = self._repository.get_federated_identity(provider, subject)
        now = self._clock()
        if identity is not None:
            user = self._repository.get_user(identity.user_id)
            if user is None or user.status is not AccountStatus.ACTIVE:
                raise InvalidCredentials
            user = self._repository.record_login(user.user_id, now)
        else:
            email = self._normalize_email(verified_email)
            # A provider email is contact data, never a local login credential
            # or evidence that two distinct provider subjects share an account.
            user = self._repository.add_user(
                User(
                    user_id=self._id_factory(),
                    email=None,
                    password_hash=_OAUTH_ONLY_PASSWORD_HASH,
                    display_name=display_name.strip()[:80] if display_name else None,
                    created_at=now,
                    updated_at=now,
                    login_mode=AccountLoginMode.FEDERATED,
                )
            )
            self._repository.add_federated_identity(
                FederatedIdentity(
                    provider=provider,
                    subject=subject,
                    user_id=user.user_id,
                    created_at=now,
                    verified_email=email,
                )
            )
        return self._grant(user, now, user_agent=user_agent, ip_address=ip_address)

    def link_federated(
        self,
        current: AuthenticatedSession,
        *,
        provider: str,
        subject: str,
        verified_email: str | None = None,
    ) -> None:
        identity = self._repository.get_federated_identity(provider, subject)
        existing = self._repository.get_user_provider_identity(current.user.user_id, provider)
        if identity is not None and identity.user_id != current.user.user_id:
            raise FederatedIdentityConflict
        if existing is not None and existing.subject != subject:
            raise FederatedIdentityConflict
        if identity is None:
            self._repository.add_federated_identity(
                FederatedIdentity(
                    provider=provider,
                    subject=subject,
                    user_id=current.user.user_id,
                    created_at=self._clock(),
                    verified_email=self._normalize_email(verified_email)
                    if verified_email
                    else None,
                )
            )

    def linked_federated_providers(self, credential: str | None) -> list[str]:
        current = self.authenticate(credential)
        return self._repository.list_federated_providers(current.user.user_id)

    def authenticate(self, credential: str | None) -> AuthenticatedSession:
        if not credential:
            raise Unauthenticated
        now = self._clock()
        session = self._repository.get_active_session(self._digest(credential), now)
        if session is None:
            raise Unauthenticated
        user = self._repository.get_user(session.user_id)
        if user is None or user.status is not AccountStatus.ACTIVE:
            raise Unauthenticated
        return AuthenticatedSession(session=session, user=user)

    def logout(self, credential: str | None) -> AuthenticatedSession:
        authenticated = self.authenticate(credential)
        revoked = self._repository.revoke_session(
            authenticated.session.session_id,
            self._clock(),
            "logout",
        )
        return AuthenticatedSession(session=revoked, user=authenticated.user)

    def _grant(
        self,
        user: User,
        now: datetime,
        *,
        user_agent: str | None,
        ip_address: str | None,
    ) -> SessionGrant:
        credential = self._credential_factory()
        session = UserSession(
            session_id=self._id_factory(),
            user_id=user.user_id,
            token_digest=self._digest(credential),
            version=1,
            created_at=now,
            expires_at=now + self._session_ttl,
            revoked_at=None,
            last_seen_at=now,
            user_agent=user_agent.strip()[:512] if user_agent else None,
            ip_address=ip_address.strip()[:64] if ip_address else None,
            revoked_reason=None,
        )
        self._repository.add_session(session)
        return SessionGrant(
            authenticated=AuthenticatedSession(session=session, user=user),
            credential=credential,
        )

    @staticmethod
    def _digest(credential: str) -> str:
        return sha256(credential.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_email(email: str) -> str:
        normalized = email.strip().casefold()
        if not _EMAIL_PATTERN.fullmatch(normalized):
            raise InvalidEmail
        return normalized

    @staticmethod
    def _generate_code() -> str:
        return f"{randbelow(1_000_000):06d}"


def safe_oauth_return_path(value: str) -> str:
    """Only root-relative application URLs; reject browser normalization tricks."""
    decoded = unquote(value)
    if (
        not value.startswith("/")
        or value.startswith("//")
        or decoded.startswith("//")
        or "\\" in decoded
        or any(ord(c) < 32 or ord(c) == 127 for c in decoded)
        or len(value) > 2048
    ):
        raise ValueError("return path must be local")
    parts = urlsplit(value)
    if parts.scheme or parts.netloc or parts.path.startswith("/api/"):
        raise ValueError("return path must be an application URL")
    return value
