import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import text
from test_application_metering import Runner
from test_phase_billing_p0 import Planner, build_application, record, register_with_phase_budget

from qunxue_api.adapters.model.metering import current_operation
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.modules.agent_conversation import AgentInterrupted, RunAlreadyActive
from qunxue_api.modules.billing import BillingReplayBlocked


class FailOnceRunner(Runner):
    def __init__(self, failure):
        self.failure = failure
        self.calls = 0

    def run(self, **kwargs):
        result = super().run(**kwargs)
        if self.calls == 1:
            raise self.failure("synthetic interrupted delivery")
        return result


@pytest.mark.parametrize("failure", [RuntimeError, AgentInterrupted])
def test_sqlite_failed_or_interrupted_retry_executes_and_charges_only_delivered_turn(
    plain_client, failure
):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    runner = FailOnceRunner(failure)
    with database.session() as session:
        app, runtime, repository = build_application(database, session, runner=runner)
        args = dict(user_id=user, conversation_id=None, prompt="synthetic", idempotency_key="retry")
        with pytest.raises(failure, match="synthetic interrupted delivery"):
            app.run_turn(**args)
        original = repository.find_run(user_id=user, idempotency_key="retry")
        old_operation = session.execute(text("SELECT * FROM billing_operations")).mappings().one()
        assert old_operation["status"] == ("cancelled" if failure is AgentInterrupted else "error")
        assert runtime.available_balance(user) == 3000

        delivered = app.run_turn(**args)
        replay = app.run_turn(**args)
        assert delivered.run_id == original.run_id
        assert not delivered.replayed and replay.replayed
        assert replay.turn.turn_id == delivered.turn.turn_id
        assert runner.calls == 2
        assert len(delivered.conversation.turns) == 1
        assert runtime.available_balance(user) == 2908
        assert session.scalar(text("SELECT count(*) FROM billing_operations")) == 2
        assert session.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 1
        assert (
            session.execute(
                text("SELECT * FROM billing_operations WHERE run_id=:run"),
                {"run": old_operation["run_id"]},
            )
            .mappings()
            .one()
            == old_operation
        )


@pytest.mark.parametrize("status", ["failed", "interrupted", "awaiting_plan_confirmation"])
def test_sqlite_retry_preserves_logical_run_started_at(plain_client, status):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    with database.session() as session:
        app, _, _ = build_application(database, session)
        service = app._conversations
        conversation = service.create_conversation(user_id=user, title="synthetic")
        args = dict(
            user_id=user,
            conversation_id=conversation.conversation_id,
            idempotency_key="time",
            knowledge_release_id="synthetic",
        )
        first = service.start_run(**args)
        service.finish_run(run_id=first.run_id, status=status)
        service.commit()
        started = datetime(2026, 1, 1, tzinfo=UTC).isoformat()
        session.execute(
            text("UPDATE agent_runs SET started_at=:started WHERE run_id=:run"),
            {"started": started, "run": str(first.run_id)},
        )
        session.commit()
        service.start_run(**args)
        service.commit()
        assert (
            session.scalar(
                text("SELECT started_at FROM agent_runs WHERE run_id=:run"),
                {"run": str(first.run_id)},
            )
            == started
        )


def test_interrupted_planning_retry_and_confirmation_share_only_the_new_operation(plain_client):
    class PlannerFailOnce(Planner):
        planning_calls = 0

        def prepare_research(self, **kwargs):
            self.planning_calls += 1
            if self.planning_calls == 1:
                scope = current_operation(required=True)
                record(scope.runtime, scope.run_id)
                raise AgentInterrupted("synthetic planning failure")
            super().prepare_research(**kwargs)

    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    with database.session() as session:
        app, runtime, _ = build_application(database, session, runner=PlannerFailOnce())
        args = dict(
            user_id=user,
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="plan-retry",
            mode="deep_research",
        )
        with pytest.raises(AgentInterrupted, match="synthetic planning failure"):
            app.run_turn(**args)
        planned = app.run_turn(**args)
        confirmed = app.run_turn(
            **args, deep_research_run_id=planned.run_id, deep_research_action="confirm"
        )
        assert confirmed.turn is not None
        assert runtime.available_balance(user) == 2878
        assert session.scalar(text("SELECT count(*) FROM billing_operations")) == 2
        assert (
            session.scalar(text("SELECT count(*) FROM billing_operations WHERE status='cancelled'"))
            == 1
        )
        assert session.scalar(text("SELECT count(*) FROM billing_attempts")) == 3


