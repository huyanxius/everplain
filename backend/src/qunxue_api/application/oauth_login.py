"""OAuth use-case orchestration through pure identity ports; HTTP and storage stay outside."""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from urllib.parse import urlencode

from qunxue_api.modules.identity import (
    FederatedIdentityConflict,
    IdentityError,
    IdentityService,
    OAuthCompletion,
    OAuthIdentityInvalid,
    OAuthProviderClient,
    OAuthProviderNetworkUnavailable,
    OAuthProviderUnavailable,
    OAuthStart,
    OAuthStorageUnavailable,
    OAuthTransactionStore,
    safe_oauth_return_path,
)

logger = logging.getLogger(__name__)


class OAuthLoginApplication:
    def __init__(
        self,
        *,
        clients: Callable[[], OAuthProviderClient],
        transactions: OAuthTransactionStore,
        identities: Callable[[], AbstractContextManager[IdentityService]],
        atomic_identities: Callable[[], AbstractContextManager[IdentityService]],
    ):
        self._clients = clients
        self._transactions = transactions
        self._identities = identities
        self._atomic_identities = atomic_identities

    @property
    def origin(self) -> str | None:
        return self._clients().origin

    @property
    def providers(self) -> list[str]:
        return self._clients().enabled

    def linked_providers(self, credential: str | None) -> list[str]:
        with self._identities() as service:
            return service.linked_federated_providers(credential)

    async def start(
        self, *, provider: str, return_path: str, credential: str | None, link: bool
    ) -> OAuthStart:
        if provider not in self.providers:
            raise OAuthIdentityInvalid("provider unavailable")
        return_path = safe_oauth_return_path(return_path)
        session_id = None
        if link:
            with self._identities() as service:
                session_id = str(service.authenticate(credential).session.session_id)
        state, browser, verifier, nonce = self._transactions.create(
            provider=provider,
            return_path=return_path,
            link_session_id=session_id,
        )
        try:
            url = await self._clients().authorize_url(
                provider,
                state=state,
                verifier=verifier,
                nonce=nonce,
            )
        except OAuthProviderUnavailable:
            self._transactions.consume(provider=provider, state=state, browser=browser)
            raise
        return OAuthStart(authorization_url=url, browser_credential=browser)

    async def complete(
        self,
        *,
        provider: str,
        state: str,
        browser: str,
        code: str | None,
        denied: bool,
        credential: str | None,
        user_agent: str | None,
        ip_address: str | None,
    ) -> OAuthCompletion:
        failure, target = "invalid_flow", "/login"
        stage = "provider_configuration"
        try:
            if provider not in self.providers:
                raise OAuthIdentityInvalid("provider unavailable")
            stage = "state_validation"
            transaction = self._transactions.consume(
                provider=provider, state=state, browser=browser
            )
            if transaction is None:
                raise OAuthIdentityInvalid("invalid flow")
            target = (
                "/settings?section=security"
                if transaction.link_session_id
                else "/login?" + urlencode({"redirect": transaction.return_path})
            )
            if denied:
                failure = "cancelled"
                raise OAuthIdentityInvalid("authorization denied")
            if code is None or not 1 <= len(code) <= 2048:
                raise OAuthIdentityInvalid("missing authorization code")
            # Revalidate the original live session before and after provider exchange.
            if transaction.link_session_id:
                stage = "link_session_before_exchange"
                with self._identities() as service:
                    if (
                        str(service.authenticate(credential).session.session_id)
                        != transaction.link_session_id
                    ):
                        raise OAuthIdentityInvalid("link session changed")
            stage = "provider_identity"
            identity = await self._clients().identity(
                provider,
                code=code,
                verifier=transaction.code_verifier,
                nonce=transaction.nonce,
            )
            # The injected storage scope serializes this short transaction; provider
            # requests occur before entering it, so no write lock spans network I/O.
            with self._atomic_identities() as service:
                if transaction.link_session_id:
                    stage = "link_session_after_exchange"
                    current = service.authenticate(credential)
                    if str(current.session.session_id) != transaction.link_session_id:
                        raise OAuthIdentityInvalid("link session changed")
                    service.link_federated(
                        current,
                        provider=identity.provider,
                        subject=identity.subject,
                        verified_email=identity.email,
                    )
                    grant = None
                else:
                    stage = "account_login"
                    grant = service.login_federated(
                        provider=identity.provider,
                        subject=identity.subject,
                        verified_email=identity.email,
                        display_name=identity.display_name,
                        user_agent=user_agent,
                        ip_address=ip_address,
                    )
            return OAuthCompletion(target=transaction.return_path, grant=grant)
        except FederatedIdentityConflict as error:
            failure = "account_link_required"
            self._record_failure(provider, stage, error, browser, credential)
        except OAuthProviderNetworkUnavailable as error:
            failure = "service_unavailable"
            self._record_failure(provider, stage, error, browser, credential)
        except (OAuthProviderUnavailable, OAuthIdentityInvalid, IdentityError) as error:
            self._record_failure(provider, stage, error, browser, credential)
        except OAuthStorageUnavailable as error:
            failure = "service_unavailable"
            self._record_failure(provider, stage, error, browser, credential)
        return OAuthCompletion(
            target=f"{target}{'&' if '?' in target else '?'}" + urlencode({"oauth_error": failure})
        )

    @staticmethod
    def _record_failure(
        provider: str, stage: str, error: Exception, browser: str, credential: str | None
    ) -> None:
        message = str(error)
        known_reasons = {
            "provider unavailable",
            "invalid flow",
            "authorization denied",
            "missing authorization code",
            "link session changed",
            "unexpected granted scopes",
            "missing GitHub subject",
            "invalid GitHub email response",
            "missing verified identity",
        }
        logger.warning(
            "OAuth callback failed provider=%s stage=%s category=%s reason=%s "
            "browser_cookie_present=%s session_cookie_present=%s",
            provider,
            stage,
            type(error).__name__,
            message if message in known_reasons else "unspecified",
            bool(browser),
            bool(credential),
        )
