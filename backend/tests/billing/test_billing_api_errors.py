# ruff: noqa: F811
"""Public feedback must agree with real synthetic receipts and wallet settlement."""

import asyncio
import json
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.metering import OperationScope
from qunxue_api.api.billing_errors import billing_error, install_billing_error_handlers
from qunxue_api.api.contracts.agent import AgentTurnRequest
from qunxue_api.api.routes.agent import stream_agent_turn
from qunxue_api.modules.billing import (
    BillingBudgetExceeded,
    BillingContextMissing,
    BillingFailure,
    BillingReplayBlocked,
    CreditRunInProgress,
    CreditsDepleted,
    ModelDeliveryRejected,
    UnknownPrice,
    UnknownTokenUsage,
)
from qunxue_api.settings import Settings

ERROR_CASES = [
    (BillingBudgetExceeded("synthetic-secret", reason="credits_depleted"),
     402, "credits_depleted"),
    (CreditsDepleted(), 402, "credits_depleted"),
    (BillingBudgetExceeded("synthetic-secret", reason="credits_frozen"),
     409, "credit_run_in_progress"),
    (CreditRunInProgress(), 409, "credit_run_in_progress"),
    (BillingBudgetExceeded("synthetic-secret"), 429, "billing_budget_exceeded"),
    (BillingBudgetExceeded("synthetic-secret", reason="service_budget_exceeded"),
     429, "billing_budget_exceeded"),
    (BillingContextMissing("synthetic-secret"), 503, "billing_not_configured"),
    (UnknownPrice("synthetic-secret"), 503, "billing_not_configured"),
    (BillingReplayBlocked("synthetic-secret"), 409, "billing_replay_blocked"),
    (ModelDeliveryRejected("synthetic-secret"), 502, "billing_provider_error"),
    (UnknownTokenUsage("synthetic-secret"), 502, "billing_provider_error"),
    (BillingFailure("synthetic-secret"), 502, "billing_provider_error"),
]


def json_failure(error):
    app = FastAPI()
    install_billing_error_handlers(app)

    @app.get("/synthetic")
    def fail():
        raise error

    with TestClient(app) as client:
        return client.get("/synthetic")


def stream_failure(error):
    class Application:
        def find_run(self, **kwargs):
            return None

        def run_turn(self, **kwargs):
            raise error

    @contextmanager
    def scope():
        yield Application()

    async def exercise():
        request = SimpleNamespace(
            app=SimpleNamespace(
                state=SimpleNamespace(
                    settings=Settings(_env_file=None), disciplinary_agent_scope=scope
                )
            )
        )
        response = stream_agent_turn(
            payload=AgentTurnRequest(message="synthetic"),
            request=request,
            current=SimpleNamespace(user=SimpleNamespace(user_id=UUID(int=923))),
            idempotency_key="synthetic",
        )
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        return "".join(chunks)

    events = asyncio.run(exercise())
    assert "event: turn_failed" in events
    assert "event: turn_completed" not in events
    assert "synthetic-secret" not in events
    return json.loads(next(line[6:] for line in events.splitlines() if line.startswith("data: ")))


def assert_feedback(error, message, code):
    assert "synthetic-secret" not in message
    assert "未扣费" not in message
    assert "退款" not in message
    if code == "credits_depleted":
        assert message == "额度已用尽，请等待 receipt"
    elif code == "credit_run_in_progress":
        assert message == "当前账户有积分正在冻结，请稍后重试。"
    elif code == "run_in_progress":
        assert message == "这段对话正在生成回答，请稍候。"
    elif code == "billing_replay_blocked":
        assert message == "本轮请求已处理，请刷新查看结果；不会重复扣费。"
    else:
        assert "已产生的模型用量按实际结算" in message
        assert "账户设置中查看用量" in message
    if getattr(error, "reason", None) == "service_budget_exceeded":
        assert "模型服务的安全额度" in message
        assert "积分不足" not in message
    if isinstance(error, UnknownTokenUsage):
        assert "模型用量尚未确认，请等待 receipt" in message
    if isinstance(error, ModelDeliveryRejected):
        assert "模型输出未能完整交付" in message


@pytest.mark.parametrize("error,status,code", ERROR_CASES)
def test_new_billing_failures_use_safe_json_error_contract(error, status, code):
    response = json_failure(error)
    assert response.status_code == status
    detail = response.json()["error"]
    assert detail["code"] == code
    assert UUID(detail["trace_id"])
    assert_feedback(error, detail["message"], code)


@pytest.mark.parametrize("error,_status,code", ERROR_CASES)
def test_stream_terminal_billing_error_preserves_event_contract(error, _status, code):
    detail = stream_failure(error)
    if isinstance(error, CreditRunInProgress):
        code = "run_in_progress"  # The Agent keeps its existing active-run contract.
    assert detail["code"] == code
    assert_feedback(error, detail["message"], code)


