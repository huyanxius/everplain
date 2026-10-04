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

    def bind_owned(self, *, user_id, tools):
        """Ordinary chat searches existing owner documents only, on tool demand."""
        tools.private_knowledge = _PrivateKnowledgeTools(self, user_id, None, tools)

    def document_scope(self, user_id, kb_id):
        libraries = (
            (self.application.require_read(user_id, kb_id),)
            if kb_id is not None
            else tuple(
                kb for kb in self.application.libraries(user_id) if kb.owner_user_id == user_id
            )
        )
        # A document can be linked from several libraries. Keep its original
        # identity once, with a live library coordinate for source navigation.
        return {
            doc.id: (kb, doc)
            for kb in libraries
            for doc in self.application.documents(user_id, kb.id, ready_only=True)
            if kb_id is not None or doc.owner_user_id == user_id
        }

    def search(self, *, user_id, kb_id, query, tools, limit=8):
        scope = self.document_scope(user_id, kb_id)
        documents = tuple(doc for _, doc in scope.values())
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
        mode, failure, degraded_reason = "lexical", None, None
        if callable(search) and chunks:
            try:
                options = {}
                if "vector_cache" in signature(search).parameters:
                    options["vector_cache"] = self.application.repository.vector_cache(documents)
                if kb_id is None and "embed_missing_documents" in signature(search).parameters:
                    options["embed_missing_documents"] = False
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
                degraded_reason = getattr(result, "degraded_reason", None)
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
        # Retrieval may run slowly. Recheck revocation and document removal before
        # handing fresh excerpts to the model, not just at the start of the call.
        current_scope = self.document_scope(user_id, kb_id)
        current_documents = {(str(doc.id), str(doc.parse_id)) for _, doc in current_scope.values()}
        selected = [
            key
            for key in selected
            if (str(coordinates[key][0].id), str(coordinates[key][0].parse_id)) in current_documents
        ]
        items = []
        for key in selected:
            doc, segment = coordinates[key]
            kb = current_scope[doc.id][0]
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
                    "retrieval_mode": mode,
                    "degraded_reason": degraded_reason,
                }
            )
        tools.select_evidence((*tools.selected_evidence_ids, *selected))
        tools.shared_reference_context = {
            "knowledge_base_name": (
                self.application.require_read(user_id, kb_id).name
                if kb_id is not None
                else "我的全部知识库"
            ),
            "items": items,
            "retrieval_mode": mode,
            "degraded_reason": degraded_reason,
            "error": failure,
        }
        # Release any cache writes before model telemetry opens another SQLite writer.
        self.application.repository.commit()
        return items

    def filter_history(self, *, user_id, kb_id, turns):
        if not any(
            citation.source_kind == "shared_material"
            for turn in turns
            for citation in turn.assistant_message.citations
        ):
            return tuple(turns)
        allowed = {
            (str(doc.id), str(doc.parse_id))
            for _, doc in self.document_scope(user_id, kb_id).values()
        }
        result = []
        source_was_removed = False
        for turn in turns:
            removed = {
                c.citation_id
                for c in turn.assistant_message.citations
                if c.source_kind == "shared_material" and (c.material_id, c.parse_id) not in allowed
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
        return tuple(
            doc for _, doc in self.references.document_scope(self.user_id, self.kb_id).values()
        )

    def read(self, knowledge_id):
        # A document id starts at its first segment. The returned continuation id
        # makes long-file reading explicit, with a bounded amount per tool call.
        for kb, doc in self.references.document_scope(self.user_id, self.kb_id).values():
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
                    knowledge_base_id=str(kb.id),
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
        allowed_documents = {
            (str(doc.id), str(doc.parse_id), str(kb.id))
            for kb, doc in self.references.document_scope(self.user_id, self.kb_id).values()
        }
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
            and (evidence.material_id, evidence.parse_id, evidence.knowledge_base_id)
            in allowed_documents
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
