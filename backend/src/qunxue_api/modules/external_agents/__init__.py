"""Explicit, expiring read-only connection grants. No network or framework dependencies."""

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from typing import Protocol
from uuid import UUID, uuid4

MAX_CONNECTION_DAYS = 365
MAX_LIBRARY_SCOPE = 50
MAX_ACTIVE_CONNECTIONS = 50
_SECRET_PATTERN = re.compile(r"ep_mcp_[A-Za-z0-9_-]{43}\Z")


class ConnectionUnauthorized(PermissionError):
    def __init__(self):
        super().__init__("连接密钥无效、已过期或已撤销。")


class ConnectionUnavailable(LookupError):
    def __init__(self):
        super().__init__("连接或授权资料不存在。")


class ConnectionValidationError(ValueError):
    pass


@dataclass(frozen=True)
class AgentConnection:
    connection_id: UUID
    owner_user_id: UUID
    name: str
    library_ids: tuple[UUID, ...]
    token_hash: str = field(repr=False)
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None

    def status(self, now: datetime) -> str:
        if self.revoked_at is not None:
            return "revoked"
        return "expired" if self.expires_at <= now else "active"


@dataclass(frozen=True)
class ConnectionGrant:
    connection: AgentConnection
    secret: str = field(repr=False)


class ConnectionRepository(Protocol):
    def list_for(self, user_id: UUID) -> tuple[AgentConnection, ...]: ...
    def get(self, connection_id: UUID) -> AgentConnection | None: ...
    def find_hash(self, token_hash: str) -> AgentConnection | None: ...
    def save(self, connection: AgentConnection) -> None: ...
    def commit(self) -> None: ...


class ExternalAgentService:
    def __init__(
        self,
        repository: ConnectionRepository,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self.repository = repository
        self.clock = clock

    def create(self, user_id, *, name, library_ids, expires_at) -> ConnectionGrant:
        now = self.clock()
        name = name.strip()
        libraries = tuple(dict.fromkeys(library_ids))
        if not name or len(name) > 80:
            raise ConnectionValidationError("连接名称需要 1–80 个字符。")
        if not libraries or len(libraries) > MAX_LIBRARY_SCOPE:
            raise ConnectionValidationError("请明确选择 1–50 个自己的知识库。")
        if expires_at.tzinfo is None or not now < expires_at <= now + timedelta(
            days=MAX_CONNECTION_DAYS
        ):
            raise ConnectionValidationError("有效期必须在未来且不超过 365 天。")
        if sum(c.status(now) == "active" for c in self.list(user_id)) >= MAX_ACTIVE_CONNECTIONS:
            raise ConnectionValidationError("最多保留 50 个有效连接，请先撤销不再使用的连接。")
        secret = f"ep_mcp_{token_urlsafe(32)}"
        connection = AgentConnection(
            connection_id=uuid4(),
            owner_user_id=user_id,
            name=name,
            library_ids=libraries,
            token_hash=hashlib.sha256(secret.encode()).hexdigest(),
            created_at=now,
            expires_at=expires_at.astimezone(UTC),
        )
        self.repository.save(connection)
        self.repository.commit()
        return ConnectionGrant(connection, secret)

    def list(self, user_id) -> tuple[AgentConnection, ...]:
        return tuple(c for c in self.repository.list_for(user_id) if c.owner_user_id == user_id)

    def revoke(self, user_id, connection_id) -> AgentConnection:
        connection = self.repository.get(connection_id)
        if connection is None or connection.owner_user_id != user_id:
            raise ConnectionUnavailable()
        if connection.revoked_at is None:
            connection = replace(connection, revoked_at=self.clock())
            self.repository.save(connection)
            self.repository.commit()
        return connection

    def authenticate(self, secret: str | None) -> AgentConnection:
        if not isinstance(secret, str) or not _SECRET_PATTERN.fullmatch(secret):
            raise ConnectionUnauthorized()
        digest = hashlib.sha256(secret.encode()).hexdigest()
        connection = self.repository.find_hash(digest)
        if connection is None or connection.status(self.clock()) != "active":
            raise ConnectionUnauthorized()
        return connection


__all__ = [
    "AgentConnection",
    "ConnectionGrant",
    "ConnectionRepository",
    "ConnectionUnauthorized",
    "ConnectionUnavailable",
    "ConnectionValidationError",
    "ExternalAgentService",
]
