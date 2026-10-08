from contextlib import contextmanager
from dataclasses import replace
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from test_agent_memory import project, register, save
from test_memory_overview_cache import memory

from qunxue_api.api.routes.memories import (
    MemoryUpdate,
    MemoryValidationError,
    delete_memory,
    update_memory,
)
from qunxue_api.application.memory_commands import MemoryCommandError, MemoryCommands
from qunxue_api.modules.agent_memory import MemoryConflict, MemoryNotFound, MemoryService


def invoke(commands, operation, item, *, content="新内容", key="request-key", version=1):
    if operation == "update":
        return commands.update(
            item.user_id,
            item.memory_id,
            content=content,
            expected_version=version,
            idempotency_key=key,
        )
    return commands.delete(item.user_id, item.memory_id, version)


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("change", ["content", "origin", "neither"])
def test_command_owns_one_scope_and_invalidates_after_successful_exit(operation, change):
    item = replace(memory(), task_id=uuid4(), origin="learned" if change == "origin" else "manual")
    content = "新内容" if change == "content" else item.content
    updated = replace(item, content=content, origin="manual", version=2)
    events, active = [], False

    class Repository:
        def get(self, user_id, memory_id):
            assert active and (user_id, memory_id) == (item.user_id, item.memory_id)
            events.append("get")
            return item

        def save(self, **kwargs):
            assert active
            assert kwargs == dict(
                user_id=item.user_id,
                task_id=item.task_id,
                key=item.key,
                memory_id=item.memory_id,
                content=content,
                origin="manual",
                expected_version=1,
                idempotency_key="request-key",
            )
            events.append("save")
            return updated

        def delete(self, user_id, memory_id, expected_version):
            assert active and (user_id, memory_id, expected_version) == (
                item.user_id,
                item.memory_id,
                1,
            )
            events.append("delete")

    @contextmanager
    def scope():
        nonlocal active
        assert not active
        active = True
        events.append("enter")
        yield MemoryService(Repository())
        events.append("commit")
        active = False
        events.append("exit")

    def invalidate(user_id, task_id):
        assert not active and (user_id, task_id) == (item.user_id, item.task_id)
        events.append("invalidate")

    result = invoke(MemoryCommands(scope, invalidate), operation, item, content=content)
    assert result == (updated if operation == "update" else None)
    expected = ["enter", "get", "save" if operation == "update" else "delete", "commit", "exit"]
    assert events == expected + (
        ["invalidate"] if operation == "delete" or change != "neither" else []
    )


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("phase", ["enter", "read", "mutate", "exit"])
@pytest.mark.parametrize("kind", [MemoryNotFound, MemoryConflict, ValueError, RuntimeError])
def test_scoped_failures_never_invalidate_and_preserve_reason(operation, phase, kind):
    item, error, invalidations = memory(), kind("exact failure"), []

    def fail(at):
        if phase == at:
            raise error

    class Repository:
        def get(self, *_args):
            fail("read")
            return item

        def save(self, **_kwargs):
            fail("mutate")
            return replace(item, content="新内容")

        def delete(self, *_args):
            fail("mutate")

    @contextmanager
    def scope():
        fail("enter")
        yield MemoryService(Repository())
        fail("exit")

    commands = MemoryCommands(scope, lambda *args: invalidations.append(args))
    expected = RuntimeError if kind is RuntimeError else MemoryCommandError
    with pytest.raises(expected) as raised:
        invoke(commands, operation, item)
    assert (raised.value if kind is RuntimeError else raised.value.reason) is error
    assert invalidations == []


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("kind", [MemoryNotFound, MemoryConflict, ValueError, RuntimeError])
def test_invalidation_failures_are_not_reclassified_as_storage_errors(operation, kind):
    item, error, events = memory(), kind("cache failure"), []

    @contextmanager
    def scope():
        yield MemoryService(
            SimpleNamespace(
                get=lambda *_: item,
                save=lambda **_: replace(item, content="新内容"),
                delete=lambda *_: None,
            )
        )
        events.append("committed")

    def invalidate(*_args):
        assert events == ["committed"]
        raise error

    with pytest.raises(kind) as raised:
        invoke(MemoryCommands(scope, invalidate), operation, item)
    assert raised.value is error


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_route_requires_only_public_command_contract(operation):
    item, calls = memory(), []

    class Commands:
        def update(self, *args, **kwargs):
            calls.append((args, kwargs))
            return item

        def delete(self, *args):
            calls.append((args, {}))

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(memory_commands=Commands()))
    )
    current = SimpleNamespace(user=SimpleNamespace(user_id=item.user_id))
    if operation == "update":
        result = update_memory(
            item.memory_id,
            MemoryUpdate(content=item.content, expected_version=1),
            request,
            current,
            "request-key",
        )
        assert result.memory_id == item.memory_id and result.content == item.content
        assert calls == [
            (
                (item.user_id, item.memory_id),
                dict(
                    content=item.content,
                    expected_version=1,
                    idempotency_key="request-key",
                ),
            )
        ]
    else:
        result = delete_memory(item.memory_id, request, current, "unused-key", 1)
        assert result.status_code == 204 and result.body == b""
        assert calls == [((item.user_id, item.memory_id, 1), {})]


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize(
    "kind,status", [(MemoryNotFound, 404), (MemoryConflict, 409), (ValueError, 422)]
)
@pytest.mark.parametrize("scoped", [True, False])
def test_route_maps_only_scoped_command_errors(operation, kind, status, scoped):
    item, reason = memory(), kind("exact error")

    def fail(*_args, **_kwargs):
        raise MemoryCommandError(reason) if scoped else reason

    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                memory_commands=SimpleNamespace(update=fail, delete=fail),
            )
        )
    )
    current = SimpleNamespace(user=SimpleNamespace(user_id=item.user_id))
    expected = (MemoryValidationError if status == 422 else HTTPException) if scoped else kind
    with pytest.raises(expected) as raised:
        if operation == "update":
            update_memory(
                item.memory_id,
                MemoryUpdate(content="内容", expected_version=1),
                request,
                current,
                "key",
            )
        else:
            delete_memory(item.memory_id, request, current, "key", 1)
    if scoped:
        assert raised.value.__cause__ is reason
        if status != 422:
            assert raised.value.status_code == status and raised.value.detail == "exact error"
        else:
            assert str(raised.value) == "exact error"
    else:
        assert raised.value is reason


