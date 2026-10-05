"""No network: original output survives retries and billing/finalization failures."""

from uuid import UUID

import pytest
from test_agent_run_recovery import Tools, registered_user

from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import (
    AgentInterrupted,
    AgentRunResult,
    ConversationNotFound,
    ConversationService,
)


class AttemptRunner:
    deltas = ("已显示的长原文",)
    fail = True
    calls = 0

    def run_stream(self, *, on_delta, **kwargs):
        self.calls += 1
        for delta in self.deltas:
            on_delta(delta)
        if self.fail:
            raise AgentInterrupted("fault injection")
        return AgentRunResult(answer="完整规范回答", citations=(), release_id="release-a",
                              provider="test", model="test")


@pytest.mark.parametrize("short_deltas", [("短",), ()])
def test_sqlite_attempt_archive_survives_short_or_empty_failed_retry_and_reload(
    client, short_deltas,
):
    user_id = registered_user(client)
    runner = AttemptRunner()
    database = client.app.state.database
    key = "preserve-original"
    with database.session() as session:
        app = DisciplinaryAgentApplication(
            conversations=ConversationService(SqliteConversationRepository(session)),
            runner=runner, tools_factory=Tools,
        )
        with pytest.raises(AgentInterrupted):
            app.run_turn(user_id=user_id, conversation_id=None, prompt="原问题",
                         idempotency_key=key, on_delta=lambda _: None)
        first = app.find_run(user_id=user_id, idempotency_key=key)
        first_id = first.output_attempts[0].attempt_id
        runner.deltas = short_deltas
        with pytest.raises(AgentInterrupted):
            app.run_turn(user_id=user_id, conversation_id=first.conversation_id, prompt="被忽略",
                         idempotency_key=key, on_delta=lambda _: None)
    with database.session() as session:
        repo = SqliteConversationRepository(session)
        run = repo.find_run_by_id(user_id=user_id, run_id=first.run_id)
        assert run.output_attempts[0].answer == "已显示的长原文"
        assert run.output_attempts[0].attempt_id == first_id
        assert run.output_attempts[1].answer == "".join(short_deltas)
        assert all(attempt.status == "interrupted" for attempt in run.output_attempts)
        assert len(repo.get(user_id=user_id, conversation_id=first.conversation_id)
                   .unfinished_runs[0].output_attempts) == 2
        events = repo.read_output_events(user_id=user_id, run_id=run.run_id)
        assert [event.sequence for event in events] == list(range(1, len(events) + 1))
        assert [event.payload["delta"] for event in events] == ["已显示的长原文", *short_deltas]
        assert repo.read_output_events(user_id=user_id, run_id=run.run_id, after=1) == events[1:]
        with pytest.raises(ConversationNotFound):
            repo.read_output_events(user_id=UUID(int=8888), run_id=run.run_id)
        assert repo.append_output_event(user_id=user_id, run_id=run.run_id,
                                        attempt_id=first_id, name="assistant_delta",
                                        payload={"delta": "stale"}) is None


def test_body_commit_precedes_callback_and_final_failure_does_not_undo_it(client):
    user_id = registered_user(client)
    database = client.app.state.database
    with database.session() as session:
        app = DisciplinaryAgentApplication(
            conversations=ConversationService(SqliteConversationRepository(session)),
            runner=AttemptRunner(), tools_factory=Tools,
        )

        def delivered(delta):
            # Subscriber can disappear/fail after it sees a token. The committed
            # body must already be readable from a different database connection.
            with database.session() as other:
                stored = SqliteConversationRepository(other).find_run(
                    user_id=user_id, idempotency_key="delivered-before-error",
                )
                assert stored.output_attempts[0].answer == delta
            raise RuntimeError("transport or billing observer failed")

        with pytest.raises(RuntimeError, match="observer failed"):
            app.run_turn(user_id=user_id, conversation_id=None, prompt="问题",
                         idempotency_key="delivered-before-error", on_delta=delivered)
    with database.session() as session:
        run = SqliteConversationRepository(session).find_run(
            user_id=user_id, idempotency_key="delivered-before-error",
        )
        assert run.status == "failed"
        assert run.output_attempts[0].answer == "已显示的长原文"


def test_completed_turn_retains_original_stream_versions(client):
    user_id = registered_user(client)
    runner = AttemptRunner()
    runner.fail = False
    with client.app.state.database.session() as session:
        app = DisciplinaryAgentApplication(
            conversations=ConversationService(SqliteConversationRepository(session)),
            runner=runner, tools_factory=Tools,
        )
        execution = app.run_turn(user_id=user_id, conversation_id=None, prompt="问题",
                                 idempotency_key="canonical-v-original", on_delta=lambda _: None)
    with client.app.state.database.session() as session:
        saved = SqliteConversationRepository(session).get(
            user_id=user_id, conversation_id=execution.conversation.conversation_id,
        )
        assert saved.turns[0].assistant_message.content == "完整规范回答"
        assert saved.turns[0].output_attempts[0].answer == "已显示的长原文"
        assert saved.turns[0].output_attempts[0].status == "completed"


