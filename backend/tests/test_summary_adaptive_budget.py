"""Actual fault shape and real SDK fixtures; no live-provider/production claim."""

import hashlib
import importlib.util
import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event, Thread
from types import SimpleNamespace
from uuid import UUID

import pytest
from billing_test_support import configure_synthetic_billing
from sqlalchemy import text, update
from streaming_test_support import chat_http_response
from test_agent_memory import register
from test_conversation_context import seed
from test_conversation_summary import output, worker
from test_conversation_summary_diagnostics import _completion, _wire_summarizer

from qunxue_api.adapters.research_agent.conversation_summarizer import (
    PydanticConversationSummarizer,
)
from qunxue_api.adapters.sqlite.agent_conversation_model import (
    AgentConversationRow,
    AgentMessageRow,
)
from qunxue_api.adapters.sqlite.agent_memory_model import (
    ConversationSummaryRow,
    MemoryUsageRow,
    invalidate_conversation_summary,
)
from qunxue_api.adapters.sqlite.identity_model import UserRow

AUDIT = "_reservation_release_audit"


def inspector():
    path = Path(__file__).resolve().parents[2] / "ops/inspect_summary_budget.py"
    spec = importlib.util.spec_from_file_location("inspect_summary_budget", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def legacy_stalled(client):
    owner = UUID(register(client))
    seed(client, owner, ("杭州交通预算五百元", "杭州行程想比较高铁和大巴"))
    seed(client, owner, ("读书会演讲五分钟，需要保留对照例子",))
    older = datetime.now(UTC) - timedelta(seconds=3000)
    with client.app.state.database.session() as session:
        session.get(UserRow, str(owner)).role = "admin"
        session.execute(update(AgentConversationRow).values(updated_at=older))
        session.execute(update(AgentMessageRow).values(created_at=older))
        session.add(MemoryUsageRow(
            user_id=str(owner), day=datetime.now(UTC).date().isoformat(), calls=2,
            budget_tokens=48000, input_tokens=0, output_tokens=0,
        ))
        session.add(ConversationSummaryRow(
            user_id=str(owner), fingerprint="", attempted_fingerprint="unrelated-old-source",
            summary={}, attempts=0,
        ))
    return owner


def usage(client, owner, day=None):
    with client.app.state.database.session() as session:
        row = session.get(MemoryUsageRow, (str(owner), day or datetime.now(UTC).date().isoformat()))
        return row.calls, row.budget_tokens, row.input_tokens, row.output_tokens


def test_read_only_inspector_is_identical_to_runtime_and_never_changes_db(plain_client):
    owner = legacy_stalled(plain_client)
    module = inspector()
    summarizer = PydanticConversationSummarizer(
        base_url="https://synthetic.test/v1", api_key="synthetic", model="gpt-6-luna",
    )
    path = Path(plain_client.app.state.database.engine.url.database)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    result = module.inspect(path)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    with plain_client.app.state.context_summary_scope() as repo:
        snapshot = repo.snapshot(owner)
    assert result["reservation_tokens"] == summarizer.reservation_tokens(snapshot[1], snapshot[3])
    assert result["within_token_budget"] and result["reservation_tokens"] <= 16000
    assert result["provider_called"] is False and result["database_changed"] is False
    assert str(owner) not in json.dumps(result) and "杭州" not in json.dumps(result)
    assert usage(plain_client, owner) == (2, 48000, 0, 0)


def test_current_48000_old_reservation_still_allows_actual_sdk_three_cards(
    plain_client, monkeypatch,
):
    owner = legacy_stalled(plain_client)
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        wire, _ = _completion(body, SimpleNamespace(sources=payload["sources"]))
        sources = [s for s in payload["sources"] if s["role"] == "user"]
        refs = [{"conversation_id": s["conversation_id"], "message_id": s["message_id"],
                 "quote": s["content"]} for s in sources]
        value = {
            "summary": "最近讨论了杭州周末交通预算和五分钟读书会演讲。",
            "summary_sources": refs,
            "cards": [{"title": s["content"],
                       "description": f"你具体提到：{s['content']}，可以一起继续讨论。",
                       "sources": [ref]} for s, ref in zip(sources, refs, strict=True)],
        }
        wire["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = json.dumps(
            value, ensure_ascii=False,
        )
        return chat_http_response(wire, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)
    current = worker(plain_client)
    current.idle_seconds = 600
    current.generate, current.billing = summarizer, plain_client.app.state.billing_operations
    pending = plain_client.get("/api/agent/context-summary").json()
    assert pending["status"] == "pending" and pending["status_reason"] == "queued"
    assert current.run_once()
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "ready" and body["summary"] and len(body["cards"]) == 3
    assert len(requests) == 1 and usage(plain_client, owner) == (3, 48100, 80, 20)
    assert not current.run_once()


def claimed(client, *, reserve=7000):
    owner = UUID(register(client))
    seed(client, owner)
    with client.app.state.context_summary_scope() as repo:
        batch = repo.claim(
            idle_seconds=0, daily_calls=8, daily_tokens=64000,
            reservation_estimator=lambda *_: reserve,
        )
    return owner, batch


def billed(client, batch, *, known=True, input_tokens=80, output_tokens=20, extra=None):
    configure_synthetic_billing(client.app, phase="conversation_summary")
    billing = client.app.state.billing_operations
    with billing.open(user_id=batch.user_id, run_id=batch.lease_token,
                      payload={"context_fingerprint": batch.fingerprint},
                      phase="conversation_summary") as scope:
        attempt = scope.runtime.before_attempt(
            run_id=scope.run_id, endpoint_id="synthetic", model="gpt-6-luna",
            input_limit=max(100000, input_tokens), output_limit=max(1800, output_tokens),
            request_hash="synthetic", provider_host="synthetic.test",
        )
        if known:
            scope.runtime.complete_attempt(
                attempt_id=attempt, returned_model="gpt-6-luna", outcome="error",
                input_tokens=input_tokens, output_tokens=output_tokens,
                cache_read_tokens=0, cache_write_tokens=0,
            )
        if extra:
            other = scope.runtime.before_attempt(
                run_id=scope.run_id, endpoint_id="synthetic", model="gpt-6-luna",
                input_limit=1000, output_limit=1800, request_hash="other-synthetic",
                provider_host="synthetic.test",
            )
            if extra == "not_sent":
                assert scope.runtime.release_proven_not_sent(other)
        scope.finish("error")
    return attempt


def test_failed_invalid_structured_output_counts_known_usage_without_publishing(
    plain_client, monkeypatch,
):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        wire, _ = _completion(
            body, SimpleNamespace(sources=payload["sources"]), invalid_output=True,
        )
        return chat_http_response(wire, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)
    current = worker(plain_client)
    current.generate, current.billing = summarizer, plain_client.app.state.billing_operations
    assert current.run_once()
    assert len(requests) == 1 and usage(plain_client, owner) == (1, 100, 80, 20)
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "failed"


@pytest.mark.parametrize("input_tokens,output_tokens", [(0, 0), (8000, 2000)])
def test_known_zero_and_overrun_replace_estimate_exactly_once(
    plain_client, input_tokens, output_tokens,
):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch, input_tokens=input_tokens, output_tokens=output_tokens)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(batch)
        assert not repo.reconcile_failed_usage(batch)
    assert usage(plain_client, owner) == (1, input_tokens + output_tokens,
                                         input_tokens, output_tokens)


