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


@pytest.mark.parametrize("observe_terminal_commit", [False, True])
def test_disconnect_and_two_cursor_subscribers_do_not_execute_again(
    client, monkeypatch, observe_terminal_commit,
):
    runner, request, current, database = setup_runtime(client)
    key = "disconnect-and-multi-subscribe"
    publication_snapshots = []
    if observe_terminal_commit:
        from sqlalchemy import text

        append = SqliteConversationRepository._append_output_event

        def observe_before_terminal(repo, **kwargs):
            if kwargs["name"] == "turn_completed":
                # A different SQLite connection cannot see the canonical
                # terminal before its real cursor exists, even without a local
                # publisher registry (as after reconnect in another process).
                with database.engine.connect() as observer:
                    row = observer.execute(text(
                        "SELECT status,last_event_sequence FROM agent_runs WHERE run_id=:id"
                    ), {"id": str(kwargs["run_id"])}).one()
                    terminal_count = observer.scalar(text(
                        "SELECT count(*) FROM agent_output_events "
                        "WHERE run_id=:id AND name='turn_completed'"
                    ), {"id": str(kwargs["run_id"])})
                    publication_snapshots.append((*row, terminal_count))
            return append(repo, **kwargs)

        monkeypatch.setattr(SqliteConversationRepository, "_append_output_event",
                            observe_before_terminal)

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
    if observe_terminal_commit:
        assert publication_snapshots == [("running", 4, 0)]


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


def test_runtime_checkpoint_keeps_active_tool_write_rollbackable(client):
    from sqlalchemy import text

    from qunxue_api.modules.agent_conversation import AgentToolEvent

    user_id = registered_user(client)
    database = client.app.state.database
    with database.session() as session:
        session.execute(text("CREATE TABLE runtime_rollback_probe (value TEXT)"))
        session.commit()

        class Runner:
            def run_stream(self, *, on_delta, on_tool_event, on_checkpoint, **kwargs):
                on_tool_event(AgentToolEvent(tool="write", phase="started", call_id="write"))
                session.execute(text("INSERT INTO runtime_rollback_probe VALUES ('unfinished')"))
                on_checkpoint()
                with database.session() as observer:
                    assert observer.execute(text(
                        "SELECT count(*) FROM runtime_rollback_probe"
                    )).scalar() == 0
                session.rollback()
                on_tool_event(AgentToolEvent(tool="write", phase="failed", call_id="write"))
                on_delta("工具失败后仍保留的正文")
                return AgentRunResult(answer="最终答案", citations=(), release_id="release-a",
                                      provider="test", model="test")

        app = DisciplinaryAgentApplication(
            conversations=ConversationService(SqliteConversationRepository(session)),
            runner=Runner(), tools_factory=Tools, rollback=session.rollback,
        )

        def delivered(delta):
            with database.session() as observer:
                assert observer.execute(text(
                    "SELECT count(*) FROM runtime_rollback_probe"
                )).scalar() == 0
                saved = SqliteConversationRepository(observer).find_run(
                    user_id=user_id, idempotency_key="active-tool-rollback",
                )
                assert saved.output_attempts[0].answer == delta

        app.run_turn(user_id=user_id, conversation_id=None, prompt="问题",
                     idempotency_key="active-tool-rollback", on_delta=delivered)


