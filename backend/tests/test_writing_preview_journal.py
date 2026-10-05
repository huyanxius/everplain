"""Dedicated preview replay is fenced, scoped and independent of assistant text."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, update
from test_research_material_api import _authenticate
from test_writing import doc
from test_writing_agent_tools import bind

from qunxue_api.adapters.sqlite import AgentOutputEventRow, AgentRunRow
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.adapters.sqlite.writing import WritingDocumentRow
from qunxue_api.modules.agent_conversation import (
    AgentMaterialAttachment,
    ConversationNotFound,
    ConversationService,
)


def seed(c, *, attachments=()):
    owner = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。结尾")
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        service = ConversationService(repo)
        conversation = service.create_conversation(user_id=owner, title="Preview test")
        run = service.start_run(
            user_id=owner,
            conversation_id=conversation.conversation_id,
            idempotency_key=str(uuid4()),
            knowledge_release_id="fixture",
            request_snapshot={
                "message": "修改",
                "writing_context": {
                    "document_id": document["document_id"],
                    "document_version": 1,
                    "selection_start": 5,
                    "selection_end": 8,
                },
            },
            material_attachments=attachments,
        )
        repo.commit()
    return owner, document, run


def body(document, run, **changes):
    return {
        "type": "writing_preview",
        "run_id": str(run.run_id),
        "call_id": "call",
        "document_id": document["document_id"],
        "base_version": 1,
        "selection_start": 5,
        "selection_end": 8,
        "sequence": 1,
        "replacement_text": "安全预览",
        "state": "streaming",
        **changes,
    }


def append(c, owner, run, payload, **changes):
    with c.app.state.database.session() as session:
        return SqliteConversationRepository(session).append_output_event(
            user_id=owner,
            run_id=run.run_id,
            attempt_id=changes.get("attempt_id", run.lease_token),
            name="writing_preview",
            payload=payload,
        )


def test_snapshots_and_sse_cursor_replay_never_append_to_chat_and_latest_call_is_last(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    first = append(c, owner, run, body(document, run))
    second = append(c, owner, run, body(document, run, replacement_text="安全预览完整"))
    third = append(c, owner, run, body(document, run, call_id="another", replacement_text="另一稿"))
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        saved = repo.find_run_by_id(user_id=owner, run_id=run.run_id)
        assert saved.partial_answer == "" and all(
            item.answer == "" for item in saved.output_attempts
        )
        assert [item["call_id"] for item in saved.writing_previews] == ["call", "another"]
        assert saved.writing_previews[0]["replacement_text"] == "安全预览完整"
        assert all(item["attempt_id"] == run.lease_token for item in saved.writing_previews)
        assert [item["sequence"] for item in saved.writing_previews] == [
            second.sequence,
            third.sequence,
        ]
        assert (
            repo.read_output_events(user_id=owner, run_id=run.run_id, after=first.sequence)[0]
            == second
        )
        with pytest.raises(ConversationNotFound):
            repo.read_output_events(user_id=UUID(int=1234), run_id=run.run_id)
        repo.finish_run(run_id=run.run_id, lease_token=run.lease_token, status="interrupted")
        repo.commit()
    replay = c.get(
        f"/api/agent/runs/{run.run_id}/events",
        headers={
            "Last-Event-ID": f"{run.run_id}:{first.sequence}",
        },
    )
    assert replay.status_code == 200
    assert f"id: {run.run_id}:{first.sequence}\n" not in replay.text
    assert "assistant_delta" not in replay.text
    lookup = c.get(
        "/api/agent/runs/by-idempotency-key", headers={"Idempotency-Key": run.idempotency_key}
    ).json()
    assert lookup["writing_previews"][0]["replacement_text"] == "安全预览完整"


def test_running_reconnect_snapshot_rebuilds_preview_without_rerunning_model(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    event = append(c, owner, run, body(document, run))
    # Active POST observes existing output; terminate after the first read so this
    # controlled subscription closes without provider work or a fake timer.
    from qunxue_api.api.routes.agent import _run_snapshot

    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        saved = repo.find_run_by_id(user_id=owner, run_id=run.run_id)
        snapshot = _run_snapshot(saved)
        assert snapshot["writing_previews"][0]["replacement_text"] == "安全预览"
        assert snapshot["writing_previews"][0]["sequence"] == event.sequence
        repo.finish_run(run_id=run.run_id, lease_token=run.lease_token, status="interrupted")
        repo.commit()
    lookup = c.get(
        "/api/agent/runs/by-idempotency-key", headers={"Idempotency-Key": run.idempotency_key}
    )
    assert lookup.json()["writing_previews"] == snapshot["writing_previews"]


@pytest.mark.parametrize("fence", ["wrong_attempt", "cancel", "terminal", "expired"])
def test_preview_journal_running_lease_and_cancel_fences(plain_client, fence):
    c = plain_client
    owner, document, run = seed(c)
    changes = {}
    if fence == "wrong_attempt":
        changes["attempt_id"] = "other-attempt"
    else:
        with c.app.state.database.session() as session:
            values = (
                {"cancel_requested": True}
                if fence == "cancel"
                else (
                    {"status": "interrupted"}
                    if fence == "terminal"
                    else {"lease_expires_at": datetime.now(UTC) - timedelta(seconds=1)}
                )
            )
            session.execute(
                update(AgentRunRow)
                .where(AgentRunRow.run_id == str(run.run_id))
                .values(
                    **values,
                )
            )
            session.commit()
    assert append(c, owner, run, body(document, run), **changes) is None


@pytest.mark.parametrize(
    "change",
    [
        {"original_text": "SECRET"},
        {"thinking": "SECRET"},
        {"selection_start": True},
        {"sequence": 0},
        {"state": "ready", "revision_id": "fake"},
        {"document_id": str(UUID(int=999))},
        {"run_id": str(UUID(int=999))},
        {"selection_start": 1, "selection_end": 2},
        {"selection_start": 2, "selection_end": 5},
    ],
)
def test_event_allowlist_and_target_binding_fail_closed(plain_client, change):
    c = plain_client
    owner, document, run = seed(c)
    with pytest.raises(ValueError):
        append(c, owner, run, body(document, run, **change))


def test_ready_requires_actual_persisted_revision_and_exact_utf16_replacement(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    append(c, owner, run, body(document, run))
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind(app, owner, document, selection_start=5, selection_end=8)
        tools.read_writing_document()
        revision = tools.propose_writing_edit(
            expected_version=1, original_text="重复。", replacement_text="真正修订"
        )
    ready = body(
        document,
        run,
        state="ready",
        revision_id=revision["revision_id"],
        replacement_text="真正修订",
    )
    assert append(c, owner, run, ready).payload["state"] == "ready"
    with pytest.raises(ValueError):
        append(c, owner, run, {**ready, "replacement_text": "其他正文"})
    path = f"/api/writing/documents/{document['document_id']}"
    rejected = c.post(
        path + f"/revisions/{revision['revision_id']}/resolve",
        json={
            "expected_version": 1,
            "decision": "reject",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert rejected.status_code == 200
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        saved = repo.find_run_by_id(user_id=owner, run_id=run.run_id)
        assert saved.writing_previews[0]["state"] == "invalidated"
        assert saved.writing_previews[0]["replacement_text"] == ""
        assert "revision_id" not in saved.writing_previews[0]


def test_invalidation_atomically_erases_prior_call_plaintext_from_every_replay_cursor(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    append(c, owner, run, body(document, run))
    append(c, owner, run, body(document, run, replacement_text="更多安全预览"))
    append(
        c,
        owner,
        run,
        body(
            document,
            run,
            state="invalidated",
            replacement_text="",
            error_code="writing_preview_invalid_arguments",
        ),
    )
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        rows = session.scalars(
            select(AgentOutputEventRow).where(
                AgentOutputEventRow.run_id == str(run.run_id),
            )
        ).all()
        assert all(item.payload["replacement_text"] == "" for item in rows)
        assert all(item.payload["state"] == "invalidated" for item in rows)
        events = repo.read_output_events(user_id=owner, run_id=run.run_id)
        assert "安全预览" not in json.dumps([item.payload for item in events], ensure_ascii=False)


@pytest.mark.parametrize("mutation", ["version", "owner", "delete"])
def test_replay_and_snapshot_hide_preview_after_target_loses_safe_binding(plain_client, mutation):
    c = plain_client
    owner, document, run = seed(c)
    append(c, owner, run, body(document, run))
    with c.app.state.database.session() as session:
        target = session.get(WritingDocumentRow, document["document_id"])
        if mutation == "version":
            target.version += 1
        elif mutation == "owner":
            other = UUID(_authenticate(c)["user"]["user_id"])
            target.user_id = str(other)
        else:
            session.delete(target)
        session.commit()
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        events = repo.read_output_events(user_id=owner, run_id=run.run_id)
        assert events[0].payload["replacement_text"] == ""
        assert (
            repo.find_run_by_id(user_id=owner, run_id=run.run_id).writing_previews[0]["state"]
            == "invalidated"
        )


def test_deleted_source_suppresses_preview_even_without_any_assistant_text_or_tool_trace(
    plain_client,
):
    c = plain_client
    owner, document, run = seed(
        c, attachments=(AgentMaterialAttachment(UUID(int=811), UUID(int=812)),)
    )
    assert append(c, owner, run, body(document, run)) is None
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        saved = repo.find_run_by_id(user_id=owner, run_id=run.run_id)
        assert saved.output_redacted and saved.writing_previews == ()
        assert repo.read_output_events(user_id=owner, run_id=run.run_id) == ()
