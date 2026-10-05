"""Preserve execution attempts and ordered original output independently of billing."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0610"
down_revision = "20261005_0600"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agent_runs", sa.Column("last_event_sequence", sa.Integer(),
                                       nullable=False, server_default="0"))
    op.create_table(
        "agent_output_attempts",
        sa.Column("attempt_id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("agent_runs.run_id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "ordinal"),
    )
    op.create_index("ix_agent_output_attempts_run_id", "agent_output_attempts", ["run_id"])
    op.create_table(
        "agent_output_events",
        sa.Column("run_id", sa.String(36), sa.ForeignKey("agent_runs.run_id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("sequence", sa.Integer(), primary_key=True),
        sa.Column("attempt_id", sa.String(36),
                  sa.ForeignKey("agent_output_attempts.attempt_id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Historical text is an archive, never a fabricated stream/cursor history.
    op.execute(sa.text("""
        INSERT INTO agent_output_attempts (attempt_id, run_id, ordinal, status, answer, created_at)
        SELECT COALESCE(NULLIF(lease_token, ''), run_id), run_id, 1, status,
               partial_answer, started_at
        FROM agent_runs WHERE partial_answer IS NOT NULL AND partial_answer != ''
    """))


def downgrade():
    raise RuntimeError(
        "Output archives cannot be discarded by downgrade; restore to a new database."
    )