def test_missing_terminal_journal_preserves_committed_completed_turn(client, monkeypatch, caplog):
    """A journal outage cannot turn a successfully committed answer into a failure."""
    from sqlalchemy.exc import OperationalError

    from qunxue_api.application import disciplinary_agent as agent_application

    # Alembic's test database logging setup disables pre-imported loggers.
    # Capture the diagnostic through the application's real logger in this test.
    monkeypatch.setattr(agent_application.logger, "disabled", False)
    caplog.set_level("ERROR", logger=agent_application.__name__)

    from qunxue_api.api.routes.agent import _TERMINAL_EVENT_NAMES

    runner, request, current, database = setup_runtime(client)
    runner.release.set()
    original = SqliteConversationRepository._append_output_event
    failed_names = []

    def fail_terminal(repo, **kwargs):
        if kwargs["name"] in _TERMINAL_EVENT_NAMES:
            failed_names.append(kwargs["name"])
            raise OperationalError("terminal journal", {}, RuntimeError("injected outage"))
        return original(repo, **kwargs)

    monkeypatch.setattr(SqliteConversationRepository, "_append_output_event", fail_terminal)

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message="问题"), request, current,
                                     "completed-without-terminal-journal")
        frames = [event_parts(frame) async for frame in response.body_iterator]
        assert frames[-1][1] == "turn_completed"
        assert not any(name == "turn_failed" for _, name, _ in frames)
        assert frames[-1][2]["conversation"]["turns"][0]["assistant"]["content"] == "完整答案"
        assert "".join(body["delta"] for _, name, body in frames
                       if name == "assistant_delta") == "原文A原文B"
        assert runner.calls == 1
        assert not any(name == "output_persistence_failed" for _, name, _ in frames)
        assert frames[-1][0] is None  # A storage outage never invents a durable cursor.

    asyncio.run(exercise())
    assert failed_names == ["turn_completed"]
    assert "Agent terminal journal transaction failed" in caplog.text
    with database.session() as session:
        saved = SqliteConversationRepository(session).find_run(
            user_id=current.user.user_id, idempotency_key="completed-without-terminal-journal",
        )
        assert saved.status == "completed"
        events = SqliteConversationRepository(session).read_output_events(
            user_id=current.user.user_id, run_id=saved.run_id,
        )
        assert not any(event.name in _TERMINAL_EVENT_NAMES for event in events)
        assert saved.output_attempts[0].answer == "原文A原文B"
@pytest.mark.parametrize("outcome", ["completed", "failed", "interrupted", "awaiting", "length"])
def test_no_committed_terminal_state_without_real_terminal_event(client, monkeypatch, outcome):
    from sqlalchemy import event, text
    from sqlalchemy.orm import Session
    from test_agent_delivery_output_state import Billing, ReceiptScope

    from qunxue_api.api.routes import agent
    from qunxue_api.modules.agent_conversation import AgentInterrupted, AgentResearchEvent

    TERMINALS = agent._TERMINAL_EVENT_NAMES
    uid = registered_user(client)
    db = client.app.state.database
    key = "independent-commit-atomic-" + outcome
    seen = []
    worker_done = threading.Event()
    calls = []
    financial_order = []

    class Runner:
        def prepare_research(self, *, on_event, **kwargs):
            if outcome == "awaiting":
                on_event(AgentResearchEvent(kind="plan", payload={"title": "Synthetic plan"}))

        def run_stream(self, *, on_delta, **kwargs):
            calls.append("model")
            on_delta("independent durable body")
            if outcome == "failed":
                raise RuntimeError("synthetic failure")
            if outcome == "interrupted":
                raise AgentInterrupted("synthetic stop")
            return AgentRunResult(
                answer="canonical answer",
                citations=(),
                release_id="release-a",
                provider="test",
                model="test",
            )

    class Receipt(ReceiptScope):
        def finish(self, result):
            if result == "error" and outcome == "length":
                with db.engine.connect() as conn:
                    row = conn.execute(
                        text("SELECT status FROM agent_runs WHERE idempotency_key=:key"),
                        {"key": key},
                    ).first()
                    financial_order.append(row[0] if row else None)
            return super().finish(result)

    receipt = Receipt(
        {
            "output_finish_reason": "truncated" if outcome == "length" else "complete",
            "usage_status": "known",
            "settlement_status": "settled",
            "receipt_persistence": "saved",
        }
    )

    @contextmanager
    def scope():
        with db.session() as session:
            yield DisciplinaryAgentApplication(
                conversations=ConversationService(SqliteConversationRepository(session)),
                runner=Runner(),
                tools_factory=Tools,
                rollback=session.rollback,
                billing=Billing(receipt) if outcome == "length" else None,
            )

    client.app.state.disciplinary_agent_scope = scope
    request = SimpleNamespace(app=client.app, headers={})
    current = SimpleNamespace(user=SimpleNamespace(user_id=uid))
    release = agent._release_active_run

    def mark_done(*args):
        release(*args)
        worker_done.set()

    monkeypatch.setattr(agent, "_release_active_run", mark_done)

    def observe_commit(session):
        if session.get_bind() is not db.engine:
            return
        with db.engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT run_id, status, lease_token, last_event_sequence "
                    "FROM agent_runs WHERE user_id=:uid AND idempotency_key=:key"
                ),
                {"uid": str(uid), "key": key},
            ).all()
            for rid, status, attempt, cursor in rows:
                if status == "running":
                    continue
                events = conn.execute(
                    text(
                        "SELECT sequence, name FROM agent_output_events "
                        "WHERE run_id=:rid AND attempt_id=:attempt ORDER BY sequence"
                    ),
                    {"rid": rid, "attempt": attempt},
                ).all()
                seen.append((status, cursor, tuple(events)))

    event.listen(Session, "after_commit", observe_commit)

    async def collect():
        stream = agent.stream_agent_turn(
            AgentTurnRequest(
                message="Synthetic outcome",
                mode="deep_research" if outcome == "awaiting" else "standard",
            ),
            request,
            current,
            key,
        )
        frames = [
            event_parts(frame) async for frame in stream.body_iterator if not frame.startswith(":")
        ]
        assert await asyncio.to_thread(worker_done.wait, 3)
        return frames

    try:
        frames = asyncio.run(asyncio.wait_for(collect(), 6))
    finally:
        event.remove(Session, "after_commit", observe_commit)
    assert seen, "Observer must see the committed terminal state."
    gaps = [
        (status, cursor, events)
        for status, cursor, events in seen
        if not any(name in TERMINALS for _, name in events)
    ]
    assert not gaps, f"Canonical terminal was externally committed before its real event: {gaps}"
    assert len(calls) == (0 if outcome == "awaiting" else 1)
    assert len([e for e in seen[-1][2] if e[1] in TERMINALS]) == 1
    assert frames[-1][0] is not None, "Terminal has a real durable cursor."
    if outcome == "length":
        assert financial_order == ["running"], (
            "Streaming finance closes without holding the final logical writer."
        )