def test_old_known_lease_settles_without_changing_replacement_lease(plain_client):
    owner, a = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        session.get(ConversationSummaryRow, str(owner)).lease_until = (
            datetime.now(UTC) - timedelta(seconds=1)
        )
    with plain_client.app.state.context_summary_scope() as repo:
        b = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000,
                       reservation_estimator=lambda *_: 8000)
    assert b is not None
    billed(plain_client, a)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(a)
        assert not repo.reconcile_failed_usage(a)
    assert usage(plain_client, owner) == (2, 8100, 80, 20)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.lease_token == b.lease_token and row.attempts == 2
        assert row.summary[AUDIT]["active_reservation"]["lease_token"] == b.lease_token
        assert row.summary[AUDIT]["reservations"][b.lease_token]["state"] == "reserved"
    billed(plain_client, b)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(b)
        assert not repo.reconcile_failed_usage(b)
        assert not repo.reconcile_failed_usage(a)
    assert usage(plain_client, owner) == (2, 200, 160, 40)


def test_unknown_dispatch_is_never_reclaimed(plain_client):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch, known=False)
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.reconcile_failed_usage(batch)
    assert usage(plain_client, owner) == (1, 7000, 0, 0)


@pytest.mark.parametrize("short", [False, True])
def test_exact_budget_boundary_matches_read_and_claim_without_partial_writes(plain_client, short):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    day = datetime.now(UTC).date().isoformat()
    with plain_client.app.state.database.session() as session:
        session.add(MemoryUsageRow(user_id=str(owner), day=day, calls=2,
                                   budget_tokens=48000, input_tokens=0, output_tokens=0))
    def estimator(*_):
        return 16000 + int(short)
    with plain_client.app.state.context_summary_scope() as repo:
        body = repo.read(owner, idle_seconds=0, reservation_estimator=estimator)
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000,
                           reservation_estimator=estimator)
    assert (batch is None) == short
    assert body["status"] == ("failed" if short else "pending")
    assert usage(plain_client, owner) == ((2, 48000, 0, 0) if short else (3, 64000, 0, 0))
    if short:
        with plain_client.app.state.database.session() as session:
            assert session.get(ConversationSummaryRow, str(owner)) is None


