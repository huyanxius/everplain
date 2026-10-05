"""Owner-scoped import request receipts and local note attachments.

Source/content fingerprints use the existing import source/item JSON details;
no second ingestion queue or backfill of historical document text is needed.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0615"
down_revision = "20261005_0610"
branch_labels = None
depends_on = None


def upgrade():
    # Add in place: rebuilding the parent would cascade-delete existing queued items.
    op.add_column("import_batches", sa.Column("request_key", sa.String(64), nullable=True))
    op.add_column("import_batches", sa.Column("fingerprint", sa.String(64), nullable=True))
    op.create_index(
        "uq_import_batches_user_request", "import_batches", ["user_id", "request_key"], unique=True
    )
    op.create_table(
        "import_attachments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("import_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("shared_documents.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("media_type", sa.String(128), nullable=False),
        sa.Column("references", sa.JSON(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
    )
    for field in ("item_id", "user_id", "document_id"):
        op.create_index(f"ix_import_attachments_{field}", "import_attachments", [field])


def downgrade():
    raise RuntimeError(
        "Import receipts and attachments cannot be discarded; restore to a new database."
    )
