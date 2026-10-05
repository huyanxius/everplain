"""Release only the two reviewed 2026-10-05 pre-network summary reservations.

Run with the installed backend Python environment. Dry-run is the default and
executes the same narrow updates inside an always-rolled-back transaction. This
does not reconcile billing, issue credits, reset retry fences, or schedule work.
"""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

PLAN_ID = "summary-pre-network-reservations-20261005"
DAY = "2026-10-05"
REASON = "memory_learning_phase_policy_missing_pre_network"
AUDIT_KEY = "_reservation_release_audit"
COUNTERS = {
    "attempts": 2,
    "calls": 2,
    "budget_tokens": 48000,
    "input_tokens": 0,
    "output_tokens": 0,
}
EXPECTED_KEYS = set(COUNTERS) | {
    "retry_after",
    "last_error",
    "lease_token",
    "lease_until",
    "cache_fingerprint",
}
SCHEMA_COLUMNS = {
    "agent_conversation_summaries": {
        "user_id",
        "fingerprint",
        "attempted_fingerprint",
        "summary",
        "attempts",
        "retry_after",
        "lease_token",
        "lease_until",
        "last_error",
    },
    "agent_memory_usage": {
        "user_id",
        "day",
        "calls",
        "budget_tokens",
        "input_tokens",
        "output_tokens",
    },
    "billing_operations": {"run_id", "user_id", "fingerprint", "status"},
    "billing_attempts": {"attempt_id", "run_id", "outcome", "usage_state"},
    "alembic_version": {"version_num"},
}


class Refused(ValueError):
    """A fixed, non-sensitive refusal code suitable for the operator report."""


