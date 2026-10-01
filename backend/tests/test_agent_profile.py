from uuid import uuid4

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
