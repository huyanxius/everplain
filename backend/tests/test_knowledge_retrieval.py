"""Shared retrieval primitives and explicit legacy-catalog compatibility boundaries."""

from types import SimpleNamespace

import pytest
from sqlalchemy import text

from qunxue_api.adapters.empty_catalog import EmptyKnowledgeCatalog
from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.adapters.research_agent.retrieval import (
    RetrievalCandidate,
    fuzzy_match_score,
    normalize_query,
    rrf_fuse,
)
from qunxue_api.adapters.retrieval import RetrievalChunk
from qunxue_api.adapters.retrieval.hybrid import (
    HybridRetrievalHit,
    HybridRetrievalResult,
)
from qunxue_api.adapters.theory_evidence import (
    CatalogTheoryEvidenceSource,
    CatalogTheoryLexicalRetriever,
)
from qunxue_api.modules.knowledge_catalog import KnowledgeReleaseLevel, KnowledgeReleaseRef


def test_normalize_query_collapses_punctuation_and_case_for_fuzzy_matching() -> None:
    assert normalize_query("  符号互动论？  ") == "符号互动论"
    assert normalize_query("Symbolic-Interactionism") == "symbolicinteractionism"


def test_fuzzy_match_score_accepts_typo_and_alias_without_exact_keyword() -> None:
    score = fuzzy_match_score(
        "那个研究人如何通过互动形成自我理解的理论",
        title="符号互动论",
        aliases=("Symbolic Interactionism", "互动论"),
        text="关注符号、互动与自我意义建构。",
    )

    assert score >= 0.35


def test_rrf_fuse_merges_lexical_and_semantic_rankings_without_score_scale_assumptions() -> None:
    lexical = [
        RetrievalCandidate("knowledge:a", 0.98, "lexical"),
        RetrievalCandidate("knowledge:b", 0.80, "lexical"),
    ]
    semantic = [
        RetrievalCandidate("knowledge:b", 0.91, "semantic"),
        RetrievalCandidate("knowledge:c", 0.89, "semantic"),
    ]

    fused = rrf_fuse((lexical, semantic), limit=3)

    assert [item.citation_id for item in fused] == [
        "knowledge:b",
        "knowledge:a",
        "knowledge:c",
    ]
    assert fused[0].sources == ("lexical", "semantic")


def test_lexical_fallback_returns_no_hits_when_query_has_no_relevance() -> None:
    chunk = RetrievalChunk(
        chunk_id="knowledge:alienation",
        document_kind="knowledge_entry",
        knowledge_id="D1:C001",
        theory_id=None,
        content_version=1,
        content_hash="sha256:alienation",
        title="异化劳动",
        text="劳动者与劳动产品之间的结构性分离。",
        source_ids=(),
    )

    result = CatalogTheoryLexicalRetriever._lexical_result(
        query="qzxv",
        chunks=(chunk,),
        limit=3,
        retrieval_index_id="catalog-lexical:test",
    )

    assert result.hits == ()


class _ExplicitLegacyCatalog:
    """A caller-supplied historical adapter, never the default personal catalog."""

    def __init__(self, level: KnowledgeReleaseLevel) -> None:
        self.release = KnowledgeReleaseRef(
            knowledge_release_id=f"legacy-{level.value}-v1",
            level=level,
            content_hash=f"sha256:legacy-{level.value}-v1",
        )
        self.calls = []
        self.detail = SimpleNamespace(
            summary=SimpleNamespace(
                knowledge_id="D2:P001", content_version=2, title="社区互助",
            ),
            aliases=("互助网络",),
            content="社区互助通过持续联系与互惠规范支持行动。",
            sources=(SimpleNamespace(
                source_id="source:synthetic-community", title="合成互助记录",
                use_boundary="仅用于测试来源追溯。",
            ),),
            theory_profile=None,
        )

    def current_release(self, *, purpose):
        self.calls.append(purpose.value)
        if purpose.value == "match" and self.release.level is not KnowledgeReleaseLevel.FINAL:
            raise LookupError("no final MATCH release")
        return self.release

    def list_rag_entries(self, *, release_id):
        assert release_id == self.release.knowledge_release_id
        return (self.detail,)

    def list_match_profiles(self, *, release_id):
        assert release_id == self.release.knowledge_release_id
        return ()

    def get_entry(self, *, knowledge_id, release_id):
        assert release_id == self.release.knowledge_release_id
        assert knowledge_id == self.detail.summary.knowledge_id
        return self.detail


