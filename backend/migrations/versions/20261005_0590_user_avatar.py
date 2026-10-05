"""Persist optional user appearance and resume the expanded welcome journey."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0590"
down_revision = "20261005_0570"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agent_profiles", sa.Column("user_avatar", sa.JSON(), nullable=True))
    # Only rows from the four-step journey are present at this revision. Completed
    # profiles stay complete, with their existing step and all other data intact.
    op.execute(
        "UPDATE agent_profiles SET setup_step = CASE setup_step "
        "WHEN 0 THEN 3 WHEN 1 THEN 1 WHEN 2 THEN 4 WHEN 3 THEN 5 "
        "ELSE setup_step END WHERE setup_completed = 0"
    )


def downgrade():
    # New companion/user-appearance pages resume at the closest old page.
    op.execute(
        "UPDATE agent_profiles SET setup_step = CASE setup_step "
        "WHEN 2 THEN 1 WHEN 3 THEN 0 WHEN 4 THEN 2 WHEN 5 THEN 3 "
        "ELSE setup_step END WHERE setup_completed = 0"
    )
    op.execute(
        "UPDATE agent_profiles SET setup_step = 4 "
        "WHERE setup_completed = 1 AND setup_step = 6"
    )
    op.drop_column("agent_profiles", "user_avatar")