def snapshot(database):
    tables = [
        "agent_memories",
        "agent_memory_scopes",
        "agent_memory_revisions",
        "agent_memory_requests",
        "agent_conversation_summaries",
    ]
    with database.session() as session:
        return {table: list(session.execute(text(f"SELECT * FROM {table}"))) for table in tables}


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("phase", ["read", "mutate", "commit"])
def test_sqlite_failures_rollback_all_writes_before_any_invalidation(
    plain_client, operation, phase
):
    client = plain_client
    user_id = UUID(register(client))
    entry = save(client).json()
    original_scope = client.app.state.memory_service_scope
    before = snapshot(client.app.state.database)
    calls, error = [], ValueError("synthetic failure")

    @contextmanager
    def failing_scope():
        with original_scope() as service:
            repository = service.repository
            method = "get" if phase == "read" else "save" if operation == "update" else "delete"
            target = repository.session if phase == "commit" else repository
            method = "commit" if phase == "commit" else method
            original = getattr(target, method)

            def fail(*args, **kwargs):
                if phase == "mutate":
                    original(*args, **kwargs)
                raise error

            setattr(target, method, fail)
            yield service

    client.app.state.memory_service_scope = failing_scope
    client.app.state.memory_overview.invalidate = lambda *args: calls.append(args)
    item = replace(memory(), user_id=user_id, memory_id=UUID(entry["memory_id"]))
    with pytest.raises(MemoryCommandError) as raised:
        invoke(client.app.state.memory_commands, operation, item)
    assert raised.value.reason is error
    assert calls == [] and snapshot(client.app.state.database) == before


