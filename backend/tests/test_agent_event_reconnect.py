"""Real SQLite and streaming responses, with no provider or network request."""

import asyncio
import json
import threading
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from test_agent_run_recovery import Tools, registered_user

from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.api.contracts.agent import AgentTurnRequest
from qunxue_api.api.routes.agent import stream_agent_turn, subscribe_agent_run_events
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import AgentRunResult, ConversationService


class ControlledRunner:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def run_stream(self, *, on_delta, is_cancelled, **kwargs):
        self.calls += 1
        on_delta("原文A")
        self.started.set()
        assert self.release.wait(5)
        assert not is_cancelled()
        on_delta("原文B")
        return AgentRunResult(answer="完整答案", citations=(), release_id="release-a",
                              provider="test", model="test")


def setup_runtime(client):
    user_id = registered_user(client)
    runner = ControlledRunner()
    database = client.app.state.database

    @contextmanager
    def application_scope():
        with database.session() as session:
            yield DisciplinaryAgentApplication(
                conversations=ConversationService(SqliteConversationRepository(session)),
                runner=runner, tools_factory=Tools,
            )

    client.app.state.disciplinary_agent_scope = application_scope
    request = SimpleNamespace(app=client.app, headers={})
    current = SimpleNamespace(user=SimpleNamespace(user_id=user_id))
    return runner, request, current, database


def event_parts(frame):
    lines = frame.splitlines()
    return (next((line[4:] for line in lines if line.startswith("id: ")), None),
            next((line[7:] for line in lines if line.startswith("event: ")), None),
            json.loads(next(line[6:] for line in lines if line.startswith("data: "))))


def test_disconnect_and_two_cursor_subscribers_do_not_execute_again(client):
    runner, request, current, database = setup_runtime(client)
    key = "disconnect-and-multi-subscribe"

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message="问题"), request, current, key)
        original = []
        try:
            async for frame in response.body_iterator:
                original.append(frame)
                if "event: assistant_delta" in frame:
                    break
            await response.body_iterator.aclose()
            event_id, _, _ = event_parts(original[-1])
            run_id_text, sequence = event_id.rsplit(":", 1)
            run_id = UUID(run_id_text)
            with database.session() as session:
                run = SqliteConversationRepository(session).find_run_by_id(
                    user_id=current.user.user_id, run_id=run_id,
                )
                assert run.status == "running"
                assert not run.cancel_requested
                assert run.output_attempts[0].answer == "原文A"
            # Repeating an already-active command subscribes, never polls into
            # a second execution after the first attempt finishes/fails.
            repeated = stream_agent_turn(AgentTurnRequest(message="问题"), request, current, key)
            request.headers = {"last-event-id": event_id}
            second = subscribe_agent_run_events(run_id, request, current, after=0)
            third = subscribe_agent_run_events(run_id, request, current, after=int(sequence))
            runner.release.set()

            async def collect(stream):
                return [event_parts(frame) async for frame in stream.body_iterator
                        if frame.startswith("id:") or frame.startswith("event:")]

            replay, resumed, other = await asyncio.wait_for(asyncio.gather(
                collect(repeated), collect(second), collect(third),
            ), timeout=4)
            assert runner.calls == 1
            assert replay[0][1] == "turn_snapshot"
            assert replay[0][2]["partial_answer"] in {"原文A", "原文A原文B"}
            assert [body["delta"] for _, name, body in replay if name == "assistant_delta"] in [
                ["原文B"], [],
            ]
            assert [body["delta"] for _, name, body in resumed if name == "assistant_delta"] == [
                "原文B",
            ]
            assert resumed == other
            assert resumed[-1][1] == "turn_completed"
            assert [int(identity.rsplit(":", 1)[1]) for identity, _, _ in resumed] == [4, 5]
            # Simulate losing only the last terminal frame after reading B.
            request.headers = {}
            last = subscribe_agent_run_events(run_id, request, current, after=4)
            frames = await collect(last)
            assert [name for _, name, _ in frames] == ["turn_completed"]
            assert runner.calls == 1
        finally:
            runner.release.set()

    asyncio.run(exercise())


def test_lost_initial_response_still_executes_once_and_lookup_can_reconcile(client):
    runner, request, current, database = setup_runtime(client)
    key = "lost-post-response"
    # The transport is never iterated, as if the headers/entire response vanished.
    stream_agent_turn(AgentTurnRequest(message="原始问题"), request, current, key)
    assert runner.started.wait(2)
    runner.release.set()
    lookup = client.get("/api/agent/runs/by-idempotency-key", headers={"Idempotency-Key": key})
    assert lookup.status_code == 200
    run_id = UUID(lookup.json()["run_id"])

    async def exercise():
        response = subscribe_agent_run_events(run_id, request, current, after=0)
        frames = [frame async for frame in response.body_iterator]
        assert any("event: turn_completed" in frame for frame in frames)
        assert runner.calls == 1
    asyncio.run(exercise())
    with database.session() as session:
        run = SqliteConversationRepository(session).find_run_by_id(
            user_id=current.user.user_id, run_id=run_id,
        )
        assert run.output_attempts[0].answer == "原文A原文B"
        assert run.status == "completed"
    with pytest.raises(HTTPException) as forbidden:
        subscribe_agent_run_events(run_id, request,
                                   SimpleNamespace(user=SimpleNamespace(user_id=UUID(int=988))),
                                   after=0)
    assert forbidden.value.status_code == 404


