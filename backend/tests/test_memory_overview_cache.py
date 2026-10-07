from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest

import qunxue_api.application.memory_overview as overview_module
from qunxue_api.application.memory_overview import (
    MemoryOverview,
    MemoryOverviewBusy,
    MemoryOverviewUnavailable,
)
from qunxue_api.modules.agent_memory import Memory


def memory():
    now = datetime.now(UTC)
    return Memory(uuid4(), uuid4(), None, "language", "使用中文。", "manual", 1, now, now)


def numbered_generator():
    summaries = iter(f"概览 {number}" for number in range(100))
    return lambda items: next(summaries)


def test_same_contents_reuse_overview_after_settings_changes():
    item = memory()
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    assert service.summarize(item.user_id, None, 2, (item,)) == "概览 0"


def test_same_contents_do_not_expire_after_five_minutes(monkeypatch):
    now = 0
    monkeypatch.setattr(overview_module, "monotonic", lambda: now, raising=False)
    item = memory()
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    now = 3600
    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"


def test_same_contents_reuse_overview_when_record_order_changes():
    item = memory()
    second = replace(item, memory_id=uuid4(), content="先开放编码。")
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item, second)) == "概览 0"
    assert service.summarize(item.user_id, None, 2, (second, item)) == "概览 0"


@pytest.mark.parametrize(
    "change",
    [{"content": "保留原文。"}, {"origin": "learned"}, {"memory_id": uuid4()}],
)
def test_changed_summary_input_does_not_reuse_old_content(change):
    item = memory()
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    changed = replace(item, **change)
    assert service.summarize(item.user_id, None, 1, (changed,)) == "概览 1"


def test_overview_cache_is_isolated_between_users_and_projects():
    item = memory()
    service = MemoryOverview(numbered_generator())
    other_user, project = uuid4(), uuid4()

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    assert service.summarize(other_user, None, 1, (replace(item, user_id=other_user),)) == "概览 1"
    project_item = replace(item, task_id=project)
    assert service.summarize(item.user_id, project, 1, (project_item,)) == "概览 2"
    assert service.summarize(item.user_id, None, 2, (item,)) == "概览 0"


def test_empty_scope_discards_previous_overview():
    item = memory()
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    assert service.summarize(item.user_id, None, 2, ()) == ""
    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 1"


def test_invalidate_discards_only_the_changed_scope():
    item = memory()
    project = uuid4()
    service = MemoryOverview(numbered_generator())

    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"
    assert service.summarize(item.user_id, project, 1, (item,)) == "概览 1"
    service.invalidate(item.user_id, None)
    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 2"
    assert service.summarize(item.user_id, project, 2, (item,)) == "概览 1"


@pytest.mark.parametrize("clear_scope", ["invalidate", "empty"])
def test_scope_cleared_during_generation_cannot_restore_old_cache(clear_scope):
    item = memory()

    def generate(items):
        if clear_scope == "invalidate":
            service.invalidate(item.user_id, None)
        else:
            assert service.summarize(item.user_id, None, 2, ()) == ""
        return "删除前的旧概览"

    service = MemoryOverview(generate)
    service.summarize(item.user_id, None, 1, (item,))
    service.generate = lambda items: "重新生成的概览"
    assert service.summarize(item.user_id, None, 1, (item,)) == "重新生成的概览"


def test_failed_generation_does_not_keep_stale_overview_or_busy_state():
    item = memory()
    service = MemoryOverview(numbered_generator())
    assert service.summarize(item.user_id, None, 1, (item,)) == "概览 0"

    def fail(items):
        raise RuntimeError("model unavailable")

    service.generate = fail
    changed = replace(item, content="保留原文。")
    with pytest.raises(MemoryOverviewUnavailable):
        service.summarize(item.user_id, None, 2, (changed,))
    service.generate = lambda items: "恢复后的概览"
    assert service.summarize(item.user_id, None, 2, (changed,)) == "恢复后的概览"
    assert service.summarize(item.user_id, None, 1, (item,)) == "恢复后的概览"


def test_changed_snapshot_during_generation_cannot_restore_old_cache():
    item = memory()
    changed = replace(item, content="保留原文。")

    def generate(items):
        with pytest.raises(MemoryOverviewBusy):
            service.summarize(item.user_id, None, 2, (changed,))
        return "旧概览"

    service = MemoryOverview(generate)
    service.summarize(item.user_id, None, 1, (item,))
    service.generate = lambda items: "新概览"
    assert service.summarize(item.user_id, None, 1, (item,)) == "新概览"


