"""Persist version-bound UTF-16 user selection scopes on reviewable revisions."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0580"
down_revision = "20261005_0590"
branch_labels = None
depends_on = None


def upgrade():
    # Additive nullable fields preserve the exact pre-migration insert contract.
    # Do not infer historical user intent from a minimal text diff.
    op.add_column("writing_revisions", sa.Column("selection_start", sa.Integer(), nullable=True))
    op.add_column("writing_revisions", sa.Column("selection_end", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("writing_revisions", "selection_end")
    op.drop_column("writing_revisions", "selection_start")
