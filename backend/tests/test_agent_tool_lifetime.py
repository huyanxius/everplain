"""Deterministic SDK resource ownership regressions; no provider or network calls."""

import threading

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session


def test_native_async_identity_schema_and_prompt_cancel_are_preserved():
    import asyncio
    import dataclasses

    from pydantic_ai import Agent, RunContext

    from qunxue_api.adapters.research_agent.tool_runtime import AgentToolRuntime

    entered = None
    finalized = []

    async def native(ctx: RunContext[None], value: int = 7) -> int:
        """Synthetic async tool with an intact typed default."""
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            finalized.append(True)
        return value

    async def scenario():
        nonlocal entered
        entered = asyncio.Event()
        runtime = AgentToolRuntime(writing_instructions=lambda: "")
        actual, baseline = Agent(), Agent()
        runtime.tool(actual, sequential=True, retries=1)(native)
        baseline.tool(native, sequential=True, retries=1)
        wrapped = actual._function_toolset.tools["native"]
        plain = baseline._function_toolset.tools["native"]
        assert wrapped.function is native
        assert dataclasses.asdict(wrapped.tool_def) == dataclasses.asdict(plain.tool_def)
        call = asyncio.create_task(wrapped.function_schema.call({"value": 13}, None))
        await entered.wait()
        call.cancel()
        with pytest.raises(asyncio.CancelledError):
            await call
        assert finalized == [True]

    asyncio.run(scenario())


def test_event_loop_shutdown_cannot_close_session_ahead_of_thread(tmp_path, monkeypatch):
    import asyncio

    from pydantic_ai import Agent, RunContext

    from qunxue_api.adapters.research_agent.tool_runtime import AgentToolRuntime

    engine = create_engine(
        f"sqlite:///{tmp_path / 'shutdown.db'}", connect_args={"check_same_thread": False}
    )
    release, finished = threading.Event(), threading.Event()
    early_close, async_errors = [], []
    runtime, agent = AgentToolRuntime(writing_instructions=lambda: ""), Agent()
    shutdown = False
    started = None
    original_shield = asyncio.shield

    def observe_drain(future):
        result = original_shield(future)
        cancelling = getattr(future, "cancelling", lambda: 0)()
        if shutdown and not future.done() and not cancelling:
            # An uncancelled pending executor completion is actually retained
            # during shutdown. Release only after that drain await is installed.
            asyncio.get_running_loop().call_soon(release.set)
        return result

    monkeypatch.setattr(asyncio, "shield", observe_drain)

    async def owned_scope():
        loop = asyncio.get_running_loop()
        with Session(engine) as session:

            def hold_commit(_session):
                loop.call_soon_threadsafe(started.set)
                assert release.wait(5), "shutdown neither drained nor closed its owner"

            event.listen(session, "after_commit", hold_commit)

            @runtime.tool(agent)
            def resource(ctx: RunContext[None]) -> str:
                try:
                    session.execute(text("SELECT 1"))
                    session.commit()
                    return "completed"
                finally:
                    finished.set()

            try:
                await agent._function_toolset.tools["resource"].function_schema.call({}, None)
            finally:
                early_close.append(not finished.is_set())
                # Negative-control recovery: the old implementation closes early.
                release.set()

    async def scenario():
        nonlocal shutdown, started
        started = asyncio.Event()
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(lambda _loop, context: async_errors.append(context))
        asyncio.create_task(owned_scope())
        await started.wait()
        shutdown = True
        # No synthetic task.cancel: asyncio.run performs its actual shutdown.

    try:
        asyncio.run(scenario())
        assert finished.is_set()
        assert early_close == [False], async_errors
        assert async_errors == []
    finally:
        release.set()
        engine.dispose()


def test_executing_executor_job_cancelled_before_function_start_has_no_late_effect():
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    from pydantic_ai import Agent, RunContext

    from qunxue_api.adapters.research_agent.tool_runtime import AgentToolRuntime

    release = threading.Event()
    job_running = loop = None
    effects = []

    class PrestartExecutor(ThreadPoolExecutor):
        def submit(self, function, *args, **kwargs):
            def delayed():
                # The concurrent Future is RUNNING and cannot be canceled, but
                # the registered function has not crossed its own start gate.
                loop.call_soon_threadsafe(job_running.set)
                assert release.wait(5)
                return function(*args, **kwargs)

            return super().submit(delayed)

    async def scenario():
        nonlocal job_running, loop
        loop = asyncio.get_running_loop()
        job_running = asyncio.Event()
        executor = PrestartExecutor(max_workers=1)
        loop.set_default_executor(executor)
        runtime, agent = AgentToolRuntime(writing_instructions=lambda: ""), Agent()

        @runtime.tool(agent)
        def pending(ctx: RunContext[None]) -> str:
            effects.append("business write after canceled scope")
            return "done"

        task = asyncio.create_task(
            agent._function_toolset.tools["pending"].function_schema.call({}, None)
        )
        await job_running.wait()
        try:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert effects == []
        finally:
            release.set()
            await loop.run_in_executor(executor, lambda: None)
        assert effects == [], "already-running executor job entered the canceled function"

    asyncio.run(scenario())


def test_reused_runtime_keeps_concurrent_run_owners_and_contexts_isolated():
    import asyncio
    from contextvars import ContextVar
    from types import SimpleNamespace

    from pydantic_ai import Agent, RunContext

    from qunxue_api.adapters.research_agent.tool_runtime import AgentToolRuntime
    from qunxue_api.modules.agent_conversation import AgentToolEvent

    runtime, agent = AgentToolRuntime(writing_instructions=lambda: ""), Agent()
    marker = ContextVar("run_owner_identity", default="outside")
    release_a = threading.Event()
    events = {"A": [], "B": []}
    closed = []
    a_entered = None

    @runtime.tool(agent)
    def scoped(ctx: RunContext[dict], label: str) -> str:
        assert ctx.deps["label"] == marker.get() == label
        runtime.emit(AgentToolEvent(tool="scoped", phase="started", call_id=label))
        if label == "A":
            loop.call_soon_threadsafe(a_entered.set)
            assert release_a.wait(5)
        runtime.emit(AgentToolEvent(tool="scoped", phase="finished", call_id=label))
        return label

    async def own(label):
        token = marker.set(label)
        try:
            with runtime.activate(
                on_tool_event=events[label].append, is_cancelled=None, writing_preview=None
            ):
                # B remains independently idle while A's actual worker owns deps.
                assert runtime.when_idle(lambda: label) == label
                try:
                    return await agent._function_toolset.tools["scoped"].function_schema.call(
                        {"label": label}, SimpleNamespace(deps={"label": label})
                    )
                finally:
                    assert runtime.is_idle(), "run leaked its resource owner count"
                    closed.append(label)
        finally:
            marker.reset(token)

    async def scenario():
        nonlocal a_entered, loop
        loop = asyncio.get_running_loop()
        a_entered = asyncio.Event()
        a = asyncio.create_task(own("A"))
        try:
            await a_entered.wait()
            assert await own("B") == "B"
            assert closed == ["B"]
            assert not a.done()
            a.cancel()
            release_a.set()
            with pytest.raises(asyncio.CancelledError):
                await a
            assert runtime.is_idle()
            assert marker.get() == "outside"
        finally:
            release_a.set()

    loop = None
    asyncio.run(scenario())
    assert closed == ["B", "A"]
    assert [item.call_id for item in events["A"]] == ["A", "A"]
    assert [item.call_id for item in events["B"]] == ["B", "B"]