def test_variable_preflight_release_removes_only_own_estimate_and_fences_replay(plain_client):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        session.execute(update(MemoryUsageRow).values(
            calls=3, budget_tokens=7077, input_tokens=50, output_tokens=27,
        ))
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.failed(
            batch, code="billing_open:phase_policy_missing", release_reservation=True,
        )
        assert not repo.failed(batch, code="billing_open:phase_policy_missing",
                               release_reservation=True)
        assert not repo.reconcile_failed_usage(batch)
    assert usage(plain_client, owner) == (2, 77, 50, 27)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.summary[AUDIT]["reservations"][batch.lease_token]["state"] == "not_sent"


@pytest.mark.parametrize("change", [
    "owner", "fingerprint", "missing", "active", "paused", "unknown", "prepared",
    "dispatch_started", "legacy_unknown", "negative", "missing_count", "wrong_amount",
])
def test_incomplete_or_mismatched_billing_evidence_never_reduces_reservation(plain_client, change):
    owner, batch = claimed(plain_client)
    attempt = billed(plain_client, batch)
    with plain_client.app.state.database.session() as session:
        if change in {"active", "paused"}:
            session.execute(text("UPDATE billing_operations SET status=:state WHERE run_id=:run"),
                            {"state": change, "run": batch.lease_token})
        elif change == "owner":
            session.execute(text("UPDATE billing_operations SET user_id='wrong-owner'"))
        elif change == "fingerprint":
            session.execute(text("UPDATE billing_operations SET fingerprint='wrong-fingerprint'"))
        elif change == "unknown":
            session.execute(text("UPDATE billing_attempts SET usage_state='unknown'"))
        elif change in {"prepared", "dispatch_started", "legacy_unknown"}:
            session.execute(text("UPDATE billing_attempts SET dispatch_state=:state"),
                            {"state": change})
        elif change == "negative":
            session.execute(text(
                "UPDATE billing_attempts SET input_tokens=-1 WHERE attempt_id=:id",
            ), {"id": attempt})
        elif change == "missing_count":
            session.execute(text("UPDATE billing_attempts SET output_tokens=NULL"))
    supplied = replace(batch, lease_token="missing-run") if change == "missing" else (
        replace(batch, reserved_tokens=1) if change == "wrong_amount" else batch
    )
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.reconcile_failed_usage(supplied)
    assert usage(plain_client, owner) == (1, 7000, 0, 0)


@pytest.mark.parametrize("extra", ["not_sent", "unknown"])
def test_every_attempt_is_required_before_usage_can_be_settled(plain_client, extra):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch, extra=extra)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(batch) is (extra == "not_sent")
    assert usage(plain_client, owner) == ((1, 100, 80, 20) if extra == "not_sent"
                                       else (1, 7000, 0, 0))


