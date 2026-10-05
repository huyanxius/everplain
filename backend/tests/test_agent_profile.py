from uuid import uuid4

import pytest
from test_research_material_api import _authenticate


def update(client, **changes):
    version = client.get("/api/agent-profile").json()["version"]
    return client.patch(
        "/api/agent-profile",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": version, **changes},
    )


def test_profile_persists_and_resumes_without_other_users(plain_client):
    c = plain_client
    assert c.get("/api/agent-profile").status_code == 401
    _authenticate(c)
    assert c.get("/api/agent-profile").json()["version"] == 0
    saved = update(
        c, name="小叶", avatar_id="you", color="#b3ac91", speaking_style="warm", setup_step=2
    )
    assert saved.status_code == 200, saved.text
    assert c.get("/api/agent-profile").json() == saved.json()
    _authenticate(c)
    assert c.get("/api/agent-profile").json()["name"] == "Everplain"
    assert c.get("/api/agent-profile").json()["setup_step"] == 0


def test_questionnaire_memory_is_editable_and_deletion_stays_deleted(plain_client):
    c = plain_client
    _authenticate(c)
    q = {
        "occupation": "产品经理",
        "industry": "教育",
        "goals": ["整理阅读笔记"],
        "interests": ["语言学"],
    }
    saved = update(c, name="小叶", questionnaire=q, setup_step=3)
    assert saved.status_code == 200, saved.text
    rows = c.get("/api/memories").json()["items"]
    assert len(rows) == 4
    assert all(x["origin"] == "explicit" and x["source_quote"].startswith("引导问卷") for x in rows)
    goal = next(x for x in rows if x["key"] == "onboarding.goals")
    deleted = c.delete(
        f"/api/memories/{goal['memory_id']}",
        params={"expected_version": goal["version"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert deleted.status_code == 204, deleted.text
    assert "整理阅读笔记" not in c.get("/api/agent-profile").json()["greeting"]
    assert update(c, setup_completed=True, setup_step=4).status_code == 200
    assert update(c, questionnaire=q | {"occupation": "老师"}).status_code == 200
    assert len(c.get("/api/memories").json()["items"]) == 3
    with c.app.state.agent_profile_scope() as app:
        # The public runtime persona never carries raw questionnaire answers.
        from uuid import UUID

        user = c.get("/api/session").json()["user"]["user_id"]
        assert set(app.get(UUID(user)).persona()) == {"name", "style"}


def test_profile_conflict_and_invalid_shape(plain_client):
    c = plain_client
    _authenticate(c)
    assert update(c, name="叶").status_code == 200
    stale = c.patch(
        "/api/agent-profile",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": 0, "name": "覆盖"},
    )
    assert stale.status_code == 409
    for value in ({"name": " "}, {"color": "red"}, {"avatar_id": "random"}, {"setup_step": 9}):
        assert update(c, **value).status_code == 422


def test_mock_greeting_uses_current_profile_name():
    from types import SimpleNamespace

    from qunxue_api.adapters.research_agent.pydantic_runner import DeterministicKnowledgeRunner

    tools = SimpleNamespace(
        persona={"name": "小叶", "style": "温和"},
        release=SimpleNamespace(knowledge_release_id=None),
    )
    answer = DeterministicKnowledgeRunner().run(prompt="你好", conversation=(), tools=tools)
    assert "我是小叶" in answer.answer
    assert "本地演示模式" in answer.answer


def test_user_avatar_persists_replaces_and_explicit_null_clears(plain_client):
    from uuid import UUID

    from sqlalchemy import text

    c = plain_client
    _authenticate(c)
    initial = c.get("/api/agent-profile").json()
    assert initial["user_avatar"] is None
    assert initial["setup_step"] == 0
    avatar = {
        "id": "cat",
        "hair": "#AABBCC",
        "skin": "#d8a988",
        "sleeve": "#123456",
        "blush": False,
    }
    saved = update(c, user_avatar=avatar, setup_step=2)
    assert saved.status_code == 200, saved.text
    assert saved.json()["user_avatar"] == avatar
    assert c.get("/api/agent-profile").json()["user_avatar"] == avatar
    assert c.get("/api/memories").json()["items"] == []
    user_id = UUID(c.get("/api/session").json()["user"]["user_id"])
    with c.app.state.agent_profile_scope() as app:
        assert "user_avatar" not in app.get(user_id).persona()
    # Updates from companion settings leave the separate user appearance intact.
    assert update(c, name="伙伴").json()["user_avatar"] == avatar
    assert update(c, name=None).json()["name"] == "伙伴"
    # An object is a replacement: omitted custom colors use preset defaults.
    assert update(c, user_avatar={"id": "mo"}).json()["user_avatar"] == {"id": "mo"}
    cleared = update(c, user_avatar=None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["user_avatar"] is None
    assert c.get("/api/agent-profile").json()["user_avatar"] is None
    with c.app.state.agent_profile_scope() as app:
        assert app.repository.session.execute(
            text("SELECT user_avatar IS NULL FROM agent_profiles WHERE user_id=:id"),
            {"id": str(user_id)},
        ).scalar_one()


def test_user_avatar_is_owner_scoped_and_conflicts_do_not_change_it(plain_client):
    c = plain_client
    _authenticate(c)
    saved = update(c, user_avatar={"id": "silver"})
    assert saved.status_code == 200, saved.text
    stale = c.patch(
        "/api/agent-profile",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": 0, "user_avatar": None},
    )
    assert stale.status_code == 409
    assert c.get("/api/agent-profile").json()["user_avatar"] == {"id": "silver"}
    _authenticate(c)
    assert c.get("/api/agent-profile").json()["user_avatar"] is None
    assert update(c, user_avatar={"id": "hime"}).status_code == 200


def test_six_step_progress_keeps_legacy_completion_compatible(plain_client):
    c = plain_client
    _authenticate(c)
    for step in range(7):
        saved = update(c, setup_step=step)
        assert saved.status_code == 200, saved.text
        assert saved.json()["setup_step"] == step
    for step in (-1, 7):
        assert update(c, setup_step=step).status_code == 422
    legacy = update(c, setup_step=4, setup_completed=True)
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["setup_completed"] is True
    assert update(c, user_avatar={"id": "xiaoping"}).json()["setup_step"] == 4


@pytest.mark.parametrize("avatar_id", ["xiaoping", "mo", "silver", "sand", "cat", "hime"])
def test_user_avatar_contract_accepts_all_presets_without_materializing_defaults(avatar_id):
    from qunxue_api.api.contracts.agent_profile import AgentProfileUpdate

    payload = AgentProfileUpdate(expected_version=0, user_avatar={"id": avatar_id})
    assert payload.model_dump(exclude_none=True)["user_avatar"] == {"id": avatar_id}


@pytest.mark.parametrize(
    "avatar",
    [
        {},
        [],
        "xiaoping",
        {"id": "unknown"},
        {"id": "mo", "accessory": "url"},
        {"id": "mo", "hair": "red"},
        {"id": "mo", "skin": "#fff"},
        {"id": "mo", "sleeve": "#00000000"},
        {"id": "mo", "hair": "#123456;display:none"},
        {"id": "mo", "hair": None},
        {"id": "mo", "skin": 123456},
        {"id": "mo", "blush": None},
        {"id": "mo", "blush": 0},
        {"id": "mo", "blush": "false"},
    ],
)
def test_user_avatar_contract_rejects_unknown_fields_and_invalid_custom_values(avatar):
    from pydantic import ValidationError

    from qunxue_api.api.contracts.agent_profile import AgentProfileUpdate

    with pytest.raises(ValidationError):
        AgentProfileUpdate(expected_version=0, user_avatar=avatar)
