"""Feed an authorized document set to the existing transient-chunk retriever."""

from dataclasses import replace
from inspect import signature

from qunxue_api.adapters.research_agent.retrieval import lexical_relevance_score
from qunxue_api.adapters.retrieval import RetrievalChunk, RetrievalPipelineUnavailable
from qunxue_api.modules.agent_conversation import AgentEvidence


class SharedKnowledgeReferences:
    def __init__(self, application, retriever):
        self.application = application
        self.retriever = retriever
        self.removed_citation_ids: set[str] = set()

    def prepare(self, *, user_id, kb_id, query, tools):
        tools.private_knowledge = _PrivateKnowledgeTools(self, user_id, kb_id, tools)
        return self.search(user_id=user_id, kb_id=kb_id, query=query, tools=tools)

    def search(self, *, user_id, kb_id, query, tools, limit=8):
        kb = self.application.require_read(user_id, kb_id)
        documents = self.application.documents(user_id, kb_id, ready_only=True)
        chunks, coordinates = [], {}
        for doc in documents:
            for segment in doc.segments:
                key = f"material:{doc.id}:{segment['segment_id']}"
                chunk = RetrievalChunk(
                    chunk_id=key,
                    document_kind="research_material",
                    knowledge_id=None,
                    theory_id=None,
                    content_version=1,
                    content_hash=segment["content_hash"],
                    title=doc.filename,
                    text=segment["text"],
                    source_ids=(key,),
                )
                chunks.append(chunk)
                coordinates[key] = (doc, segment)
        search = getattr(self.retriever, "search_chunks", None)
        mode, failure = "lexical", None
        if callable(search) and chunks:
            try:
                options = {}
                if "vector_cache" in signature(search).parameters:
                    options["vector_cache"] = self.application.repository.vector_cache(documents)
                result = search(
                    query=query,
                    chunks=tuple(chunks),
                    limit=max(1, min(limit, 20)),
                    **options,
                )
                # Custom retrievers can only return identities in the authorized set.
                selected = [
                    hit.chunk.chunk_id for hit in result.hits if hit.chunk.chunk_id in coordinates
                ]
                mode = result.mode
            except RetrievalPipelineUnavailable:
                selected = []
                failure = "知识库检索暂时失败，本轮未取得资料依据。"
        else:
            ranked = sorted(
                (
                    (lexical_relevance_score(query, title=c.title, text=c.text), c.chunk_id)
                    for c in chunks
                ),
                reverse=True,
            )
            selected = [key for score, key in ranked if score > 0][: max(1, min(limit, 20))]
        items = []
        for key in selected:
            doc, segment = coordinates[key]
            evidence = AgentEvidence(
                citation_id=key,
                label=f"{kb.name} · {doc.filename}",
                kind="research_material",
                excerpt=segment["text"],
                source_kind="shared_material",
                source_id=key,
                material_id=str(doc.id),
                parse_id=str(doc.parse_id),
                segment_id=segment["segment_id"],
                locator=segment["locator"],
                knowledge_base_id=str(kb.id),
            )
            tools.evidence[key] = evidence
            items.append(
                {
                    "citation_id": key,
                    "knowledge_id": str(doc.id),
                    "title": doc.filename,
                    "label": evidence.label,
                    "excerpt": evidence.excerpt,
                    "locator": segment["locator"],
                    "source_kind": "shared_material",
                }
            )
        tools.select_evidence((*tools.selected_evidence_ids, *selected))
        tools.shared_reference_context = {
            "knowledge_base_name": kb.name,
            "items": items,
            "retrieval_mode": mode,
            "error": failure,
        }
        # Release any cache writes before model telemetry opens another SQLite writer.
        self.application.repository.commit()
        return items

    def filter_history(self, *, user_id, kb_id, turns):
        allowed = {
            str(doc.id) for doc in self.application.documents(user_id, kb_id, ready_only=True)
        }
        result = []
        source_was_removed = False
        for turn in turns:
            removed = {
                c.citation_id
                for c in turn.assistant_message.citations
                if c.source_kind == "shared_material" and c.material_id not in allowed
            }
            self.removed_citation_ids.update(removed)
            unavailable = bool(removed)
            source_was_removed = source_was_removed or unavailable
            if source_was_removed:
                # Later uncited answers may paraphrase removed sources. Keep the
                # UI history, but stop replaying this derived content to the model.
                turn = replace(
                    turn,
                    assistant_message=replace(
                        turn.assistant_message,
                        content="该轮引用的资料已删除，本轮不能继续作为依据。",
                        citations=(),
                    ),
                    tool_summary=(),
                )
            result.append(turn)
        return tuple(result)


