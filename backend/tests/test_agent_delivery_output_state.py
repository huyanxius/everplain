"""Output completeness and receipt persistence are independent application states."""

from uuid import UUID

from test_agent_run_recovery import Tools

from qunxue_api.application.disciplinary_agent import DisciplinaryAgentApplication
from qunxue_api.modules.agent_conversation import AgentRunResult, ConversationService


class ReceiptScope:
    def __init__(self, state):
        self.delivery_state = dict(state)
        self.outcomes = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def finish(self, outcome):
        self.outcomes.append(outcome)


class Billing:
    def __init__(self, scope):
        self.scope = scope

    def open(self, **kwargs):
        return self.scope

    def close(self, **kwargs):
        pass


class Runner:
    def run_stream(self, *, on_delta, **kwargs):
        on_delta("完整收到的原文")
        return AgentRunResult(answer="完整收到的原文", citations=(), release_id="release-a",
                              provider="test", model="test")


def execute(state):
    service = ConversationService.in_memory()
    scope = ReceiptScope(state)
    app = DisciplinaryAgentApplication(conversations=service, runner=Runner(), tools_factory=Tools,
                                      billing=Billing(scope))
    result = app.run_turn(user_id=UUID(int=1), conversation_id=None, prompt="问题",
                         idempotency_key="separate-output-usage", on_delta=lambda _: None)
    return app, scope, result


def test_complete_body_with_pending_usage_is_completed_and_never_zero_fabricated():
    app, scope, result = execute({"output_finish_reason": "complete", "usage_status": "pending",
                                  "settlement_status": "pending", "receipt_persistence": "saved"})
    assert result.turn is not None
    assert result.incomplete_reason is None
    assert result.delivery_state["usage_status"] == "pending"
    assert "output_tokens" not in result.delivery_state
    run = app.find_run(user_id=UUID(int=1), idempotency_key="separate-output-usage")
    assert run.status == "completed"
    assert run.output_attempts[0].answer == "完整收到的原文"
    assert scope.outcomes == ["success"]


def test_unsaved_receipt_keeps_complete_body_and_exposes_real_unsaved_state():
    _, _, result = execute({"output_finish_reason": "complete", "usage_status": "known",
                            "settlement_status": "pending", "receipt_persistence": "unsaved"})
    assert result.turn is not None
    assert result.result.answer == "完整收到的原文"
    assert result.delivery_state["receipt_persistence"] == "unsaved"
    assert result.delivery_state["usage_status"] == "known"


def test_real_upstream_length_is_saved_interrupted_and_can_continue_without_erasing_original():
    app, scope, result = execute({"output_finish_reason": "truncated", "usage_status": "known",
                                  "settlement_status": "settled", "receipt_persistence": "saved"})
    assert result.turn is None
    assert result.incomplete_reason == "length"
    run = app.find_run(user_id=UUID(int=1), idempotency_key="separate-output-usage")
    assert run.status == "interrupted"
    assert run.output_attempts[0].answer == "完整收到的原文"
    assert result.conversation.turns == ()
    assert scope.outcomes == ["error"]
