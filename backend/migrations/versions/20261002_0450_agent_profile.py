"""Persist personal companion identity and resumable onboarding."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0450"
down_revision = "20260912_0440"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agent_profiles",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("avatar_id", sa.String(16), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("speaking_style", sa.String(16), nullable=False),
        sa.Column("setup_step", sa.Integer(), nullable=False),
        sa.Column("setup_completed", sa.Boolean(), nullable=False),
        sa.Column("questionnaire", sa.JSON(), nullable=False),
        sa.Column("memory_ids", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )


def downgrade():
    op.drop_table("agent_profiles")
