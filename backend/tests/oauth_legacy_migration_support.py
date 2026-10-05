"""0620-era SQL contracts from public base 4f2d580; no current UserRow writes."""

import hashlib
import json
from uuid import uuid4

from argon2 import PasswordHasher

LEGACY_SOURCE = "4f2d580f3ac752303dee19d8c4400616069872cf"
STAMP = "2026-10-04 00:00:00.000000"
LATER = "2026-10-04 01:00:00.000000"
PASSWORD = "synthetic-passphrase-only"


def seed_account(connection, *, email=None, password_hash=None):
    owner, session_id, credential = (str(uuid4()) for _ in range(3))
    email = email or f"{owner}@example.test"
    password_hash = password_hash or PasswordHasher().hash(PASSWORD)
    connection.execute(
        "INSERT INTO users(user_id,email,password_hash,display_name,role,status,version,"
        "created_at,updated_at) VALUES (?,?,?,'Synthetic owner','member','active',1,?,?)",
        (owner, email, password_hash, STAMP, STAMP),
    )
    connection.execute(
        "INSERT INTO user_sessions(session_id,user_id,token_digest,version,created_at,"
        "expires_at,revoked_at,last_seen_at) VALUES (?,?,?,1,?,'2099-10-05',NULL,?)",
        (session_id, owner, hashlib.sha256(credential.encode()).hexdigest(), STAMP, STAMP),
    )
    connection.execute(
        "INSERT INTO credit_accounts(user_id,balance,created_at,updated_at) VALUES (?,30,?,?)",
        (owner, STAMP, STAMP),
    )
    connection.execute(
        "INSERT INTO credit_ledger(entry_id,user_id,kind,points,balance_after,input_tokens,"
        "output_tokens,created_at) VALUES (?,?,'signup_grant',30,30,0,0,?)",
        (str(uuid4()), owner, STAMP),
    )
    return {
        "owner": owner,
        "session_id": session_id,
        "credential": credential,
        "email": email,
        "password_hash": password_hash,
    }


def seed_imports(connection, owner):
    library = str(uuid4())
    connection.execute(
        "INSERT INTO shared_knowledge_bases(id,owner_user_id,request_key,name,description,"
        "share_token,sharing_enabled,created_at,updated_at) VALUES (?,?,?,'Synthetic library',"
        "'',?,0,?,?)",
        (library, owner, str(uuid4()), str(uuid4()), STAMP, STAMP),
    )
    assets, documents, batches = {}, [], []
    for index, status in enumerate(("imported", "queued")):
        batch, item, document = (str(uuid4()) for _ in range(3))
        source_key = hashlib.sha256(str(index).encode()).hexdigest()
        content = f"# Note {index}\nSynthetic legacy content".encode()
        if "request_key" in {
            column[1] for column in connection.execute("PRAGMA table_info(import_batches)")
        }:
            connection.execute(
                "INSERT INTO import_batches(id,user_id,library_id,source_type,created_at,"
                "request_key,"
                "fingerprint) VALUES (?,?,?,'obsidian',?,?,?)",
                (batch, owner, library, STAMP, f"request-{index}", source_key),
            )
        else:
            connection.execute(
                "INSERT INTO import_batches(id,user_id,library_id,source_type,created_at) "
                "VALUES (?,?,?,'obsidian',?)",
                (batch, owner, library, STAMP),
            )
        if status == "imported":
            connection.execute(
                "INSERT INTO shared_documents(id,owner_user_id,request_key,filename,media_type,"
                "content_hash,content,size_bytes,parse_id,status,segments,vectors,"
                "warnings,created_at) "
                "VALUES (?,?,?,'note.md','text/markdown',?,?,?,?,'ready','[]','{}','[]',?)",
                (
                    document,
                    owner,
                    str(uuid4()),
                    source_key,
                    content,
                    len(content),
                    str(uuid4()),
                    STAMP,
                ),
            )
            connection.execute(
                "INSERT INTO shared_knowledge_documents(knowledge_base_id,document_id) "
                "VALUES (?,?)",
                (library, document),
            )
            documents.append(document)
        connection.execute(
            "INSERT INTO import_items(id,batch_id,user_id,source_key,title,filename,relative_path,"
            "content,media_type,details,status,document_id,attempts,created_at) "
            "VALUES (?,?,?,?,'Legacy note','note.md',?,?, 'text/markdown','{}',?,?,?,?)",
            (
                item,
                batch,
                owner,
                source_key,
                f"Vault/{index}/note.md",
                b"" if status == "imported" else content,
                status,
                document if status == "imported" else None,
                1 if status == "imported" else 0,
                STAMP,
            ),
        )
        if status == "imported":
            connection.execute(
                "INSERT INTO import_sources(user_id,source_key,document_id,relative_path,details) "
                "VALUES (?,?,?,?,'{}')",
                (owner, source_key, document, f"Vault/{index}/note.md"),
            )
        attachment_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_attachments'"
        ).fetchone()
        for asset_index in range((2 if index == 0 else 1) if attachment_table else 0):
            attachment = str(uuid4())
            binary = b"\x00\xffbinary-attachment" + bytes([index, asset_index])
            connection.execute(
                "INSERT INTO import_attachments(id,item_id,user_id,document_id,relative_path,"
                'filename,media_type,"references",size_bytes,content) VALUES (?,?,?,?,?,?,?,?,?,?)',
                (
                    attachment,
                    item,
                    owner,
                    document if status == "imported" else None,
                    f"Vault/assets/{index}-{asset_index}.png",
                    f"{index}-{asset_index}.png",
                    "image/png",
                    json.dumps([f"{index}-{asset_index}.png"]),
                    len(binary),
                    binary,
                ),
            )
            assets[attachment] = binary
        batches.append({"id": batch, "item": item, "status": status})
    return {"library": library, "documents": documents, "batches": batches, "assets": assets}