def ledger_snapshot(engine):
    with engine.connect() as conn:
        return (
            conn.scalar(text("SELECT balance FROM credit_accounts WHERE user_id='user'")),
            conn.scalar(text("SELECT coalesce(sum(charged_points),0) FROM billing_operations")),
            conn.scalar(text("SELECT coalesce(sum(points),0) FROM credit_ledger")),
            conn.scalar(text("SELECT count(*) FROM credit_ledger")),
            conn.scalar(text("SELECT count(*) FROM billing_attempts WHERE usage_state='known'")),
        )


def attempt(runtime, scope, **extra):
    return runtime.before_attempt(**{
        "run_id": scope.run_id, "endpoint_id": "primary", "model": "gpt-6.1-sol",
        "input_limit": 1000, "output_limit": 100, "request_hash": str(uuid4()),
        "provider_host": "synthetic.test", **extra,
    })


def complete_known(scope, ident, *, finish_reason="stop"):
    scope.complete(
        ident,
        {
            "id": "synthetic-receipt-" + ident,
            "model": "gpt-6.1-sol",
            "usage": {
                "prompt_tokens": 1000, "completion_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 300},
            },
        },
        outcome="success", finish_reason=finish_reason,
    )


def assert_ledger_feedback(engine, error, *, expected, status, code):
    assert ledger_snapshot(engine) == expected
    assert billing_error(error)[:2] == (status, code)
    response = json_failure(error)
    assert response.status_code == status
    detail = response.json()["error"]
    assert detail["code"] == code
    assert_feedback(error, detail["message"], code)
    stream = stream_failure(error)
    assert stream == {"code": code, "message": detail["message"]}
    # Formatting an error is read-only; it must not refund or invent a debit.
    assert ledger_snapshot(engine) == expected


def test_known_length_rejection_keeps_actual_charge_and_reports_failed_delivery(wallet):
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v1"
    with pytest.raises(ModelDeliveryRejected) as caught, OperationScope(
        runtime, user_id="user", run_id=uuid4(), fingerprint="known-length"
    ) as scope:
        complete_known(scope, attempt(runtime, scope), finish_reason="length")
    assert_ledger_feedback(
        engine, caught.value, expected=(9973, 27, -27, 1, 1),
        status=502, code="billing_provider_error",
    )


@pytest.mark.parametrize("prior_usage", [False, True])
@pytest.mark.parametrize("failure,status,code", [
    ("service_budget", 429, "billing_budget_exceeded"),
    ("operation_budget", 429, "billing_budget_exceeded"),
    ("unknown_price", 503, "billing_not_configured"),
    ("context_missing", 503, "billing_not_configured"),
])
def test_predispatch_failure_cannot_prove_a_free_operation(
    wallet, prior_usage, failure, status, code
):
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v1"
    with pytest.raises(BillingFailure) as caught, OperationScope(
        runtime, user_id="user", run_id=uuid4(), fingerprint="predispatch-" + failure
    ) as scope:
        if prior_usage:
            complete_known(scope, attempt(runtime, scope))
        if failure == "service_budget":
            runtime.daily_budget_pico = 5_000_000_000 if prior_usage else 1
            attempt(runtime, scope)
        elif failure == "operation_budget":
            runtime.max_attempts = 1 if prior_usage else 0
            attempt(runtime, scope)
        elif failure == "unknown_price":
            attempt(runtime, scope, model="synthetic-unpriced")
        else:
            scope.before_attempt_payload({"model": "gpt-6.1-sol", "messages": []})
    if failure == "service_budget":
        assert caught.value.reason == "service_budget_exceeded"
    assert_ledger_feedback(
        engine, caught.value,
        expected=(9973, 27, -27, 1, 1) if prior_usage else (10000, 0, 0, 0, 0),
        status=status, code=code,
    )


@pytest.mark.parametrize("prior_usage", [False, True])
def test_unknown_receipt_stays_pending_without_erasing_a_prior_charge(wallet, prior_usage):
    runtime, engine = wallet
    runtime.billing_policy = "actual_usage_v1"
    with pytest.raises(UnknownTokenUsage) as caught, OperationScope(
        runtime, user_id="user", run_id=uuid4(), fingerprint="pending-receipt"
    ) as scope:
        if prior_usage:
            complete_known(scope, attempt(runtime, scope))
        scope.complete(attempt(runtime, scope), {
            "id": "synthetic-pending-receipt", "model": "gpt-6.1-sol",
        }, outcome="success", finish_reason="stop")
    assert len(runtime.pending_reconciliation()) == 1
    assert_ledger_feedback(
        engine, caught.value,
        expected=(9973, 27, -27, 1, 1) if prior_usage else (10000, 0, 0, 0, 0),
        status=502, code="billing_provider_error",
    )
    assert len(runtime.pending_reconciliation()) == 1