def _assert_traceable_lexical_result(registry):
    results = registry.search_knowledge("社区互助")
    assert len(results) == 1
    hit = results[0]
    assert hit["knowledge_id"] == "D2:P001"
    assert hit["chunk_id"] == "knowledge-entry:D2:P001:v2:0"
    assert "持续联系与互惠规范" in hit["excerpt"]
    assert hit["retrieval_mode"] == "catalog_lexical"
    assert hit["retrieval_sources"] == ["lexical"]
    assert hit["embedding_model"] == "not_configured"
    assert hit["reranker_model"] is None
    assert hit["retrieval_index_id"].startswith(
        f"catalog-lexical:{registry.release.knowledge_release_id}:"
    )
    assert hit["source_citation_ids"] == ["source:source:synthetic-community"]
    assert registry.evidence[hit["citation_id"]].knowledge_id == "D2:P001"
    assert registry.evidence[hit["source_citation_ids"][0]].label == "合成互助记录"


def test_explicit_legacy_catalog_uses_traceable_lexical_retrieval_without_hybrid() -> None:
    catalog = _ExplicitLegacyCatalog(KnowledgeReleaseLevel.FINAL)
    registry = KnowledgeToolRegistry(catalog)

    _assert_traceable_lexical_result(registry)

    assert catalog.calls == ["match"]
    assert registry.release == catalog.release


def test_explicit_legacy_preview_can_be_browsed_without_becoming_a_final_release() -> None:
    catalog = _ExplicitLegacyCatalog(KnowledgeReleaseLevel.PREVIEW)
    registry = KnowledgeToolRegistry(catalog)

    _assert_traceable_lexical_result(registry)

    assert catalog.calls == ["match", "browse"]
    assert registry.release == catalog.release
    assert registry.release.level is KnowledgeReleaseLevel.PREVIEW


def test_default_empty_catalog_never_searches_inherited_legacy_rows(client) -> None:
    catalog = client.app.state.knowledge_catalog
    assert isinstance(catalog, EmptyKnowledgeCatalog)
    with client.app.state.database.session() as session:
        legacy_count = session.execute(
            text("SELECT COUNT(*) FROM knowledge_entry_revisions")
        ).scalar_one()
        assert legacy_count > 0
    calls = []

    class Retriever:
        def require_ready_manifest(self, **kwargs):
            calls.append(("manifest", kwargs))
            raise AssertionError("default empty catalog must not open a legacy index")

        def search(self, **kwargs):
            calls.append(("search", kwargs))
            raise AssertionError("default empty catalog must not retrieve legacy content")

    registry = KnowledgeToolRegistry(catalog, retriever=Retriever())

    assert registry.catalog_available is False
    assert registry.release.level is KnowledgeReleaseLevel.WORKING
    assert registry.release.knowledge_release_id == "everplain-personal-v1"
    assert registry.search_knowledge("历史唯物主义") == []
    assert registry.read_knowledge_entry("D1:C001")["error"] == "knowledge_entry_not_found"
    assert registry.evidence == {}
    assert calls == []


def test_match_evidence_rejects_preview_before_reading_catalog_or_retrieving() -> None:
    calls = []

    class Catalog:
        def list_match_profiles(self, **kwargs):
            calls.append(("catalog", kwargs))
            raise AssertionError("MATCH must reject preview before reading profiles")

    class Retriever:
        def search(self, **kwargs):
            calls.append(("retriever", kwargs))
            raise AssertionError("MATCH must reject preview before retrieval")

    preview = KnowledgeReleaseRef(
        knowledge_release_id="explicit-legacy-preview",
        level=KnowledgeReleaseLevel.PREVIEW,
        content_hash="sha256:preview",
    )
    with pytest.raises(ValueError, match="final MATCH knowledge release"):
        CatalogTheoryEvidenceSource(Catalog(), retriever=Retriever()).retrieve(
            phenomenon=SimpleNamespace(), release=preview,
        )
    assert calls == []


