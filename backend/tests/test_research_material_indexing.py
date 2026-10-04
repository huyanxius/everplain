"""Indexing is owned by ingestion; queries never repair a document cache."""

from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from test_research_material_ingestion import _authenticate, _task

from qunxue_api.adapters.research_agent.embedding import EmbeddingProviderError
from qunxue_api.adapters.research_materials import parse_material
from qunxue_api.adapters.research_materials.indexing import ResearchMaterialIndexer
from qunxue_api.adapters.sqlite.research_material_model import ResearchMaterialBlockRow
from qunxue_api.modules.research_materials import MaterialStatus, MaterialVersionConflict


class Embedder:
    def __init__(self):
        self.calls = []
        self.fail_call = None
        self.on_call = None

    def embed_documents(self, texts):
        self.calls.append(list(texts))
        if self.on_call:
            self.on_call()
        if len(self.calls) == self.fail_call:
            raise EmbeddingProviderError("temporary outage", code="service_error")
        return [[1.0, 0.5] for _ in texts]


def setup(client):
    _authenticate(client)
    task_id = _task(client)
    embedder = Embedder()
    client.app.state.research_material_indexer = ResearchMaterialIndexer(
        client.app.state.database, embedder=embedder, embedding_model="test-model"
    )
    scheduled = []
    client.app.state.schedule_research_material_ingestion = scheduled.append
    return task_id, embedder, scheduled


