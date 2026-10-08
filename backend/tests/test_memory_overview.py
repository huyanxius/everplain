from uuid import uuid4

from test_agent_memory import project, register, save


def overview(client, task_id=None):
    settings = client.get(
        "/api/memories/settings", params={"task_id": task_id} if task_id else {}
    ).json()
    return client.post(
        "/api/memories/overview",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "task_id": task_id,
            "expected_version": settings["version"],
        },
    )


def test_overview_empty_does_not_need_model(plain_client):
    register(plain_client)
    response = overview(plain_client)
    assert response.status_code == 200, response.text
    assert response.json()["summary"] == ""
    assert response.json()["memory_count"] == 0


def test_overview_uses_owned_scope_and_does_not_write_memory(plain_client):
    client = plain_client
    register(client)
    task_id = project(client)
    save(client, content="中文回答。")
    save(client, content="先开放编码。", task_id=task_id)
    seen = []

    def summarize(items):
        seen.append(items)
        return "这个项目采用开放编码。"

    client.app.state.memory_overview.generate = summarize
    before = client.get("/api/memories", params={"task_id": task_id}).json()
    result = overview(client, task_id)
    assert result.status_code == 200, result.text
    assert result.json()["summary"] == "这个项目采用开放编码。"
    assert [item.content for item in seen[0]] == ["先开放编码。"]
    assert overview(client, task_id).json() == result.json()
    assert len(seen) == 1
    assert client.get("/api/memories", params={"task_id": task_id}).json() == before
    client.cookies.clear()
    register(client)
    assert (
        client.post(
            "/api/memories/overview",
            headers={"Idempotency-Key": str(uuid4())},
            json={"task_id": task_id, "expected_version": 1},
        ).status_code
        == 404
    )
    assert len(seen) == 1


def test_overview_rejects_changed_snapshot(plain_client):
    client = plain_client
    register(client)
    record = save(client, content="中文回答。").json()

    def summarize(items):
        client.patch(
            f"/api/memories/{record['memory_id']}",
            headers={"Idempotency-Key": str(uuid4())},
            json={"content": "保留原文。", "expected_version": 1},
        )
        return "已过期的概览"

    client.app.state.memory_overview.generate = summarize
    assert overview(client).status_code == 409


def test_overview_model_failure_preserves_records(plain_client):
    client = plain_client
    register(client)
    save(client)
    before = client.get("/api/memories").json()
    response = overview(client)
    assert response.status_code == 503
    assert client.get("/api/memories").json() == before


def test_overview_reuses_summary_after_settings_changes_and_noop_edit(plain_client):
    client = plain_client
    register(client)
    first = save(client, key="language", content="中文回答。").json()
    save(client, key="method", content="先开放编码。")
    summaries = iter(["保留的概览", "不应重新生成"])
    client.app.state.memory_overview.generate = lambda items: next(summaries)
    assert overview(client).json()["summary"] == "保留的概览"

    settings = client.get("/api/memories/settings").json()
    response = client.patch(
        "/api/memories/settings",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": settings["version"], "use_memory": False, "learn_memory": False},
    )
    assert response.status_code == 200, response.text
    assert overview(client).json()["summary"] == "保留的概览"
    response = client.patch(
        f"/api/memories/{first['memory_id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"content": first["content"], "expected_version": first["version"]},
    )
    assert response.status_code == 200, response.text
    assert overview(client).json()["summary"] == "保留的概览"