def test_cache_evicts_least_recently_used_scopes():
    item = memory()
    users = [uuid4() for _ in range(65)]
    service = MemoryOverview(numbered_generator())
    for number, user in enumerate(users[:64]):
        assert service.summarize(user, None, 1, (item,)) == f"概览 {number}"

    assert service.summarize(users[0], None, 2, (item,)) == "概览 0"
    assert service.summarize(users[64], None, 1, (item,)) == "概览 64"
    assert service.summarize(users[0], None, 2, (item,)) == "概览 0"
    assert service.summarize(users[1], None, 1, (item,)) == "概览 65"


def test_generation_limits_one_per_user_and_four_in_total():
    items = [memory() for _ in range(5)]

    def generate(current):
        number = items.index(current[0])
        with pytest.raises(MemoryOverviewBusy):
            service.summarize(current[0].user_id, uuid4(), 1, current)
        if number < 3:
            next_item = items[number + 1]
            return service.summarize(next_item.user_id, None, 1, (next_item,))
        if number == 3:
            with pytest.raises(MemoryOverviewBusy):
                service.summarize(items[4].user_id, None, 1, (items[4],))
        return "生成完成"

    service = MemoryOverview(generate)
    assert service.summarize(items[0].user_id, None, 1, (items[0],)) == "生成完成"
    assert service.summarize(items[4].user_id, None, 1, (items[4],)) == "生成完成"


def _overview_reader_scope(events, snapshots, *, failure=None):
    """A public reader fake: no repository, database, Session, or HTTP objects."""
    from contextlib import contextmanager

    from qunxue_api.application.memory_overview import MemoryOverviewReader

    opened = 0

    @contextmanager
    def read_scope(user_id, task_id):
        nonlocal opened
        opened += 1
        number = opened
        version, items = snapshots[number - 1]
        assert all(item.user_id == user_id and item.task_id == task_id for item in items)

        def step(phase):
            events.append((number, phase))
            if failure and failure[:2] == (number, phase):
                raise failure[2]

        def read_version():
            step("version")
            return version

        def read_items():
            step("items")
            return items

        try:
            step("open")
            yield MemoryOverviewReader(read_version, read_items)
            step("exit")
        finally:
            events.append((number, "closed"))

    return read_scope


@pytest.mark.parametrize("delivery", ["callback", "cache", "empty"])
@pytest.mark.parametrize("change", ["same", "settings", "noop", "order"])
def test_overview_query_public_reader_owns_complete_delivery_sequence(delivery, change):
    from qunxue_api.application.memory_overview import MemoryOverviewQuery, MemoryOverviewResult

    first = memory()
    second = replace(first, memory_id=uuid4(), content="先看原文。")
    items = () if delivery == "empty" else (first, second)
    latest = items
    version = 1 if change == "same" else 2
    if change == "noop":
        latest = tuple(replace(item, version=2, updated_at=datetime.now(UTC)) for item in items)
    elif change == "order":
        latest = tuple(reversed(items))
    events = []
    read_scope = _overview_reader_scope(events, [(1, items), (version, latest)])

    class Engine:
        def summarize(self, user_id, task_id, seen_version, seen_items, *, before_delivery):
            assert (user_id, task_id, seen_version, seen_items) == (first.user_id, None, 1, items)
            events.append("summarize")
            if delivery == "callback":
                before_delivery()
                events.append("paid-success")
            events.append("return")
            return "" if delivery == "empty" else "概览"

        def invalidate(self, *args):
            pytest.fail("An unchanged fingerprint must not invalidate the overview")

    result = MemoryOverviewQuery(read_scope, Engine()).summarize(first.user_id, None, 1)
    assert result == MemoryOverviewResult(
        "" if delivery == "empty" else "概览", version, len(items)
    )
    initial = [(1, "open"), (1, "version"), (1, "items"), (1, "exit"), (1, "closed")]
    final = [(2, "open"), (2, "version")]
    if version != 1:
        final.append((2, "items"))
    final += [(2, "exit"), (2, "closed")]
    assert events == initial + ["summarize"] + (
        final + ["paid-success", "return"] if delivery == "callback" else ["return"] + final
    )