def test_one_journal_write_failure_still_presents_received_body_as_unsaved(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    runner, request, current, database = setup_runtime(client)
    runner.release.set()
    original = SqliteConversationRepository.append_output_event
    failures = []

    def failing_append(repo, **kwargs):
        if kwargs["name"] == "assistant_delta" and not failures:
            failures.append("injected")
            raise OperationalError("journal write", {}, RuntimeError("fault injection"))
        return original(repo, **kwargs)

    monkeypatch.setattr(SqliteConversationRepository, "append_output_event", failing_append)

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message="问题"), request, current,
                                     "unsaved-body")
        frames = [event_parts(frame) async for frame in response.body_iterator]
        snapshot = next(body for _, name, body in frames if name == "turn_snapshot")
        assert snapshot["partial_answer"] == "原文A"
        assert snapshot["output_persistence_failed"] is True
        warning = next(body for _, name, body in frames if name == "output_persistence_failed")
        assert "尚未保存" in warning["message"]
        assert "无法保证恢复" in warning["message"]
        failed = next(body for _, name, body in frames if name == "turn_failed")
        assert failed["code"] == "agent_output_storage_error"
        assert runner.calls == 1

    asyncio.run(exercise())
    with database.session() as session:
        run = SqliteConversationRepository(session).find_run(
            user_id=current.user.user_id, idempotency_key="unsaved-body",
        )
        assert run.status == "failed"
        assert run.output_attempts[0].answer == ""


def test_tool_journal_does_not_deadlock_on_complete_uncommitted_business_write(client):
    from sqlalchemy import text

    from qunxue_api.modules.agent_conversation import AgentToolEvent

    runner, request, current, database = setup_runtime(client)
    key = "tool-checkpoint-lock-boundary"

    class WritingRunner:
        calls = 0

        def run_stream(self, *, on_tool_event, on_delta, **kwargs):
            self.calls += 1
            on_tool_event(AgentToolEvent(tool="write_a", phase="started", call_id="a"))
            business_session.execute(text(
                "INSERT INTO tool_journal_probe VALUES ('committed-result')"
            ))
            # A second tool starts while A's complete write still holds the
            # primary transaction. B's event must not wait on our own lock.
            on_tool_event(AgentToolEvent(tool="write_b", phase="started", call_id="b"))
            on_tool_event(AgentToolEvent(tool="write_a", phase="finished", call_id="a"))
            on_tool_event(AgentToolEvent(tool="write_b", phase="finished", call_id="b"))
            on_delta("工具之后的完整正文")
            return AgentRunResult(answer="完成", citations=(), release_id="release-a",
                                  provider="test", model="test")

    writer = WritingRunner()
    business_session = None

    @contextmanager
    def scope():
        nonlocal business_session
        with database.session() as session:
            # The main runner scope owns this transaction. Observer scopes have
            # no active model and must not replace the runner's session.
            app = DisciplinaryAgentApplication(
                conversations=ConversationService(SqliteConversationRepository(session)),
                runner=writer, tools_factory=Tools,
            )
            original_run = app.run_turn

            def run(**kwargs):
                nonlocal business_session
                business_session = session
                return original_run(**kwargs)

            app.run_turn = run
            yield app

    with database.session() as session:
        session.execute(text("CREATE TABLE tool_journal_probe (value TEXT)"))
        session.commit()
    client.app.state.disciplinary_agent_scope = scope

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message="写工具"), request, current, key)
        frames = await asyncio.wait_for(
            asyncio.create_task(collect_frames(response)), timeout=4,
        )
        names = [event_parts(frame)[1] for frame in frames]
        assert names.count("tool_started") == 2
        assert names.count("tool_finished") == 2
        assert names[-1] == "turn_completed"

    async def collect_frames(response):
        return [frame async for frame in response.body_iterator]

    asyncio.run(exercise())
    assert writer.calls == 1
    with database.session() as session:
        saved = session.execute(text("SELECT value FROM tool_journal_probe")).scalar()
        assert saved == "committed-result"


def test_unsaved_tail_after_durable_body_preserves_exact_order_without_duplicate(
    client, monkeypatch,
):
    from sqlalchemy.exc import OperationalError

    runner, request, current, _database = setup_runtime(client)
    runner.release.set()
    original = SqliteConversationRepository.append_output_event
    count = []

    def failing_second(repo, **kwargs):
        if kwargs["name"] == "assistant_delta":
            count.append(1)
            if len(count) == 2:
                raise OperationalError("second delta", {}, RuntimeError("injected tail fault"))
        return original(repo, **kwargs)

    monkeypatch.setattr(SqliteConversationRepository, "append_output_event", failing_second)

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message="问题"), request, current,
                                     "saved-then-unsaved-tail")
        answer = ""
        frames = []
        async for frame in response.body_iterator:
            _identity, name, body = event_parts(frame)
            frames.append(name)
            if name == "assistant_delta":
                answer += body["delta"]
            elif name == "turn_snapshot":
                answer = body["partial_answer"]
        assert answer == "原文A原文B"
        assert frames[-1] == "turn_failed"
        assert "output_persistence_failed" in frames

    asyncio.run(exercise())