def test_knowledge_search_maps_hybrid_chunks_to_auditable_evidence() -> None:
    release = SimpleNamespace(
        knowledge_release_id="release-reviewed-v1",
        content_hash="sha256:release-reviewed-v1",
    )
    source = SimpleNamespace(
        source_id="source:putnam",
        title="Bowling Alone",
        locator="Chapter 1",
        url="https://example.com/bowling-alone",
        verification_status=SimpleNamespace(value="verified"),
        use_boundary="仅支持社会资本与持续关系网络的命题。",
    )
    summary = SimpleNamespace(
        knowledge_id="D2:P001",
        content_version=2,
        title="社会资本理论",
        category="中层理论",
        dimension="关系结构",
        eligibility=SimpleNamespace(rag_eligible=True),
    )
    detail = SimpleNamespace(
        summary=summary,
        aliases=("社会资本",),
        content="信任、互惠规范和持续关系网络支持集体行动。",
        sources=(source,),
    )
    calls: list[dict[str, object]] = []

    class Catalog:
        def current_release(self, *, purpose):
            del purpose
            return release

        def get_entry(self, *, knowledge_id, release_id):
            assert knowledge_id == summary.knowledge_id
            assert release_id == release.knowledge_release_id
            return detail

    class Retriever:
        def search(self, **kwargs):
            calls.append(kwargs)
            return HybridRetrievalResult(
                retrieval_index_id="retrieval-index:reviewed-v1",
                mode="hybrid_reranked",
                embedding_model="Pro/BAAI/bge-m3",
                reranker_model="Pro/BAAI/bge-reranker-v2-m3",
                degraded_reason=None,
                hits=(
                    HybridRetrievalHit(
                        chunk=RetrievalChunk(
                            chunk_id="theory-profile:social-capital:v2",
                            document_kind="theory_profile",
                            knowledge_id=summary.knowledge_id,
                            theory_id="social-capital",
                            content_version=2,
                            content_hash="sha256:social-capital-v2",
                            title=summary.title,
                            text="社会资本理论解释持续关系如何支持社区互助。",
                            source_ids=(source.source_id,),
                        ),
                        fused_score=0.031,
                        retrieval_sources=("lexical", "semantic"),
                        rerank_score=0.93,
                    ),
                ),
            )

    registry = KnowledgeToolRegistry(Catalog(), retriever=Retriever())
    results = registry.search_knowledge("成员流动后社区互助为什么减少？")

    assert calls == [
        {
            "query": "成员流动后社区互助为什么减少？",
            "knowledge_release_id": release.knowledge_release_id,
            "release_content_hash": release.content_hash,
            "document_kind": None,
            "limit": 5,
        }
    ]
    assert results == [
        {
            "citation_id": "retrieval:theory-profile:social-capital:v2",
            "knowledge_id": "D2:P001",
            "theory_id": "social-capital",
            "chunk_id": "theory-profile:social-capital:v2",
            "title": "社会资本理论",
            "excerpt": "社会资本理论解释持续关系如何支持社区互助。",
            "retrieval_index_id": "retrieval-index:reviewed-v1",
            "retrieval_mode": "hybrid_reranked",
            "retrieval_sources": ["lexical", "semantic"],
            "rerank_score": 0.93,
            "embedding_model": "Pro/BAAI/bge-m3",
            "reranker_model": "Pro/BAAI/bge-reranker-v2-m3",
            "source_citation_ids": ["source:source:putnam"],
            "evidence_status": "verified",
        }
    ]
    assert registry.evidence["retrieval:theory-profile:social-capital:v2"].kind == "theory"
    assert registry.evidence["source:source:putnam"].label == "Bowling Alone"
