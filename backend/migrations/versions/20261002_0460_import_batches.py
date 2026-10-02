"""Durable import batches, retryable items and per-owner source identity."""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0460"
down_revision = "20261002_0450"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "import_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "library_id", sa.String(36), sa.ForeignKey("shared_knowledge_bases.id"), nullable=False
        ),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_import_batches_user_id", "import_batches", ["user_id"])
    op.create_index("ix_import_batches_library_id", "import_batches", ["library_id"])
    op.create_table(
        "import_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "batch_id",
            sa.String(36),
            sa.ForeignKey("import_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_key", sa.String(64), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("media_type", sa.String(128), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("document_id", sa.String(36)),
        sa.Column("error", sa.Text()),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for field in ("batch_id", "user_id", "status"):
        op.create_index(f"ix_import_items_{field}", "import_items", [field])
    op.create_table(
        "import_sources",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("source_key", sa.String(64), primary_key=True),
        sa.Column(
            "document_id", sa.String(36), sa.ForeignKey("shared_documents.id"), nullable=False
        ),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("details", sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table("import_sources")
    op.drop_table("import_items")
    op.drop_table("import_batches")
