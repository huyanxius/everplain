"""Only proved, undispatched current leases release their exact own reservation."""

from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text
from test_agent_memory import register
from test_conversation_context import seed
from test_conversation_summary import output

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentMessageRow
from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow, MemoryUsageRow

AUDIT = "_reservation_release_audit"
CODE = "billing_open:phase_policy_missing"


def claimed(client):
    owner = UUID(register(client))
    seed(client, owner)
    with client.app.state.context_summary_scope() as repository:
        batch = repository.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
    assert batch is not None
    return owner, batch


def state(client, owner, day):
    with client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        usage = session.get(MemoryUsageRow, (str(owner), day))
        return {
            "summary": deepcopy(row.summary), "lease_token": row.lease_token,
            "lease_until": row.lease_until, "attempts": row.attempts,
            "retry_after": row.retry_after, "last_error": row.last_error,
            "usage": (usage.calls, usage.budget_tokens, usage.input_tokens, usage.output_tokens),
        }


def test_exact_preflight_release_is_audited_and_idempotent(plain_client):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), batch.usage_day))
        usage.calls += 2
        usage.budget_tokens += 77
        usage.input_tokens, usage.output_tokens = 50, 27
        # Other learning and previous compensation audit remain intact.
        row = session.get(ConversationSummaryRow, str(owner))
        row.summary = {**row.summary, AUDIT: {
            **row.summary[AUDIT], "compensations": {"old-plan": {"digest": "safe"}},
        }}
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.failed(batch, code=CODE, release_reservation=True)
    after = state(plain_client, owner, batch.usage_day)
    assert after["usage"] == (2, 77, 50, 27)
    assert after["lease_token"] is None and after["lease_until"] is None
    assert after["attempts"] == 0 and after["retry_after"] is not None
    assert after["last_error"] == CODE
    audit = after["summary"][AUDIT]
    assert audit["compensations"] == {"old-plan": {"digest": "safe"}}
    assert audit["preflight"]["released_calls"] == 1
    assert audit["preflight"]["released_budget_tokens"] == 24000
    assert "active_reservation" not in audit
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.failed(batch, code=CODE, release_reservation=True) is False
    assert state(plain_client, owner, batch.usage_day) == after


@pytest.mark.parametrize("change", [
    "lease", "expired", "fingerprint", "attempts", "calls", "tokens",
    "reservation_day", "reservation_token", "audit", "wrong_day",
])
def test_unproved_or_stale_reservation_release_refuses_without_writes(plain_client, change):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        usage = session.get(MemoryUsageRow, (str(owner), batch.usage_day))
        if change == "lease":
            row.lease_token = "replacement-lease"
        elif change == "expired":
            row.lease_until = datetime.now(UTC) - timedelta(seconds=1)
        elif change == "fingerprint":
            row.attempted_fingerprint = "changed-source"
        elif change == "attempts":
            row.attempts = 0
        elif change == "calls":
            usage.calls = 0
        elif change == "tokens":
            usage.budget_tokens = 23999
        elif change == "audit":
            row.summary = {AUDIT: []}
        elif change in {"reservation_day", "reservation_token"}:
            summary = deepcopy(row.summary)
            key = "day" if change == "reservation_day" else "lease_token"
            summary[AUDIT]["active_reservation"][key] = "mismatched"
            row.summary = summary
    before = state(plain_client, owner, batch.usage_day)
    supplied = replace(batch, usage_day="2026-01-01") if change == "wrong_day" else batch
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.failed(supplied, code=CODE, release_reservation=True) is False
    assert state(plain_client, owner, batch.usage_day) == before


@pytest.mark.parametrize("code,terminal", [
    ("model:summary_failed", False), ("model:http_429", False),
    ("model:phase_policy_missing", False), (CODE, True),
])
def test_release_flag_rejects_unproven_category(plain_client, code, terminal):
    owner, batch = claimed(plain_client)
    before = state(plain_client, owner, batch.usage_day)
    with (
        plain_client.app.state.context_summary_scope() as repository,
        pytest.raises(ValueError, match="unproven_summary_reservation_release"),
    ):
        repository.failed(batch, code=code, terminal=terminal, release_reservation=True)
    assert state(plain_client, owner, batch.usage_day) == before


def test_refund_and_lease_audit_roll_back_if_second_cas_fails(plain_client):
    owner, batch = claimed(plain_client)
    with plain_client.app.state.database.session() as session:
        session.execute(text("""CREATE TRIGGER remove_usage_during_refund
            AFTER UPDATE OF summary ON agent_conversation_summaries
            BEGIN DELETE FROM agent_memory_usage WHERE user_id = NEW.user_id; END"""))
    before = state(plain_client, owner, batch.usage_day)
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.failed(batch, code=CODE, release_reservation=True) is False
    assert state(plain_client, owner, batch.usage_day) == before


def test_outer_transaction_failure_rolls_back_reservation_release(plain_client):
    owner, batch = claimed(plain_client)
    before = state(plain_client, owner, batch.usage_day)
    with pytest.raises(RuntimeError, match="synthetic_abort"), \
            plain_client.app.state.context_summary_scope() as repository:
        assert repository.failed(batch, code=CODE, release_reservation=True)
        raise RuntimeError("synthetic_abort")
    assert state(plain_client, owner, batch.usage_day) == before


def test_success_and_empty_history_preserve_compensation_audit_but_never_expose_it(plain_client):
    owner, batch = claimed(plain_client)
    saved = {"compensations": {"reviewed-plan": {"digest": "safe-audit"}}}
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        row.summary = {**row.summary, AUDIT: {**row.summary[AUDIT], **saved}}
    value, input_tokens, output_tokens = output(batch)
    value[AUDIT] = {"compensations": {"model-injected": {}}}
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.complete(batch, value, input_tokens, output_tokens)
    assert state(plain_client, owner, batch.usage_day)["summary"][AUDIT] == saved
    public = plain_client.get("/api/agent/context-summary").json()
    assert public["status"] == "ready" and AUDIT not in str(public)
    with plain_client.app.state.database.session() as session:
        for message in session.query(AgentMessageRow).all():
            message.content = "oversized" * 10000
        row = session.get(ConversationSummaryRow, str(owner))
        row.fingerprint, row.updated_at = "", None
    with plain_client.app.state.context_summary_scope() as repository:
        assert repository.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000) is None
    assert state(plain_client, owner, batch.usage_day)["summary"][AUDIT] == saved
    assert AUDIT not in str(plain_client.get("/api/agent/context-summary").json())