class _PrivateKnowledgeTools:
    """Every read rechecks membership and document state, including within one run."""

    def __init__(self, references, user_id, kb_id, tools):
        self.references = references
        self.user_id, self.kb_id, self.tools = user_id, kb_id, tools

    def prompt_map(self, current):
        removed = self.references.removed_citation_ids
        if any(
            removed.intersection(node.get("citation_ids", [])) for node in current.get("nodes", [])
        ):
            # Canvas summaries can derive from each other. Withhold this old
            # context from the model while preserving the user's saved canvas.
            return {"schema_version": 1, "nodes": [], "relations": []}
        return current

    def search(self, query, *, limit=8):
        return self.references.search(
            user_id=self.user_id, kb_id=self.kb_id, query=query, tools=self.tools, limit=limit
        )

    def _documents(self):
        self.references.application.require_read(self.user_id, self.kb_id)
        return self.references.application.documents(self.user_id, self.kb_id, ready_only=True)

    def read(self, knowledge_id):
        # A document id starts at its first segment. The returned continuation id
        # makes long-file reading explicit, with a bounded amount per tool call.
        for doc in self._documents():
            segments = list(doc.segments)
            start = (
                0
                if knowledge_id == str(doc.id)
                else next(
                    (
                        index
                        for index, segment in enumerate(segments)
                        if knowledge_id == f"material:{doc.id}:{segment['segment_id']}"
                    ),
                    -1,
                )
            )
            if start < 0:
                continue
            selected = []
            size = 0
            for segment in segments[start:]:
                if selected and size + len(segment["text"]) > 14000:
                    break
                selected.append(segment)
                size += len(segment["text"])
            citations = []
            for segment in selected:
                key = f"material:{doc.id}:{segment['segment_id']}"
                self.tools.evidence[key] = AgentEvidence(
                    citation_id=key,
                    label=doc.filename,
                    kind="research_material",
                    excerpt=segment["text"],
                    source_kind="shared_material",
                    source_id=key,
                    material_id=str(doc.id),
                    parse_id=str(doc.parse_id),
                    segment_id=segment["segment_id"],
                    locator=segment["locator"],
                    knowledge_base_id=str(self.kb_id),
                )
                citations.append(key)
            self.tools.select_evidence((*self.tools.selected_evidence_ids, *citations))
            next_index = start + len(selected)
            return {
                "knowledge_id": str(doc.id),
                "title": doc.filename,
                "content": "\n\n".join(segment["text"] for segment in selected),
                "source_ids": citations,
                "citation_ids": citations,
                "next_knowledge_id": (
                    f"material:{doc.id}:{segments[next_index]['segment_id']}"
                    if next_index < len(segments)
                    else None
                ),
                "evidence_status": "read",
                "source_kind": "shared_material",
            }
        return {"error": "knowledge_entry_not_found", "knowledge_id": knowledge_id}

    def sources(self, source_ids):
        allowed_documents = {str(doc.id) for doc in self._documents()}
        return [
            {
                "source_id": key,
                "citation_id": key,
                "title": evidence.label,
                "content": evidence.excerpt,
                "locator": evidence.locator,
                "source_kind": "shared_material",
            }
            for key in source_ids
            if (evidence := self.tools.evidence.get(key)) is not None
            and evidence.knowledge_base_id == str(self.kb_id)
            and evidence.material_id in allowed_documents
        ]

    def directory(self, query=None, *, limit=24):
        documents = self._documents()
        if query:
            documents = [doc for doc in documents if query.casefold() in doc.filename.casefold()]
        return [
            {
                "knowledge_id": str(doc.id),
                "title": doc.filename,
                "segment_count": len(doc.segments),
                "source_kind": "shared_material",
            }
            for doc in documents[: max(1, min(limit, 40))]
        ]
