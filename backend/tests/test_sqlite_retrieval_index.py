import math
import sqlite3
import struct
from dataclasses import replace
from pathlib import Path

import pytest

from qunxue_api.adapters.retrieval import (
    RetrievalChunk,
    RetrievalIndexMismatch,
    RetrievalIndexUnavailable,
    SqliteRetrievalIndex,
)


def _index(path: Path) -> SqliteRetrievalIndex:
    return SqliteRetrievalIndex(path)


def _chunks() -> tuple[RetrievalChunk, ...]:
    return (
        RetrievalChunk(
            chunk_id="theory:social-capital:v2:0",
            document_kind="theory_profile",
            knowledge_id="D2:P001",
            theory_id="social-capital",
            content_version=2,
            content_hash="sha256:social-capital-v2",
            title="社会资本理论",
            text="社会资本通过信任、规范和关系网络支持集体行动。",
            source_ids=("source:putnam",),
        ),
        RetrievalChunk(
            chunk_id="theory:symbolic-interaction:v1:0",
            document_kind="theory_profile",
            knowledge_id="D2:P002",
            theory_id="symbolic-interaction",
            content_version=1,
            content_hash="sha256:symbolic-interaction-v1",
            title="符号互动论",
            text="行动者在持续互动中协商意义并形成自我理解。",
            source_ids=("source:mead",),
        ),
    )


def test_rebuild_is_deterministic_and_searches_only_the_pinned_release(
    tmp_path: Path,
) -> None:
    index = _index(tmp_path / "retrieval.db")
    chunks = _chunks()

    first = index.rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="Pro/BAAI/bge-m3",
        chunk_schema_version="theory-profile-v1",
        chunks=chunks,
        vectors=((1.0, 0.0), (0.0, 1.0)),
    )
    second = index.rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="Pro/BAAI/bge-m3",
        chunk_schema_version="theory-profile-v1",
        chunks=chunks,
        vectors=((1.0, 0.0), (0.0, 1.0)),
    )

    assert first == second
    assert first.point_count == 2
    assert first.vector_dimension == 2
    assert first.status == "ready"
    assert index.search(
        retrieval_index_id=first.retrieval_index_id,
        knowledge_release_id="release-reviewed-v1",
        query_vector=(0.9, 0.1),
        document_kind="theory_profile",
        limit=2,
    )[0].chunk.chunk_id == "theory:social-capital:v2:0"

    with pytest.raises(RetrievalIndexMismatch, match="knowledge release"):
        index.search(
            retrieval_index_id=first.retrieval_index_id,
            knowledge_release_id="release-other",
            query_vector=(0.9, 0.1),
            document_kind="theory_profile",
            limit=2,
        )


def test_manifest_identity_ignores_provider_float_jitter_and_ready_points_are_immutable(
    tmp_path: Path,
) -> None:
    chunks = _chunks()
    first_index = _index(tmp_path / "first.db")
    first = first_index.rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="Pro/BAAI/bge-m3",
        chunk_schema_version="theory-profile-v1",
        chunks=chunks,
        vectors=((1.0, 0.0), (0.0, 1.0)),
    )

    repeated = first_index.rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="Pro/BAAI/bge-m3",
        chunk_schema_version="theory-profile-v1",
        chunks=chunks,
        vectors=((0.999, 0.001), (0.001, 0.999)),
    )
    rebuilt_elsewhere = _index(tmp_path / "second.db").rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="Pro/BAAI/bge-m3",
        chunk_schema_version="theory-profile-v1",
        chunks=chunks,
        vectors=((0.999, 0.001), (0.001, 0.999)),
    )

    assert repeated == first
    assert rebuilt_elsewhere == first
    assert first_index.search(
        retrieval_index_id=first.retrieval_index_id,
        knowledge_release_id="release-reviewed-v1",
        query_vector=(1.0, 0.0),
        document_kind="theory_profile",
        limit=1,
    )[0].score == 1.0


def test_rebuild_rejects_vectors_with_inconsistent_dimensions(tmp_path: Path) -> None:
    index = _index(tmp_path / "retrieval.db")

    with pytest.raises(ValueError, match="vector dimension"):
        index.rebuild(
            knowledge_release_id="release-reviewed-v1",
            release_content_hash="sha256:release-reviewed-v1",
            embedding_model="Pro/BAAI/bge-m3",
            chunk_schema_version="theory-profile-v1",
            chunks=_chunks(),
            vectors=((1.0, 0.0), (0.0, 1.0, 0.0)),
        )


