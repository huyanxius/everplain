"""SQLite is the ACK boundary. State transitions never log a payload or credential."""

import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager


class SubjectBusy(Exception):
    pass


class QueueFull(Exception):
    pass


class LeaseLost(Exception):
    pass


class EventConflict(Exception):
    pass


def digest(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def event_key(event):
    return digest([event["platform"], event["bot_id"], event["tenant_id"], event["event_id"]])


def split_text(text, platform):
    # Conservative UTF-16 unit limit also handles Telegram's entity offsets;
    # Feishu UTF-8 JSON remains comfortably below its 30KB payload limit.
    limit = 4000 if platform == "telegram" else 3000
    parts, current, size = [], [], 0
    for char in text:
        units = len(char.encode("utf-16-le")) // 2
        if size + units > limit:
            parts.append("".join(current))
            current, size = [], 0
        current.append(char)
        size += units
    if current:
        parts.append("".join(current))
    return parts or ["本轮没有可发送的文本，请在 Everplain 查看会话。"]


class Store:
    def __init__(self, path, *, max_pending=10000, clock=time.time):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path, self.max_pending, self.clock = path, max_pending, clock
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS inbox (
                    key TEXT PRIMARY KEY, digest TEXT NOT NULL, scope TEXT NOT NULL,
                    principal TEXT NOT NULL,
                    event TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0, available REAL NOT NULL DEFAULT 0,
                    lease REAL NOT NULL DEFAULT 0, created REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS inbox_ready ON inbox(state, available);
                CREATE INDEX IF NOT EXISTS inbox_principal ON inbox(principal, created);
                CREATE TABLE IF NOT EXISTS outbox (
                    id TEXT PRIMARY KEY, event_key TEXT NOT NULL REFERENCES inbox(key),
                    part INTEGER NOT NULL, platform TEXT NOT NULL, chat_id TEXT NOT NULL,
                    thread_id TEXT NOT NULL DEFAULT '',
                    text TEXT NOT NULL, require_auth INTEGER NOT NULL DEFAULT 1,
                    state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                    available REAL NOT NULL DEFAULT 0, lease REAL NOT NULL DEFAULT 0,
                    remote_id TEXT, first_attempt REAL, UNIQUE(event_key, part)
                );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(inbox)")}
            for name in ("accepted", "cursor", "control", "dispatch_attempts", "uncertain"):
                if name not in columns:
                    db.execute(f"ALTER TABLE inbox ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def enqueue(self, event):
        key, body_hash = (
            event_key(event),
            digest({k: v for k, v in event.items() if k != "received_at_ms"}),
        )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT digest FROM inbox WHERE key=?", (key,)).fetchone()
            if prior:
                if prior["digest"] != body_hash:
                    raise EventConflict()
                return key
            count = db.execute(
                "SELECT (SELECT COUNT(*) FROM inbox WHERE state IN ('pending','running')) + "
                "(SELECT COUNT(*) FROM outbox WHERE state NOT IN ('sent','suppressed'))"
            ).fetchone()[0]
            if count >= self.max_pending:
                raise QueueFull()
            principal = digest(
                [event[k] for k in ("platform", "bot_id", "tenant_id", "subject_id")]
            )
            subject_count = db.execute(
                "SELECT COUNT(*) FROM inbox WHERE principal=? AND "
                "(state IN ('pending','running') OR created>?)",
                (principal, self.clock() - 60),
            ).fetchone()[0]
            if subject_count >= 20:
                raise SubjectBusy()
            scope = digest(
                [
                    event[k]
                    for k in (
                        "platform",
                        "bot_id",
                        "tenant_id",
                        "subject_id",
                        "chat_id",
                        "thread_id",
                    )
                ]
            )
            db.execute(
                "INSERT INTO inbox(key,digest,scope,principal,event,created,control) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    key,
                    body_hash,
                    scope,
                    principal,
                    json.dumps(event, ensure_ascii=False),
                    self.clock(),
                    event["text"].strip() == "/cancel",
                ),
            )
        return key

    def claim_inbox(self, *, control=False):
        now = self.clock()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                """
                SELECT * FROM inbox AS candidate
                WHERE ((state='pending' AND available<=?) OR (state='running' AND lease<=?))
                AND candidate.control=? AND (? OR NOT EXISTS (
                    SELECT 1 FROM inbox AS active WHERE active.scope=candidate.scope
                    AND active.key!=candidate.key AND active.control=0
                    AND active.state='running' AND active.lease>?
                )) AND (? OR NOT EXISTS (
                    SELECT 1 FROM inbox AS earlier WHERE earlier.scope=candidate.scope
                    AND earlier.control=0
                    AND earlier.state IN ('pending','running')
                    AND (earlier.created<candidate.created OR
                        (earlier.created=candidate.created AND earlier.key<candidate.key))
                )) ORDER BY created,key LIMIT 1
            """,
                (now, now, control, control, now, control),
            ).fetchone()
            if row is None:
                return None
            db.execute(
                "UPDATE inbox SET state='running',attempts=attempts+1,lease=? WHERE key=?",
                (now + 360, row["key"]),
            )
            return {**dict(row), "attempts": row["attempts"] + 1, "event": json.loads(row["event"])}

    def checkpoint_inbox(self, row, *, cursor=None, accepted=None, uncertain=None):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE inbox SET lease=?,cursor=MAX(cursor,COALESCE(?,cursor)),"
                "accepted=COALESCE(?,accepted),uncertain=COALESCE(?,uncertain) "
                "WHERE key=? AND state='running' AND attempts=?",
                (self.clock() + 15, cursor, accepted, uncertain, row["key"], row["attempts"]),
            ).rowcount
            if changed != 1:
                raise LeaseLost()
        if cursor is not None:
            row["cursor"] = max(row["cursor"], cursor)
        if accepted is not None:
            row["accepted"] = accepted
        if uncertain is not None:
            row["uncertain"] = uncertain

    def begin_dispatch(self, row):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE inbox SET dispatch_attempts=dispatch_attempts+1,uncertain=1,lease=? "
                "WHERE key=? AND state='running' AND attempts=?",
                (self.clock() + 15, row["key"], row["attempts"]),
            ).rowcount
            if changed != 1:
                raise LeaseLost()
            count = db.execute("SELECT dispatch_attempts FROM inbox WHERE key=?",
                               (row["key"],)).fetchone()[0]
        row["dispatch_attempts"] = count
        row["uncertain"] = True

    def complete_inbox(self, row, text, *, require_auth=True):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE inbox SET state='complete',event='{}',lease=0 "
                "WHERE key=? AND state='running' AND attempts=? AND lease>?",
                (row["key"], row["attempts"], self.clock()),
            ).rowcount
            if changed != 1:
                raise LeaseLost()
            db.execute(
                "UPDATE outbox SET state='suppressed',text='' "
                "WHERE event_key=? AND part=-1 AND state='pending'",
                (row["key"],),
            )
            for part, content in enumerate(split_text(text, row["event"]["platform"])):
                db.execute(
                    """INSERT OR IGNORE INTO outbox(
                    id,event_key,part,platform,chat_id,thread_id,text,require_auth
                ) VALUES(?,?,?,?,?,?,?,?)""",
                    (
                        digest([row["key"], part]),
                        row["key"],
                        part,
                        row["event"]["platform"],
                        row["event"]["chat_id"],
                        row["event"]["thread_id"],
                        content,
                        require_auth,
                    ),
                )

    def _notice(self, db, row, part, text, delay=0):
        db.execute(
            """INSERT OR IGNORE INTO outbox(
            id,event_key,part,platform,chat_id,thread_id,text,require_auth,available
        ) VALUES(?,?,?,?,?,?,?,0,?)""",
            (
                digest([row["key"], part]),
                row["key"],
                part,
                row["event"]["platform"],
                row["event"]["chat_id"],
                row["event"]["thread_id"],
                text,
                self.clock() + delay,
            ),
        )

    def progress(self, row):
        if row["event"]["text"].startswith("/"):
            return
        with self.connect() as db:
            self._notice(db, row, -1, "已收到，正在处理。完成后会在这里回复。", delay=2)

    def fail_inbox(self, row):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE inbox SET state='dead',lease=0 WHERE key=? "
                "AND state='running' AND attempts=?",
                (row["key"], row["attempts"]),
            ).rowcount
            if changed != 1:
                raise LeaseLost()
            db.execute(
                "UPDATE outbox SET state='suppressed',text='' "
                "WHERE event_key=? AND part=-1 AND state='pending'",
                (row["key"],),
            )
            self._notice(db, row, -2, "暂时未能完成这条消息。请在 Everplain 查看会话，或稍后重试。")

    def retry_inbox(self, key, *, attempt, delay, dead=False):
        with self.connect() as db:
            db.execute(
                "UPDATE inbox SET state=?,available=?,lease=0 WHERE key=? "
                "AND state='running' AND attempts=?",
                ("dead" if dead else "pending", self.clock() + delay, key, attempt),
            )

    def claim_outbox(self):
        now = self.clock()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Feishu UUID deduplication lasts one hour, measured from FIRST attempt.
            db.execute(
                "UPDATE outbox SET state='ambiguous' WHERE platform='feishu' "
                "AND state IN ('sending','pending') AND first_attempt IS NOT NULL "
                "AND first_attempt<=?",
                (now - 3300,),
            )
            # A crash while Telegram may have accepted a message is not a safe retry.
            db.execute(
                "UPDATE outbox SET state='ambiguous' WHERE state='sending' "
                "AND platform='telegram' AND lease<=?",
                (now,),
            )
            db.execute(
                "UPDATE outbox SET state='pending' WHERE state='sending' "
                "AND platform='feishu' AND lease<=?",
                (now,),
            )
            row = db.execute(
                """
                SELECT * FROM outbox AS candidate WHERE state='pending' AND available<=?
                AND NOT EXISTS (SELECT 1 FROM outbox AS prior
                    WHERE prior.event_key=candidate.event_key AND prior.part<candidate.part
                    AND prior.part>=0 AND prior.state!='sent') ORDER BY rowid LIMIT 1
            """,
                (now,),
            ).fetchone()
            if row is None:
                return None
            db.execute(
                "UPDATE outbox SET state='sending',attempts=attempts+1,lease=?, "
                "first_attempt=COALESCE(first_attempt,?) WHERE id=?",
                (now + 600, now, row["id"]),
            )
            return {**dict(row), "attempts": row["attempts"] + 1}

    def finish_outbox(self, id, state, *, attempt, delay=0, remote_id=None):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE outbox SET state=?,available=?,lease=0,remote_id=? WHERE id=? "
                "AND state='sending' AND attempts=?",
                (state, self.clock() + delay, remote_id, id, attempt),
            ).rowcount
            if changed != 1:
                raise LeaseLost()
            if state in {"sent", "suppressed"}:
                db.execute("UPDATE outbox SET text='' WHERE id=?", (id,))
            if state == "suppressed":
                db.execute(
                    "UPDATE outbox SET state='suppressed',text='',lease=0 "
                    "WHERE event_key=(SELECT event_key FROM outbox WHERE id=?) "
                    "AND state IN ('pending','sending')",
                    (id,),
                )

    def counts(self):
        with self.connect() as db:
            return {
                table: {
                    row[0]: row[1]
                    for row in db.execute(f"SELECT state,COUNT(*) FROM {table} GROUP BY state")
                }
                for table in ("inbox", "outbox")
            }
