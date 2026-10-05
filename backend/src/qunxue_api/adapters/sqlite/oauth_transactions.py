from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import unquote, urlsplit

from sqlalchemy import delete

from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.oauth_model import OAuthTransactionRow

OAUTH_TTL_SECONDS = 600


def digest(value: str) -> str:
    return sha256(value.encode()).hexdigest()


def safe_return_path(value: str) -> str:
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


class OAuthTransactions:
    def __init__(self, database: Database) -> None:
        self._database = database

    def create(self, *, provider: str, return_path: str, link_session_id: str | None):
        state, browser, verifier, nonce = (token_urlsafe(32) for _ in range(4))
        now = datetime.now(UTC)
        with self._database.session() as db:
            db.execute(delete(OAuthTransactionRow).where(OAuthTransactionRow.expires_at <= now))
            db.add(
                OAuthTransactionRow(
                    state_digest=digest(state),
                    provider=provider,
                    browser_digest=digest(browser),
                    code_verifier=verifier,
                    nonce=nonce,
                    return_path=safe_return_path(return_path),
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
        with self._database.session() as db:
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
            return row
