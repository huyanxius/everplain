"""Add an owned derived recent-activity cache; do not backfill model output."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0570"
down_revision = "20261005_0560"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agent_conversation_summaries",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("attempted_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("summary", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("lease_token", sa.String(36)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("retry_after", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(64)),
    )


def downgrade():
    op.drop_table("agent_conversation_summaries")
