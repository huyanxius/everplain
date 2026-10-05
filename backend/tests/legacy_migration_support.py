"""Synthetic rows written with historical SQL contracts, never current-head ORM."""

from uuid import uuid4

from alembic import command

STAMP = "2026-10-04T00:00:00+00:00"


def create_legacy_database(path, revision, monkeypatch, config):
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", f"sqlite:///{path}")
    command.upgrade(config, revision)


def seed_user(connection):
    owner = uuid4()
    connection.execute(
        "INSERT INTO users(user_id,email,password_hash,role,status,version,created_at,updated_at) "
        "VALUES (?,?,'synthetic','member','active',1,?,?)",
        (str(owner), f"{owner}@example.test", STAMP, STAMP),
    )
    connection.execute(
        "INSERT INTO credit_accounts(user_id,balance,created_at,updated_at) VALUES (?,30,?,?)",
        (str(owner), STAMP, STAMP),
    )
    connection.execute(
        "INSERT INTO credit_ledger(entry_id,user_id,kind,points,balance_after,input_tokens,"
        "output_tokens,created_at) VALUES (?,?,'signup_grant',30,30,0,0,?)",
        (str(uuid4()), str(owner), STAMP),
    )
    return owner


def seed_conversation(connection, owner, texts):
    conversation = uuid4()
    connection.execute(
        "INSERT INTO agent_conversations(conversation_id,user_id,title,version,created_at,"
        "updated_at) VALUES (?,?,'Migration fixture',1,?,?)",
        (str(conversation), str(owner), STAMP, STAMP),
    )
    users = []
    for index, content in enumerate(texts):
        turn = uuid4()
        for offset, (role, value) in enumerate((
            ("user", content), ("assistant", "Synthetic reply"),
        )):
            message = uuid4()
            sequence = index * 2 + offset
            connection.execute(
                "INSERT INTO agent_messages(message_id,conversation_id,turn_id,role,content,"
                "citations,sequence,created_at) VALUES (?,?,?,?,?,'[]',?,?)",
                (str(message), str(conversation), str(turn), role, value, sequence, STAMP),
            )
            if role == "user":
                users.append({"message_id": str(message), "sequence": sequence, "excerpt": value})
    return conversation, users