def seed_quota_history(connection, owner, *, receipt_id="synthetic-reset-receipt"):
    """Fixed pre-0640 SQL for activated, settled and reset free-quota evidence.

    These columns and values follow f6747a6's quota adapter. Never use the
    current runtime against a historical database: its required columns evolve.
    """
    started = "2026-10-04T00:00:00+00:00"
    reset = "2026-10-04T02:00:00+00:00"
    for epoch, end, balance, precision, closed, reason in (
        (0, started, 30, "0", started, "legacy_before_quota"),
        (1, "2026-10-11T00:00:00+00:00", 24, "6000000000000", reset, "quota_activation"),
        (2, "2026-10-11T02:00:00+00:00", 30, "0", None, "bank_reset"),
    ):
        connection.execute(
            "INSERT INTO credit_quota_periods(user_id,epoch,plan_id,limit_points,started_at,"
            "expires_at,balance,total_credit_pico,closed_at,reason) "
            "VALUES (?,?,'free',30,?,?,?,?,?,?)",
            (owner, epoch, reset if epoch == 2 else started,
             end, balance, precision, closed, reason),
        )
    connection.execute(
        "UPDATE credit_accounts SET quota_period_epoch=2,balance=30,updated_at=? WHERE user_id=?",
        (reset, owner),
    )
    connection.execute(
        "INSERT INTO billing_precision(user_id,total_credit_pico) VALUES (?,'0')", (owner,)
    )
    for epoch, entry, stamp, before, delta, reason, model, precision in (
        (1, str(uuid4()), started, 30, 0, "quota_activation", "quota-activation", "0"),
        (2, receipt_id, reset, 24, 6, "bank_reset", "bank-reset", "6000000000000"),
    ):
        connection.execute(
            "INSERT INTO credit_ledger(entry_id,user_id,run_id,kind,points,balance_after,"
            "quota_period_epoch,input_tokens,output_tokens,model,created_at) "
            "VALUES (?,?,NULL,'redemption',?,30,?,0,0,?,?)",
            (entry, owner, delta, epoch, model, stamp),
        )
        connection.execute(
            "INSERT INTO billing_precision_adjustments(reset_id,user_id,reason,before_precision,"
            "delta_precision,after_precision,before_balance,delta_points,after_balance,"
            "closed_operation_ids,created_at) VALUES (?,?,?,?,?,'0',?,?,30,'[]',?)",
            (entry, owner, reason, precision, str(-int(precision)), before, delta, stamp),
        )
    epoch, balance = connection.execute(
        "SELECT epoch,balance FROM credit_quota_periods WHERE user_id=? "
        "ORDER BY epoch DESC LIMIT 1",
        (owner,),
    ).fetchone()
    return {"epoch": epoch, "balance": balance}