@pytest.fixture
def ready_index(tmp_path):
    path = tmp_path / "retrieval.db"
    index = _index(path)
    manifest = index.rebuild(
        knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1",
        embedding_model="fixture",
        chunk_schema_version="fixture-v1",
        chunks=_chunks(),
        vectors=((1.0, 0.0), (0.0, 1.0)),
    )
    return index, manifest, path


def _search_ready(ready_index, vector, *, document_kind=None, limit=2):
    index, manifest, _path = ready_index
    return index.search(
        retrieval_index_id=manifest.retrieval_index_id,
        knowledge_release_id=manifest.knowledge_release_id,
        query_vector=vector,
        document_kind=document_kind,
        limit=limit,
    )


@pytest.mark.parametrize(
    "vector",
    [(0.0, 0.0), (math.nan, 1.0),
     (math.inf, 1.0), (-math.inf, 1.0), ("invalid", 1.0), (None, 1.0),
     (10**1000, 1.0), None],
)
def test_invalid_query_fails_through_the_index_error_contract(ready_index, vector):
    with pytest.raises(ValueError):
        _search_ready(ready_index, vector)


@pytest.mark.parametrize("vector", [(), (1.0,), (1.0, 0.0, 0.0)])
def test_query_dimension_mismatch_preserves_existing_error(ready_index, vector):
    with pytest.raises(RetrievalIndexMismatch, match="query vector dimension"):
        _search_ready(ready_index, vector)


def test_zero_query_error_and_zero_stored_score_are_preserved(ready_index):
    with pytest.raises(ValueError, match="query vector must not be zero"):
        _search_ready(ready_index, (0.0, 0.0))
    _index, _manifest, path = ready_index
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE retrieval_points SET vector = ?", (struct.pack("<2f", 0, 0),))
    assert [hit.score for hit in _search_ready(ready_index, (1.0, 0.0))] == [0.0, 0.0]


@pytest.mark.parametrize("scale", [1.0, 1e308, 1e-300, 5e-324])
def test_finite_nonzero_query_scale_preserves_scores_and_tie_order(ready_index, scale):
    hits = _search_ready(ready_index, (scale, scale))
    assert [hit.chunk.chunk_id for hit in hits] == sorted(chunk.chunk_id for chunk in _chunks())
    assert [hit.score for hit in hits] == pytest.approx([math.sqrt(0.5)] * 2)
    assert all(math.isfinite(hit.score) and -1.0 <= hit.score <= 1.0 for hit in hits)


@pytest.mark.parametrize(
    "blob",
    [b"", b"abc", struct.pack("<f", 1.0), struct.pack("<3f", 1.0, 0.0, 0.0),
     struct.pack("<2f", math.nan, 1.0),
     struct.pack("<2f", math.inf, 1.0), struct.pack("<2f", -math.inf, 1.0),
     "abcd", 1234],
)
def test_corrupt_stored_vector_fails_instead_of_returning_partial_results(ready_index, blob):
    _index, manifest, path = ready_index
    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE retrieval_points SET vector = ? WHERE chunk_id = ?",
            (blob, _chunks()[1].chunk_id),
        )
    # Even the bad candidate outside top one must not silently change the ranking.
    with pytest.raises(RetrievalIndexUnavailable, match="stored vector"):
        _search_ready(ready_index, (1.0, 0.0), limit=1)


@pytest.mark.parametrize("dimension", [0, -1, 1.5, "invalid"])
def test_corrupt_manifest_dimension_fails_explicitly(ready_index, dimension):
    _index, _manifest, path = ready_index
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE retrieval_indexes SET vector_dimension = ?", (dimension,))
    with pytest.raises(RetrievalIndexUnavailable):
        _search_ready(ready_index, (1.0, 0.0))


