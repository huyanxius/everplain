"""Allow personal research documents without a disciplinary theory plan."""

import sqlalchemy as sa
from alembic import op

revision = "20260912_0440"
down_revision = "20260908_0430"
branch_labels = None
depends_on = None

TABLES = (
    "research_document_versions",
    "research_document_proposals",
    "research_document_identities",
    "research_document_handoffs",
)


def upgrade():
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column("theory_plan_id", existing_type=sa.String(36), nullable=True)
    op.create_index(
        "uq_personal_document_task",
        "research_document_identities",
        ["task_id"],
        unique=True,
        sqlite_where=sa.text("theory_plan_id IS NULL"),
    )
    op.create_index(
        "uq_personal_document_handoff",
        "research_document_handoffs",
        ["user_id", "task_id"],
        unique=True,
        sqlite_where=sa.text("theory_plan_id IS NULL"),
    )


def downgrade():
    # A rollback cannot invent disciplinary plans for existing personal documents.
    count = sum(
        op.get_bind().scalar(sa.text(f"SELECT count(*) FROM {table} WHERE theory_plan_id IS NULL"))
        for table in TABLES
    )
    if count:
        raise RuntimeError("Personal documents must be exported before downgrading this schema")
    op.drop_index("uq_personal_document_handoff", "research_document_handoffs")
    op.drop_index("uq_personal_document_task", "research_document_identities")
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column("theory_plan_id", existing_type=sa.String(36), nullable=False)