def test_deleted_source_redacts_all_archived_attempts_and_replay(client):
    from qunxue_api.modules.agent_conversation import AgentMaterialAttachment

    user_id = registered_user(client)
    with client.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        service = ConversationService(repo)
        conversation = service.create_conversation(user_id=user_id, title="已删除的资料")
        previous = None
        for index in range(2):
            run = service.start_run(
                user_id=user_id, conversation_id=conversation.conversation_id,
                idempotency_key="deleted-archive", knowledge_release_id="release-a",
                request_snapshot={"message": "问题"},
                material_attachments=(AgentMaterialAttachment(UUID(int=811), UUID(int=812)),),
            )
            repo.commit()
            repo.append_output_event(user_id=user_id, run_id=run.run_id,
                                     attempt_id=run.lease_token, name="assistant_delta",
                                     payload={"delta": f"deleted-secret-{index}"})
            repo.finish_run(run_id=run.run_id, lease_token=run.lease_token, status="failed")
            repo.commit()
            previous = run
        restored = repo.find_run_by_id(user_id=user_id, run_id=previous.run_id)
        assert len(restored.output_attempts) == 2
        assert "secret" not in repr(restored)
        assert repo.read_output_events(user_id=user_id, run_id=previous.run_id) == ()


def test_migration_preserves_exact_legacy_body_without_fabricating_stream_events():
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, text

    path = Path(__file__).parents[1] / "migrations/versions/20261005_0610_agent_output_journal.py"
    spec = importlib.util.spec_from_file_location("output_journal_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("""CREATE TABLE agent_runs (
            run_id TEXT PRIMARY KEY, lease_token TEXT, status TEXT, partial_answer TEXT,
            started_at DATETIME
        )"""))
        original = "原始长文\n空格  \n末尾。"
        connection.execute(text("""INSERT INTO agent_runs VALUES
            ('legacy-run', NULL, 'interrupted', :body, '2026-10-05 01:00:00')
        """), {"body": original})
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            with pytest.raises(RuntimeError, match="cannot be discarded"):
                migration.downgrade()
        saved = connection.execute(text("SELECT answer FROM agent_output_attempts")).scalar()
        assert saved == original
        assert connection.execute(text("SELECT last_event_sequence FROM agent_runs")).scalar() == 0
        assert connection.execute(text("SELECT count(*) FROM agent_output_events")).scalar() == 0


def test_journal_waits_for_business_rollback_without_committing_business_state(client):
    import threading

    from sqlalchemy import text

    user_id = registered_user(client)
    database = client.app.state.database
    with database.session() as session:
        repo = SqliteConversationRepository(session)
        service = ConversationService(repo)
        conversation = service.create_conversation(user_id=user_id, title="事务隔离")
        run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                                idempotency_key="transaction-isolation",
                                knowledge_release_id="release-a")
        session.execute(text("CREATE TABLE output_business_probe (value TEXT)"))
        repo.commit()
        session.execute(text("INSERT INTO output_business_probe VALUES ('uncommitted-tool')"))
        started, delivered = threading.Event(), threading.Event()
        errors = []

        def save_body():
            started.set()
            try:
                repo.append_output_event(user_id=user_id, run_id=run.run_id,
                                         attempt_id=run.lease_token, name="assistant_delta",
                                         payload={"delta": "body survives tool rollback"})
                delivered.set()
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=save_body)
        worker.start()
        assert started.wait(1)
        assert not delivered.wait(0.1), "journal incorrectly committed the business transaction"
        session.rollback()
        worker.join(5)
        assert not worker.is_alive()
        assert errors == []
        assert delivered.is_set()
    with database.session() as other:
        assert other.execute(text("SELECT count(*) FROM output_business_probe")).scalar() == 0
        saved = SqliteConversationRepository(other).find_run_by_id(
            user_id=user_id, run_id=run.run_id,
        )
        assert saved.output_attempts[0].answer == "body survives tool rollback"


def test_one_thousand_small_deltas_preserve_order_and_remain_bounded(client):
    import time

    user_id = registered_user(client)
    with client.app.state.database.session() as session:
        repo = SqliteConversationRepository(session)
        service = ConversationService(repo)
        conversation = service.create_conversation(user_id=user_id, title="输出吞吐")
        run = service.start_run(user_id=user_id, conversation_id=conversation.conversation_id,
                                idempotency_key="one-thousand-deltas",
                                knowledge_release_id="release-a")
        repo.commit()
        started = time.monotonic()
        for index in range(1000):
            event = repo.append_output_event(user_id=user_id, run_id=run.run_id,
                                             attempt_id=run.lease_token, name="assistant_delta",
                                             payload={"delta": str(index % 10)})
            assert event.sequence == index + 1
        elapsed = time.monotonic() - started
        print(f"1000 journal transactions: {elapsed:.3f}s")
        assert elapsed < 15, "small-delta journal writes became pathologically slow"
        saved = repo.find_run_by_id(user_id=user_id, run_id=run.run_id)
        assert saved.output_attempts[0].answer == "0123456789" * 100
        assert saved.last_event_sequence == 1000
        page = repo.read_output_events(user_id=user_id, run_id=run.run_id, after=500)
        assert [event.sequence for event in page] == list(range(501, 701))
        from sqlalchemy import text
        plan = session.execute(text("""EXPLAIN QUERY PLAN SELECT sequence FROM agent_output_events
            WHERE run_id = :run AND sequence > 500 ORDER BY sequence LIMIT 200
        """), {"run": str(run.run_id)}).all()
        assert any("INDEX" in str(row) and "run_id=? AND sequence>?" in str(row) for row in plan)
