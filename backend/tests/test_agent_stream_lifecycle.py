import asyncio
import json
import threading
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from qunxue_api.api.contracts.agent import AgentTurnRequest
from qunxue_api.api.dependencies import get_current_session
from qunxue_api.api.routes.agent import router, stream_agent_turn
from qunxue_api.modules.agent_conversation import (
    AgentInterrupted,
    ConversationNotFound,
    ConversationService,
)
from qunxue_api.settings import Settings


def test_asgi_disconnect_detaches_subscription_and_explicit_stop_cancels_worker():
    """Closing a connection cannot claim the user pressed stop."""
    stopped = threading.Event()
    cleanup = threading.Event()
    user_id = UUID(int=923)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="silent model")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="disconnect-test", knowledge_release_id="test")

    class SlowApplication:
        def find_run(self, **kwargs):
            return None  # The first command has not been admitted by this fake runner yet.

        def find_run_by_id(self, **kwargs):
            return service.find_run_by_id(**kwargs)

        def append_output_event(self, **kwargs):
            return service.append_output_event(**kwargs)

        def read_output_events(self, **kwargs):
            return service.read_output_events(**kwargs)

        def run_turn(self, **kwargs):
            kwargs["on_run_started"](run.run_id, conversation.conversation_id, False,
                                      lease_token=run.lease_token)
            while not cleanup.wait(0.01):
                if kwargs["is_cancelled"]():
                    stopped.set()
                    service.finish_run(run_id=run.run_id, status="interrupted",
                                       lease_token=run.lease_token)
                    raise AgentInterrupted("explicitly stopped")

        def heartbeat(self, **kwargs):
            return False

        def request_cancel(self, **kwargs):
            return service.request_cancel(**kwargs)

    @contextmanager
    def application_scope():
        yield SlowApplication()

    async def exercise():
        from fastapi import Response

        from qunxue_api.api.routes.agent import stop_agent_run

        disconnect = asyncio.Event()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            settings=Settings(_env_file=None), disciplinary_agent_scope=application_scope,
        )))
        current = SimpleNamespace(user=SimpleNamespace(user_id=user_id))
        response = stream_agent_turn(payload=AgentTurnRequest(message="silent model"),
                                     request=request, current=current,
                                     idempotency_key="disconnect-test")

        async def receive():
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if b"turn_started" in message.get("body", b""):
                disconnect.set()

        try:
            await asyncio.wait_for(response(
                {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.0"}},
                receive, send,
            ), timeout=1)
            assert not await asyncio.to_thread(stopped.wait, 0.1)
            assert not service.find_run_by_id(user_id=user_id, run_id=run.run_id).cancel_requested
            stop_agent_run(run.run_id, request, Response(), current, "explicit-stop")
            assert await asyncio.to_thread(stopped.wait, 1)
        finally:
            cleanup.set()
            await asyncio.sleep(0.02)

    asyncio.run(exercise())


def test_stop_unknown_run_does_not_claim_success():
    class Application:
        def request_cancel(self, **kwargs):
            raise ConversationNotFound("run does not belong to this user")

    @contextmanager
    def application_scope():
        yield Application()

    app = FastAPI()
    app.state.disciplinary_agent_scope = application_scope
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(user_id=UUID(int=931)),
    )
    app.add_exception_handler(ConversationNotFound, lambda request, error: JSONResponse(
        {"error": {"code": "not_found"}}, status_code=404,
    ))
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            f"/api/agent/runs/{UUID(int=932)}/stop",
            headers={"Idempotency-Key": "stop-unknown"},
        )
    assert response.status_code == 404


def test_input_limit_stream_error_is_not_a_provider_outage():
    from qunxue_api.adapters.model import ModelAttemptFailure
    from qunxue_api.adapters.research_agent.pydantic_runner import AgentModelRouteError

    class LimitedApplication:
        def find_run(self, **kwargs):
            return None

        def run_turn(self, **kwargs):
            raise AgentModelRouteError.from_attempt(
                ModelAttemptFailure(code="model_input_limit", retryable=False)
            )

    @contextmanager
    def application_scope():
        yield LimitedApplication()

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            settings=Settings(_env_file=None), disciplinary_agent_scope=application_scope,
        )))
        response = stream_agent_turn(
            payload=AgentTurnRequest(message="synthetic context limit"), request=request,
            current=SimpleNamespace(user=SimpleNamespace(user_id=UUID(int=943))),
            idempotency_key="input-limit-test",
        )
        frames = [frame async for frame in response.body_iterator]
        failed = next(frame for frame in frames if "event: turn_failed" in frame)
        payload = json.loads(failed.split("data: ", 1)[1].strip())
        assert payload["code"] == "agent_input_limit"
        assert "上下文上限" in payload["message"]
        assert "暂时不可用" not in payload["message"]

    asyncio.run(exercise())