@pytest.mark.parametrize("table", ["retrieval_points", "retrieval_indexes"])
def test_query_storage_errors_are_explicit_index_failures(ready_index, table):
    _index, _manifest, path = ready_index
    with sqlite3.connect(path) as connection:
        connection.execute(f"DROP TABLE {table}")
    with pytest.raises(RetrievalIndexUnavailable) as caught:
        _search_ready(ready_index, (1.0, 0.0))
    assert isinstance(caught.value.__cause__, sqlite3.Error)


def test_normal_scores_filters_limits_and_release_identity_are_preserved(ready_index):
    index, manifest, path = ready_index
    assert [hit.score for hit in _search_ready(ready_index, (-1.0, 0.0))] == [0.0, -1.0]
    assert _search_ready(ready_index, (1.0, 0.0), document_kind="not-present") == ()
    assert len(_search_ready(ready_index, (1.0, 0.0), limit=0)) == 1
    hits = _search_ready(ready_index, (3.0, 4.0))
    assert [hit.score for hit in hits] == pytest.approx([0.8, 0.6])
    assert hits[0].chunk == _chunks()[1]
    with pytest.raises(RetrievalIndexMismatch, match="knowledge release"):
        index.search(
            retrieval_index_id=manifest.retrieval_index_id,
            knowledge_release_id="other-release",
            query_vector=(1.0, 0.0), document_kind=None, limit=2,
        )
    # Existing dimension and kind filters still isolate unrelated corrupt data.
    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE retrieval_points SET document_kind = 'unrelated', vector = 'bad' "
            "WHERE chunk_id = ?", (_chunks()[1].chunk_id,),
        )
    assert len(_search_ready(ready_index, (1.0, 0.0), document_kind="theory_profile")) == 1


@pytest.mark.parametrize("scale", [1.0, 3e38, 1e-40])
def test_float32_storage_range_has_finite_comparable_scores(tmp_path, scale):
    index = _index(tmp_path / "range.db")
    chunks = tuple(replace(_chunks()[0], chunk_id=f"chunk:{i}") for i in range(3))
    manifest = index.rebuild(
        knowledge_release_id="fixture", release_content_hash="fixture", embedding_model="fixture",
        chunk_schema_version="fixture", chunks=chunks,
        vectors=((scale, scale), (scale, 0.0), (-scale, -scale)),
    )
    hits = index.search(
        retrieval_index_id=manifest.retrieval_index_id, knowledge_release_id="fixture",
        query_vector=(scale, scale), document_kind=None, limit=3,
    )
    assert [hit.chunk.chunk_id for hit in hits] == ["chunk:0", "chunk:1", "chunk:2"]
    assert [hit.score for hit in hits] == pytest.approx([1.0, math.sqrt(0.5), -1.0])
    assert all(math.isfinite(hit.score) and -1.0 <= hit.score <= 1.0 for hit in hits)


@pytest.mark.parametrize(
    ("column", "value"),
    [("source_ids_json", "{bad json"), ("source_ids_json", "null"),
     ("content_version", "not-an-int")],
)
def test_corrupt_point_metadata_is_an_explicit_index_failure(ready_index, column, value):
    _index, _manifest, path = ready_index
    with sqlite3.connect(path) as connection:
        connection.execute(f"UPDATE retrieval_points SET {column} = ?", (value,))
    with pytest.raises(RetrievalIndexUnavailable, match="stored retrieval point"):
        _search_ready(ready_index, (1.0, 0.0))


@pytest.mark.parametrize("vector", [(0.0, 0.0), (math.nan, 1.0), (math.inf, 1.0),
                                    ("invalid", 1.0), (10**1000, 1.0), None])
def test_invalid_query_is_explicit_at_hybrid_boundary_without_lexical_fallback(ready_index, vector):
    from qunxue_api.adapters.retrieval import HybridRetriever, RetrievalPipelineUnavailable

    class Embedder:
        def embed_query(self, query):
            assert query == "社会资本理论"
            return vector

    class Reranker:
        def rerank(self, **kwargs):
            pytest.fail("invalid semantic input must not return lexical-only evidence")

    index, _manifest, _path = ready_index
    retriever = HybridRetriever(
        index=index, embedder=Embedder(), embedding_model="fixture",
        chunk_schema_version="fixture-v1", reranker=Reranker(), reranker_model="fixture",
        min_rerank_score=0.0,
    )
    with pytest.raises(RetrievalPipelineUnavailable, match="invalid vector") as caught:
        retriever.search(
            query="社会资本理论", knowledge_release_id="release-reviewed-v1",
            release_content_hash="sha256:release-reviewed-v1", document_kind=None, limit=2,
        )
    assert isinstance(caught.value.__cause__, ValueError)


