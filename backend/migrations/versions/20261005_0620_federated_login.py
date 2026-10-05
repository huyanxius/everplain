"""Add subject-bound login identities and one-time server-side OAuth requests."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0620"
down_revision = "20261005_0610"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "federated_identities",
        sa.Column("provider", sa.String(16), primary_key=True),
        sa.Column("subject", sa.String(255), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider IN ('google', 'github')", name="ck_federated_provider"),
        sa.UniqueConstraint("user_id", "provider", name="uq_federated_user_provider"),
    )
    op.create_index("ix_federated_identities_user_id", "federated_identities", ["user_id"])
    op.create_table(
        "oauth_transactions",
        sa.Column("state_digest", sa.String(64), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("browser_digest", sa.String(64), nullable=False),
        sa.Column("code_verifier", sa.String(128), nullable=False),
        sa.Column("nonce", sa.String(128), nullable=False),
        sa.Column("return_path", sa.String(2048), nullable=False),
        sa.Column("link_session_id", sa.String(36), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_oauth_transactions_expiry", "oauth_transactions", ["expires_at"])


def downgrade():
    # Dropping bound identities would lock out OAuth-only users.
    raise RuntimeError("Federated identities require restoring a backup to a new database")
