"""Cache source-linked recent conversation excerpts without model calls."""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "20261004_0550"
down_revision = "20261003_0540"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "agent_conversations",
        sa.Column("context_digest", sa.JSON(), nullable=False, server_default="{}"),
    )
    connection = op.get_bind()
    # Keyset batches keep historical backfill bounded. Only user text is cached;
    # assistant text could contain derivatives of subsequently deleted sources.
    after = ""
    secret = re.compile(
        r"sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
        r"[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
        r"|(?:api[_ -]?key|access[_ -]?token|password|密码|密钥)\s*[:=：]\s*[\"']?[^\s\"']{6,}",
        re.I,
    )
    while True:
        ids = (
            connection.execute(
                sa.text(
                    "SELECT conversation_id FROM agent_conversations "
                    "WHERE conversation_id > :after "
                    "ORDER BY conversation_id LIMIT 100"
                ),
                {"after": after},
            )
            .scalars()
            .all()
        )
        if not ids:
            break
        for conversation_id in ids:
            messages = (
                connection.execute(
                    sa.text(
                        "SELECT message_id, sequence, content FROM agent_messages "
                        "WHERE conversation_id=:id AND role='user' ORDER BY sequence DESC LIMIT 3"
                    ),
                    {"id": conversation_id},
                )
                .mappings()
                .all()
            )
            if not messages:
                continue
            items = []
            for message in reversed(messages):
                text = " ".join(secret.sub("[REDACTED_SECRET]", message["content"]).split())
                items.append(
                    {
                        "message_id": message["message_id"],
                        "sequence": message["sequence"],
                        "excerpt": text if len(text) <= 360 else text[:359] + "…",
                    }
                )
            digest = {
                "version": 1,
                "kind": "user_excerpt",
                "through_sequence": items[-1]["sequence"],
                "items": items,
            }
            connection.execute(
                sa.text(
                    "UPDATE agent_conversations SET context_digest=:digest "
                    "WHERE conversation_id=:id"
                ),
                {"id": conversation_id, "digest": json.dumps(digest, ensure_ascii=False)},
            )
        after = ids[-1]


def downgrade():
    op.drop_column("agent_conversations", "context_digest")