def test_parallel_retry_calls_execute_only_one_runner_and_charge_once(plain_client):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    args = dict(user_id=user, conversation_id=None, prompt="synthetic", idempotency_key="parallel")
    with database.session() as session:
        app, _, _ = build_application(database, session, runner=FailOnceRunner(RuntimeError))
        with pytest.raises(RuntimeError):
            app.run_turn(**args)

    entered, release = threading.Event(), threading.Event()

    class BlockingRunner(Runner):
        def run(self, **kwargs):
            entered.set()
            assert release.wait(10)
            return super().run(**kwargs)

    runner = BlockingRunner()

    def retry():
        with database.session() as session:
            app, _, _ = build_application(database, session, runner=runner)
            return app.run_turn(**args)

    with ThreadPoolExecutor(max_workers=2) as executor:
        winner = executor.submit(retry)
        try:
            assert entered.wait(10)
            with pytest.raises(RunAlreadyActive):
                executor.submit(retry).result(timeout=10)
        finally:
            release.set()
        assert winner.result(timeout=10).turn is not None
    assert runner.calls == 1
    with database.session() as session:
        app, runtime, _ = build_application(database, session, runner=runner)
        assert app.run_turn(**args).replayed
        assert runner.calls == 1
        assert runtime.available_balance(user) == 2908
        assert session.scalar(text("SELECT count(*) FROM billing_operations")) == 2


@pytest.mark.parametrize("late_outcome", ["success", "error"])
def test_old_attempt_callbacks_and_reset_fence_cannot_touch_retry_operation(
    plain_client, late_outcome
):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    old_attempt = None

    class InFlightRunner(Runner):
        def run(self, **kwargs):
            nonlocal old_attempt
            scope = current_operation(required=True)
            old_attempt = scope.runtime.before_attempt(
                run_id=scope.run_id,
                endpoint_id="primary",
                model="gpt-6.1-sol",
                input_limit=1000,
                output_limit=1000,
                request_hash="synthetic-late",
            )
            raise AgentInterrupted("synthetic outstanding provider call")

    args = dict(user_id=user, conversation_id=None, prompt="synthetic", idempotency_key="late")
    with database.session() as session:
        app, runtime, repository = build_application(database, session, runner=InFlightRunner())
        with pytest.raises(AgentInterrupted):
            app.run_turn(**args)
        old_run = repository.find_run(user_id=user, idempotency_key="late")
        old_operation = session.execute(text("SELECT * FROM billing_operations")).mappings().one()
        session.commit()
    with database.engine.begin() as connection:
        connection.connection.driver_connection.executescript(
            (Path(__file__).parents[1] / "fixtures/billing_reset_schema.sql").read_text()
        )
        connection.execute(
            text(
                "INSERT INTO billing_precision_adjustments VALUES "
                "('synthetic',:user,'user_requested_all_accounts_reset',"
                "'0','0','0',3000,0,3000,:closed,:now)"
            ),
            {
                "user": str(user),
                "closed": json.dumps([old_operation["run_id"]]),
                "now": datetime.now(UTC).isoformat(),
            },
        )

    class LateCallbacksRunner(Runner):
        def run(self, **kwargs):
            scope = current_operation(required=True)
            assert scope.run_id != old_operation["run_id"]
            with database.engine.connect() as connection:
                before = (
                    connection.execute(
                        text("SELECT * FROM billing_operations WHERE run_id=:r"),
                        {"r": scope.run_id},
                    )
                    .mappings()
                    .one()
                )
            runtime.complete_attempt(
                attempt_id=old_attempt,
                input_tokens=600,
                output_tokens=800,
                returned_model="gpt-6.1-sol",
                outcome=late_outcome,
            )
            runtime.finish(run_id=old_operation["run_id"], outcome=late_outcome)
            with pytest.raises(BillingReplayBlocked):
                runtime.start(
                    user_id=user,
                    run_id=old_operation["run_id"],
                    fingerprint="synthetic",
                    resume=True,
                )
            with database.session() as stale_session:
                _, _, stale_repository = build_application(database, stale_session)
                stale_repository.finish_run(
                    run_id=old_run.run_id,
                    lease_token=old_run.lease_token,
                    status="failed",
                    error="late worker",
                )
                stale_repository.commit()
            with database.engine.connect() as connection:
                assert (
                    connection.execute(
                        text("SELECT * FROM billing_operations WHERE run_id=:r"),
                        {"r": scope.run_id},
                    )
                    .mappings()
                    .one()
                    == before
                )
                assert (
                    connection.execute(
                        text("SELECT * FROM billing_operations WHERE run_id=:r"),
                        {"r": old_operation["run_id"]},
                    )
                    .mappings()
                    .one()
                    == old_operation
                )
                assert (
                    connection.scalar(
                        text("SELECT billable FROM billing_attempts WHERE attempt_id=:a"),
                        {"a": old_attempt},
                    )
                    == 0
                )
            return super().run(**kwargs)

    with database.session() as session:
        app, retry_runtime, _ = build_application(database, session, runner=LateCallbacksRunner())
        assert app.run_turn(**args).turn is not None
        assert retry_runtime.available_balance(user) == 2908
        assert app.run_turn(**args).replayed