@pytest.mark.parametrize("failure", ["vector", "storage"])
def test_hybrid_keeps_corrupt_index_failure_explicit(ready_index, failure):
    from qunxue_api.adapters.retrieval import HybridRetriever, RetrievalPipelineUnavailable

    index, _manifest, path = ready_index

    class Embedder:
        def embed_query(self, query):
            # Corruption after preflight/list_chunks exercises search's own error boundary.
            with sqlite3.connect(path) as connection:
                if failure == "vector":
                    connection.execute("UPDATE retrieval_points SET vector = 'bad'")
                else:
                    connection.execute("DROP TABLE retrieval_points")
            return [1.0, 0.0]

    class Reranker:
        def rerank(self, **kwargs):
            pytest.fail("corrupt index must not return partial or lexical-only evidence")

    retriever = HybridRetriever(
        index=index, embedder=Embedder(), embedding_model="fixture",
        chunk_schema_version="fixture-v1", reranker=Reranker(), reranker_model="fixture",
        min_rerank_score=0.0,
    )
    with pytest.raises(RetrievalPipelineUnavailable, match="index is unavailable") as caught:
        retriever.search(
            query="社会资本理论", knowledge_release_id="release-reviewed-v1",
            release_content_hash="sha256:release-reviewed-v1", document_kind=None, limit=2,
        )
    assert isinstance(caught.value.__cause__, RetrievalIndexUnavailable)


@pytest.mark.parametrize("query", ["", "  ", "社会资本理论"])
def test_query_text_and_valid_semantic_pipeline_remain_unchanged(ready_index, query):
    from qunxue_api.adapters.research_agent.reranker import RerankScore
    from qunxue_api.adapters.retrieval import HybridRetriever

    class Embedder:
        def embed_query(self, text):
            assert text == query
            return [1.0, 0.0]

    class Reranker:
        def rerank(self, *, query: str, documents, top_n):
            assert len(documents) == top_n == 2
            return (RerankScore(index=0, score=0.9), RerankScore(index=1, score=0.8))

    index, _manifest, _path = ready_index
    result = HybridRetriever(
        index=index, embedder=Embedder(), embedding_model="fixture",
        chunk_schema_version="fixture-v1", reranker=Reranker(), reranker_model="fixture",
        min_rerank_score=0.0,
    ).search(
        query=query, knowledge_release_id="release-reviewed-v1",
        release_content_hash="sha256:release-reviewed-v1", document_kind=None, limit=2,
    )
    assert result.degraded_reason is None
    assert result.mode.endswith("_reranked")
    assert {hit.chunk for hit in result.hits} == set(_chunks())


@pytest.mark.parametrize("stage", ["embedder", "hit"])
def test_hybrid_input_mapping_does_not_hide_unrelated_value_errors(ready_index, monkeypatch, stage):
    from qunxue_api.adapters.retrieval import HybridRetriever

    expected = ValueError("unrelated implementation failure")

    class Embedder:
        def embed_query(self, text):
            if stage == "embedder":
                raise expected
            return [1.0, 0.0]

    class BadHit:
        chunk = _chunks()[0]

        @property
        def score(self):
            raise expected

    class Reranker:
        def rerank(self, **kwargs):
            pytest.fail("failed stage must stop before reranking")

    index, _manifest, _path = ready_index
    monkeypatch.setattr(index, "search", lambda **kwargs: [BadHit()])
    retriever = HybridRetriever(
        index=index, embedder=Embedder(), embedding_model="fixture",
        chunk_schema_version="fixture-v1", reranker=Reranker(), reranker_model="fixture",
        min_rerank_score=0.0,
    )
    with pytest.raises(ValueError) as caught:
        retriever.search(
            query="社会资本理论", knowledge_release_id="release-reviewed-v1",
            release_content_hash="sha256:release-reviewed-v1", document_kind=None, limit=2,
        )
    assert caught.value is expected
