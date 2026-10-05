"""Real owner-scoped readiness, explicit decisions and resumable index jobs."""

from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from test_agent_global_knowledge import SearchingRunner
from test_research_material_api import _authenticate
from test_shared_knowledge_api import create_library, upload

from qunxue_api.adapters.sqlite.shared_knowledge import SharedDocumentRow
from qunxue_api.modules.shared_knowledge import KnowledgeIndexChoiceRequired


def mutation(client, method, path, *, key=None, **kwargs):
    return getattr(client, method)(path, headers={"Idempotency-Key": key or str(uuid4())}, **kwargs)


@pytest.fixture
def index_client(plain_client):
    plain_client.app.state.knowledge_retriever = SimpleNamespace(_embedding_model="test-index")
    original_graph_scope = plain_client.app.state.personal_graph_scope
    @contextmanager
    def graph_scope():
        with original_graph_scope() as graph:
            graph.repository.mock = False
            graph.repository.embedding_model = "test-index"
            yield graph
    plain_client.app.state.personal_graph_scope = graph_scope
    return plain_client


def prepare(client):
    identity = _authenticate(client)
    kb = create_library(client)
    ready = upload(client, kb["id"])
    missing = upload(client, kb["id"], "课堂记录标记 未完成资料")
    with client.app.state.shared_knowledge_scope() as app:
        for doc in (ready, missing):
            row = app.repository.session.get(SharedDocumentRow, doc["id"])
            row.knowledge_status = "ready"
            row.index_status = "failed"
            row.index_error = "索引服务暂时不可用"
        row = app.repository.session.get(SharedDocumentRow, ready["id"])
        row.index_status = "ready"
        row.vectors = {
            "test-index": {f"material:{row.id}:{s['segment_id']}": [1.0, 0.0] for s in row.segments}
        }
        app.repository.commit()
    return identity, kb, ready, missing


def test_readiness_lists_actual_documents_and_foreign_user_sees_no_scope(index_client):
    c = index_client
    _, kb, ready, missing = prepare(c)
    status = c.get("/api/agent/knowledge-index-status").json()
    assert status["state"] == "missing_index"
    assert (status["total_count"], status["ready_count"], status["missing_count"]) == (2, 1, 1)
    assert status["processing_count"] == 0 and status["failed_count"] == 1
    assert status["ready_document_ids"] == [ready["id"]]
    assert status["missing_documents"][0]["document_id"] == missing["id"]
    assert status["ready_documents"][0]["index_error"] is None
    assert "segments" not in str(status)
    c.cookies.clear()
    _authenticate(c)
    assert c.get("/api/agent/knowledge-index-status").json()["total_count"] == 0
    assert (
        c.get(
            "/api/agent/knowledge-index-status", params={"reference_knowledge_base_id": kb["id"]}
        ).status_code
        == 404
    )


def test_default_retrieval_stops_without_choice_and_skip_excludes_missing_text(index_client):
    c = index_client
    identity, _, ready, _ = prepare(c)
    user_id = UUID(identity["user"]["user_id"])
    with c.app.state.disciplinary_agent_scope() as app:
        app._runner = SearchingRunner()
        with pytest.raises(KnowledgeIndexChoiceRequired) as error:
            app.run_turn(
                user_id=user_id,
                conversation_id=None,
                prompt="课堂记录标记",
                idempotency_key=str(uuid4()),
            )
        assert error.value.status["missing_count"] == 1
        assert app._runner.tools.evidence == {}
    with c.app.state.disciplinary_agent_scope() as app:
        app._runner = SearchingRunner()
        result = app.run_turn(
            user_id=user_id,
            conversation_id=None,
            prompt="课堂记录标记",
            idempotency_key=str(uuid4()),
            knowledge_index_action="skip_missing",
        )
        assert {x.material_id for x in result.result.citations} == {ready["id"]}
        assert "未完成资料" not in str(app._runner.inputs)
        assert result.result.answer.startswith("本次仅使用已就绪的 1/2")
        coverage = next(
            x["output"]["knowledge_index_coverage"]
            for x in result.tool_summary
            if x.get("tool") == "knowledge_index_scope"
        )
        assert coverage["missing_count"] == 1


def test_actual_tool_readiness_is_terminal_and_recoverable_without_greeting_gate(index_client):
    c = index_client
    _, _, _, _ = prepare(c)
    original = c.app.state.disciplinary_agent_scope

    @contextmanager
    def scope():
        with original() as app:
            app._runner = SearchingRunner()
            yield app

    c.app.state.disciplinary_agent_scope = scope
    key = str(uuid4())
    result = mutation(c, "post", "/api/agent/turns", key=key, json={"message": "课堂记录标记"})
    assert result.status_code == 200
    assert "event: knowledge_index_choice_required" in result.text
    assert "event: turn_completed" not in result.text
    lookup = c.get("/api/agent/runs/by-idempotency-key", headers={"Idempotency-Key": key}).json()
    assert lookup["status"] == "failed"
    conversation = c.get(f"/api/agent/conversations/{lookup['conversation_id']}").json()
    run = next(
        item for item in conversation["unfinished_runs"] if item["run_id"] == lookup["run_id"]
    )
    assert any(
        "knowledge_index_status" in (event.get("output") or {}) for event in run["tool_summary"]
    )


