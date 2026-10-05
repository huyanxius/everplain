"""Controlled real commit/cancel windows never orphan an accept-able suggestion."""

import json
from dataclasses import asdict
from uuid import UUID, uuid4

import pytest
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from test_writing_preview_journal import seed
from test_writing_preview_stream import runner

from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.modules.agent_conversation import AgentInterrupted, ConversationService
from qunxue_api.modules.writing import WritingConflict


def bind_run(app, owner, document, run):
    tools = app._tools_factory()
    tools.bind_writing_context(
        user_id=owner,
        agent_run_id=run.run_id,
        context={
            "document_id": document["document_id"],
            "document_version": 1,
            "selection_start": 5,
            "selection_end": 8,
        },
    )
    tools.bind_writing_execution_fence(run.lease_token)
    return tools


@pytest.mark.parametrize("cancel_at", ["after_commit", "after_ready", "accepted_before_cancel"])
def test_real_revision_commit_then_cancel_without_ready_leaves_no_pending_and_preserves_body(
    plain_client,
    cancel_at,
):
    c = plain_client
    owner, document, run = seed(c)
    agent = runner()
    published = []
    calls = 0
    created = []
    cancelled = False
    path = f"/api/writing/documents/{document['document_id']}"

    def cancel():
        with c.app.state.database.session() as session:
            repo = SqliteConversationRepository(session)
            repo.request_cancel(user_id=owner, run_id=run.run_id)
            repo.commit()

    async def transport(messages, info):
        nonlocal calls, cancelled
        calls += 1
        if calls == 1:
            yield {
                0: DeltaToolCall(name="read_writing_document", json_args="{}", tool_call_id="read")
            }
        elif calls == 2:
            yield {
                0: DeltaToolCall(
                    name="propose_writing_edit",
                    tool_call_id="write",
                    json_args=json.dumps(
                        {
                            "expected_version": 1,
                            "original_text": "重复。",
                            "replacement_text": "真实建议",
                            "selection_start": 5,
                            "selection_end": 8,
                        }
                    ),
                )
            }
        else:
            assert cancel_at == "after_ready"
            cancel()
            cancelled = True
            yield "应当中断"

    def publish(event):
        payload = {
            "type": "writing_preview",
            **{key: value for key, value in asdict(event).items() if value is not None},
            "run_id": str(run.run_id),
        }
        with c.app.state.database.session() as session:
            stored = SqliteConversationRepository(session).append_output_event(
                user_id=owner,
                run_id=run.run_id,
                attempt_id=run.lease_token,
                name="writing_preview",
                payload=payload,
            )
        if stored is None:
            raise AgentInterrupted("controlled publication fence")
        published.append(stored)

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        original = tools.propose_writing_edit

        def propose(**payload):
            nonlocal cancelled
            result = original(**payload)  # The proposal's actual transaction has committed.
            created.append(result)
            if cancel_at != "after_ready":
                if cancel_at == "accepted_before_cancel":
                    accepted = c.post(
                        path + f"/revisions/{result['revision_id']}/resolve",
                        json={
                            "expected_version": 1,
                            "decision": "accept",
                        },
                        headers={"Idempotency-Key": str(uuid4())},
                    )
                    assert accepted.status_code == 200
                    cancelled = True
                cancel()
            return result

        tools.propose_writing_edit = propose
        with (
            agent._agent.override(model=FunctionModel(stream_function=transport)),
            pytest.raises(AgentInterrupted),
        ):
            agent.run_stream(
                prompt="修改",
                conversation=(),
                tools=tools,
                on_delta=lambda _: None,
                on_writing_preview=publish,
                is_cancelled=lambda: cancelled,
            )
    assert created
    if cancel_at == "after_commit":
        assert not any(event.payload["state"] == "ready" for event in published)
    if cancel_at == "accepted_before_cancel":
        assert c.get(path).json()["markdown"] == "😀重复。真实建议结尾"
        assert c.get(path).json()["version"] == 2
    else:
        assert c.get(path).json()["markdown"] == document["markdown"]
        assert all(
            item["status"] == "rejected" for item in c.get(path + "/revisions").json()["items"]
        )
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        previews = repo.find_run_by_id(user_id=owner, run_id=run.run_id).writing_previews
        assert all(event["state"] != "ready" for event in previews)


