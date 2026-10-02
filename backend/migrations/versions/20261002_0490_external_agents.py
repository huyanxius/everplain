"""Explicit expiring library-scoped external agent credentials (hashes only)."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0490"
down_revision = "20261002_0480"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "external_agent_connections",
        sa.Column("connection_id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("library_ids", sa.JSON(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_external_agent_connections_owner_user_id",
        "external_agent_connections",
        ["owner_user_id"],
    )


def downgrade():
    op.drop_table("external_agent_connections")