def test_explicit_repair_queues_only_missing_and_is_idempotent_then_continues(index_client):
    c = index_client
    _, _, ready, missing = prepare(c)
    before = c.get("/api/agent/knowledge-index-status").json()
    body = {
        "documents": [
            {k: d[k] for k in ("knowledge_base_id", "document_id", "parse_id")}
            for d in before["missing_documents"]
        ]
    }
    key = str(uuid4())
    for _ in range(2):
        queued = mutation(c, "post", "/api/agent/knowledge-index-repairs", key=key, json=body)
        assert queued.status_code == 202
        assert queued.json()["processing_count"] == 1
    calls = []

    class Embedder:
        def embed_documents(self, texts):
            calls.extend(texts)
            return [[1.0, 0.0] for _ in texts]

    worker = c.app.state.course_organization_worker
    worker.embedder, worker.embedding_model = Embedder(), "test-index"
    assert worker.run_once()
    assert not worker.run_once()
    assert calls == ["课堂记录标记 未完成资料"]
    after = c.get("/api/agent/knowledge-index-status").json()
    assert after["state"] == "ready" and after["ready_count"] == 2
    mutation(c, "post", "/api/agent/knowledge-index-repairs", key=key, json=body)
    assert not worker.run_once()
    assert set(after["ready_document_ids"]) == {ready["id"], missing["id"]}


def test_repair_rejects_stale_parse_or_foreign_owner_before_any_queue_write(index_client):
    c = index_client
    _, _, _, missing = prepare(c)
    state = c.get("/api/agent/knowledge-index-status").json()
    target = {
        k: state["missing_documents"][0][k]
        for k in ("knowledge_base_id", "document_id", "parse_id")
    }
    stale = {**target, "parse_id": str(uuid4())}
    assert (
        mutation(
            c, "post", "/api/agent/knowledge-index-repairs", json={"documents": [stale]}
        ).status_code
        == 409
    )
    with c.app.state.shared_knowledge_scope() as app:
        assert app.repository.session.get(SharedDocumentRow, missing["id"]).index_status == "failed"
    c.cookies.clear()
    _authenticate(c)
    assert (
        mutation(
            c, "post", "/api/agent/knowledge-index-repairs", json={"documents": [target]}
        ).status_code
        == 404
    )


def graph_ready_document(c, document_id, *, knowledge_ready=True):
    with c.app.state.shared_knowledge_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, document_id)
        row.vectors = {
            "test-index": {f"material:{row.id}:{s['segment_id']}": [1.0, 0.0] for s in row.segments}
        }
        row.index_status = "ready"
        row.knowledge_status = "ready" if knowledge_ready else "failed"
        row.knowledge_error = None if knowledge_ready else "实体关系整理失败"
        row.knowledge = (
            {
                "summary": "课堂记录",
                "topics": [
                    {
                        "title": "课堂记录",
                        "summary": "课堂记录",
                        "segment_ids": [row.segments[0]["segment_id"]],
                    }
                ],
                "relations": [],
            }
            if knowledge_ready
            else None
        )
        app.repository.commit()


def test_graph_requires_entity_relation_stage_and_skip_is_not_full_success(index_client):
    from qunxue_api.adapters.sqlite.personal_graph import PersonalGraphRow

    c = index_client
    identity, _, ready, missing = prepare(c)
    graph_ready_document(c, ready["id"])
    graph_ready_document(c, missing["id"], knowledge_ready=False)
    search = c.get("/api/agent/knowledge-index-status").json()
    assert search["ready_count"] == 2
    graph = c.get("/api/personal-graph").json()
    status = graph["knowledge_index_status"]
    assert status["purpose"] == "graph" and status["ready_count"] == 1
    assert status["missing_documents"][0]["stage"] == "knowledge"
    blocked = mutation(c, "post", "/api/personal-graph/refresh")
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "knowledge_index_choice_required"
    assert blocked.json()["status"]["missing_count"] == 1
    partial = mutation(
        c, "post", "/api/personal-graph/refresh", json={"knowledge_index_action": "skip_missing"}
    )
    assert partial.status_code == 200
    assert partial.json()["knowledge_index_status"]["ready_count"] == 1
    assert partial.json()["coverage"] == {
        "included_count": 1, "total_count": 2, "excluded_count": 1,
    }
    assert partial.json()["document_count"] == 1
    assert all(item.get("document_id") != missing["id"]
               for item in partial.json()["sources"].values())
    assert c.get("/api/personal-graph").json()["document_count"] == 1
    with c.app.state.personal_graph_scope() as app:
        row = app.repository.session.get(PersonalGraphRow, identity["user"]["user_id"])
        assert set(row.state["assignments"]) == {ready["id"]}
        state = row.state
        app.repository.mock = False
        app.repository.embedding_model = "test-index"
        app.repository.mark_dirty(UUID(identity["user"]["user_id"]))
        app.refresh(UUID(identity["user"]["user_id"]))
        app.repository.session.refresh(row)
        assert row.pending is False and row.state == state


