import asyncio
import json
import threading
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID

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
