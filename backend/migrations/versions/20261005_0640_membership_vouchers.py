"""Add membership voucher metadata and queued 28-day subscription windows."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0640"
down_revision = "20261005_0630"
branch_labels = None
depends_on = None


def upgrade():
    context = op.get_context()
    connection = op.get_bind()
    if context.as_sql or connection.dialect.name != "sqlite":
        raise RuntimeError("Membership vouchers require the reviewed online SQLite release path")
    with context.autocommit_block():
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            op.add_column("credit_redemption_codes", sa.Column("plan_id", sa.String(64)))
            op.add_column(
                "credit_redemption_codes",
                sa.Column("action", sa.String(24), nullable=False, server_default="bank_reset"),
            )
            op.add_column(
                "subscriptions", sa.Column("current_period_start", sa.DateTime(timezone=True))
            )
            if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
                raise RuntimeError("Membership voucher migration found a foreign-key violation")
            if connection.exec_driver_sql("PRAGMA integrity_check").scalar_one() != "ok":
                raise RuntimeError("Membership voucher migration failed integrity validation")
            connection.exec_driver_sql("COMMIT")
        except BaseException:
            connection.exec_driver_sql("ROLLBACK")
            raise


def downgrade():
    raise RuntimeError("Restore the pre-membership backup to a new database instead of downgrade")