@pytest.mark.parametrize("finishes_during_read", [False, True])
@pytest.mark.parametrize(("status", "name", "payload"), [
    ("failed", "knowledge_index_choice_required", {"status": {"missing_count": 1}}),
    ("interrupted", "turn_interrupted", {"code": "output_truncated"}),
])
def test_live_terminal_waits_for_journal_even_if_worker_finishes_during_read(
    finishes_during_read, status, name, payload,
):
    """The business commit and route's terminal journal are separate transactions."""
    from qunxue_api.api.routes.agent import _subscribe_run_events

    user_id = UUID(int=944)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="terminal race")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="terminal-race", knowledge_release_id="test")
    service.finish_run(run_id=run.run_id, status=status, lease_token=run.lease_token)
    finished = threading.Event()
    reads = []

    def publish():
        service.append_output_event(user_id=user_id, run_id=run.run_id,
                                    attempt_id=run.lease_token, name=name, payload=payload)
        finished.set()

    class Application:
        def find_run_by_id(self, **kwargs):
            return service.find_run_by_id(**kwargs)

        def read_output_events(self, **kwargs):
            reads.append(1)
            if len(reads) == 1:
                snapshot = service.read_output_events(**kwargs)
                assert snapshot == ()
                if finishes_during_read:
                    publish()
                return snapshot
            if not finishes_during_read:
                publish()
            return service.read_output_events(**kwargs)

    @contextmanager
    def scope():
        yield Application()

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        stream = _subscribe_run_events(request, user_id, run.run_id, after=0,
                                       worker_finished=finished)
        frames = [frame async for frame in stream]
        assert len(reads) == 2
        assert len(frames) == 1
        assert f"id: {run.run_id}:1\nevent: {name}\n" in frames[0]
        assert json.loads(frames[0].split("data: ", 1)[1]) == {
            **payload, "attempt_id": run.lease_token,
        }

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))


def test_finished_live_worker_preserves_unjournaled_terminal_error():
    from qunxue_api.api.routes.agent import _subscribe_run_events

    user_id = UUID(int=945)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="failed terminal write")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="failed-terminal-write", knowledge_release_id="test")
    service.finish_run(run_id=run.run_id, status="failed", lease_token=run.lease_token)
    finished = threading.Event()
    finished.set()
    failure = ("knowledge_index_choice_required", {"status": {"missing_count": 1}})

    @contextmanager
    def scope():
        yield service

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        stream = _subscribe_run_events(request, user_id, run.run_id, after=0,
                                       worker_finished=finished, terminal_failure=[failure])
        frames = [frame async for frame in stream]
        assert len(frames) == 1
        assert "event: knowledge_index_choice_required\n" in frames[0]
        assert json.loads(frames[0].split("data: ", 1)[1]) == failure[1]
        assert not frames[0].startswith("id:")  # No fabricated durable event/cursor.

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))


@pytest.mark.parametrize("local_worker", [False, True])
@pytest.mark.parametrize(("status", "expected"), [
    ("failed", "turn_failed"), ("interrupted", "turn_interrupted"),
    ("awaiting_plan_confirmation", "research_waiting"),
])
def test_terminal_without_journal_still_closes_reconnect_or_finished_worker(local_worker,
                                                                           status, expected):
    from qunxue_api.api.routes.agent import _subscribe_run_events

    user_id = UUID(int=946)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="missing terminal")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="missing-terminal", knowledge_release_id="test")
    service.finish_run(run_id=run.run_id, status=status, lease_token=run.lease_token)
    finished = threading.Event()
    finished.set()

    @contextmanager
    def scope():
        yield service

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        stream = _subscribe_run_events(request, user_id, run.run_id, after=0,
                                       worker_finished=finished if local_worker else None)
        frames = [frame async for frame in stream]
        assert len(frames) == 1 and f"event: {expected}\n" in frames[0]

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))


