"""Add freeform companion preferences without rewriting existing profiles or memories."""

import sqlalchemy as sa
from alembic import op

revision = "20261003_0520"
down_revision = "20261002_0510"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "agent_profiles", sa.Column("soul_text", sa.Text(), nullable=False, server_default="")
    )


def downgrade():
    op.drop_column("agent_profiles", "soul_text")
