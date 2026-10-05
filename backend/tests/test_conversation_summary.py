"""Synthetic source/worker tests. These do not claim a live model or browser pass."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import update
from test_agent_memory import register
from test_conversation_context import seed, tools

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentConversationRow
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.adapters.sqlite.agent_memory_model import ConversationSummaryRow, MemoryUsageRow


def worker(client):
    result = client.app.state.context_summary_worker
    result.idle_seconds = 0
    result.generate = output
    return result


def output(batch):
    first = next(s for s in batch.sources if s["role"] == "user")
    refs = [
        {
            "conversation_id": first["conversation_id"],
            "message_id": first["message_id"],
            "quote": first["content"][:30],
        }
    ]
    return (
        {
            "summary": "你在规划杭州周末和一次公开演讲，交通预算已确定，演讲结构还想再讨论。",
            "summary_sources": refs,
            "cards": [
                {
                    "title": "杭州两日行程的交通取舍",
                    "description": "你希望周末去杭州，交通预算上限为五百元。",
                    "prompt": "按五百元交通预算比较杭州两日行程的交通安排。",
                    "sources": refs,
                }
            ],
        },
        1200,
        300,
    )


def test_multiple_conversation_source_snapshot_cached_once_and_injected(plain_client):
    owner = UUID(register(plain_client))
    a = seed(plain_client, owner, ("我周末要去杭州，交通预算不超过五百元。",))
    b = seed(plain_client, owner, ("我想准备一次公开演讲，还没有决定怎么安排结构。",))
    worker(plain_client)
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "pending"
    calls = []

    def generate(batch):
        calls.append(batch)
        assert {s["conversation_id"] for s in batch.sources} == {
            str(a.conversation_id),
            str(b.conversation_id),
        }
        assert {s["role"] for s in batch.sources} == {"user", "assistant"}
        assert any(s["content"] == "先确认日期，再比较交通。" for s in batch.sources)
        return output(batch)

    assert worker(plain_client).run_once(generate=generate)
    response = plain_client.get("/api/agent/context-summary")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "private, no-store"
    body = response.json()
    assert body["status"] == "ready" and body["summary"]
    assert body["cards"][0]["sources"][0]["quote"] in next(
        s["content"] for s in calls[0].sources if s["role"] == "user"
    )
    assert body["cards"][0]["prompt"].count("参考原对话") == 1
    assert "Model-generated recent conversation activity" in tools(plain_client, owner).context
    assert body["summary"] in tools(plain_client, owner).context
    assert not worker(plain_client).run_once(generate=generate)
    for _ in range(3):
        assert plain_client.get("/api/agent/context-summary").json() == body
    assert len(calls) == 1
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        assert (usage.calls, usage.budget_tokens) == (1, 1500)


def test_new_turn_deletion_and_account_switch_hide_stale_content(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner)
    assert worker(plain_client).run_once(generate=output)
    with plain_client.app.state.database.session() as session:
        row = session.get(AgentConversationRow, str(conversation.conversation_id))
        row.title = "旅行已取消"
    changed = plain_client.get("/api/agent/context-summary").json()
    assert changed["status"] == "pending" and changed["cards"] == []
    assert worker(plain_client).run_once(generate=output)
    other = UUID(register(plain_client))
    assert other != owner
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "empty"
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.read(owner)["cards"]
    with plain_client.app.state.database.session() as session:
        SqliteConversationRepository(session).delete(
            user_id=owner, conversation_id=conversation.conversation_id
        )
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.read(owner)["cards"] == []


def test_correction_arriving_during_generation_cannot_publish_old_summary(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner)

    def correct(batch):
        with plain_client.app.state.database.session() as session:
            row = session.get(AgentConversationRow, str(conversation.conversation_id))
            row.title = "计划取消，已经不去杭州了"
        return output(batch)

    assert worker(plain_client).run_once(generate=correct)
    result = plain_client.get("/api/agent/context-summary").json()
    assert result["status"] == "pending" and not result["cards"]
    # New fingerprint bypasses stale-attempt backoff, with fresh generation.
    assert worker(plain_client).run_once(generate=output)


def test_live_disable_during_generation_and_read_never_discloses(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)

    def disable(batch):
        with plain_client.app.state.memory_service_scope() as memory:
            memory.repository.configure(
                owner, None, expected_version=0, use_memory=False, learn_memory=False
            )
        return output(batch)

    assert worker(plain_client).run_once(generate=disable)
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "disabled" and not body["summary"] and not body["cards"]
    assert not worker(plain_client).run_once(generate=output)


def test_unverifiable_and_secret_and_generic_cards_are_rejected(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner, ("要去杭州。password: super-secret-value",))

    def invalid(batch):
        assert "super-secret-value" not in str(batch.sources)
        value, i, o = output(batch)
        value["summary_sources"][0]["quote"] = "这句话根本没有出现"
        value["cards"].extend(
            [
                {**value["cards"][0], "title": "比较可选方案"},
                {**value["cards"][0], "title": "password: super-secret-value"},
            ]
        )
        return value, i, o

    assert worker(plain_client).run_once(generate=invalid)
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "empty" and not body["summary"] and not body["cards"]


def test_failed_generation_backoff_budget_and_no_static_fallback(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    calls = []

    def failed(batch):
        calls.append(batch)
        raise RuntimeError("private provider body must not be cached")

    assert worker(plain_client).run_once(generate=failed)
    assert not worker(plain_client).run_once(generate=failed)
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and not body["cards"]
    with plain_client.app.state.database.session() as session:
        usage = session.get(MemoryUsageRow, (str(owner), datetime.now(UTC).date().isoformat()))
        assert usage.budget_tokens == 24000
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.last_error == "model:summary_failed"
    assert len(calls) == 1


def test_whole_messages_budget_and_no_model_for_weak_sources(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner, ("整条中文源消息" * 10000,), answer="完整的长助手回答" * 10000)
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "empty" and body["omitted_messages"] == 2
    assert not worker(plain_client).run_once(generate=output)
    with plain_client.app.state.context_summary_scope() as repo:
        assert not repo.snapshot(owner)[1]


def test_lease_prevents_duplicate_workers_and_idle_gate(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.claim(idle_seconds=600, daily_calls=8, daily_tokens=64000) is None
        batch = repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000)
        assert batch is not None
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000) is None
    with plain_client.app.state.database.session() as session:
        session.execute(
            update(ConversationSummaryRow).values(
                lease_until=datetime.now(UTC) - timedelta(seconds=1)
            )
        )
    with plain_client.app.state.context_summary_scope() as repo:
        assert repo.complete(batch, output(batch)[0], 1, 1) is False


def test_unauthenticated_summary_is_rejected(plain_client):
    assert plain_client.get("/api/agent/context-summary").status_code == 401


def test_deleted_material_assistant_content_never_sent_to_summarizer(plain_client):
    from uuid import uuid4

    from sqlalchemy import select

    from qunxue_api.adapters.sqlite.agent_conversation_model import AgentMessageRow

    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, answer="材料已删除之后不应恢复的私密结论")
    with plain_client.app.state.database.session() as session:
        message = session.scalar(
            select(AgentMessageRow).where(
                AgentMessageRow.conversation_id == str(conversation.conversation_id),
                AgentMessageRow.role == "assistant",
            )
        )
        message.citations = [
            {
                "citation_id": "gone",
                "label": "私密材料",
                "kind": "research_material",
                "source_kind": "research_material",
                "material_id": str(uuid4()),
                "parse_id": str(uuid4()),
            }
        ]

    def generate(batch):
        assert "材料已删除之后不应恢复的私密结论" not in str(batch.sources)
        assert any("已删除" in s["content"] for s in batch.sources if s["role"] == "assistant")
        return output(batch)

    assert worker(plain_client).run_once(generate=generate)
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "ready"


def test_model_noop_is_saved_as_empty_without_retry(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner, ("你好",), answer="你好。")

    def noop(batch):
        return {"summary": "", "summary_sources": [], "cards": []}, 100, 10

    assert worker(plain_client).run_once(generate=noop)
    assert not worker(plain_client).run_once(generate=noop)
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "empty"


def test_registered_history_tools_emit_safe_stream_events(plain_client, monkeypatch):
    import json
    from types import SimpleNamespace
    from uuid import uuid4

    from pydantic_ai.models.function import DeltaToolCall, FunctionModel

    from qunxue_api.adapters.research_agent.memory_tools import AgentMemoryTools
    from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner

    # This is an offline FunctionModel test; no network request is made. Do not
    # require optional SOCKS support merely to construct the unused SDK client.
    for name in (
        "ALL_PROXY",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "all_proxy",
        "https_proxy",
        "http_proxy",
    ):
        monkeypatch.delenv(name, raising=False)
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, ("杭州交通预算是五百元。",))
    memory = AgentMemoryTools(
        plain_client.app.state.memory_service_scope,
        conversation_scope=plain_client.app.state.conversation_context_scope,
        user_id=owner,
        task_id=None,
        conversation_id=uuid4(),
        run_id=uuid4(),
        prompt="回顾交通预算",
    )
    registry = SimpleNamespace(
        memory=memory,
        release=SimpleNamespace(knowledge_release_id="fixture"),
        evidence={},
        selected_evidence_ids=(),
        research_map_enabled=False,
        research_map={},
        web_search_enabled=False,
    )
    turns, events = [], []

    async def model_stream(messages, info):
        del messages, info
        step = len(turns)
        turns.append(step)
        if step == 0:
            yield {
                0: DeltaToolCall(
                    name="search_conversations",
                    json_args=json.dumps({"query": "杭州"}),
                    tool_call_id="search",
                )
            }
        elif step == 1:
            yield {
                0: DeltaToolCall(
                    name="read_conversation",
                    json_args=json.dumps(
                        {
                            "conversation_id": str(conversation.conversation_id),
                            "sequence": 0,
                        }
                    ),
                    tool_call_id="read",
                )
            }
        else:
            yield "你之前说交通预算是五百元。"

    runner = PydanticAIKnowledgeRunner(
        base_url="https://synthetic.test/v1", api_key="fixture", model="fixture", timeout_seconds=10
    )
    with runner._agent.override(model=FunctionModel(stream_function=model_stream)):
        result = runner.run_stream(
            prompt="回顾交通预算",
            conversation=(),
            tools=registry,
            on_delta=lambda _: None,
            on_tool_event=events.append,
        )
    assert "五百元" in result.answer
    assert [(e.tool, e.phase) for e in events] == [
        ("search_conversations", "started"),
        ("search_conversations", "finished"),
        ("read_conversation", "started"),
        ("read_conversation", "finished"),
    ]
    assert "杭州交通预算是五百元" not in str(events)
    assert all(not e.input or "query" not in e.input for e in events)


def test_unconfigured_generator_does_not_promise_pending_result(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    assert plain_client.app.state.context_summary_worker.generate is None
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "failed"


def test_wrapped_budget_denial_is_terminal_for_same_source_watermark(plain_client):
    from qunxue_api.modules.billing import BillingBudgetExceeded

    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    calls = []

    def blocked(batch):
        calls.append(batch)
        try:
            raise BillingBudgetExceeded("synthetic global risk cap", reason="global_risk_limit")
        except BillingBudgetExceeded as error:
            raise RuntimeError("synthetic SDK connection wrapper") from error

    assert worker(plain_client).run_once(generate=blocked)
    assert not worker(plain_client).run_once(generate=blocked)
    with plain_client.app.state.database.session() as session:
        row = session.get(ConversationSummaryRow, str(owner))
        assert row.attempts == 3 and row.last_error == "model:budget_exceeded"
        assert row.retry_after is None
    body = plain_client.get("/api/agent/context-summary").json()
    assert body["status"] == "failed" and not body["cards"]
    assert len(calls) == 1


def test_automatic_memory_content_version_does_not_resummarize_same_sources(plain_client):
    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    assert worker(plain_client).run_once(generate=output)
    before = plain_client.get("/api/agent/context-summary").json()
    with plain_client.app.state.memory_service_scope() as memory:
        scope = memory.repository.scope(owner, None)
        memory.repository.lock_scope(scope)  # same fence bump used by automatic learning
        assert memory.repository.scope(owner, None).version == scope.version + 1
    assert plain_client.get("/api/agent/context-summary").json() == before
    assert not worker(plain_client).run_once(generate=output)


def test_late_assistant_source_preserves_exact_read_sequence(plain_client):
    owner = UUID(register(plain_client))
    conversation = seed(plain_client, owner, tuple(f"交通讨论{i}" for i in range(30)))

    def generate(batch):
        source = next(s for s in batch.sources if s["role"] == "assistant")
        refs = [
            {
                "conversation_id": source["conversation_id"],
                "message_id": source["message_id"],
                "quote": source["content"],
            }
        ]
        value, i, o = output(batch)
        value["summary_sources"] = refs
        value["cards"][0]["sources"] = refs
        return value, i, o

    assert worker(plain_client).run_once(generate=generate)
    body = plain_client.get("/api/agent/context-summary").json()
    source = body["cards"][0]["sources"][0]
    assert source["sequence"] == 59 and source["role"] == "assistant"
    assert "sequence=59" in body["cards"][0]["prompt"]
    recall = tools(plain_client, owner)
    assert '"sequence": 59' in recall.context
    page = recall.read(str(conversation.conversation_id), sequence=source["sequence"])
    assert page["messages"][0]["content"] == source["quote"]
    assert recall.calls == 1


def test_summary_runtime_flag_is_independent_and_preserves_shared_budget(monkeypatch):
    from qunxue_api.settings import Settings

    monkeypatch.setenv("EVERPLAIN_MEMORY_LEARNING_ENABLED", "false")
    monkeypatch.delenv("EVERPLAIN_CONVERSATION_SUMMARY_ENABLED", raising=False)
    settings = Settings(_env_file=None)
    assert not settings.memory_learning_enabled
    assert settings.conversation_summary_enabled
    assert settings.memory_learning_idle_seconds == 600
    assert settings.memory_learning_daily_calls == 8
    assert settings.memory_learning_daily_tokens == 64000
    monkeypatch.setenv("EVERPLAIN_CONVERSATION_SUMMARY_ENABLED", "false")
    assert not Settings(_env_file=None).conversation_summary_enabled


def test_lifespan_generates_summary_with_learning_off_and_respects_both_user_switches(
    plain_client, monkeypatch
):
    import time
    from threading import Event

    from fastapi.testclient import TestClient

    from qunxue_api import bootstrap
    from qunxue_api.adapters.sqlite.agent_conversation_model import AgentMessageRow
    from qunxue_api.adapters.sqlite.conversation_context_repository import (
        SqliteConversationContextRepository,
    )
    from qunxue_api.application.memory_learning import MemoryLearningWorker
    from qunxue_api.settings import Settings

    disabled = []
    for use_memory, learn_memory in ((False, True), (True, False)):
        owner = UUID(register(plain_client))
        seed(plain_client, owner, (f"Disabled user's private source {use_memory}",))
        with plain_client.app.state.memory_service_scope() as memory:
            memory.repository.configure(
                owner, None, expected_version=0,
                use_memory=use_memory, learn_memory=learn_memory,
            )
        disabled.append(str(owner))
    eligible = UUID(register(plain_client))
    seed(plain_client, eligible, ("我周末要去杭州，交通预算不超过五百元。",))
    older = datetime.now(UTC) - timedelta(minutes=2)
    with plain_client.app.state.database.session() as session:
        session.execute(update(AgentConversationRow).values(updated_at=older))
        session.execute(update(AgentMessageRow).values(created_at=older))
    calls, source_owners, generated = [], set(), Event()
    source_text = SqliteConversationContextRepository.source_text

    def guarded_source(self, user_id, conversation, message):
        assert str(user_id) not in disabled
        source_owners.add(str(user_id))
        return source_text(self, user_id, conversation, message)

    def generate(batch):
        calls.append(str(batch.user_id))
        assert batch.user_id == eligible
        assert "Disabled user's private source" not in str(batch.sources)
        generated.set()
        return output(batch)

    def forbidden_learning(*args, **kwargs):
        raise AssertionError("Long-term learning must remain disabled")

    monkeypatch.setattr(SqliteConversationContextRepository, "source_text", guarded_source)
    monkeypatch.setattr(bootstrap, "PydanticConversationSummarizer", lambda **kwargs: generate)
    monkeypatch.setattr(bootstrap, "PydanticMemoryExtractor", forbidden_learning)
    monkeypatch.setattr(MemoryLearningWorker, "run_once", forbidden_learning)
    settings = Settings(
        _env_file=None, database_url=plain_client.app.state.database.engine.url.render_as_string(),
        runtime_mode="base", model_base_url="https://synthetic.test/v1",
        model_api_key="synthetic-test-key", model_name="gpt-6-luna",
        memory_learning_enabled=False, conversation_summary_enabled=True,
        memory_learning_idle_seconds=60,
    )
    app = bootstrap.create_app(
        settings=settings, database=plain_client.app.state.database,
        model_provider=plain_client.app.state.model_provider,
        require_email_verification=False,
    )
    # Only the generator boundary is injected; the actual lifecycle loop, claim,
    # source/privacy checks, persistence and shared quota run on the real database.
    app.state.context_summary_worker.billing = None
    assert app.state.context_summary_worker.generate is not None
    assert app.state.memory_worker._extractor is None
    with TestClient(app) as client:
        client.cookies.update(plain_client.cookies)
        assert generated.wait(5), "Summary scheduler did not start with learning disabled"
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            body = client.get("/api/agent/context-summary").json()
            if body["status"] == "ready":
                break
            time.sleep(0.02)
        assert body["status"] == "ready", body
        assert calls == [str(eligible)]
        assert source_owners == {str(eligible)}
        with app.state.context_summary_scope() as repository:
            for owner in disabled:
                assert repository.read(UUID(owner))["status"] == "disabled"
    with plain_client.app.state.database.session() as session:
        for owner in disabled:
            assert session.get(ConversationSummaryRow, owner) is None
        usage = session.get(MemoryUsageRow, (str(eligible), older.date().isoformat()))
        assert usage.calls == 1 and usage.budget_tokens == 1500


def test_global_summary_off_hides_existing_cache_and_never_promises_pending(
    plain_client, monkeypatch
):
    from fastapi.testclient import TestClient

    from qunxue_api import bootstrap
    from qunxue_api.adapters.sqlite.conversation_context_repository import (
        SqliteConversationContextRepository,
    )
    from qunxue_api.settings import Settings

    owner = UUID(register(plain_client))
    seed(plain_client, owner)
    assert worker(plain_client).run_once(generate=output)
    assert plain_client.get("/api/agent/context-summary").json()["status"] == "ready"

    def forbidden_source(*args, **kwargs):
        raise AssertionError("A disabled summary must not inspect original message content")

    monkeypatch.setattr(SqliteConversationContextRepository, "source_text", forbidden_source)
    settings = Settings(
        _env_file=None, database_url=plain_client.app.state.database.engine.url.render_as_string(),
        runtime_mode="mock", model_base_url=None, model_api_key=None, model_name=None,
        memory_learning_enabled=False, conversation_summary_enabled=False,
    )
    app = bootstrap.create_app(
        settings=settings, database=plain_client.app.state.database,
        require_email_verification=False,
    )
    assert app.state.context_summary_worker.generate is None
    with TestClient(app) as client:
        client.cookies.update(plain_client.cookies)
        body = client.get("/api/agent/context-summary").json()
        assert body["status"] == "disabled"
        assert body["summary"] == "" and body["summary_sources"] == [] and body["cards"] == []
        with app.state.context_summary_scope() as repository:
            assert repository.snapshot(owner) is None
            assert repository.claim(idle_seconds=0, daily_calls=8, daily_tokens=64000) is None
        assert "Model-generated recent conversation activity" not in tools(client, owner).context