@pytest.mark.parametrize("change", ["content", "origin", "identity", "delete"])
@pytest.mark.parametrize("delivery", ["callback", "cache"])
def test_overview_query_invalidates_changed_snapshot_before_stale(change, delivery):
    from qunxue_api.application.memory_overview import MemoryOverviewQuery, MemoryOverviewStale

    item = memory()
    changes = {
        "content": (replace(item, content="保留原文。"),),
        "origin": (replace(item, origin="learned"),),
        "identity": (replace(item, memory_id=uuid4()),),
        "delete": (),
    }
    events = []
    read_scope = _overview_reader_scope(events, [(1, (item,)), (2, changes[change])])

    class Engine:
        def summarize(self, *args, before_delivery):
            events.append("summarize")
            if delivery == "callback":
                before_delivery()
                pytest.fail("Stale delivery must abort before paid success")
            events.append("return")
            return "旧概览"

        def invalidate(self, user_id, task_id):
            assert (user_id, task_id) == (item.user_id, None)
            events.append("invalidate")

    with pytest.raises(MemoryOverviewStale):
        MemoryOverviewQuery(read_scope, Engine()).summarize(item.user_id, None, 1)
    assert events[-3:] == [(2, "items"), "invalidate", (2, "closed")]
    assert "paid-success" not in events


def test_overview_query_rejects_expected_version_before_reading_items_or_engine():
    from qunxue_api.application.memory_overview import MemoryOverviewQuery, MemoryOverviewReadError
    from qunxue_api.modules.agent_memory import MemoryConflict

    item = memory()
    events = []
    read_scope = _overview_reader_scope(events, [(2, (item,))])
    with pytest.raises(MemoryOverviewReadError) as raised:
        MemoryOverviewQuery(read_scope, object()).summarize(item.user_id, None, 1)
    assert isinstance(raised.value.reason, MemoryConflict)
    assert str(raised.value) == "记忆已更新，请刷新后重新整理概览。"
    assert events == [(1, "open"), (1, "version"), (1, "closed")]


@pytest.mark.parametrize("path", ["initial", "callback", "cache", "empty"])
@pytest.mark.parametrize("phase", ["open", "version", "items", "exit"])
@pytest.mark.parametrize("kind", ["not-found", "conflict", "validation"])
def test_overview_query_read_failure_timing_keeps_scoped_errors_distinct(path, phase, kind):
    from qunxue_api.application.memory_overview import MemoryOverviewQuery, MemoryOverviewReadError
    from qunxue_api.modules.agent_memory import MemoryConflict, MemoryNotFound

    item = memory()
    events = []
    error = {"not-found": MemoryNotFound, "conflict": MemoryConflict, "validation": ValueError}[
        kind
    ]("原始读取错误")
    items = () if path == "empty" else (item,)
    engine = MemoryOverview(lambda _: "概览")
    if path == "cache":
        assert engine.summarize(item.user_id, None, 1, items) == "概览"
    read_scope = _overview_reader_scope(
        events, [(1, items), (2, items)], failure=(1 if path == "initial" else 2, phase, error)
    )
    query = MemoryOverviewQuery(read_scope, engine)
    expected = MemoryOverviewUnavailable if path == "callback" else MemoryOverviewReadError
    with pytest.raises(expected) as raised:
        query.summarize(item.user_id, None, 1)
    if path == "callback":
        assert str(raised.value) == "概览暂未生成，可以先查看下方记忆记录。"
        assert raised.value.__cause__.reason is error
    else:
        assert raised.value.reason is error
        assert str(raised.value) == str(error)
    assert events[-1] == (1 if path == "initial" else 2, "closed")
    assert sum(phase == "open" for _, phase in events) == (1 if path == "initial" else 2)


def test_overview_query_initial_scope_closed_and_final_scope_closed_before_billing_finish():
    from contextlib import contextmanager

    from qunxue_api.application.memory_overview import MemoryOverviewQuery

    item = memory()
    events = []
    read_scope = _overview_reader_scope(events, [(1, (item,)), (1, (item,))])

    class Billing:
        @contextmanager
        def open(self, **kwargs):
            assert events[-1] == (1, "closed")
            assert kwargs["phase"] == "memory_overview"
            events.append("billing-open")
            yield self
            events.append("billing-close")

        def finish(self, outcome):
            assert events[-1] == (2, "closed")
            assert outcome == "success"
            events.append("billing-finish")

    def generate(items):
        assert events[-1] == "billing-open"
        events.append("generate")
        return "概览"

    result = MemoryOverviewQuery(read_scope, MemoryOverview(generate, billing=Billing())).summarize(
        item.user_id, None, 1
    )
    assert result.summary == "概览"
    assert events[-3:] == [(2, "closed"), "billing-finish", "billing-close"]