@pytest.mark.parametrize("status", ["completed", "awaiting_plan_confirmation"])
def test_committed_canonical_result_wins_over_terminal_publish_failure(status):
    from qunxue_api.api.routes.agent import _subscribe_run_events

    user_id = UUID(int=947)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="canonical terminal")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="canonical-terminal", knowledge_release_id="test")
    service.finish_run(run_id=run.run_id, status=status, lease_token=run.lease_token)
    finished = threading.Event()
    finished.set()

    @contextmanager
    def scope():
        yield SimpleNamespace(
            find_run_by_id=service.find_run_by_id,
            read_output_events=service.read_output_events,
            get_conversation=service.get_conversation,
            release_ids_by_turn=lambda **kwargs: {},
        )

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        stream = _subscribe_run_events(request, user_id, run.run_id, after=0,
                                       worker_finished=finished,
                                       terminal_failure=[("turn_failed", {
                                           "code": "agent_unavailable",
                                       })])
        frames = [frame async for frame in stream]
        expected = "turn_completed" if status == "completed" else "research_waiting"
        assert len(frames) == 1 and f"event: {expected}\n" in frames[0]

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))


@pytest.mark.parametrize("status", ["failed", "interrupted", "running"])
def test_redacted_run_never_releases_unjournaled_terminal_details(status):
    from dataclasses import replace

    from qunxue_api.api.routes.agent import _subscribe_run_events

    service = ConversationService.in_memory()
    user_id = UUID(int=948)
    conversation = service.create_conversation(user_id=user_id, title="redacted terminal")
    run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="redacted-terminal", knowledge_release_id="test")
    if status != "running":
        service.finish_run(run_id=run.run_id, status=status, lease_token=run.lease_token)
    run = replace(service.find_run_by_id(user_id=user_id, run_id=run.run_id),
                  output_redacted=True)
    finished = threading.Event()
    finished.set()

    @contextmanager
    def scope():
        yield SimpleNamespace(find_run_by_id=lambda **kwargs: run,
                              read_output_events=lambda **kwargs: ())

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        stream = _subscribe_run_events(request, user_id, run.run_id, after=0,
                                       worker_finished=finished,
                                       terminal_failure=[("knowledge_index_choice_required", {
                                           "status": {"private_document": "deleted-secret"},
                                       })])
        frames = [frame async for frame in stream]
        expected = "turn_interrupted" if status == "interrupted" else "turn_failed"
        assert f"event: {expected}\n" in frames[-1]
        assert "deleted-secret" not in "".join(frames)
        assert "knowledge_index_choice_required" not in "".join(frames)

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))


def test_replaced_live_worker_cannot_emit_its_old_terminal_or_unsaved_body():
    from qunxue_api.api.routes.agent import _subscribe_run_events

    user_id = UUID(int=953)
    service = ConversationService.in_memory()
    conversation = service.create_conversation(user_id=user_id, title="replacement fence")
    old = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                            idempotency_key="replacement", knowledge_release_id="release-a")
    service.finish_run(run_id=old.run_id, lease_token=old.lease_token, status="interrupted")
    current = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                                idempotency_key="replacement", knowledge_release_id="release-a")
    assert current.lease_token != old.lease_token

    class Application:
        def find_run_by_id(self, **kwargs):
            return service.find_run_by_id(**kwargs)

        def read_output_events(self, **kwargs):
            return service.read_output_events(**kwargs)

    @contextmanager
    def scope():
        yield Application()

    finished = threading.Event()
    finished.set()

    async def exercise():
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            disciplinary_agent_scope=scope,
        )))
        frames = [frame async for frame in _subscribe_run_events(
            request, user_id, current.run_id, after=0, worker_finished=finished,
            fallback_identity={"attempt_id": old.lease_token}, unsaved_body=["old private tail"],
            terminal_failure=[("turn_failed", {"code": "old_failure"})],
        )]
        assert frames == []

    asyncio.run(asyncio.wait_for(exercise(), timeout=2))
    assert service.find_run_by_id(user_id=user_id, run_id=current.run_id) == current