@pytest.mark.parametrize("change", ["source", "disabled", "expired", "storage"])
def test_failed_publication_still_accounts_proven_usage(plain_client, monkeypatch, change):
    from qunxue_api.adapters.sqlite.conversation_summary_repository import (
        SqliteConversationSummaryRepository,
    )

    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner)
    configure_synthetic_billing(plain_client.app, phase="conversation_summary")

    def reply(request, body):
        payload = json.loads(next(m["content"] for m in body["messages"] if m["role"] == "user"))
        wire, _ = _completion(body, SimpleNamespace(sources=payload["sources"]))
        return chat_http_response(wire, request=request)

    summarizer, requests, _ = _wire_summarizer(monkeypatch, reply)

    def generate(batch):
        result = summarizer(batch)
        if change == "disabled":
            with plain_client.app.state.memory_service_scope() as memory:
                memory.repository.configure(owner, None, expected_version=0,
                                            use_memory=False, learn_memory=False)
        elif change != "storage":
            with plain_client.app.state.database.session() as session:
                if change == "source":
                    session.get(AgentConversationRow, str(conversation.conversation_id)).title = (
                        "原安排已经发生更正"
                    )
                else:
                    session.get(ConversationSummaryRow, str(owner)).lease_until = (
                        datetime.now(UTC) - timedelta(seconds=1)
                    )
        return result

    generate.reservation_tokens = summarizer.reservation_tokens
    if change == "storage":
        def broken_publish(*_):
            raise sqlite3.OperationalError("synthetic_storage_failure")
        monkeypatch.setattr(SqliteConversationSummaryRepository, "complete", broken_publish)
    current = worker(plain_client)
    current.generate, current.billing = generate, plain_client.app.state.billing_operations
    assert current.run_once()
    assert len(requests) == 1 and usage(plain_client, owner) == (1, 100, 80, 20)
    body = plain_client.get("/api/agent/context-summary").json()
    if change in {"source", "expired"}:
        assert body["summary"] and body["is_stale"]
    else:
        assert body["status"] != "ready" and not body["cards"] and not body["summary"]


def test_usage_and_receipt_roll_back_together_if_second_write_is_refused(plain_client):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch)
    with plain_client.app.state.database.session() as session:
        session.execute(text("""CREATE TRIGGER refuse_summary_usage_update
            BEFORE UPDATE ON agent_memory_usage BEGIN SELECT RAISE(IGNORE); END"""))
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.reconcile_failed_usage(batch)
    assert usage(plain_client, owner) == (1, 7000, 0, 0)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.summary[AUDIT]["reservations"][batch.lease_token]["state"] == "reserved"


def test_outer_failure_rolls_back_usage_and_receipt(plain_client):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch)
    with pytest.raises(RuntimeError), plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(batch)
        raise RuntimeError("synthetic_abort")
    assert usage(plain_client, owner) == (1, 7000, 0, 0)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.summary[AUDIT]["reservations"][batch.lease_token]["state"] == "reserved"


def test_accounting_does_not_write_billing_or_credit_data(plain_client):
    owner, batch = claimed(plain_client)
    billed(plain_client, batch)
    tables = ("billing_operations", "billing_attempts", "credit_accounts", "credit_ledger")
    with plain_client.app.state.database.engine.connect() as conn:
        before = {table: conn.execute(text(f"SELECT * FROM {table}")).all() for table in tables}
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.reconcile_failed_usage(batch)
    with plain_client.app.state.database.engine.connect() as conn:
        after = {table: conn.execute(text(f"SELECT * FROM {table}")).all() for table in tables}
    assert before == after and usage(plain_client, owner) == (1, 100, 80, 20)