def _require(condition, code):
    if not condition:
        raise Refused(code)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _timestamp(value):
    _require(type(value) is str, "invalid_retry_timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise Refused("invalid_retry_timestamp") from error
    # SQLite stores UTC timestamps without timezone information.
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _fingerprint(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_plan(plan):
    _require(
        type(plan) is dict
        and set(plan) == {"version", "plan_id", "evidence_revision", "schema_revisions", "users"},
        "invalid_plan_fields",
    )
    _require(type(plan["version"]) is int and plan["version"] == 1, "invalid_plan_version")
    _require(plan["plan_id"] == PLAN_ID, "wrong_plan_id")
    _require(
        type(plan["evidence_revision"]) is str
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", plan["evidence_revision"]),
        "invalid_evidence_revision",
    )
    revisions = plan["schema_revisions"]
    _require(
        type(revisions) is list
        and revisions
        and all(
            type(item) is str and re.fullmatch(r"[A-Za-z0-9_]{1,128}", item) for item in revisions
        )
        and len(set(revisions)) == len(revisions),
        "invalid_schema_revisions",
    )
    _require(type(plan["users"]) is list and len(plan["users"]) == 2, "exactly_two_users_required")
    owners = []
    for user in plan["users"]:
        _require(
            type(user) is dict and set(user) == {"user_id", "fingerprint", "day", "expected"},
            "invalid_user_fields",
        )
        try:
            owner = str(UUID(user["user_id"]))
        except (TypeError, ValueError, AttributeError) as error:
            raise Refused("invalid_user_id") from error
        _require(owner == user["user_id"], "noncanonical_user_id")
        owners.append(owner)
        _require(_fingerprint(user["fingerprint"]), "invalid_source_fingerprint")
        _require(user["day"] == DAY, "wrong_usage_day")
        expected = user["expected"]
        _require(
            type(expected) is dict and set(expected) == EXPECTED_KEYS, "invalid_expected_fields"
        )
        _require(
            all(
                type(expected[key]) is int and expected[key] == value
                for key, value in COUNTERS.items()
            ),
            "wrong_expected_counters",
        )
        _timestamp(expected["retry_after"])
        _require(
            type(expected["last_error"]) is str
            and expected["last_error"] in {"summary_failed", "billing_open:phase_policy_missing"},
            "unsupported_failure_evidence",
        )
        _require(
            expected["lease_token"] is None and expected["lease_until"] is None,
            "expected_lease_must_be_empty",
        )
        _require(expected["cache_fingerprint"] == "", "expected_cache_must_be_empty")
    _require(len(set(owners)) == 2, "duplicate_users")
    # User/revision ordering has no semantic meaning. All other manifest bytes
    # contribute to the immutable same-plan identity.
    canonical = {
        **plan,
        "schema_revisions": sorted(revisions),
        "users": sorted(plan["users"], key=lambda item: item["user_id"]),
    }
    return hashlib.sha256(_json(canonical).encode()).hexdigest()


def billing_fingerprint(source_fingerprint):
    """Exact SqliteBillingOperations.open payload encoding, including spaces."""
    return hashlib.sha256(
        json.dumps(
            {"context_fingerprint": source_fingerprint},
            default=str,
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _schema(connection, plan):
    tables = {
        row[0]
        for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
    }
    _require(set(SCHEMA_COLUMNS) <= tables, "unsupported_database_schema")
    for table, required in SCHEMA_COLUMNS.items():
        columns = {row[1] for row in connection.exec_driver_sql(f'PRAGMA table_info("{table}")')}
        _require(required <= columns, "unsupported_database_schema")
    actual = sorted(
        row[0] for row in connection.exec_driver_sql("SELECT version_num FROM alembic_version")
    )
    _require(actual == sorted(plan["schema_revisions"]), "schema_revision_mismatch")
    # Triggers on the two changed tables could mutate billing or other state.
    _require(
        connection.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name IN "
            "('agent_memory_usage','agent_conversation_summaries') LIMIT 1"
        ).first()
        is None,
        "unexpected_update_trigger",
    )
    _require(
        connection.exec_driver_sql(
            "SELECT 1 FROM billing_attempts a LEFT JOIN billing_operations o "
            "ON o.run_id=a.run_id WHERE o.run_id IS NULL LIMIT 1"
        ).first()
        is None,
        "unattributable_billing_attempt",
    )


def _summary(connection, owner):
    row = (
        connection.exec_driver_sql(
            "SELECT * FROM agent_conversation_summaries WHERE user_id=?", (owner,)
        )
        .mappings()
        .first()
    )
    _require(row is not None, "summary_missing")
    try:
        summary = json.loads(row["summary"], object_pairs_hook=_unique_object)
    except (TypeError, ValueError) as error:
        raise Refused("invalid_summary_json") from error
    _require(type(summary) is dict, "invalid_summary_json")
    audit = summary.get(AUDIT_KEY, {})
    _require(type(audit) is dict, "invalid_audit_json")
    compensations = audit.get("compensations", {})
    _require(type(compensations) is dict, "invalid_compensation_audit")
    return row, summary, audit, compensations


def _source_fingerprint(session, owner):
    # Reuse the runtime's exact bounded source selection, redaction, project
    # permissions, and deleted-material fences. Never serialize its sources.
    from qunxue_api.adapters.sqlite.conversation_summary_repository import (
        SqliteConversationSummaryRepository,
    )

    snapshot = SqliteConversationSummaryRepository(session).snapshot(UUID(owner))
    _require(snapshot is not None and bool(snapshot[1]), "source_unavailable")
    return snapshot[0]


def _counter_changes(user):
    return {"day": user["day"], **COUNTERS}, {
        "day": user["day"],
        "attempts": 0,
        "calls": 0,
        "budget_tokens": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }


def _verify_replay(record, user, digest, evidence_revision):
    before, after = _counter_changes(user)
    _require(
        type(record) is dict
        and set(record)
        == {
            "status",
            "plan_digest",
            "evidence_revision",
            "reason",
            "timestamp",
            "fingerprint",
            "before",
            "after",
        }
        and record["status"] == "applied"
        and record["plan_digest"] == digest
        and record["evidence_revision"] == evidence_revision
        and record["reason"] == REASON
        and record["fingerprint"] == user["fingerprint"]
        and record["before"] == before
        and record["after"] == after,
        "same_plan_audit_mismatch",
    )
    _timestamp(record["timestamp"])


def _validate_user(connection, session, user, row, summary, now):
    owner, expected = user["user_id"], user["expected"]
    _require(row["fingerprint"] == expected["cache_fingerprint"], "cache_fingerprint_mismatch")
    _require(row["attempted_fingerprint"] == user["fingerprint"], "attempted_fingerprint_mismatch")
    _require(
        _source_fingerprint(session, owner) == user["fingerprint"], "source_watermark_mismatch"
    )
    _require(row["lease_token"] is None and row["lease_until"] is None, "lease_present")
    _require(row["attempts"] == expected["attempts"], "attempts_mismatch")
    _require(row["last_error"] == expected["last_error"], "failure_evidence_mismatch")
    _require(row["retry_after"] is not None, "retry_state_mismatch")
    retry = _timestamp(row["retry_after"])
    _require(retry == _timestamp(expected["retry_after"]), "retry_state_mismatch")
    _require(retry <= now, "retry_not_expired")
    # Metadata/audit is allowed, generated cache content is not.
    _require(
        not summary.get("summary")
        and not summary.get("summary_sources")
        and not summary.get("cards"),
        "summary_cache_present",
    )
    usage = (
        connection.exec_driver_sql(
            "SELECT * FROM agent_memory_usage WHERE user_id=? AND day=?", (owner, user["day"])
        )
        .mappings()
        .first()
    )
    _require(usage is not None, "usage_missing")
    _require(
        all(usage[key] == expected[key] for key in COUNTERS if key != "attempts"),
        "usage_counters_mismatch",
    )
    operation_hash = billing_fingerprint(user["fingerprint"])
    _require(
        connection.exec_driver_sql(
            "SELECT 1 FROM billing_operations WHERE fingerprint=? LIMIT 1", (operation_hash,)
        ).first()
        is None,
        "matching_billing_operation",
    )
    _require(
        connection.exec_driver_sql(
            "SELECT 1 FROM billing_attempts a JOIN billing_operations o ON o.run_id=a.run_id "
            "WHERE o.fingerprint=? LIMIT 1",
            (operation_hash,),
        ).first()
        is None,
        "matching_billing_attempt",
    )
    return _counter_changes(user)


def compensate(database, plan, *, apply=False, now=None):
    """Validate both users before any update; rollback on every dry-run/refusal."""
    digest = validate_plan(plan)
    _require(type(apply) is bool, "invalid_apply_flag")
    database = Path(database).resolve()
    _require(database.is_file(), "database_missing")
    now = now or datetime.now(UTC)
    _require(now.tzinfo is not None, "invalid_clock")
    now = now.astimezone(UTC)
    # The source repository uses the installed backend dependencies. No bootstrap,
    # configuration, network clients, model calls, or migrations are invoked.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend/src"))
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import NullPool

    engine = create_engine(
        "sqlite://",
        poolclass=NullPool,
        creator=lambda: sqlite3.connect(
            database.as_uri() + "?mode=rw",
            uri=True,
            timeout=30,
        ),
    )
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                _schema(connection, plan)
                states = [_summary(connection, user["user_id"]) for user in plan["users"]]
                applied = []
                for user, (_, _, _, records) in zip(plan["users"], states, strict=True):
                    record = records.get(PLAN_ID)
                    if record is not None:
                        _verify_replay(record, user, digest, plan["evidence_revision"])
                    applied.append(record is not None)
                _require(not any(applied) or all(applied), "incomplete_plan_audit")
                if all(applied):
                    return {
                        "status": "already_applied",
                        "plan_id": PLAN_ID,
                        "plan_digest": digest,
                        "users": 2,
                        "refunded_calls": 0,
                        "refunded_budget_tokens": 0,
                    }
                with Session(
                    bind=connection, autoflush=False, join_transaction_mode="rollback_only"
                ) as session:
                    changes = [
                        _validate_user(connection, session, user, state[0], state[1], now)
                        for user, state in zip(plan["users"], states, strict=True)
                    ]
                for user, state, (before, after) in zip(
                    plan["users"], states, changes, strict=True
                ):
                    _, summary, audit, records = state
                    entry = {
                        "status": "applied",
                        "plan_digest": digest,
                        "evidence_revision": plan["evidence_revision"],
                        "reason": REASON,
                        "timestamp": now.isoformat(),
                        "fingerprint": user["fingerprint"],
                        "before": before,
                        "after": after,
                    }
                    summary[AUDIT_KEY] = {
                        **audit,
                        "compensations": {**records, PLAN_ID: entry},
                    }
                    updated = connection.exec_driver_sql(
                        "UPDATE agent_memory_usage SET calls=calls-2, "
                        "budget_tokens=budget_tokens-48000 "
                        "WHERE user_id=? AND day=? AND calls=2 AND budget_tokens=48000 "
                        "AND input_tokens=0 AND output_tokens=0",
                        (user["user_id"], user["day"]),
                    )
                    _require(updated.rowcount == 1, "usage_update_conflict")
                    updated = connection.exec_driver_sql(
                        "UPDATE agent_conversation_summaries SET attempts=0, summary=? "
                        "WHERE user_id=? AND attempts=2 AND attempted_fingerprint=? "
                        "AND lease_token IS NULL AND lease_until IS NULL",
                        (_json(summary), user["user_id"], user["fingerprint"]),
                    )
                    _require(updated.rowcount == 1, "summary_update_conflict")
                report = {
                    "status": "applied" if apply else "dry_run",
                    "plan_id": PLAN_ID,
                    "plan_digest": digest,
                    "evidence_revision": plan["evidence_revision"],
                    "refunded_calls": 4,
                    "refunded_budget_tokens": 96000,
                    "changes": [
                        {"user_index": index, "before": before, "after": after}
                        for index, (before, after) in enumerate(changes, start=1)
                    ],
                }
                if apply:
                    connection.commit()
                return report
            finally:
                # Also rolls back successful dry-run and already-applied replay.
                if connection.in_transaction():
                    connection.rollback()
    finally:
        engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True, help="Private reviewed JSON manifest")
    parser.add_argument(
        "--apply", action="store_true", help="Commit; omitted means rollback dry-run"
    )
    args = parser.parse_args(argv)
    try:
        with args.plan.open() as handle:
            plan = json.load(handle, object_pairs_hook=_unique_object)
        report = compensate(args.database, plan, apply=args.apply)
    except Refused as error:
        report = {"status": "refused", "reason": str(error)}
    except Exception as error:  # noqa: BLE001 - sanitize every runtime error at the CLI boundary
        # SQL/ORM exception strings can contain private row data. Never print them.
        report = {"status": "failed", "error": type(error).__name__}
    print(_json(report))
    return 0 if report["status"] in {"dry_run", "applied", "already_applied"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
