"""Hashed connection credentials and explicit library scopes; never persist a bearer secret."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, String, select, update
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.external_agents import AgentConnection

from .base import Base


class ExternalAgentConnectionRow(Base):
    __tablename__ = "external_agent_connections"
    connection_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    library_ids: Mapped[list] = mapped_column(JSON)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _utc(value):
    return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


def _connection(row):
    return AgentConnection(
        connection_id=UUID(row.connection_id),
        owner_user_id=UUID(row.owner_user_id),
        name=row.name,
        library_ids=tuple(UUID(value) for value in row.library_ids),
        token_hash=row.token_hash,
        created_at=_utc(row.created_at),
        expires_at=_utc(row.expires_at),
        revoked_at=_utc(row.revoked_at),
    )


class SqliteExternalAgentRepository:
    def __init__(self, session):
        self.session = session

    def _one(self, query):
        row = self.session.scalar(query.execution_options(populate_existing=True))
        return _connection(row) if row is not None else None

    def list_for(self, user_id):
        return tuple(
            _connection(row)
            for row in self.session.scalars(
                select(ExternalAgentConnectionRow)
                .where(ExternalAgentConnectionRow.owner_user_id == str(user_id))
                .order_by(ExternalAgentConnectionRow.created_at.desc())
                .execution_options(populate_existing=True)
            )
        )

    def get(self, connection_id):
        return self._one(
            select(ExternalAgentConnectionRow).where(
                ExternalAgentConnectionRow.connection_id == str(connection_id)
            )
        )

    def find_hash(self, token_hash):
        return self._one(
            select(ExternalAgentConnectionRow).where(
                ExternalAgentConnectionRow.token_hash == token_hash
            )
        )

    def save(self, connection):
        if connection.revoked_at is not None:
            # Revocation is monotonic. A concurrent retry cannot restore an older active row.
            self.session.execute(
                update(ExternalAgentConnectionRow)
                .where(
                    ExternalAgentConnectionRow.connection_id == str(connection.connection_id),
                    ExternalAgentConnectionRow.owner_user_id == str(connection.owner_user_id),
                    ExternalAgentConnectionRow.revoked_at.is_(None),
                )
                .values(revoked_at=connection.revoked_at)
            )
        else:
            self.session.add(
                ExternalAgentConnectionRow(
                    connection_id=str(connection.connection_id),
                    owner_user_id=str(connection.owner_user_id),
                    name=connection.name,
                    library_ids=[str(value) for value in connection.library_ids],
                    token_hash=connection.token_hash,
                    created_at=connection.created_at,
                    expires_at=connection.expires_at,
                    revoked_at=None,
                )
            )
        self.session.flush()

    def commit(self):
        self.session.commit()