def test_graph_repair_only_retries_failed_knowledge_and_preserves_ready_vectors(index_client):
    c = index_client
    _, _, ready, missing = prepare(c)
    graph_ready_document(c, ready["id"])
    graph_ready_document(c, missing["id"], knowledge_ready=False)
    status = c.get("/api/agent/knowledge-index-status", params={"purpose": "graph"}).json()
    body = {
        "purpose": "graph",
        "documents": [
            {k: d[k] for k in ("knowledge_base_id", "document_id", "parse_id")}
            for d in status["missing_documents"]
        ],
    }
    queued = mutation(c, "post", "/api/agent/knowledge-index-repairs", json=body)
    assert queued.status_code == 202 and queued.json()["processing_count"] == 1
    with c.app.state.shared_knowledge_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, missing["id"])
        assert row.knowledge_status == "queued" and row.index_status == "ready"
        cached = row.vectors
    worker = c.app.state.course_organization_worker
    worker.billing = None  # Synthetic generator below has no provider or billable model call.
    worker.generate = lambda doc: {
        "summary": "课堂记录",
        "topics": [
            {
                "title": "课堂记录",
                "summary": "课堂记录",
                "segment_ids": [doc.segments[0]["segment_id"]],
            }
        ],
        "relations": [],
    }
    assert worker.run_once()
    assert not worker.run_once()
    after = c.get("/api/agent/knowledge-index-status", params={"purpose": "graph"}).json()
    assert after["state"] == "ready", __import__("json").dumps(after, ensure_ascii=False)
    with c.app.state.shared_knowledge_scope() as app:
        assert app.repository.session.get(SharedDocumentRow, missing["id"]).vectors == cached


def test_selected_library_requires_the_same_explicit_index_choice(index_client):
    c = index_client
    identity, kb, ready, _ = prepare(c)
    with c.app.state.disciplinary_agent_scope() as app:
        app._runner = SearchingRunner()
        with pytest.raises(KnowledgeIndexChoiceRequired):
            app.run_turn(
                user_id=UUID(identity["user"]["user_id"]),
                conversation_id=None,
                prompt="课堂记录",
                reference_knowledge_base_id=UUID(kb["id"]),
                idempotency_key=str(uuid4()),
            )
    with c.app.state.disciplinary_agent_scope() as app:
        app._runner = SearchingRunner()
        result = app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="课堂记录",
            reference_knowledge_base_id=UUID(kb["id"]),
            knowledge_index_action="skip_missing",
            idempotency_key=str(uuid4()),
        )
        assert {item.material_id for item in result.result.citations} == {ready["id"]}


def test_repair_receipt_survives_worker_checkpoint_and_failure(index_client):
    from qunxue_api.adapters.research_agent.course_knowledge import (
        CourseKnowledgeGenerator,
        CourseOrganizationError,
    )

    c = index_client
    _, _, ready, missing = prepare(c)
    graph_ready_document(c, ready["id"])
    graph_ready_document(c, missing["id"], knowledge_ready=False)
    status = c.get("/api/agent/knowledge-index-status", params={"purpose": "graph"}).json()
    target = {
        k: status["missing_documents"][0][k]
        for k in ("knowledge_base_id", "document_id", "parse_id")
    }
    body, key = {"purpose": "graph", "documents": [target]}, str(uuid4())
    assert (
        mutation(c, "post", "/api/agent/knowledge-index-repairs", key=key, json=body).status_code
        == 202
    )
    calls = []

    class FailingGenerator(CourseKnowledgeGenerator):
        def __init__(self):
            pass

        def __call__(self, document, *, checkpoints, on_checkpoint):
            calls.append(document.id)
            on_checkpoint({"version": 2, "batches": {}, "cost": {}})
            raise CourseOrganizationError("model_timeout")

    worker = c.app.state.course_organization_worker
    worker.billing, worker.generate = None, FailingGenerator()
    assert worker.run_once()
    repeated = mutation(c, "post", "/api/agent/knowledge-index-repairs", key=key, json=body)
    assert repeated.status_code == 202 and repeated.json()["failed_count"] == 1
    assert not worker.run_once() and len(calls) == 1
    assert mutation(c, "post", "/api/agent/knowledge-index-repairs", json=body).status_code == 202
    assert worker.run_once() and len(calls) == 2
