"""Synthetic, offline compensation tests using the installed backend dependencies."""

import copy
import hashlib
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from qunxue_api.adapters.sqlite.agent_conversation_model import (
    AgentConversationRow,
    AgentMessageRow,
)
from qunxue_api.adapters.sqlite.base import Base
from qunxue_api.adapters.sqlite.conversation_summary_repository import (
    SqliteConversationSummaryRepository,
)
from qunxue_api.adapters.sqlite.durable_billing import create_billing_tables
from qunxue_api.adapters.sqlite.identity_model import UserRow
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend/src"))
spec = importlib.util.spec_from_file_location(
    "release_summary_reservations", ROOT / "ops/release_summary_reservations.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


NOW = datetime(2026, 10, 5, 9, tzinfo=UTC)
RETRY = NOW - timedelta(hours=1)
OWNERS = ["10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002"]


class ReleaseSummaryReservationsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "synthetic.db"
        self.engine = create_engine(f"sqlite:///{self.database}")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        create_billing_tables(self.engine)
        with Session(self.engine) as session:
            for index, owner in enumerate(OWNERS, start=1):
                conversation = f"20000000-0000-0000-0000-{index:012d}"
                session.add(
                    UserRow(
                        user_id=owner,
                        email=f"synthetic{index}@example.invalid",
                        password_hash="synthetic-unusable-hash",
                        created_at=RETRY,
                        updated_at=RETRY,
                    )
                )
                session.add(
                    AgentConversationRow(
                        conversation_id=conversation,
                        user_id=owner,
                        title=f"Synthetic source {index}",
                        created_at=RETRY,
                        updated_at=RETRY,
                    )
                )
                session.add(
                    AgentMessageRow(
                        message_id=f"30000000-0000-0000-0000-{index:012d}",
                        conversation_id=conversation,
                        turn_id=f"synthetic-turn-{index}",
                        role="user",
                        sequence=0,
                        content=f"Synthetic private source {index}.",
                        created_at=RETRY,
                    )
                )
            session.commit()
        self.plan = {
            "version": 1,
            "plan_id": release.PLAN_ID,
            "evidence_revision": "synthetic-reviewed-evidence-v1",
            "schema_revisions": ["synthetic_schema"],
            "users": [],
        }
        with Session(self.engine) as session:
            for owner in OWNERS:
                fingerprint = SqliteConversationSummaryRepository(session).snapshot(UUID(owner))[0]
                self.plan["users"].append(
                    {
                        "user_id": owner,
                        "fingerprint": fingerprint,
                        "day": release.DAY,
                        "expected": {
                            **release.COUNTERS,
                            "retry_after": RETRY.isoformat(),
                            "last_error": "summary_failed",
                            "lease_token": None,
                            "lease_until": None,
                            "cache_fingerprint": "",
                        },
                    }
                )
        with sqlite3.connect(self.database) as connection:
            connection.execute("CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)")
            connection.execute("INSERT INTO alembic_version VALUES ('synthetic_schema')")
            for index, user in enumerate(self.plan["users"], start=1):
                connection.execute(
                    "INSERT INTO agent_conversation_summaries "
                    "(user_id,fingerprint,attempted_fingerprint,summary,attempts,retry_after,"
                    "last_error) VALUES (?,'',?,?,2,?,'summary_failed')",
                    (
                        user["user_id"],
                        user["fingerprint"],
                        json.dumps(
                            {
                                "synthetic_metadata": index,
                                release.AUDIT_KEY: {
                                    "preflight": {"calls": 1},
                                    "other_metadata": "keep",
                                },
                            }
                        ),
                        RETRY.isoformat(),
                    ),
                )
                connection.execute(
                    "INSERT INTO agent_memory_usage VALUES (?,?,2,0,0,48000)",
                    (user["user_id"], release.DAY),
                )
                # A different day's shared quota is deliberately nonzero.
                connection.execute(
                    "INSERT INTO agent_memory_usage VALUES (?,'2026-10-04',4,11,7,18000)",
                    (user["user_id"],),
                )
                connection.execute(
                    "INSERT INTO credit_accounts (user_id,balance,active_run_id,"
                    "active_run_expires_at,created_at,updated_at) VALUES (?,73,?,?,?,?)",
                    (
                        user["user_id"],
                        f"synthetic-fence-{index}",
                        NOW.isoformat(),
                        RETRY.isoformat(),
                        RETRY.isoformat(),
                    ),
                )
                connection.execute(
                    "INSERT INTO credit_ledger (entry_id,user_id,kind,points,balance_after,"
                    "input_tokens,output_tokens,created_at) "
                    "VALUES (?,?,'signup_grant',73,73,0,0,?)",
                    (f"synthetic-entry-{index}", user["user_id"], RETRY.isoformat()),
                )
                connection.execute(
                    "INSERT INTO billing_precision VALUES (?,'7000000000000')", (user["user_id"],)
                )

    def sql(self, statement, parameters=()):
        with sqlite3.connect(self.database) as connection:
            return connection.execute(statement, parameters).fetchall()

    def dump(self):
        with sqlite3.connect(self.database) as connection:
            return "\n".join(connection.iterdump())

    def run_plan(self, *, apply=False, plan=None, now=NOW):
        return release.compensate(self.database, plan or self.plan, apply=apply, now=now)

    def assert_refused_without_writes(self, code=None, *, plan=None, now=NOW):
        before = self.dump()
        with self.assertRaises(release.Refused) as caught:
            self.run_plan(apply=True, plan=plan, now=now)
        if code:
            self.assertEqual(str(caught.exception), code)
        self.assertEqual(self.dump(), before)

    def test_default_dry_run_rolls_back_both_users_and_all_audits(self):
        before = self.dump()
        report = self.run_plan()
        self.assertEqual(report["status"], "dry_run")
        self.assertEqual(report["refunded_calls"], 4)
        self.assertEqual(report["refunded_budget_tokens"], 96000)
        self.assertEqual(self.dump(), before)

    def test_apply_only_changes_exact_shared_counters_attempts_and_audit(self):
        tables = [
            "credit_accounts",
            "credit_ledger",
            "billing_precision",
            "billing_operations",
            "billing_attempts",
            "agent_memory_scopes",
            "agent_memory_jobs",
            "agent_runs",
        ]
        untouched = {table: self.sql(f"SELECT * FROM {table}") for table in tables}
        summaries = self.sql("SELECT * FROM agent_conversation_summaries ORDER BY user_id")
        report = self.run_plan(apply=True)
        self.assertEqual(report["status"], "applied")
        self.assertEqual(
            self.sql(
                "SELECT calls,input_tokens,output_tokens,budget_tokens "
                "FROM agent_memory_usage WHERE day=?",
                (release.DAY,),
            ),
            [(0, 0, 0, 0), (0, 0, 0, 0)],
        )
        self.assertEqual(
            self.sql(
                "SELECT calls,input_tokens,output_tokens,budget_tokens "
                "FROM agent_memory_usage WHERE day='2026-10-04'"
            ),
            [(4, 11, 7, 18000), (4, 11, 7, 18000)],
        )
        for table in tables:
            self.assertEqual(self.sql(f"SELECT * FROM {table}"), untouched[table], table)
        after = self.sql("SELECT * FROM agent_conversation_summaries ORDER BY user_id")
        # Model order: owner/fingerprints/summary/updated_at/leases/retry/attempts/last_error.
        for old, new in zip(summaries, after, strict=True):
            self.assertEqual(old[:3], new[:3])
            self.assertEqual(old[4:8], new[4:8])
            self.assertEqual(new[8], 0)
            self.assertEqual(old[9:], new[9:])
            summary = json.loads(new[3])
            self.assertEqual(
                summary["synthetic_metadata"], json.loads(old[3])["synthetic_metadata"]
            )
            audit = summary[release.AUDIT_KEY]
            self.assertEqual(audit["preflight"], {"calls": 1})
            self.assertEqual(audit["other_metadata"], "keep")
            record = audit["compensations"][release.PLAN_ID]
            self.assertEqual(record["plan_digest"], report["plan_digest"])
            self.assertEqual(record["reason"], release.REASON)
            self.assertEqual(record["timestamp"], NOW.isoformat())
            self.assertEqual(record["before"]["budget_tokens"], 48000)
            self.assertEqual(record["after"]["budget_tokens"], 0)

    def test_applied_replay_is_noop_even_after_new_source_lease_and_counters(self):
        self.run_plan(apply=True)
        self.sql(
            "UPDATE agent_memory_usage SET calls=5,budget_tokens=53000 WHERE day=?", (release.DAY,)
        )
        self.sql("UPDATE agent_messages SET content='A new legitimate message'")
        self.sql(
            "UPDATE agent_conversation_summaries SET attempts=3,lease_token='new-lease',"
            "lease_until=?,fingerprint=?",
            (NOW.isoformat(), "a" * 64),
        )
        before = self.dump()
        report = self.run_plan(apply=True)
        self.assertEqual(report["status"], "already_applied")
        self.assertEqual(report["refunded_calls"], 0)
        self.assertEqual(self.dump(), before)
        self.assertEqual(self.run_plan()["status"], "already_applied")

    def test_changed_same_plan_rejects_without_another_refund(self):
        self.run_plan(apply=True)
        changed = copy.deepcopy(self.plan)
        changed["evidence_revision"] = "synthetic-changed-evidence"
        self.assert_refused_without_writes("same_plan_audit_mismatch", plan=changed)

    def test_changed_same_plan_fingerprint_rejects_without_another_refund(self):
        self.run_plan(apply=True)
        changed = copy.deepcopy(self.plan)
        changed["users"][1]["fingerprint"] = "b" * 64
        self.assert_refused_without_writes("same_plan_audit_mismatch", plan=changed)

    def test_tampered_audit_before_counters_refuses_replay(self):
        self.run_plan(apply=True)
        summary = json.loads(
            self.sql(
                "SELECT summary FROM agent_conversation_summaries WHERE user_id=?", (OWNERS[1],)
            )[0][0]
        )
        summary[release.AUDIT_KEY]["compensations"][release.PLAN_ID]["before"]["calls"] = 3
        self.sql(
            "UPDATE agent_conversation_summaries SET summary=? WHERE user_id=?",
            (json.dumps(summary), OWNERS[1]),
        )
        self.assert_refused_without_writes("same_plan_audit_mismatch")

    def test_missing_second_user_audit_after_apply_refuses_partial_replay(self):
        self.run_plan(apply=True)
        self.sql(
            "UPDATE agent_conversation_summaries SET summary='{}' WHERE user_id=?", (OWNERS[1],)
        )
        self.assert_refused_without_writes("incomplete_plan_audit")

    def test_source_change_for_second_user_is_atomic_refusal(self):
        self.sql(
            "UPDATE agent_messages SET content='changed source' WHERE conversation_id=?",
            ("20000000-0000-0000-0000-000000000002",),
        )
        self.assert_refused_without_writes("source_watermark_mismatch")

    def test_attempted_fingerprint_change_refuses(self):
        self.sql(
            "UPDATE agent_conversation_summaries SET attempted_fingerprint=? WHERE user_id=?",
            ("a" * 64, OWNERS[1]),
        )
        self.assert_refused_without_writes("attempted_fingerprint_mismatch")

    def test_lease_including_expired_lease_refuses(self):
        for until in (NOW + timedelta(minutes=5), NOW - timedelta(minutes=5)):
            with self.subTest(until=until):
                self.sql(
                    "UPDATE agent_conversation_summaries SET lease_token='synthetic-lease',"
                    "lease_until=? WHERE user_id=?",
                    (until.isoformat(), OWNERS[1]),
                )
                self.assert_refused_without_writes("lease_present")

    def test_every_counter_mismatch_refuses_both_users(self):
        for key, value in release.COUNTERS.items():
            with self.subTest(counter=key):
                table = (
                    "agent_conversation_summaries" if key == "attempts" else "agent_memory_usage"
                )
                self.sql(f"UPDATE {table} SET {key}=? WHERE user_id=?", (value + 1, OWNERS[1]))
                self.assert_refused_without_writes(
                    "attempts_mismatch" if key == "attempts" else "usage_counters_mismatch"
                )
                self.sql(f"UPDATE {table} SET {key}=? WHERE user_id=?", (value, OWNERS[1]))

    def test_retry_mismatch_and_unexpired_retry_refuse(self):
        self.sql(
            "UPDATE agent_conversation_summaries SET retry_after=? WHERE user_id=?",
            ((RETRY - timedelta(seconds=1)).isoformat(), OWNERS[1]),
        )
        self.assert_refused_without_writes("retry_state_mismatch")
        self.sql(
            "UPDATE agent_conversation_summaries SET retry_after=? WHERE user_id=?",
            (RETRY.isoformat(), OWNERS[1]),
        )
        self.assert_refused_without_writes("retry_not_expired", now=RETRY - timedelta(seconds=1))

    def test_cache_and_schema_revision_mismatch_refuse(self):
        self.sql(
            "UPDATE agent_conversation_summaries SET summary=? WHERE user_id=?",
            (json.dumps({"summary": "already generated"}), OWNERS[1]),
        )
        self.assert_refused_without_writes("summary_cache_present")
        self.sql("UPDATE alembic_version SET version_num='changed_schema'")
        self.assert_refused_without_writes("schema_revision_mismatch")

    def test_matching_billing_operation_in_any_state_refuses(self):
        fingerprint = release.billing_fingerprint(self.plan["users"][1]["fingerprint"])
        for status in ("active", "success", "error", "refunded", "cancelled", "paused", "unknown"):
            with self.subTest(status=status):
                self.sql(
                    "INSERT INTO billing_operations (run_id,user_id,fingerprint,status,"
                    "hold_points,exempt,price_json,created_at,updated_at) "
                    "VALUES ('synthetic-summary-run',?,?,?,0,1,'{}',?,?)",
                    (OWNERS[1], fingerprint, status, RETRY.isoformat(), RETRY.isoformat()),
                )
                self.assert_refused_without_writes("matching_billing_operation")
                self.sql("DELETE FROM billing_operations WHERE run_id='synthetic-summary-run'")

    def test_matching_digest_owned_by_different_user_refuses(self):
        fingerprint = release.billing_fingerprint(self.plan["users"][1]["fingerprint"])
        self.sql(
            "INSERT INTO billing_operations (run_id,user_id,fingerprint,status,"
            "hold_points,exempt,price_json,created_at,updated_at) "
            "VALUES ('synthetic-summary-run',?,?,'unknown',0,1,'{}',?,?)",
            (OWNERS[0], fingerprint, RETRY.isoformat(), RETRY.isoformat()),
        )
        self.assert_refused_without_writes("matching_billing_operation")

    def test_unknown_orphan_attempt_refuses(self):
        self.sql(
            "INSERT INTO billing_attempts (attempt_id,run_id,endpoint_id,request_hash,"
            "requested_model,outcome,usage_state,input_limit,output_limit,"
            "reserved_cost_pico,price_json,created_at,updated_at) "
            "VALUES ('synthetic-attempt','absent-run','synthetic-endpoint','hash',"
            "'synthetic-model','unknown','unknown',1,1,3,'{}',?,?)",
            (RETRY.isoformat(), RETRY.isoformat()),
        )
        self.assert_refused_without_writes("unattributable_billing_attempt")

    def test_unrelated_billing_operation_is_untouched(self):
        self.sql(
            "INSERT INTO billing_operations (run_id,user_id,fingerprint,status,"
            "hold_points,exempt,price_json,created_at,updated_at) "
            "VALUES ('synthetic-other-run',?,?,'unknown',19,0,'{}',?,?)",
            (OWNERS[0], "a" * 64, RETRY.isoformat(), RETRY.isoformat()),
        )
        before = self.sql("SELECT * FROM billing_operations")
        self.assertEqual(self.run_plan(apply=True)["status"], "applied")
        self.assertEqual(self.sql("SELECT * FROM billing_operations"), before)

    def test_exception_during_second_user_write_rolls_back_first_user(self):
        before = self.dump()
        original = release._json

        def fail_second(value):
            if type(value) is dict and value.get("synthetic_metadata") == 2:
                raise RuntimeError("synthetic write failure")
            return original(value)

        with (
            patch.object(release, "_json", side_effect=fail_second),
            self.assertRaises(RuntimeError),
        ):
            self.run_plan(apply=True)
        self.assertEqual(self.dump(), before)

    def test_trigger_on_changed_tables_refuses_without_writes(self):
        self.sql(
            "CREATE TRIGGER synthetic_surprise AFTER UPDATE ON agent_memory_usage "
            "BEGIN UPDATE credit_accounts SET balance=balance+1; END"
        )
        self.assert_refused_without_writes("unexpected_update_trigger")

    def test_manifest_scope_is_fixed_and_exactly_two_users(self):
        for update in (
            {"plan_id": "other-plan"},
            {"users": self.plan["users"][:1]},
            {"users": self.plan["users"] * 2},
            {"version": True},
            {"users": [self.plan["users"][0], self.plan["users"][0]]},
        ):
            with self.subTest(update=list(update)):
                changed = {**self.plan, **update}
                self.assert_refused_without_writes(plan=changed)

    def test_operation_fingerprint_matches_runtime_payload_encoding(self):
        source = self.plan["users"][0]["fingerprint"]
        payload = {"context_fingerprint": source}
        self.assertEqual(
            release.billing_fingerprint(source),
            hashlib.sha256(
                json.dumps(
                    payload,
                    default=str,
                    sort_keys=True,
                    ensure_ascii=False,
                ).encode()
            ).hexdigest(),
        )
        self.assertNotEqual(
            release.billing_fingerprint(source),
            hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest(),
        )

    def test_cli_defaults_to_dry_run_and_does_not_print_sources_or_user_ids(self):
        plan_file = Path(self.temporary.name) / "private-plan.json"
        plan_file.write_text(json.dumps(self.plan))
        before = self.dump()
        output = io.StringIO()
        with redirect_stdout(output), patch.object(release, "datetime") as clock:
            clock.now.return_value = NOW
            clock.fromisoformat.side_effect = datetime.fromisoformat
            result = release.main(["--database", str(self.database), "--plan", str(plan_file)])
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "dry_run")
        for private in [*OWNERS, "Synthetic private source", "synthetic-unusable-hash"]:
            self.assertNotIn(private, output.getvalue())
        self.assertEqual(self.dump(), before)

    def test_cli_sanitizes_sql_exception_details_and_preserves_database(self):
        plan_file = Path(self.temporary.name) / "private-plan.json"
        plan_file.write_text(json.dumps(self.plan))
        output = io.StringIO()
        with (
            patch.object(release, "compensate", side_effect=RuntimeError("private SQL row value")),
            redirect_stdout(output),
        ):
            self.assertEqual(
                release.main(["--database", str(self.database), "--plan", str(plan_file)]), 1
            )
        self.assertEqual(
            json.loads(output.getvalue()), {"status": "failed", "error": "RuntimeError"}
        )
        self.assertNotIn("private SQL row value", output.getvalue())


if __name__ == "__main__":
    unittest.main()
