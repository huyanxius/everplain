"""Add personal seven-day quota epochs without rewriting historical billing."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0600"
down_revision = "20261005_0580"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("credit_accounts", sa.Column("quota_period_epoch", sa.Integer(), nullable=True))
    op.add_column("credit_ledger", sa.Column("quota_period_epoch", sa.Integer(), nullable=True))
    op.add_column(
        "billing_operations", sa.Column("quota_period_epoch", sa.Integer(), nullable=True)
    )
    op.create_table(
        "credit_quota_periods",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("epoch", sa.Integer(), primary_key=True),
        sa.Column("plan_id", sa.String(64), nullable=False),
        sa.Column("limit_points", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Text(), nullable=False),
        sa.Column("balance", sa.Integer(), nullable=False),
        sa.Column("total_credit_pico", sa.Text(), nullable=False),
        sa.Column("closed_at", sa.Text(), nullable=True),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.CheckConstraint(
            "balance >= 0 AND limit_points > 0 AND epoch >= 0", name="ck_credit_quota_period_values"
        ),
    )
    # Production may already have the audited admin-reset table and terminal fence.
    # IF NOT EXISTS preserves it verbatim; do not replace triggers or ledger receipts.
    op.execute("""CREATE TABLE IF NOT EXISTS billing_precision_adjustments (
      reset_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
      before_precision TEXT NOT NULL, delta_precision TEXT NOT NULL,
      after_precision TEXT NOT NULL, before_balance INTEGER NOT NULL,
      delta_points INTEGER NOT NULL, after_balance INTEGER NOT NULL,
      closed_operation_ids TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(reset_id,user_id))""")


def downgrade():
    raise RuntimeError(
        "Financial quota evidence cannot be downgraded; restore a verified backup to a new target."
    )