def test_bound_execution_fence_denies_cancelled_proposal_before_write(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    with c.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        repo.request_cancel(user_id=owner, run_id=run.run_id)
        repo.commit()
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        tools.read_writing_document()
        with pytest.raises(WritingConflict, match="取消"):
            tools.propose_writing_edit(
                expected_version=1,
                original_text="重复。",
                replacement_text="不能创建",
                selection_start=5,
                selection_end=8,
            )
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path + "/revisions").json()["items"] == []


def test_cleanup_cannot_reject_another_runs_pending_revision(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        tools.read_writing_document()
        revision = tools.propose_writing_edit(
            expected_version=1,
            original_text="重复。",
            replacement_text="应当保留",
            selection_start=5,
            selection_end=8,
        )
        assert not tools._writing.application.discard_agent_proposal(
            owner,
            document["document_id"],
            UUID(int=100000),
            revision,
        )
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path + "/revisions").json()["items"][0]["revision_id"] == revision["revision_id"]


def test_post_ready_summary_error_preserves_valid_proposal_and_exact_retry_identity(plain_client):
    c = plain_client
    owner, document, run = seed(c)
    agent = runner()
    path = f"/api/writing/documents/{document['document_id']}"
    for fail_summary in (False, True):
        calls = 0
        previews = []

        async def transport(messages, info, *, fail_summary=fail_summary):
            nonlocal calls
            calls += 1
            if calls == 1:
                yield {
                    0: DeltaToolCall(
                        name="read_writing_document", json_args="{}", tool_call_id="read"
                    )
                }
            elif calls == 2:
                yield {
                    0: DeltaToolCall(
                        name="propose_writing_edit",
                        tool_call_id="write",
                        json_args=json.dumps(
                            {
                                "expected_version": 1,
                                "original_text": "重复。",
                                "replacement_text": "已经完成",
                                "selection_start": 5,
                                "selection_end": 8,
                            }
                        ),
                    )
                }
            elif fail_summary:
                raise RuntimeError("controlled summary EOF")
            else:
                yield "仅是聊天说明。"

        def publish(event, *, previews=previews):
            payload = {
                "type": "writing_preview",
                **{key: value for key, value in asdict(event).items() if value is not None},
                "run_id": str(run.run_id),
            }
            with c.app.state.database.session() as session:
                stored = SqliteConversationRepository(session).append_output_event(
                    user_id=owner,
                    run_id=run.run_id,
                    attempt_id=run.lease_token,
                    name="writing_preview",
                    payload=payload,
                )
            previews.append(stored)

        with c.app.state.disciplinary_agent_scope() as app:
            tools = bind_run(app, owner, document, run)
            with agent._agent.override(model=FunctionModel(stream_function=transport)):
                if fail_summary:
                    with pytest.raises(RuntimeError, match="summary EOF"):
                        agent.run_stream(
                            prompt="修改",
                            conversation=(),
                            tools=tools,
                            on_delta=lambda _: None,
                            on_writing_preview=publish,
                        )
                    assert not tools._writing.created_revision_ids
                else:
                    agent.run_stream(
                        prompt="修改",
                        conversation=(),
                        tools=tools,
                        on_delta=lambda _: None,
                        on_writing_preview=publish,
                    )
        revisions = c.get(path + "/revisions").json()["items"]
        assert len(revisions) == 1 and revisions[0]["status"] == "pending"
        assert previews[-1].payload["state"] == "ready"
        assert previews[-1].payload["revision_id"] == revisions[0]["revision_id"]
    assert c.get(path).json()["markdown"] == document["markdown"]