def crash_retry(database_url, user_id, stage):
    database = Database(database_url)
    with database.session() as session:
        app, _, _ = build_application(database, session, runner=Runner())
        if stage == "before_billing":
            app._billing.open = lambda **kwargs: os._exit(73)
            callback = None
        else:

            def callback(*args):
                os._exit(73)

        app.run_turn(
            user_id=UUID(user_id),
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="crash-retry",
            on_run_started=callback,
        )


def crash_before_failure_settlement(database_url, user_id):
    database = Database(database_url)
    with database.session() as session:
        app, runtime, _ = build_application(database, session, runner=FailOnceRunner(RuntimeError))
        # The synthetic operation holds the whole test account, so a missing
        # prior-operation repair deterministically freezes the next request.
        runtime.max_operation_pico = 10**12
        original = runtime.finish

        def finish(**kwargs):
            if kwargs["outcome"] == "error":
                os._exit(73)
            return original(**kwargs)

        runtime.finish = finish
        app.run_turn(
            user_id=UUID(user_id),
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="failed-before-settlement",
        )


def test_failed_row_active_billing_crash_is_repaired_before_retry_reservation(plain_client):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    process = subprocess.run(
        [
            sys.executable,
            "-c",
            "from test_agent_retry_billing import crash_before_failure_settlement; "
            "import sys; crash_before_failure_settlement(*sys.argv[1:])",
            database.engine.url.render_as_string(),
            str(user),
        ],
        env={
            **os.environ,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": os.pathsep.join(
                [
                    str(Path(__file__).parents[2] / "src"),
                    str(Path(__file__).parents[1]),
                    str(Path(__file__).parent),
                    os.environ.get("PYTHONPATH", ""),
                ]
            ),
        },
        capture_output=True,
        timeout=20,
    )
    assert process.returncode == 73, process.stderr.decode()
    with database.session() as session:
        runner = Runner()
        app, runtime, repository = build_application(database, session, runner=runner)
        old = repository.find_run(user_id=user, idempotency_key="failed-before-settlement")
        assert old.status == "failed"
        assert runtime.available_balance(user) == 0
        args = dict(
            user_id=user,
            conversation_id=None,
            prompt="synthetic",
            idempotency_key="failed-before-settlement",
        )
        assert app.run_turn(**args).turn is not None
        assert app.run_turn(**args).replayed
        assert runner.calls == 1
        assert runtime.available_balance(user) == 2908
        assert (
            session.scalar(text("SELECT count(*) FROM billing_operations WHERE status='active'"))
            == 0
        )
        assert session.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 1


@pytest.mark.parametrize("stage", ["before_billing", "after_billing"])
def test_crashed_retry_recovers_persisted_operation_and_retries_again(plain_client, stage):
    user = UUID(register_with_phase_budget(plain_client))
    database = plain_client.app.state.database
    args = dict(
        user_id=user, conversation_id=None, prompt="synthetic", idempotency_key="crash-retry"
    )
    with database.session() as session:
        app, _, _ = build_application(database, session, runner=FailOnceRunner(RuntimeError))
        with pytest.raises(RuntimeError):
            app.run_turn(**args)
    process = subprocess.run(
        [
            sys.executable,
            "-c",
            "from test_agent_retry_billing import crash_retry; "
            "import sys; crash_retry(*sys.argv[1:])",
            database.engine.url.render_as_string(),
            str(user),
            stage,
        ],
        env={
            **os.environ,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": os.pathsep.join(
                [
                    str(Path(__file__).parents[2] / "src"),
                    str(Path(__file__).parents[1]),
                    str(Path(__file__).parent),
                    os.environ.get("PYTHONPATH", ""),
                ]
            ),
        },
        capture_output=True,
        timeout=20,
    )
    assert process.returncode == 73, process.stderr.decode()
    with database.session() as session:
        app, runtime, repository = build_application(database, session, runner=Runner())
        crashed = repository.find_run(user_id=user, idempotency_key="crash-retry")
        operation_id = crashed.request_snapshot["_billing_run_id"]
        assert operation_id != str(crashed.run_id)
        session.execute(
            text("UPDATE agent_runs SET lease_expires_at=:expired WHERE run_id=:run"),
            {
                "expired": (datetime.now(UTC) - timedelta(minutes=1)).strftime(
                    "%Y-%m-%d %H:%M:%S.%f"
                ),
                "run": str(crashed.run_id),
            },
        )
        session.commit()
        app.get_conversation(user_id=user, conversation_id=crashed.conversation_id)
        operation = session.execute(
            text("SELECT status FROM billing_operations WHERE run_id=:run"), {"run": operation_id}
        ).scalar()
        assert operation == (None if stage == "before_billing" else "error")
        assert runtime.available_balance(user) == 3000
        assert app.run_turn(**args).turn is not None
        assert runtime.available_balance(user) == 2908
        assert (
            session.scalar(text("SELECT count(*) FROM billing_operations WHERE status='active'"))
            == 0
        )
