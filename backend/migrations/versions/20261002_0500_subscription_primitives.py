"""Persist optional subscriptions, checkout reservations and webhook replay IDs."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0500"
down_revision = "20261002_0490"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "subscriptions",
        sa.Column("provider_id", sa.String(255), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("customer_id", sa.String(255), nullable=False),
        sa.Column("plan_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])
    op.create_table(
        "subscription_checkouts",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan_id", sa.String(64), nullable=False),
        sa.Column("price_id", sa.String(255), nullable=False),
        sa.Column("success_url", sa.Text(), nullable=False),
        sa.Column("cancel_url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("session_id", sa.String(255), nullable=True),
        sa.Column("checkout_url", sa.Text(), nullable=True),
    )
    op.create_index("ix_subscription_checkouts_user_id", "subscription_checkouts", ["user_id"])
    op.create_table(
        "subscription_webhook_events",
        sa.Column("event_id", sa.String(255), primary_key=True),
        sa.Column("event_type", sa.String(120), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("subscription_webhook_events")
    op.drop_table("subscription_checkouts")
    op.drop_table("subscriptions")
