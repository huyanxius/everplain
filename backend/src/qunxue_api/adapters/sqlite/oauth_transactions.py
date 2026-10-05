from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe

from sqlalchemy import delete, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.oauth_model import OAuthTransactionRow
from qunxue_api.modules.identity import (
    OAUTH_TTL_SECONDS,
    IdentityService,
    OAuthStorageUnavailable,
    OAuthTransaction,
    safe_oauth_return_path,
)


def digest(value: str) -> str:
    return sha256(value.encode()).hexdigest()


class OAuthTransactions:
    def __init__(
        self,
        database: Database,
        identity_factory: Callable[[Session], IdentityService] | None = None,
    ) -> None:
        self._database = database
        self._identity_factory = identity_factory

    def create(self, *, provider: str, return_path: str, link_session_id: str | None):
        state, browser, verifier, nonce = (token_urlsafe(32) for _ in range(4))
        now = datetime.now(UTC)
        with self._storage_scope() as db:
            db.execute(delete(OAuthTransactionRow).where(OAuthTransactionRow.expires_at <= now))
            db.add(
                OAuthTransactionRow(
                    state_digest=digest(state),
                    provider=provider,
                    browser_digest=digest(browser),
                    code_verifier=verifier,
                    nonce=nonce,
                    return_path=safe_oauth_return_path(return_path),
                    link_session_id=link_session_id,
                    expires_at=now + timedelta(seconds=OAUTH_TTL_SECONDS),
                )
            )
        return state, browser, verifier, nonce

    def consume(self, *, provider: str, state: str, browser: str):
        if not 32 <= len(state) <= 128 or not 32 <= len(browser) <= 128:
            return None
        # DELETE RETURNING claims the request once across processes, then commits
        # before contacting the provider. Even failed/denied callbacks cannot replay.
        with self._storage_scope() as db:
            row = db.execute(
                delete(OAuthTransactionRow)
                .where(
                    OAuthTransactionRow.state_digest == digest(state),
                    OAuthTransactionRow.provider == provider,
                    OAuthTransactionRow.browser_digest == digest(browser),
                    OAuthTransactionRow.expires_at > datetime.now(UTC),
                )
                .returning(OAuthTransactionRow)
            ).scalar_one_or_none()
            if row is None:
                return None
            return OAuthTransaction(
                provider=row.provider,
                code_verifier=row.code_verifier,
                nonce=row.nonce,
                return_path=row.return_path,
                link_session_id=row.link_session_id,
                expires_at=row.expires_at.replace(tzinfo=UTC)
                if row.expires_at.tzinfo is None
                else row.expires_at,
            )

    @contextmanager
    def _storage_scope(self) -> Iterator[Session]:
        try:
            with self._database.session() as db:
                yield db
        except SQLAlchemyError as error:
            raise OAuthStorageUnavailable("OAuth storage unavailable") from error

    @contextmanager
    def identities(self) -> Iterator[IdentityService]:
        if self._identity_factory is None:
            raise RuntimeError("OAuth identity factory is not configured")
        with self._storage_scope() as db:
            yield self._identity_factory(db)

    @contextmanager
    def atomic_identities(self) -> Iterator[IdentityService]:
        if self._identity_factory is None:
            raise RuntimeError("OAuth identity factory is not configured")
        with self._storage_scope() as db:
            if db.bind.dialect.name == "sqlite":
                db.execute(text("BEGIN IMMEDIATE"))
            yield self._identity_factory(db)
