"""Real-cookie + SQLite tests; no model, tool, email or billable execution."""
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import inspect, text

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentRunRow
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import ConversationService

PATH = "/api/agent/runs/by-idempotency-key"
KEY = "native-original-turn-key"


def register(client, email="lookup-owner@example.invalid"):
    response = client.post(
        "/api/session/register",
        headers={"Idempotency-Key": str(uuid4())},
        json={"email": email, "password": "test-only-password-123"},
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["user"]["user_id"])


def seed(client, owner, *, status="running", key=KEY, snapshot=True):
    with client.app.state.database.session() as db:
        service = ConversationService(SqliteConversationRepository(db))
        conversation = service.create_conversation(user_id=owner, title="Synthetic lookup test")
        run = service.start_run(
            user_id=owner, conversation_id=conversation.conversation_id,
            idempotency_key=key, knowledge_release_id="fixture-release",
            request_snapshot={
                "message": "fixture question", "mode": "standard", "workspace": "agent",
                "model_id": "fixture-model", "reasoning_effort": "high",
                "_private_internal_marker": "never serialize server-only fields",
            } if snapshot else {},
        )
        service.checkpoint_run(user_id=owner, run_id=run.run_id,
                               partial_answer="Partial fixture answer")
        if status != "running":
            service.finish_run(run_id=run.run_id, status=status,
                               turn_id=uuid4() if status == "completed" else None)
        return run.run_id, conversation.conversation_id


def billing_snapshot(client):
    engine = client.app.state.database.engine
    tables = [name for name in inspect(engine).get_table_names()
              if "billing" in name or "credit" in name]
    with engine.connect() as db:
        return {name: [tuple(row) for row in db.execute(text(f'SELECT * FROM "{name}"'))]
                for name in tables}


def test_lookup_requires_real_cookie_session(plain_client):
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 401


@pytest.mark.parametrize("key", [None, "short", "x" * 129])
def test_lookup_requires_valid_original_key(plain_client, key):
    register(plain_client)
    headers = {} if key is None else {"Idempotency-Key": key}
    assert plain_client.get(PATH, headers=headers).status_code == 422


def test_missing_and_another_owner_are_indistinguishable(plain_client):
    owner = register(plain_client)
    seed(plain_client, owner)
    register(plain_client, "lookup-other@example.invalid")
    foreign = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    missing = plain_client.get(PATH, headers={"Idempotency-Key": "native-absent-key"})
    assert foreign.status_code == missing.status_code == 404
    for response in (foreign, missing):
        body = response.json()
        assert set(body) == {"error"}
        assert body["error"]["code"] == "not_found"
        assert "run_id" not in response.text and "fixture question" not in response.text
        assert response.headers["cache-control"] == "no-store"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]


@pytest.mark.parametrize("status", [
    "running", "completed", "failed", "interrupted",
    "awaiting_clarification", "awaiting_plan_confirmation",
])
def test_owner_reads_status_without_replay_cancellation_or_billing(
    plain_client, monkeypatch, status,
):
    owner = register(plain_client)
    run_id, conversation_id = seed(plain_client, owner, status=status)
    with plain_client.app.state.disciplinary_agent_scope() as app:
        before_run = asdict(app.find_run(user_id=owner, idempotency_key=KEY))
    before_billing = billing_snapshot(plain_client)

    def forbidden(*_args, **_kwargs):
        raise AssertionError("Lookup must not execute, resume, cancel, heartbeat or recover")

    for name in ("run_turn", "request_cancel", "heartbeat", "get_conversation"):
        monkeypatch.setattr(DisciplinaryAgentApplication, name, forbidden)
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["run_id"] == str(run_id)
    assert body["conversation_id"] == str(conversation_id)
    assert body["idempotency_key"] == KEY and body["status"] == status
    assert body["request"]["message"] == "fixture question"
    assert body["request"]["model_id"] == "fixture-model"
    assert body["partial_answer"] == "Partial fixture answer"
    assert body["cancel_requested"] is False
    assert (body["turn_id"] is not None) == (status == "completed")
    assert "user_id" not in body and "lease_token" not in body
    assert "_private_internal_marker" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert "Idempotency-Key" in response.headers["vary"]
    with plain_client.app.state.disciplinary_agent_scope() as app:
        after_run = asdict(app.find_run(user_id=owner, idempotency_key=KEY))
    assert after_run == before_run
    assert billing_snapshot(plain_client) == before_billing


def test_legacy_run_returns_null_request_instead_of_inventing_one(plain_client):
    owner = register(plain_client)
    seed(plain_client, owner, status="interrupted", snapshot=False)
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 200
    assert response.json()["request"] is None


def test_same_key_is_scoped_to_each_authenticated_owner(plain_client):
    first = register(plain_client)
    first_run, _ = seed(plain_client, first)
    second = register(plain_client, "lookup-second@example.invalid")
    second_run, _ = seed(plain_client, second)
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 200
    assert response.json()["run_id"] == str(second_run)
    assert response.json()["run_id"] != str(first_run)


def test_invalid_legacy_snapshot_does_not_block_identity_lookup(plain_client):
    owner = register(plain_client)
    run_id, _ = seed(plain_client, owner)
    with plain_client.app.state.database.session() as db:
        service = ConversationService(SqliteConversationRepository(db))
        service.checkpoint_run(user_id=owner, run_id=run_id, request_snapshot={"message": ""})
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 200
    assert response.json()["run_id"] == str(run_id)
    assert response.json()["request"] is None


def test_lookup_observes_expired_lease_without_recovering_or_renewing_it(plain_client):
    owner = register(plain_client)
    run_id, _ = seed(plain_client, owner)
    expired_at = datetime.now(UTC) - timedelta(minutes=1)
    with plain_client.app.state.database.session() as db:
        db.get(AgentRunRow, str(run_id)).lease_expires_at = expired_at
    response = plain_client.get(PATH, headers={"Idempotency-Key": KEY})
    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert response.json()["cancel_requested"] is False
    with plain_client.app.state.database.session() as db:
        row = db.get(AgentRunRow, str(run_id))
        assert row.status == "running"
        assert row.lease_expires_at.replace(tzinfo=UTC) == expired_at