@pytest.mark.parametrize(
    "events",
    [
        (),
        (("assistant_delta", {"delta": "must stay independent"}),),
        (("turn_completed", {}), ("turn_failed", {})),
        (("turn_completed", []),),
        (("turn_completed",),),
        (("agent_delivery_state", {}),),
    ],
)
def test_terminal_batch_rejects_missing_or_ambiguous_terminal(events):
    from qunxue_api.modules.agent_conversation import AgentTerminalEventBatch

    with pytest.raises(ValueError):
        AgentTerminalEventBatch(events)


@pytest.mark.parametrize("repository_kind", ["sqlite", "memory"])
def test_terminal_batch_replay_and_rejected_owner_never_advance_cursor(client, repository_kind):
    from qunxue_api.modules.agent_conversation import AgentTerminalEventBatch

    runner, request, current, database = setup_runtime(client)
    user_id = current.user.user_id
    key = "terminal-batch-fences"

    @contextmanager
    def repository_scope():
        if repository_kind == "memory":
            yield ConversationService.in_memory()._repository
        else:
            with database.session() as session:
                yield SqliteConversationRepository(session)

    with repository_scope() as repo:
        service = ConversationService(repo)
        conversation = service.create_conversation(user_id=user_id, title="terminal batch")
        run = service.start_run(
            user_id=user_id,
            conversation_id=conversation.conversation_id,
            idempotency_key=key,
            knowledge_release_id="release-a",
        )
        service.finish_run(run_id=run.run_id, lease_token=run.lease_token, status="failed")
        body = (
            ("agent_delivery_state", {"usage_status": "pending"}),
            ("citation_added", {"citation_id": "actual-citation"}),
            ("turn_failed", {"code": "test_failure"}),
        )
        first = service.append_terminal_events(
            user_id=user_id,
            run_id=run.run_id,
            attempt_id=run.lease_token,
            batch=AgentTerminalEventBatch(body),
        )
        assert [event.sequence for event in first] == [1, 2, 3]
        assert tuple((event.name, event.payload) for event in first) == body
        service.commit()
        for name in AgentTerminalEventBatch.terminal_names:
            assert (
                service.append_terminal_events(
                    user_id=user_id,
                    run_id=run.run_id,
                    attempt_id=run.lease_token,
                    batch=AgentTerminalEventBatch(
                        (
                            ("agent_delivery_state", {"wrong": "duplicate"}),
                            (name, {}),
                        )
                    ),
                )
                == ()
            )
        for owner, attempt in ((UUID(int=987), run.lease_token), (user_id, "stale")):
            assert (
                service.append_terminal_events(
                    user_id=owner,
                    run_id=run.run_id,
                    attempt_id=attempt,
                    batch=AgentTerminalEventBatch((("turn_failed", {}),)),
                )
                is None
            )
        assert service.read_output_events(user_id=user_id, run_id=run.run_id) == first
        assert service.find_run_by_id(user_id=user_id, run_id=run.run_id).last_event_sequence == 3