@pytest.mark.parametrize("kind", ["not-found", "conflict", "validation"])
def test_overview_query_does_not_reclassify_unscoped_engine_errors(kind):
    from qunxue_api.application.memory_overview import MemoryOverviewQuery
    from qunxue_api.modules.agent_memory import MemoryConflict, MemoryNotFound

    item = memory()
    error = {"not-found": MemoryNotFound, "conflict": MemoryConflict, "validation": ValueError}[
        kind
    ]("unscoped engine failure")
    events = []

    class Engine:
        def summarize(self, *args, **kwargs):
            raise error

    read_scope = _overview_reader_scope(events, [(1, (item,))])
    with pytest.raises(type(error)) as raised:
        MemoryOverviewQuery(read_scope, Engine()).summarize(item.user_id, None, 1)
    assert raised.value is error
    assert events[-1] == (1, "closed")


@pytest.mark.parametrize(
    "kind,status,message",
    [
        ("not-found", 404, "项目不存在"),
        ("conflict", 409, "读取冲突"),
        ("validation", 422, "受控读取校验"),
        ("busy", 429, "请稍后"),
        ("unavailable", 503, "暂不可用"),
        ("stale", 409, "记忆已更新，请刷新后重新整理概览。"),
        ("raw-validation", None, "unscoped"),
        ("initial-busy", None, "initial failure"),
    ],
)
def test_overview_route_preserves_exact_scoped_and_delivery_error_mapping(kind, status, message):
    from types import SimpleNamespace

    from fastapi import HTTPException

    from qunxue_api.api.routes.memories import (
        MemoryOverviewRequest,
        MemoryValidationError,
        summarize_memory,
    )
    from qunxue_api.application.memory_overview import MemoryOverviewReadError, MemoryOverviewStale
    from qunxue_api.modules.agent_memory import MemoryConflict, MemoryNotFound

    error = {
        "not-found": MemoryOverviewReadError(MemoryNotFound(message)),
        "conflict": MemoryOverviewReadError(MemoryConflict(message)),
        "validation": MemoryOverviewReadError(ValueError(message)),
        "busy": MemoryOverviewBusy(message),
        "unavailable": MemoryOverviewUnavailable(message),
        "stale": MemoryOverviewStale(),
        "raw-validation": ValueError(message),
        "initial-busy": MemoryOverviewReadError(MemoryOverviewBusy(message)),
    }[kind]

    class Query:
        def summarize(self, *args):
            raise error

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(memory_overview_query=Query()))
    )
    current = SimpleNamespace(user=SimpleNamespace(user_id=uuid4()))
    expected = MemoryValidationError if status == 422 else HTTPException
    if status is None:
        expected = type(error.reason if isinstance(error, MemoryOverviewReadError) else error)
    with pytest.raises(expected) as raised:
        summarize_memory(MemoryOverviewRequest(expected_version=1), request, current, "key")
    if status is None or status == 422:
        assert str(raised.value) == message
    else:
        assert raised.value.status_code == status
        assert raised.value.detail == message


@pytest.mark.parametrize("delivery", ["callback", "cache", "empty"])
def test_overview_query_sqlite_rechecks_project_ownership_after_generation_or_return(
    plain_client, delivery
):
    from test_agent_memory import project, register, save
    from test_memory_overview import overview

    client = plain_client
    register(client)
    task_id = project(client)
    if delivery != "empty":
        save(client, task_id=task_id)
    engine = client.app.state.memory_overview
    engine.generate = lambda _: "不能泄露的旧概览"
    if delivery == "cache":
        assert overview(client, task_id).status_code == 200

    def revoke():
        response = client.delete(
            f"/api/research-tasks/{task_id}", headers={"Idempotency-Key": str(uuid4())}
        )
        assert response.status_code == 200, response.text

    if delivery == "callback":
        def generate(_items):
            revoke()
            return "不能泄露的旧概览"
        engine.generate = generate
    else:
        original = engine.summarize

        def summarize(*args, **kwargs):
            summary = original(*args, **kwargs)
            revoke()
            return summary
        engine.summarize = summarize

    response = overview(client, task_id)
    assert response.status_code == (503 if delivery == "callback" else 404), response.text
    expected = "Internal server error." if delivery == "callback" else "Resource not found."
    assert response.json()["error"]["message"] == expected
    assert "不能泄露" not in response.text


def test_overview_query_rejects_memory_created_after_empty_engine_return():
    from qunxue_api.application.memory_overview import MemoryOverviewQuery, MemoryOverviewStale

    item = memory()
    events = []
    read_scope = _overview_reader_scope(events, [(0, ()), (1, (item,))])
    engine = MemoryOverview()
    with pytest.raises(MemoryOverviewStale):
        MemoryOverviewQuery(read_scope, engine).summarize(item.user_id, None, 0)
    assert events[-3:] == [(2, "version"), (2, "items"), (2, "closed")]