def test_expired_crash_gap_reconciles_undelivered_revision_without_touching_document(plain_client):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from qunxue_api.adapters.sqlite import AgentRunRow

    c = plain_client
    owner, document, run = seed(c)
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        tools.read_writing_document()
        revision = tools.propose_writing_edit(
            expected_version=1,
            original_text="重复。",
            replacement_text="未送达建议",
            selection_start=5,
            selection_end=8,
        )
    # Simulate a process crash after the actual proposal commit and before any
    # ready journal publication. The old worker's lease expires on disk.
    with c.app.state.database.session() as session:
        session.execute(
            update(AgentRunRow)
            .where(AgentRunRow.run_id == str(run.run_id))
            .values(
                lease_expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        session.commit()
    path = f"/api/writing/documents/{document['document_id']}"
    revisions = c.get(path + "/revisions").json()["items"]
    assert revisions[0]["status"] == "rejected"
    assert "_agent_provenance" not in json.dumps(revisions)
    accepted = c.post(
        path + f"/revisions/{revision['revision_id']}/resolve",
        json={
            "expected_version": 1,
            "decision": "accept",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert accepted.status_code == 409
    assert c.get(path).json()["markdown"] == document["markdown"]


def test_ready_publication_before_reconcile_lock_preserves_recovered_revision(
    plain_client, monkeypatch
):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update
    from sqlalchemy.orm import Session
    from test_writing_preview_journal import body

    from qunxue_api.adapters.sqlite import AgentRunRow

    c = plain_client
    owner, document, run = seed(c)
    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        tools.read_writing_document()
        revision = tools.propose_writing_edit(
            expected_version=1,
            original_text="重复。",
            replacement_text="已恢复正文",
            selection_start=5,
            selection_end=8,
        )
    with c.app.state.database.session() as session:
        session.execute(
            update(AgentRunRow)
            .where(AgentRunRow.run_id == str(run.run_id))
            .values(
                lease_expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        session.commit()
    original_execute = Session.execute
    published = False

    def execute(session, statement, *args, **kwargs):
        nonlocal published
        if (
            not published
            and getattr(statement, "is_update", False)
            and statement.table.name == "writing_revisions"
        ):
            published = True
            # The retry wins immediately before cleanup takes its write lock.
            with c.app.state.database.session() as other:
                original_execute(
                    other,
                    update(AgentRunRow)
                    .where(
                        AgentRunRow.run_id == str(run.run_id),
                    )
                    .values(lease_expires_at=datetime.now(UTC) + timedelta(seconds=30)),
                )
                other.commit()
                event = SqliteConversationRepository(other).append_output_event(
                    user_id=owner,
                    run_id=run.run_id,
                    attempt_id=run.lease_token,
                    name="writing_preview",
                    payload=body(
                        document,
                        run,
                        state="ready",
                        revision_id=revision["revision_id"],
                        replacement_text="已恢复正文",
                    ),
                )
                assert event is not None
        return original_execute(session, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", execute)
    path = f"/api/writing/documents/{document['document_id']}"
    revisions = c.get(path + "/revisions").json()["items"]
    assert published and revisions[0]["status"] == "pending"
    assert revisions[0]["revision_id"] == revision["revision_id"]


def test_old_cleanup_cannot_reject_same_revision_recovered_by_a_healthy_new_attempt(plain_client):
    from test_writing_preview_journal import body

    c = plain_client
    owner, document, first = seed(c)
    with c.app.state.disciplinary_agent_scope() as app:
        old_tools = bind_run(app, owner, document, first)
        old_tools.read_writing_document()
        revision = old_tools.propose_writing_edit(
            expected_version=1,
            original_text="重复。",
            replacement_text="复用的真实建议",
            selection_start=5,
            selection_end=8,
        )
        with c.app.state.database.session() as session:
            repo = SqliteConversationRepository(session)
            repo.finish_run(run_id=first.run_id, lease_token=first.lease_token, status="failed")
            repo.commit()
            service = ConversationService(repo)
            second = service.start_run(
                user_id=owner,
                conversation_id=first.conversation_id,
                idempotency_key=first.idempotency_key,
                knowledge_release_id="fixture",
                request_snapshot=first.request_snapshot,
            )
            repo.commit()
        new_tools = bind_run(app, owner, document, second)
        new_tools.read_writing_document()
        recovered = new_tools.propose_writing_edit(
            expected_version=1,
            original_text="重复。",
            replacement_text="复用的真实建议",
            selection_start=5,
            selection_end=8,
        )
        assert recovered["revision_id"] == revision["revision_id"]
        assert not new_tools._writing.created_revision_ids
        assert not old_tools.discard_writing_proposal(revision)
        with c.app.state.database.session() as session:
            repo = SqliteConversationRepository(session)
            assert (
                repo.append_output_event(
                    user_id=owner,
                    run_id=second.run_id,
                    attempt_id=second.lease_token,
                    name="writing_preview",
                    payload=body(
                        document,
                        second,
                        state="ready",
                        revision_id=revision["revision_id"],
                        replacement_text="复用的真实建议",
                    ),
                )
                is not None
            )
            repo.finish_run(run_id=second.run_id, lease_token=second.lease_token, status="failed")
            repo.commit()
        assert not old_tools.discard_writing_proposal(revision)
    path = f"/api/writing/documents/{document['document_id']}"
    revisions = c.get(path + "/revisions").json()["items"]
    assert revisions[0]["status"] == "pending"
