"""Add opt-in channel identities and replay-safe execution receipts."""

import sqlalchemy as sa
from alembic import op

revision = "20261003_0540"
down_revision = "20261003_0530"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "channel_link_codes",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gateway_id", sa.String(200), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("consumed_at", sa.Integer()),
    )
    op.create_table(
        "channel_bindings",
        sa.Column("binding_id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("identity_key", sa.String(64), unique=True),
        sa.Column("gateway_id", sa.String(200), nullable=False),
        sa.Column("subject_id", sa.String(200), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("activated_at_ms", sa.Integer(), nullable=False),
        sa.Column("revoked_at", sa.Integer()),
    )
    op.create_index("ix_channel_bindings_user_id", "channel_bindings", ["user_id"])
    op.create_table(
        "channel_scopes",
        sa.Column("scope_key", sa.String(64), primary_key=True),
        sa.Column(
            "binding_id",
            sa.String(36),
            sa.ForeignKey("channel_bindings.binding_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("conversation_id", sa.String(36)),
        sa.Column("active_event", sa.String(64)),
        sa.Column("lease_until", sa.Integer(), nullable=False),
    )
    op.create_index("ix_channel_scopes_binding_id", "channel_scopes", ["binding_id"])
    op.create_table(
        "channel_events",
        sa.Column("event_key", sa.String(64), primary_key=True),
        sa.Column("gateway_id", sa.String(200), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column(
            "binding_id",
            sa.String(36),
            sa.ForeignKey("channel_bindings.binding_id", ondelete="CASCADE"),
        ),
        sa.Column("scope_key", sa.String(64)),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("lease_token", sa.String(36)),
        sa.Column("lease_until", sa.Integer(), nullable=False),
        sa.Column("answer", sa.Text()),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )


def downgrade():
    for table in ("channel_events", "channel_scopes", "channel_bindings", "channel_link_codes"):
        op.drop_table(table)