def test_sqlite_replay_conflict_noop_origin_and_successful_delete(plain_client):
    client = plain_client
    owner = UUID(register(client))
    task_id = project(client)
    entry = save(client, task_id=task_id).json()
    item = replace(
        memory(), user_id=owner, memory_id=UUID(entry["memory_id"]), task_id=UUID(task_id)
    )
    commands, calls = client.app.state.memory_commands, []
    original_scope = client.app.state.memory_service_scope

    def invalidate(user_id, scope_id):
        # A separate connection sees the committed state before invalidation.
        with original_scope() as service:
            calls.append((user_id, scope_id, service.repository.list(user_id, scope_id)))

    client.app.state.memory_overview.invalidate = invalidate
    updated = invoke(commands, "update", item)
    assert len(calls) == 1 and calls[0][:2] == (owner, UUID(task_id))
    assert calls[0][2][0] == updated and updated.key == entry["key"]
    replayed = invoke(commands, "update", item)
    assert replayed == updated and len(calls) == 1
    for kwargs in ({"content": "conflicting payload"}, {"key": "fresh stale key"}):
        with pytest.raises(MemoryCommandError) as raised:
            invoke(commands, "update", item, **kwargs)
        assert isinstance(raised.value.reason, MemoryConflict)
    unchanged = invoke(commands, "update", item, version=2, key="noop-key")
    assert unchanged.version == 3 and len(calls) == 1
    with original_scope() as service:
        learned = service.save(
            user_id=owner,
            task_id=item.task_id,
            key=entry["key"],
            content=unchanged.content,
            origin="learned",
            idempotency_key="origin-seed",
            memory_id=item.memory_id,
            expected_version=3,
        )
    corrected = invoke(commands, "update", item, version=learned.version, key="origin-only")
    assert corrected.origin == "manual" and corrected.content == learned.content
    assert len(calls) == 2
    with pytest.raises(MemoryCommandError) as raised:
        invoke(commands, "delete", item, version=corrected.version - 1)
    assert isinstance(raised.value.reason, MemoryConflict) and len(calls) == 2
    invoke(commands, "delete", item, version=corrected.version)
    assert len(calls) == 3 and calls[-1][2] == ()
    with pytest.raises(MemoryCommandError) as raised:
        invoke(commands, "delete", item, version=corrected.version)
    assert isinstance(raised.value.reason, MemoryNotFound) and len(calls) == 3


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("loss", ["foreign_owner", "deleted_project"])
def test_http_rejects_foreign_owner_and_missing_project_without_invalidation(
    plain_client,
    operation,
    loss,
):
    client = plain_client
    register(client)
    task_id = project(client)
    entry = save(client, task_id=task_id).json()
    if loss == "foreign_owner":
        client.cookies.clear()
        register(client)
    else:
        response = client.delete(
            f"/api/research-tasks/{task_id}",
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert response.status_code == 200
    calls = []
    client.app.state.memory_overview.invalidate = lambda *args: calls.append(args)
    path = f"/api/memories/{entry['memory_id']}"
    headers = {"Idempotency-Key": str(uuid4())}
    response = (
        client.patch(path, headers=headers, json={"content": "修改", "expected_version": 1})
        if operation == "update"
        else client.delete(path, headers=headers, params={"expected_version": 1})
    )
    assert response.status_code == 404 and calls == []


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_http_auth_validation_and_required_header_stay_outside_commands(plain_client, operation):
    client, calls, item = plain_client, [], memory()

    def command(*args, **kwargs):
        calls.append((args, kwargs))
        raise MemoryCommandError(ValueError("受控记忆校验"))

    client.app.state.memory_commands = SimpleNamespace(update=command, delete=command)
    path = f"/api/memories/{item.memory_id}"
    headers = {"Idempotency-Key": "test-request"}

    def request(*, version=1, with_header=True, extra=False):
        if operation == "update":
            payload = {"content": "内容", "expected_version": version}
            if extra:
                payload["extra"] = True
            return client.patch(path, headers=headers if with_header else {}, json=payload)
        return client.delete(
            path, headers=headers if with_header else {}, params={"expected_version": version}
        )

    assert request().status_code == 401 and calls == []
    owner = register(client)
    assert request(version=0).status_code == 422
    assert request(with_header=False).status_code == 422
    if operation == "update":
        assert request(extra=True).status_code == 422
    assert calls == []
    response = request()
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "受控记忆校验"
    assert len(calls) == 1 and str(calls[0][0][0]) == owner
