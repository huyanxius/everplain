"""A model boolean cannot replace the existing authenticated, versioned user commands."""

from types import SimpleNamespace
from uuid import UUID, uuid4

from sqlalchemy import func, select
from test_theory_matching_api import (
    _create_confirmed_task,
    _idempotency_headers,
    _install_pre_reviewed_release,
    _start_payload,
)

from qunxue_api.adapters.research_agent.pydantic_runner import _prepare_document_tool
from qunxue_api.adapters.sqlite import TheoryDecisionSetRow
from qunxue_api.adapters.sqlite.knowledge_catalog import SqliteKnowledgeCatalog
from qunxue_api.api.routes.matching import router as legacy_matching_router


def test_retained_legacy_user_commands_can_confirm_then_agent_can_read_owned_plan(client, tmp_path):
    # Default personal-product bootstrap intentionally hides legacy formal tools.
    # Exercise the retained compatibility path using only this isolated fixture's
    # installed synthetic release; never enable a public catalog in production.
    with client.app.state.disciplinary_agent_scope() as app:
        assert app._tools_factory().catalog_available is False
    client.app.state.knowledge_catalog = SqliteKnowledgeCatalog(
        client.app.state.database, knowledge_root=tmp_path / "unused-legacy-source",
    )
    # Explicit test-only mounting proves compatibility, not current product availability.
    client.app.include_router(legacy_matching_router)
    navigation, phenomenon = _create_confirmed_task(client)
    release_id = _install_pre_reviewed_release(client)
    user_id = UUID(client.get("/api/session").json()["user"]["user_id"])
    started_response = client.post(
        f"/api/research-tasks/{navigation['task_id']}/match-runs",
        headers=_idempotency_headers(),
        json=_start_payload(navigation, phenomenon, knowledge_release_id=release_id),
    )
    assert started_response.status_code == 200, started_response.text
    started = started_response.json()
    candidates = started["candidate_page"]["candidates"]
    decisions = [{
        "candidate_id": item["candidate_id"], "candidate_version": item["version"],
        "action": "adopt" if i == 0 else "exclude",
        "reason": "用户核对合成来源后选择主解释" if i == 0 else "暂不采用此合成候选",
        "related_source_ids": item["source_ids"], "related_candidate_ids": [],
    } for i, item in enumerate(candidates)]
    assignments = [{"candidate_id": candidates[0]["candidate_id"], "role_code": "primary",
                    "responsibility": "解释合成案例中的关系变化"}]
    model_payload = dict(decisions=decisions, use_assignments=assignments,
                         relations=[], user_confirmed=True)
    with client.app.state.disciplinary_agent_scope() as app:
        conversation = app._conversations.create_conversation(user_id=user_id, title="合成审批边界")
        app._conversations._repository.link_research_task(
            user_id=user_id, conversation_id=conversation.conversation_id,
            task_id=UUID(navigation["task_id"]),
        )
        app._conversations.commit()
        tools = app._tools_factory()
        tools.bind_agent_context(user_id=user_id, conversation_id=conversation.conversation_id,
                                 agent_run_id=uuid4())
        denied = tools.save_confirmed_theory_plan(**model_payload)
        assert denied["error"] == "user_confirmation_required"
    with client.app.state.database.session() as session:
        assert session.scalar(select(func.count()).select_from(TheoryDecisionSetRow)) == 0

    decision_response = client.post(
        f"/api/match-runs/{started['match_run_id']}/decisions",
        headers=_idempotency_headers("actual-user-decisions"),
        json={"expected_match_run_version": started["version"],
              "completion_basis": started["completion_basis"], "decisions": decisions,
              "use_assignments": assignments, "relations": []},
    )
    assert decision_response.status_code == 200, decision_response.text
    saved = decision_response.json()
    url = f"/api/decision-sets/{saved['decision_set_id']}/confirm"
    stale = client.post(url, headers=_idempotency_headers(),
                        json={"expected_decision_set_version": saved["version"] + 1})
    assert stale.status_code == 409
    confirmation = client.post(url, headers=_idempotency_headers("actual-user-confirmation"),
                               json={"expected_decision_set_version": saved["version"]})
    assert confirmation.status_code == 200, confirmation.text
    with client.app.state.disciplinary_agent_scope() as app:
        tools = app._tools_factory()
        tools.bind_agent_context(user_id=user_id, conversation_id=conversation.conversation_id,
                                 agent_run_id=uuid4())
        readback = tools.save_confirmed_theory_plan(**model_payload)
    assert readback["status"] == "confirmed"
    assert readback["theory_plan_id"] == confirmation.json()["theory_plan_id"]
    assert readback["knowledge_release_id"] == release_id
    with client.app.state.database.session() as session:
        assert session.scalar(select(func.count()).select_from(TheoryDecisionSetRow)) == 1

    other = client.post("/api/session/register", headers=_idempotency_headers(),
                        json={"email": "other-confirmation@example.com",
                              "password": "synthetic-password-123"})
    assert other.status_code == 201
    denied_owner = client.post(url, headers=_idempotency_headers(),
                               json={"expected_decision_set_version": saved["version"]})
    assert denied_owner.status_code == 404


def test_default_product_hides_unmounted_formal_theory_commands(plain_client):
    client = plain_client
    with client.app.state.disciplinary_agent_scope() as app:
        tools = app._tools_factory()
        assert tools.catalog_available is False
        assert _prepare_document_tool(SimpleNamespace(deps=tools), SimpleNamespace(
            name="save_confirmed_theory_plan",
        )) is None
    paths = client.app.openapi()["paths"]
    assert "/api/match-runs/{match_run_id}/decisions" not in paths
    assert "/api/decision-sets/{decision_set_id}/confirm" not in paths