def test_publication_cannot_resurrect_old_receipt_and_steal_historical_budget(
    plain_client, monkeypatch,
):
    from qunxue_api.adapters.sqlite.conversation_summary_repository import (
        SqliteConversationSummaryRepository,
    )

    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    day = datetime.now(UTC).date().isoformat()
    with plain_client.app.state.database.session() as session:
        session.add(MemoryUsageRow(user_id=str(owner), day=day, calls=2, budget_tokens=48000,
                                   input_tokens=0, output_tokens=0))
    with plain_client.app.state.context_summary_scope() as repo:
        a = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000,
                       reservation_estimator=lambda *_: 7000)
    with plain_client.app.state.database.session() as session:
        session.get(ConversationSummaryRow, str(owner)).lease_until = (
            datetime.now(UTC) - timedelta(seconds=1)
        )
    with plain_client.app.state.context_summary_scope() as repo:
        b = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000,
                       reservation_estimator=lambda *_: 8000)
    billed(plain_client, a)
    billed(plain_client, b, input_tokens=1200, output_tokens=300)
    loaded_b, release_b, started_a, done_a = Event(), Event(), Event(), Event()
    failures = []
    preserve = SqliteConversationSummaryRepository._preserve_reservation_audit

    def pause_after_read(value, previous, *, clear_active=False):
        if clear_active:
            loaded_b.set()
            assert release_b.wait(5)
        return preserve(value, previous, clear_active=clear_active)

    monkeypatch.setattr(SqliteConversationSummaryRepository, "_preserve_reservation_audit",
                        staticmethod(pause_after_read))

    def publish_b():
        try:
            with plain_client.app.state.context_summary_scope() as repo:
                assert repo.complete(b, output(b)[0], 1200, 300)
            with plain_client.app.state.context_summary_scope() as repo:
                assert repo.reconcile_failed_usage(b)
        except Exception as error:
            failures.append(error)

    def settle_a():
        started_a.set()
        try:
            with plain_client.app.state.context_summary_scope() as repo:
                assert repo.reconcile_failed_usage(a)
        except Exception as error:
            failures.append(error)
        finally:
            done_a.set()

    b_thread, a_thread = Thread(target=publish_b), Thread(target=settle_a)
    b_thread.start()
    assert loaded_b.wait(5)
    a_thread.start()
    assert started_a.wait(5)
    try:
        assert not done_a.wait(0.2), "A must wait while B owns the audit write transaction"
    finally:
        release_b.set()
        b_thread.join(5)
        a_thread.join(5)
    assert not failures and not b_thread.is_alive() and not a_thread.is_alive()
    assert usage(plain_client, owner) == (4, 49600, 1280, 320)
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.reconcile_failed_usage(a)
        assert not repo.reconcile_failed_usage(b)
    assert usage(plain_client, owner) == (4, 49600, 1280, 320)


def test_preflight_prunes_only_closed_receipts_and_preserves_unresolved(plain_client):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        value = dict(row.summary)
        audit = dict(value[AUDIT])
        receipts = dict(audit["reservations"])
        receipts.update({f"closed-{index}": {"state": "known", "settled_at": str(index)}
                         for index in range(100)})
        receipts["other-unresolved"] = {"state": "reserved"}
        audit["reservations"] = receipts
        row.summary = {**value, AUDIT: audit}
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.failed(
            batch, code="billing_open:phase_policy_missing", release_reservation=True,
        )
    with plain_client.app.state.database.session() as session:
        receipts = session.get(ConversationSummaryRow, str(owner)).summary[AUDIT]["reservations"]
        assert receipts["other-unresolved"]["state"] == "reserved"
        assert len([r for r in receipts.values() if r["state"] != "reserved"]) == 64


def test_proven_unstarted_dynamic_lease_still_releases_after_source_invalidation(plain_client):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        invalidate_conversation_summary(session, owner)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.failed(
            batch, code="billing_open:phase_policy_missing", release_reservation=True,
        )
    assert usage(plain_client, owner) == (0, 0, 0, 0)
    with plain_client.app.state.database.session() as session:
        assert session.get(ConversationSummaryRow, str(owner)).attempts == 0


@pytest.mark.parametrize("kind", ["legacy_fixed", "unrecognized"])
def test_wrong_kind_cannot_release_dynamic_receipt_as_legacy(plain_client, kind):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.failed(
            replace(batch, reservation_kind=kind), code="billing_open:phase_policy_missing",
            release_reservation=True,
        )
    assert usage(plain_client, owner) == (1, 7000, 0, 0)