def test_canonical_preflush_error_is_not_a_terminal_journal_outage(client, monkeypatch):
    from qunxue_api.modules.agent_conversation import (
        AgentTerminalEventBatch,
        AgentTerminalJournalFailure,
    )

    database = client.app.state.database
    with database.session() as session:
        repo = SqliteConversationRepository(session)

        def failed_flush(*args, **kwargs):
            raise RuntimeError("canonical flush failure")

        with monkeypatch.context() as patch:
            patch.setattr(session, "flush", failed_flush)
            with pytest.raises(RuntimeError, match="canonical flush failure") as caught:
                repo.append_terminal_events(
                    user_id=UUID(int=1),
                    run_id=UUID(int=2),
                    attempt_id="old",
                    batch=AgentTerminalEventBatch((("turn_failed", {}),)),
                )
            assert not isinstance(caught.value, AgentTerminalJournalFailure)


@pytest.mark.parametrize("failure_stage", ["billing_open", "tool_binding"])
@pytest.mark.parametrize("journal_failure", [False, True])
def test_failure_before_run_started_keeps_its_original_terminal_identity(
    client, monkeypatch, failure_stage, journal_failure,
):
    from sqlalchemy.exc import OperationalError

    runner, request, current, database = setup_runtime(client)
    original_scope = request.app.state.disciplinary_agent_scope
    key = "failure-before-start-callback"

    class BrokenBilling:
        def open(self, **kwargs):
            raise RuntimeError("synthetic billing admission failure")

    class BrokenTools(Tools):
        def bind_agent_context(self, **kwargs):
            raise RuntimeError("synthetic tool binding failure")

    @contextmanager
    def failing_scope():
        with original_scope() as app:
            if failure_stage == "billing_open":
                app._billing = BrokenBilling()
            else:
                app._tools_factory = BrokenTools
            yield app

    request.app.state.disciplinary_agent_scope = failing_scope
    if journal_failure:
        append = SqliteConversationRepository._append_output_event

        def fail_terminal(repo, **kwargs):
            if kwargs["name"] == "turn_failed":
                raise OperationalError("terminal INSERT", {}, RuntimeError("synthetic outage"))
            return append(repo, **kwargs)

        monkeypatch.setattr(SqliteConversationRepository, "_append_output_event", fail_terminal)

    async def collect(response):
        return [event_parts(frame) async for frame in response.body_iterator]

    response = stream_agent_turn(AgentTurnRequest(message="问题"), request, current, key)
    frames = asyncio.run(asyncio.wait_for(collect(response), timeout=3))
    assert len(frames) == 1 and frames[0][1] == "turn_failed"
    assert frames[0][2]["code"] == "agent_unavailable"
    assert runner.calls == 0
    with database.session() as session:
        repo = SqliteConversationRepository(session)
        run = repo.find_run(user_id=current.user.user_id, idempotency_key=key)
        assert run.status == "failed" and not run.partial_answer
        assert run.output_attempts[0].answer == ""
        journal = repo.read_output_events(user_id=current.user.user_id, run_id=run.run_id)
    if journal_failure:
        assert frames[0][0] is None and journal == ()
    else:
        assert len(journal) == 1 and frames[0][0] == f"{run.run_id}:1"
        replay = subscribe_agent_run_events(run.run_id, request, current, after=0)
        assert asyncio.run(asyncio.wait_for(collect(replay), timeout=3)) == frames
    assert runner.calls == 0


