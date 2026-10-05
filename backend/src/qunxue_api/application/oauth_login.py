"""OAuth use-case orchestration through pure identity ports; HTTP and storage stay outside."""

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
    OAuthProviderUnavailable,
    OAuthStart,
    OAuthStorageUnavailable,
    OAuthTransactionStore,
    safe_oauth_return_path,
)


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
        try:
            if provider not in self.providers:
                raise OAuthIdentityInvalid("provider unavailable")
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
                with self._identities() as service:
                    if (
                        str(service.authenticate(credential).session.session_id)
                        != transaction.link_session_id
                    ):
                        raise OAuthIdentityInvalid("link session changed")
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
                    current = service.authenticate(credential)
                    if str(current.session.session_id) != transaction.link_session_id:
                        raise OAuthIdentityInvalid("link session changed")
                    service.link_federated(
                        current, provider=identity.provider, subject=identity.subject
                    )
                    grant = None
                else:
                    grant = service.login_federated(
                        provider=identity.provider,
                        subject=identity.subject,
                        verified_email=identity.email,
                        user_agent=user_agent,
                        ip_address=ip_address,
                    )
            return OAuthCompletion(target=transaction.return_path, grant=grant)
        except FederatedIdentityConflict:
            failure = "account_link_required"
        except (OAuthProviderUnavailable, OAuthIdentityInvalid, IdentityError):
            pass
        except OAuthStorageUnavailable:
            failure = "service_unavailable"
        return OAuthCompletion(
            target=f"{target}{'&' if '?' in target else '?'}" + urlencode({"oauth_error": failure})
        )
