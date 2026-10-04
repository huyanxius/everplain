"""Private writing samples, drafts and reviewable revisions."""

import sqlalchemy as sa
from alembic import op

revision = "20261003_0530"
down_revision = "20261003_0520"
branch_labels = None
depends_on = None


def owner():
    return sa.Column(
        "user_id", sa.String(), sa.ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )


def upgrade():
    op.create_table(
        "writing_samples",
        sa.Column("sample_id", sa.String(), primary_key=True),
        owner(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("genre", sa.String(20), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("user_id", "content_hash"),
    )
    op.create_table(
        "writing_documents",
        sa.Column("document_id", sa.String(), primary_key=True),
        owner(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("genre", sa.String(20), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_table(
        "writing_revisions",
        sa.Column("revision_id", sa.String(), primary_key=True),
        owner(),
        sa.Column(
            "document_id",
            sa.String(),
            sa.ForeignKey("writing_documents.document_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("before_markdown", sa.Text(), nullable=False),
        sa.Column("after_markdown", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "writing_operations",
        sa.Column("operation_id", sa.String(), primary_key=True),
        owner(),
        sa.Column("request_key", sa.String(200), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("target", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("user_id", "request_key"),
    )
    for table in (
        "writing_samples",
        "writing_documents",
        "writing_revisions",
        "writing_operations",
    ):
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])
    op.create_index("ix_writing_revisions_document_id", "writing_revisions", ["document_id"])
    op.create_index(
        "uq_writing_running_target",
        "writing_operations",
        ["user_id", "target"],
        unique=True,
        sqlite_where=sa.text("status = 'running'"),
    )


def downgrade():
    for table in (
        "writing_operations",
        "writing_revisions",
        "writing_documents",
        "writing_samples",
    ):
        op.drop_table(table)
