from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentRunRow
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.modules.agent_conversation import ConversationService


@pytest.mark.parametrize(
    "ui_key,writing_context,automatic",
    [
        ("writing-ui:rewrite:explicit", {"document_id": "doc", "document_version": 1}, True),
        ("ordinary-chat", {"document_id": "doc", "document_version": 1}, False),
        ("writing-ui:rewrite:without-context", None, False),
    ],
)
def test_reload_exposes_explicit_action_origin_and_preserves_natural_message(
    client,
    ui_key,
    writing_context,
    automatic,
) -> None:
    registered = client.post(
        "/api/session/register",
        json={
            "email": "writing-origin@example.test",
            "password": "password-123",
            "display_name": "作者",
        },
        headers={"Idempotency-Key": "register-writing-origin"},
    )
    assert registered.status_code == 201
    user_id = UUID(registered.json()["user"]["user_id"])
    with client.app.state.database.session() as session:
        service = ConversationService(SqliteConversationRepository(session))
        conversation = service.create_conversation(user_id=user_id, title="写作")
        turn = service.append_turn(
            user_id=user_id,
            conversation_id=conversation.conversation_id,
            idempotency_key=ui_key,
            user_content="优化当前选区",
            assistant_content="已经提出修订。",
            citations=(),
        )
        session.add(
            AgentRunRow(
                run_id=str(uuid4()),
                conversation_id=str(conversation.conversation_id),
                user_id=str(user_id),
                turn_id=str(turn.turn_id),
                idempotency_key=ui_key,
                status="completed",
                provider="test",
                model="test",
                usage={},
                tool_summary=[],
                request_snapshot={
                    "message": "优化当前选区",
                    **({"writing_context": writing_context} if writing_context else {}),
                },
                started_at=datetime.now(UTC),
            )
        )
    for _ in range(2):
        response = client.get(f"/api/agent/conversations/{conversation.conversation_id}")
        assert response.status_code == 200
        restored = response.json()["turns"][0]
        assert restored["user"]["content"] == "优化当前选区"
        markers = [
            trace for trace in restored["tool_traces"] if trace["tool"] == "writing_ui_action"
        ]
        assert bool(markers) is automatic
        if automatic:
            assert len(markers) == 1
            assert markers[0]["input"] == {"origin": "selection_toolbar"}
