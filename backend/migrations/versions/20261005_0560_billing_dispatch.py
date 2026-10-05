"""Keep explicit dispatch evidence without rewriting historical billing costs."""

import sqlalchemy as sa
from alembic import context, op

revision = "20261005_0560"
down_revision = "20261004_0550"
branch_labels = None
depends_on = None


def upgrade():
    columns = set() if context.is_offline_mode() else {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("billing_attempts")
    }
    if "dispatch_state" not in columns:
        op.add_column(
            "billing_attempts",
            sa.Column("dispatch_state", sa.Text(), nullable=False, server_default="legacy_unknown"),
        )
    if "provider_request_id" not in columns:
        op.add_column(
            "billing_attempts", sa.Column("provider_request_id", sa.Text(), nullable=True)
        )


def downgrade():
    # Leave these additive audit columns available to old code. Rolling back
    # application code must never erase dispatch or reconciliation evidence.
    pass