def test_overview_reflects_edits_and_deletion(plain_client):
    client = plain_client
    register(client)
    first = save(client, content="中文回答。").json()
    client.app.state.memory_overview.generate = lambda items: "；".join(m.content for m in items)
    assert overview(client).json()["summary"] == "中文回答。"

    response = client.patch(
        f"/api/memories/{first['memory_id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"content": "保留原文。", "expected_version": first["version"]},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert overview(client).json()["summary"] == "保留原文。"
    response = client.delete(
        f"/api/memories/{first['memory_id']}",
        params={"expected_version": updated["version"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 204, response.text
    result = overview(client).json()
    assert result["summary"] == ""
    assert result["memory_count"] == 0


def test_overview_rejects_deletion_while_generating(plain_client):
    client = plain_client
    register(client)
    first = save(client, content="中文回答。").json()

    def generate(items):
        response = client.delete(
            f"/api/memories/{first['memory_id']}",
            params={"expected_version": first["version"]},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert response.status_code == 204, response.text
        return "删除前的概览"

    client.app.state.memory_overview.generate = generate
    assert overview(client).status_code == 409
    assert overview(client).json()["summary"] == ""


def test_overview_route_accepts_only_the_public_query_contract():
    from types import SimpleNamespace

    from qunxue_api.api.routes.memories import MemoryOverviewRequest, summarize_memory
    from qunxue_api.application.memory_overview import MemoryOverviewResult

    user_id, task_id = uuid4(), uuid4()
    calls = []

    class Query:
        def summarize(self, *args):
            calls.append(args)
            return MemoryOverviewResult("公开用例概览", 8, 3)

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(memory_overview_query=Query()))
    )
    current = SimpleNamespace(user=SimpleNamespace(user_id=user_id))
    result = summarize_memory(
        MemoryOverviewRequest(task_id=task_id, expected_version=7), request, current, "request-key"
    )
    assert result.model_dump() == {"summary": "公开用例概览", "scope_version": 8, "memory_count": 3}
    assert calls == [(user_id, task_id, 7)]


def test_overview_query_sqlite_scope_release_reauthorization_and_latest_version(plain_client):
    from contextlib import contextmanager

    from sqlalchemy import text

    client = plain_client
    register(client)
    task_id = project(client)
    save(client, task_id=task_id)
    original_scope = client.app.state.memory_service_scope
    sessions, events = [], []

    @contextmanager
    def observed_scope():
        with original_scope() as memory:
            sessions.append(memory.repository.session)
            events.append("open")
            yield memory
        events.append("closed")

    client.app.state.memory_service_scope = observed_scope

    def generate(_items):
        assert events == ["open", "closed"]
        assert not sessions[0].in_transaction()
        # Another real session can change settings while generation has no read scope.
        with original_scope() as memory:
            owner = _items[0].user_id
            scope = memory.repository.scope(owner, _items[0].task_id)
            memory.repository.configure(
                owner, _items[0].task_id, expected_version=scope.version,
                use_memory=False, learn_memory=False,
            )
        return "仍有效的概览"

    client.app.state.memory_overview.generate = generate
    response = client.post(
        "/api/memories/overview", headers={"Idempotency-Key": str(uuid4())},
        json={"task_id": task_id, "expected_version": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"summary": "仍有效的概览", "scope_version": 2, "memory_count": 1}
    assert events == ["open", "closed", "open", "closed"]
    assert sessions[0] is not sessions[1]
    assert all(not session.in_transaction() for session in sessions)
    with original_scope() as memory:
        assert memory.repository.session.scalar(text("SELECT count(*) FROM agent_memories")) == 1


def test_overview_http_boundary_keeps_auth_dto_header_and_controlled_validation(plain_client):
    from qunxue_api.application.memory_overview import MemoryOverviewReadError, MemoryOverviewResult

    client = plain_client
    calls = []

    class Query:
        def summarize(self, *args):
            calls.append(args)
            if args[-1] == 1:
                raise MemoryOverviewReadError(ValueError("受控读取校验"))
            return MemoryOverviewResult("", 0, 0)

    client.app.state.memory_overview_query = Query()
    url = "/api/memories/overview"
    headers = {"Idempotency-Key": str(uuid4())}
    assert client.post(url, headers=headers, json={"expected_version": 0}).status_code == 401
    assert not calls
    user_id = register(client)
    for payload in ({"expected_version": -1}, {"expected_version": 0, "extra": True}):
        assert client.post(url, headers=headers, json=payload).status_code == 422
    assert client.post(url, json={"expected_version": 0}).status_code == 422
    assert not calls
    response = client.post(url, headers=headers, json={"expected_version": 0})
    assert response.status_code == 200
    assert response.json() == {"summary": "", "scope_version": 0, "memory_count": 0}
    assert len(calls) == 1 and str(calls[0][0]) == user_id and calls[0][1:] == (None, 0)
    response = client.post(url, headers=headers, json={"expected_version": 1})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["message"] == "受控读取校验"