@pytest.mark.parametrize(
    "fault", ["none", "canonical", "terminal_citation", "fallback", "runner", "projection"],
)
@pytest.mark.parametrize("broken_logger", [False, True])
def test_output_storage_diagnostics_preserve_body_and_settlement(
    client, monkeypatch, caplog, fault, broken_logger,
):
    """Actual SQLite faults exercise formatted diagnostics, not invented exceptions."""
    import logging

    from sqlalchemy import text
    from test_agent_delivery_output_state import Billing, ReceiptScope

    from qunxue_api.api.routes import agent
    from qunxue_api.application import disciplinary_agent
    from qunxue_api.modules.agent_conversation import AgentEvidence

    body = "synthetic-private-body Authorization=synthetic-token Cookie=synthetic-cookie"
    prompt = "synthetic-private-input code=synthetic-code"
    uid = registered_user(client)
    database = client.app.state.database
    receipt = ReceiptScope({"output_finish_reason": "complete", "usage_status": "known",
                            "settlement_status": "settled", "receipt_persistence": "saved"})
    if fault == "projection":
        receipt.delivery_state.update(usage_status="unknown", settlement_status="pending")
    calls = []
    log_calls = []
    unhandled = []
    monkeypatch.setattr(threading, "excepthook", unhandled.append)

    class StatefulError(RuntimeError):
        reads = 0

        @property
        def exceptions(self):
            self.reads += 1
            if fault == "projection" and self.reads == 2:
                raise RuntimeError("synthetic projection failure")
            if fault != "projection" and self.reads > 2:
                raise RuntimeError("unexpected repeat classification")
            return ()

    original_error = StatefulError(body)

    class OutputTools(Tools):
        evidence = {"citation-a": True}

    class OutputRunner:
        def run_stream(self, *, on_delta, **kwargs):
            calls.append("model")
            on_delta(body)
            if fault in {"runner", "projection"}:
                raise original_error
            return AgentRunResult(
                answer=body, citations=(AgentEvidence(
                    citation_id="citation-a", label="source", kind="source", excerpt=body,
                    source_kind="web",
                ),), release_id="release-a", provider="test", model="test",
            )

    @contextmanager
    def scope():
        with database.session() as session:
            yield DisciplinaryAgentApplication(
                conversations=ConversationService(SqliteConversationRepository(session)),
                runner=OutputRunner(), tools_factory=OutputTools, billing=Billing(receipt),
                rollback=session.rollback, atomic=session.begin_nested,
            )

    client.app.state.disciplinary_agent_scope = scope
    request = SimpleNamespace(app=client.app, headers={})
    current = SimpleNamespace(user=SimpleNamespace(user_id=uid))
    for logger in (agent.logger, disciplinary_agent.logger):
        monkeypatch.setattr(logger, "disabled", False)
        caplog.set_level(logging.ERROR, logger=logger.name)
    logger = (agent.logger if fault in {"canonical", "fallback", "runner"}
              else disciplinary_agent.logger)
    if broken_logger:
        def fail_sink(*args, **kwargs):
            log_calls.append("sink")
            raise RuntimeError("synthetic sink unavailable")
        monkeypatch.setattr(logger, "error", fail_sink)
    if fault not in {"none", "runner", "projection"}:
        table, condition = (
            ("agent_messages", "NEW.role='assistant'") if fault in {"canonical", "fallback"} else
            ("agent_output_events", "NEW.name='citation_added'")
        )
        with database.engine.begin() as connection:
            connection.execute(text(
                f"CREATE TRIGGER output_fault BEFORE INSERT ON {table} WHEN {condition} "
                "BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END"
            ))

    if fault == "fallback":
        with database.engine.begin() as connection:
            connection.execute(text(
                "CREATE TRIGGER status_fault BEFORE UPDATE ON agent_runs "
                "WHEN NEW.status='failed' BEGIN "
                "SELECT RAISE(ABORT, 'synthetic status failure'); END"
            ))
            connection.execute(text(
                "CREATE TRIGGER fallback_fault BEFORE INSERT ON agent_output_events "
                "WHEN NEW.name='turn_failed' BEGIN "
                "SELECT RAISE(ABORT, 'synthetic fallback failure'); END"
            ))

    async def exercise():
        response = stream_agent_turn(AgentTurnRequest(message=prompt), request, current,
                                     "safe-output-diagnostic")
        return [event_parts(frame) async for frame in response.body_iterator]

    frames = asyncio.run(asyncio.wait_for(exercise(), timeout=5))
    with database.session() as session:
        repository = SqliteConversationRepository(session)
        run = repository.find_run(user_id=uid, idempotency_key="safe-output-diagnostic")
        conversation = ConversationService(repository).get_conversation(
            user_id=uid, conversation_id=run.conversation_id,
        )
        events = repository.read_output_events(user_id=uid, run_id=run.run_id)
    assert calls == ["model"]
    assert not unhandled
    if fault in {"runner", "projection"}:
        assert original_error.reads == (3 if fault == "projection" else 2)
        assert original_error.args == (body,)
        assert original_error.__context__ is None
    assert run.output_attempts[0].answer == body
    failure = fault in {"canonical", "fallback", "runner", "projection"}
    assert receipt.outcomes == (["error"] if failure else ["success"])
    expected_status = {
        "canonical": "failed", "fallback": "running", "runner": "failed", "projection": "failed",
    }
    assert run.status == expected_status.get(fault, "completed")
    assert len(conversation.turns) == (0 if failure else 1)
    if not failure:
        assert conversation.turns[0].assistant_message.content == body
        assert frames[-1][1] == "turn_completed"
        assert frames[-1][2]["conversation"]["turns"][0]["assistant"]["content"] == body
    else:
        assert frames[-1][1] == "turn_failed"
        assert frames[-1][2]["code"] == "agent_unavailable"
        assert frames[-1][2]["message"] == "Agent 暂时无法完成回答，请稍后重试。"
    assert not any(name == "output_persistence_failed" for _, name, _ in frames)
    if fault in {"terminal_citation", "fallback", "projection"}:
        assert frames[-1][0] is None
        assert not any(event.name in agent._TERMINAL_EVENT_NAMES for event in events)
    else:
        assert frames[-1][0] is not None
    if fault == "projection":
        metadata = [payload for _, name, payload in frames if name == "agent_delivery_state"]
        assert metadata and metadata[-1]["usage_status"] == "unknown"
        assert "output_tokens" not in metadata[-1]
    if fault == "none":
        assert not log_calls
        return
    if broken_logger:
        assert log_calls == (["sink", "sink"] if fault == "fallback" else ["sink"])
        return
    records = [record for record in caplog.records if record.name == logger.name]
    assert len(records) == (2 if fault == "fallback" else 1)
    record = records[-1]
    assert not record.exc_info and record.exc_text is None and not record.stack_info
    formatted = "\n".join(logging.Formatter().format(item) for item in caplog.records
                          if item.name in {agent.logger.name, disciplinary_agent.logger.name})
    assert all(secret not in formatted for secret in (
        body, prompt, "synthetic-private", "synthetic-token", "synthetic-cookie", "synthetic-code",
        "parameters:", "INSERT INTO", "Traceback", "synthetic storage failure",
    ))
    payload = json.loads(record.args[1])
    expected_category = "unknown" if fault in {"runner", "projection"} else "storage_error"
    assert payload["category"] == expected_category
    assert payload["run_id"] == str(run.run_id)
    assert payload["conversation_id"] == str(run.conversation_id)
    assert payload["attempt_id"] == run.lease_token
    assert payload["frames"]
