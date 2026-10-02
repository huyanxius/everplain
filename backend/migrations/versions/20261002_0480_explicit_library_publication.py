"""Require fresh sharing consent and explicit public document snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0480"
down_revision = "20261002_0470"
branch_labels = None
depends_on = None


def upgrade():
    # Earlier personal-only versions ignored legacy sharing flags. Never activate
    # those flags or memberships merely because this release restores invitations.
    op.execute("UPDATE shared_knowledge_bases SET sharing_enabled = 0")
    op.execute("DELETE FROM shared_knowledge_subscriptions")
    op.create_table(
        "shared_knowledge_publications",
        sa.Column(
            "knowledge_base_id",
            sa.String(36),
            sa.ForeignKey("shared_knowledge_bases.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("topics", sa.JSON(), nullable=False),
        sa.Column("document_ids", sa.JSON(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("shared_knowledge_publications")
    op.execute("UPDATE shared_knowledge_bases SET sharing_enabled = 0")
    op.execute("DELETE FROM shared_knowledge_subscriptions")
