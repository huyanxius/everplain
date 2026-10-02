"""Persist stable personal graph clusters and incremental work state."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0470"
down_revision = "20261002_0460"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "personal_graphs",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("pending", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("personal_graphs")
