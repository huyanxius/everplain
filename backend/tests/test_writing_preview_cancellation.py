"""Controlled real commit/cancel windows never orphan an accept-able suggestion."""

import asyncio
import json
import threading
from dataclasses import asdict
from types import SimpleNamespace
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


async def cancellation_checkpoint():
    """Run the already queued cancellation before examining task ownership."""
    reached = asyncio.Event()
    asyncio.get_running_loop().call_soon(reached.set)
    await reached.wait()


@pytest.mark.parametrize("accepted", [False, True])
def test_cancelled_sdk_call_owns_session_until_real_cleanup_commit_returns(
    plain_client, monkeypatch, accepted,
):
    from sqlalchemy import event

    c = plain_client
    owner, document, run = seed(c)
    agent = runner()
    path = f"/api/writing/documents/{document['document_id']}"
    release_commit = threading.Event()
    worker_done = threading.Event()
    cancelled = threading.Event()
    trace = []
    revisions = []

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        tools.read_writing_document()
        session = tools._writing.application.repository.session
        original = tools.propose_writing_edit
        original_close = session.close

        def close():
            assert worker_done.is_set(), "scope closed before the SDK worker finished"
            trace.append("scope_close")
            original_close()

        monkeypatch.setattr(session, "close", close)

        def propose(**payload):
            result = original(**payload)
            revisions.append(result)
            if accepted:
                response = c.post(
                    path + f"/revisions/{result['revision_id']}/resolve",
                    json={"expected_version": 1, "decision": "accept"},
                    headers={"Idempotency-Key": str(uuid4())},
                )
                assert response.status_code == 200
            with c.app.state.database.session() as other:
                repo = SqliteConversationRepository(other)
                repo.request_cancel(user_id=owner, run_id=run.run_id)
                repo.commit()
            cancelled.set()
            return result

        tools.propose_writing_edit = propose

        async def scenario():
            loop = asyncio.get_running_loop()
            commit_entered = asyncio.Event()

            def hold_commit(_session):
                if cancelled.is_set() and not release_commit.is_set():
                    # SessionTransaction.commit is still on the worker's stack.
                    trace.append("cleanup_commit_entered")
                    loop.call_soon_threadsafe(commit_entered.set)
                    assert release_commit.wait(5), "test did not release the commit barrier"
                    trace.append("cleanup_commit_released")

            event.listen(session, "after_commit", hold_commit)
            original_discard = tools.discard_writing_proposal

            def discard(revision):
                try:
                    return original_discard(revision)
                finally:
                    trace.append("worker_cleanup_returned")
                    worker_done.set()

            tools.discard_writing_proposal = discard
            tool = agent._agent._function_toolset.tools["propose_writing_edit"]
            with agent._tool_runtime.activate(
                on_tool_event=None, is_cancelled=cancelled.is_set, writing_preview=None,
            ):
                task = asyncio.create_task(tool.function_schema.call({
                    "expected_version": 1, "original_text": "重复。",
                    "replacement_text": "确定性建议", "selection_start": 5, "selection_end": 8,
                }, SimpleNamespace(deps=tools, tool_call_id="commit-barrier")))
                try:
                    await asyncio.wait_for(commit_entered.wait(), 5)
                    for _ in range(2):
                        task.cancel()
                        await cancellation_checkpoint()
                        assert not task.done(), "cancel abandoned an in-flight Session commit"
                    assert not worker_done.is_set()
                finally:
                    release_commit.set()
                    assert await asyncio.to_thread(worker_done.wait, 5)
                    # A real worker error (including AgentInterrupted) retains its
                    # meaning after draining; it is not replaced by cancellation.
                    with pytest.raises((AgentInterrupted, asyncio.CancelledError)):
                        await task
                    event.remove(session, "after_commit", hold_commit)
                trace.append("sdk_call_returned")

        asyncio.run(scenario())
    assert trace == [
        "cleanup_commit_entered", "cleanup_commit_released", "worker_cleanup_returned",
        "sdk_call_returned", "scope_close",
    ]
    current = c.get(path).json()
    assert current["markdown"] == ("😀重复。确定性建议结尾" if accepted else document["markdown"])
    assert current["version"] == (2 if accepted else 1)
    saved = c.get(path + "/revisions").json()["items"]
    assert len(saved) == 1
    assert saved[0]["revision_id"] == revisions[0]["revision_id"]
    assert saved[0]["status"] == ("accepted" if accepted else "rejected")