def upload(client, task_id, *, content="unchanged first paragraph", key=None):
    response = client.post(
        f"/api/research-tasks/{task_id}/materials",
        headers={"Idempotency-Key": key or str(uuid4())},
        data={"material_kind": "paper", "defer_processing": "true"},
        files={"file": ("notes.txt", content.encode(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def process(client, job_id, *, now=None):
    with client.app.state.research_material_application_scope() as application:
        if now:
            application._clock = lambda: now
        return application.process_ingestion(job_id)


def vectors(client, material_id, parse_id):
    with client.app.state.database.session() as session:
        return [
            row.embedding_vectors
            for row in session.scalars(
                select(ResearchMaterialBlockRow).where(
                    ResearchMaterialBlockRow.material_id == material_id,
                    ResearchMaterialBlockRow.parse_id == str(parse_id),
                )
            )
        ]


def test_import_replay_reparse_and_changed_blocks_are_incremental(plain_client):
    client = plain_client
    task_id, embedder, scheduled = setup(client)
    key = str(uuid4())
    original = "unchanged first paragraph\n\nsecond original paragraph"
    body = upload(client, task_id, content=original, key=key)
    first = process(client, scheduled[-1])
    assert first.ingestion_status.value == "ready"
    assert len(embedder.calls) == 1
    assert len(embedder.calls[0]) == 2
    assert all(
        "test-model" in item for item in vectors(client, body["material_id"], first.parse_id)
    )
    replay = upload(client, task_id, content=original, key=key)
    assert replay["material_id"] == body["material_id"]
    assert len(embedder.calls) == 1

    with client.app.state.research_material_application_scope() as application:
        application.reparse(
            user_id=first.user_id,
            task_id=first.task_id,
            material_id=first.material_id,
            idempotency_key=str(uuid4()),
        )
    same = process(client, scheduled[-1])
    assert same.parse_id != first.parse_id
    assert same.ingestion_status.value == "ready"
    assert len(embedder.calls) == 1

    with client.app.state.research_material_application_scope() as application:
        application._parser = lambda **kwargs: parse_material(
            **{
                **kwargs,
                "content": b"unchanged first paragraph\n\nchanged second paragraph",
            }
        )
        application.reparse(
            user_id=first.user_id,
            task_id=first.task_id,
            material_id=first.material_id,
            idempotency_key=str(uuid4()),
        )
    changed = process(client, scheduled[-1])
    assert changed.ingestion_status.value == "ready"
    assert embedder.calls[1:] == [["changed second paragraph"]]
    assert all(
        "test-model" in item for item in vectors(client, body["material_id"], changed.parse_id)
    )


def test_failed_second_batch_resumes_same_parse_without_reembedding(plain_client):
    client = plain_client
    task_id, embedder, scheduled = setup(client)
    body = upload(client, task_id, content="\n\n".join(f"paragraph number {i}" for i in range(20)))
    embedder.fail_call = 2
    failed = process(client, scheduled[-1])
    assert failed.ingestion_status.value == "failed"
    assert failed.error_code == "material_indexing_service_error"
    assert failed.completed_at is None
    assert (
        sum("test-model" in item for item in vectors(client, body["material_id"], failed.parse_id))
        == 16
    )
    with client.app.state.research_material_application_scope() as application:
        application._clock = lambda: failed.available_at + timedelta(seconds=1)
        application._parser = lambda **_kw: pytest.fail("index retry must not reparse")
        ready = application.process_ingestion(failed.job_id)
    assert ready.ingestion_status.value == "ready"
    assert ready.parse_id == failed.parse_id
    assert ready.attempt_count == 2
    assert embedder.calls[2:] == [embedder.calls[1]]
    assert len(embedder.calls[2]) == 4


def test_deletion_during_embedding_cannot_write_vectors_or_resurrect_material(plain_client):
    client = plain_client
    task_id, embedder, scheduled = setup(client)
    body = upload(client, task_id)

    def delete_during_call():
        response = client.delete(
            f"/api/research-tasks/{task_id}/materials/{body['material_id']}",
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert response.status_code == 204

    embedder.on_call = delete_during_call
    job = process(client, scheduled[-1])
    assert job.ingestion_status.value == "failed"
    assert vectors(client, body["material_id"], job.parse_id) == []
    assert (
        client.get(f"/api/research-tasks/{task_id}/materials/{body['material_id']}").status_code
        == 404
    )


def test_owner_scope_and_processing_policy_are_checked_before_embedding(plain_client, monkeypatch):
    from qunxue_api.adapters.sqlite.research_material_repository import (
        SqliteResearchMaterialRepository,
    )

    client = plain_client
    task_id, embedder, scheduled = setup(client)
    upload(client, task_id)
    monkeypatch.setattr(
        SqliteResearchMaterialRepository, "is_external_model_processable", lambda *_a, **_k: False
    )
    failed = process(client, scheduled[-1])
    assert failed.error_code == "material_indexing_policy_denied"
    assert embedder.calls == []
    monkeypatch.undo()
    with client.app.state.research_material_application_scope() as application:
        claimed = application.claim_ingestion(
            failed.job_id, now=failed.available_at + timedelta(seconds=1)
        )
    with pytest.raises(MaterialVersionConflict):
        client.app.state.research_material_indexer(replace(claimed, user_id=uuid4()))
    assert embedder.calls == []


def test_new_material_only_indexes_itself_and_does_not_scan_old_missing_data(plain_client):
    client = plain_client
    _authenticate(client)
    task_id = _task(client)
    scheduled = []
    client.app.state.schedule_research_material_ingestion = scheduled.append
    old = upload(client, task_id)
    old_job = process(client, scheduled[-1])
    assert old_job.ingestion_status.value == "ready"
    assert vectors(client, old["material_id"], old_job.parse_id) == [{}]
    embedder = Embedder()
    client.app.state.research_material_indexer = ResearchMaterialIndexer(
        client.app.state.database, embedder=embedder, embedding_model="test-model"
    )
    upload(client, task_id, content="new material only")
    ready = process(client, scheduled[-1])
    assert ready.ingestion_status.value == "ready"
    assert embedder.calls == [["new material only"]]
    assert vectors(client, old["material_id"], old_job.parse_id) == [{}]


def test_missing_provider_is_failed_not_ready_and_parse_is_readable(plain_client):
    client = plain_client
    task_id, _embedder, scheduled = setup(client)
    client.app.state.research_material_indexer = ResearchMaterialIndexer(
        client.app.state.database, embedder=None, embedding_model="test-model"
    )
    body = upload(client, task_id)
    failed = process(client, scheduled[-1])
    assert failed.error_code == "material_indexing_not_configured"
    response = client.get(f"/api/research-tasks/{task_id}/materials/{body['material_id']}").json()
    assert response["status"] == MaterialStatus.READY.value
    assert response["ingestion_status"] == "failed"
    assert response["unavailable_reason"] == "material_indexing_not_configured"


def test_replacement_during_embedding_cannot_finish_or_write_old_parse(plain_client):
    client = plain_client
    task_id, embedder, scheduled = setup(client)
    body = upload(client, task_id)
    first_id = scheduled[-1]

    def replace_during_call():
        embedder.on_call = None
        with client.app.state.research_material_application_scope() as application:
            job = application.get_ingestion_job(first_id)
            application._parser = lambda **kwargs: parse_material(
                **{
                    **kwargs,
                    "content": b"replacement content",
                }
            )
            application.reparse(
                user_id=job.user_id,
                task_id=job.task_id,
                material_id=job.material_id,
                idempotency_key=str(uuid4()),
            )

    embedder.on_call = replace_during_call
    old = process(client, first_id)
    assert old.ingestion_status.value == "failed"
    assert old.error_code == "material_indexing_superseded"
    assert old.completed_at is not None
    assert vectors(client, body["material_id"], old.parse_id) == [{}]
    current = process(client, scheduled[-1])
    assert current.ingestion_status.value == "ready"
    assert current.parse_id != old.parse_id
    assert embedder.calls[-1] == ["replacement content"]
    response = client.get(f"/api/research-tasks/{task_id}/materials/{body['material_id']}").json()
    assert response["parse_id"] == str(current.parse_id)


@pytest.mark.parametrize("bad_vector", [[], [0.0, 0.0], [float("nan"), 1.0], [True, 1.0]])
def test_invalid_vectors_never_mark_index_ready(plain_client, bad_vector):
    client = plain_client
    task_id, embedder, scheduled = setup(client)
    body = upload(client, task_id)
    embedder.embed_documents = lambda _texts: [bad_vector]
    failed = process(client, scheduled[-1])
    assert failed.error_code == "material_indexing_invalid_response"
    assert vectors(client, body["material_id"], failed.parse_id) == [{}]


def test_research_query_reuses_scoped_cache_without_document_embedding(tmp_path):
    from test_research_material_agent_tools import (
        MATERIAL_ID,
        PARSE_ID,
        USER_ID,
        _Materials,
        _registry,
    )

    from qunxue_api.adapters.research_agent.reranker import RerankScore
    from qunxue_api.adapters.retrieval import HybridRetriever, SqliteRetrievalIndex

    class QueryOnlyEmbedder:
        def embed_query(self, _text):
            return [1.0, 0.5]

        def embed_documents(self, _texts):
            pytest.fail("a research query must never embed documents")

    class ReadOnlyCache:
        def get_many(self, chunks, model):
            assert model == "test-model"
            return [[1.0, 0.5] for _ in chunks]

        def put_many(self, *_args):
            pytest.fail("a research query must never write the cache")

    class Reranker:
        def rerank(self, *, query, documents, top_n):
            return tuple(RerankScore(index=i, score=0.9) for i in range(len(documents)))

    retriever = HybridRetriever(
        index=SqliteRetrievalIndex(tmp_path / "unused.db"),
        embedder=QueryOnlyEmbedder(),
        embedding_model="test-model",
        chunk_schema_version="1",
        reranker=Reranker(),
        reranker_model="reranker",
        min_rerank_score=0.1,
    )
    registry = _registry(_Materials(), retriever)
    scopes = []

    def factory(**scope):
        scopes.append(scope)
        return ReadOnlyCache()

    registry._material_vector_cache_factory = factory
    result = registry.search_research_materials("照护变化")
    assert result
    assert scopes == [{"user_id": USER_ID, "parse_ids": {MATERIAL_ID: PARSE_ID}}]


def test_model_change_only_builds_new_model_when_import_is_requested(plain_client):
    client = plain_client
    task_id, first_embedder, scheduled = setup(client)
    body = upload(client, task_id)
    first = process(client, scheduled[-1])
    second_embedder = Embedder()
    client.app.state.research_material_indexer = ResearchMaterialIndexer(
        client.app.state.database, embedder=second_embedder, embedding_model="next-model"
    )
    # Replaying a completed ingestion is not a deployment-triggered backfill.
    assert process(client, first.job_id).ingestion_status.value == "ready"
    assert second_embedder.calls == []
    with client.app.state.research_material_application_scope() as application:
        application.reparse(
            user_id=first.user_id,
            task_id=first.task_id,
            material_id=first.material_id,
            idempotency_key=str(uuid4()),
        )
    updated = process(client, scheduled[-1])
    assert updated.ingestion_status.value == "ready"
    assert len(first_embedder.calls) == len(second_embedder.calls) == 1
    assert "test-model" in vectors(client, body["material_id"], first.parse_id)[0]
    assert "next-model" in vectors(client, body["material_id"], updated.parse_id)[0]


def test_processing_permission_revoked_during_embedding_prevents_checkpoint(
    plain_client, monkeypatch
):
    from qunxue_api.adapters.sqlite.research_material_repository import (
        SqliteResearchMaterialRepository,
    )

    client = plain_client
    task_id, embedder, scheduled = setup(client)
    body = upload(client, task_id)
    embedder.on_call = lambda: monkeypatch.setattr(
        SqliteResearchMaterialRepository, "is_external_model_processable", lambda *_a, **_k: False
    )
    failed = process(client, scheduled[-1])
    assert failed.error_code == "material_indexing_policy_denied"
    assert vectors(client, body["material_id"], failed.parse_id) == [{}]


@pytest.mark.parametrize(
    "reason", ["document vectors are not ready", "embedding service is unavailable"]
)
def test_material_search_reports_unavailable_without_lexical_evidence(reason):
    from test_research_material_agent_tools import _Materials, _registry

    from qunxue_api.adapters.retrieval import RetrievalPipelineUnavailable

    class UnavailableRetriever:
        def search_chunks(self, *, query, chunks, limit, embed_missing_documents=True):
            assert embed_missing_documents is False
            raise RetrievalPipelineUnavailable(reason)

    registry = _registry(_Materials(), UnavailableRetriever())
    result = registry.search_research_materials("照护变化")
    assert result["error"] == "material_indexing_unavailable"
    assert registry.evidence == {}


def test_production_material_search_does_not_use_unconfigured_lexical_retriever():
    from test_research_material_agent_tools import _Materials, _registry

    class LegacyLexicalRetriever:
        def search_chunks(self, *, query, chunks, limit):
            pytest.fail("production search must not silently use a lexical-only retriever")

    registry = _registry(_Materials(), LegacyLexicalRetriever())
    registry._require_material_vectors = True
    assert (
        registry.search_research_materials("照护变化")["error"] == "material_indexing_unavailable"
    )
    assert registry.evidence == {}