def test_runner_monitor_cannot_reenter_session_during_post_terminal_cleanup(
    plain_client, monkeypatch,
):
    from qunxue_api.adapters.research_agent import pydantic_runner

    c = plain_client
    owner, document, run = seed(c)
    agent = runner()
    release_cleanup, worker_done = threading.Event(), threading.Event()
    cleanup_active = threading.Event()
    loop_owner = threading.get_ident()
    calls = ticks = 0
    body = []
    trace = []
    barrier = None

    async def transport(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "已收到的正文。"
            yield {0: DeltaToolCall(
                name="read_writing_document", json_args="{}", tool_call_id="read",
            )}
        elif calls == 2:
            yield {0: DeltaToolCall(
                name="propose_writing_edit", tool_call_id="write",
                json_args=json.dumps({
                    "expected_version": 1, "original_text": "重复。",
                    "replacement_text": "不该遗留的建议", "selection_start": 5, "selection_end": 8,
                }),
            )}
        else:
            raise AssertionError("failed tool must not start another model request")

    async def monitor_tick(_delay):
        nonlocal ticks, barrier
        ticks += 1
        if ticks == 1:
            barrier = asyncio.Event()
            await asyncio.wait_for(barrier.wait(), 5)
        else:
            # The previous monitor iteration ran while cleanup owned the Session.
            trace.append("monitor_skipped_shared_session")
            release_cleanup.set()
            assert await asyncio.to_thread(worker_done.wait, 5)
            await cancellation_checkpoint()

    def safe_callback():
        assert not (cleanup_active.is_set() and threading.get_ident() == loop_owner), (
            "runner callback reentered the shared Session while worker cleanup was active"
        )
        return False

    def terminal(event):
        if event.tool == "propose_writing_edit" and event.phase == "finished":
            raise RuntimeError("synthetic terminal receipt error")

    with c.app.state.disciplinary_agent_scope() as app:
        tools = bind_run(app, owner, document, run)
        discard = tools.discard_writing_proposal
        held = False

        # Thread-local runner loop cannot be looked up from its SDK thread.
        loop = pydantic_runner._worker_event_loop.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        def signal_cleanup(revision):
            nonlocal held
            if held:
                return discard(revision)
            held = True
            cleanup_active.set()
            loop.call_soon_threadsafe(barrier.set)
            try:
                assert release_cleanup.wait(5), "test did not release cleanup"
                return discard(revision)
            finally:
                cleanup_active.clear()
                trace.append("worker_cleanup_returned")
                worker_done.set()

        tools.discard_writing_proposal = signal_cleanup
        monkeypatch.setattr(pydantic_runner, "async_sleep", monitor_tick)
        try:
            with (
                agent._agent.override(model=FunctionModel(stream_function=transport)),
                pytest.raises(RuntimeError, match="synthetic terminal receipt error"),
            ):
                agent.run_stream(
                    prompt="修改", conversation=(), tools=tools, on_delta=body.append,
                    on_tool_event=terminal,
                    is_cancelled=safe_callback, on_checkpoint=safe_callback,
                    can_cancel=lambda: True,
                )
        finally:
            release_cleanup.set()
            loop.run_until_complete(loop.shutdown_default_executor())
            loop.close()
            asyncio.set_event_loop(None)
    assert calls == 2
    assert "".join(body) == "已收到的正文。"
    assert trace.index("monitor_skipped_shared_session") < trace.index("worker_cleanup_returned")
    path = f"/api/writing/documents/{document['document_id']}"
    assert c.get(path).json()["markdown"] == document["markdown"]
    assert c.get(path + "/revisions").json()["items"][0]["status"] == "rejected"
