"""Closed projections for server-owned JSON; user content is explicitly distinguished.

A string is content, never searched for forbidden words. A structured object only
exports declared keys, recursively. Dynamic maps are only used for documented
user-defined keys or identifier-indexed records, with a closed value shape.
"""

import base64
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID


@dataclass(frozen=True)
class ListOf:
    item: object


@dataclass(frozen=True)
class MapOf:
    value: object


@dataclass(frozen=True)
class TextOrObject:
    fields: dict


SCALAR = "scalar"
TOOL_SUMMARIES = "tool_summaries"
# Explicit personal-content exception: ModelGateway persists personal research
# evidence/output, not transport headers, runner prompts or billing envelopes.
# These arbitrary historical/user evidence keys must stay portable. New system
# metadata belongs in a separate classified field, never inside this payload.
PERSONAL_MODEL_EVIDENCE = "personal_model_evidence"
# LiteratureEntry.create deliberately stores the user's imported CSL document,
# including valid CSL extensions and custom user fields, unchanged. It is not a
# server execution envelope. DOI enrichment adds bibliographic content only.
PERSONAL_BIBLIOGRAPHY = "personal_bibliography"
SCALARS = ListOf(SCALAR)
STRING_MAP = MapOf(SCALAR)
# ResearchCase.create and CaseProfile accept user-defined names and scalar values.
USER_ATTRIBUTES = "user_attributes"


def fields(names: str, **nested: object) -> dict[str, object]:
    """Concise literal declaration, not inspection of runtime input or ORM columns."""
    return dict.fromkeys(names.split(), SCALAR) | nested


def json_value(value):
    if isinstance(value, bytes):
        return {"encoding": "base64", "base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value if value is None or isinstance(value, (str, int, float, bool)) else None


def project(value, shape):
    if value is None:
        return None
    if shape == TOOL_SUMMARIES:
        return project_tool_summaries(value)
    if shape == SCALAR:
        return json_value(value) if isinstance(value, (str, int, float, bool)) else None
    if shape in (PERSONAL_MODEL_EVIDENCE, PERSONAL_BIBLIOGRAPHY):
        return json_value(value)
    if shape == USER_ATTRIBUTES:
        if isinstance(value, dict):
            return {str(key): project(item, SCALAR) for key, item in value.items()}
        # Qualitative case profiles serialize an explicit list of (name, value) pairs.
        if isinstance(value, (list, tuple)):
            return [
                [project(part, SCALAR) for part in item]
                for item in value
                if isinstance(item, (list, tuple)) and len(item) == 2
            ]
        return {}
    if isinstance(shape, TextOrObject):
        return value if isinstance(value, str) else project(value, shape.fields)
    if isinstance(shape, ListOf):
        return (
            [project(item, shape.item) for item in value] if isinstance(value, list | tuple) else []
        )
    if isinstance(shape, MapOf):
        return (
            {str(key): project(item, shape.value) for key, item in value.items()}
            if isinstance(value, dict)
            else {}
        )
    if isinstance(shape, dict):
        return (
            {key: project(value[key], child) for key, child in shape.items() if key in value}
            if isinstance(value, dict)
            else {}
        )
    raise ValueError("unregistered export JSON shape")


LOCATOR = TextOrObject(
    fields(
        "page paragraph line_start line_end char_start char_end block_index time_start_ms "
        "time_end_ms speaker slide table row column sheet cell",
        section_path=SCALARS,
    )
)
CITATION = fields(
    "citation_id label kind excerpt knowledge_id source_id source_kind material_id parse_id "
    "segment_id deleted knowledge_base_id source_version state",
    locator=LOCATOR,
)
CITATIONS = ListOf(CITATION)
EVIDENCE_REF = fields(
    "evidence_ref_id excerpt source_ref_id source_description verification_status use_boundary "
    "source_id source_kind knowledge_release_id annotation_id material_id parse_id segment_id",
    locator=LOCATOR,
)
EVIDENCE_REFS = ListOf(EVIDENCE_REF)
MEMORY = fields(
    "memory_id user_id task_id scope_key key content origin version created_at updated_at "
    "source_conversation_id source_message_id source_quote deleted",
)
AUDIT_DETAILS = fields(
    "idempotency_key session_id reason role requested_role status requested_status "
    "revoke_other_sessions revoked_sessions expected_version actual_version irreversible "
    "subject_deleted redacted_at provider login_mode",
)
QUESTIONNAIRE = fields("occupation industry additional", goals=SCALARS, interests=SCALARS)
AVATAR = fields("id hair skin sleeve blush")
NODE = fields(
    "id kind title summary status user_edited user_edit_version reviewed_user_version "
    "reviewed_user_title reviewed_user_summary expected_title expected_summary",
    citation_ids=SCALARS,
)
EDGE = fields("id source target relation label")
CANVAS_EDITS = MapOf(NODE)
MAP_PATCH = fields(
    "schema_version map_title",
    nodes=ListOf(NODE),
    relations=ListOf(EDGE),
    remove_node_ids=SCALARS,
    remove_relation_ids=SCALARS,
    suggested_nodes=ListOf(NODE),
)
WRITING_CONTEXT = fields("document_id document_version selection_start selection_end")
RUN_REQUEST = fields(
    "conversation_id message reference_knowledge_base_id model_id reasoning_effort "
    "knowledge_index_action workspace web_search mode task_id document_id section_id "
    "document_version theory_plan_id deep_research_run_id deep_research_action "
    "deep_research_selection",
    material_ids=SCALARS,
    writing_context=WRITING_CONTEXT,
    context_suggestion=fields("card_id version"),
)
USAGE = fields(
    "input_tokens output_tokens total_tokens requests tool_calls cache_read_tokens "
    "cache_write_tokens reasoning_tokens input_audio_tokens output_audio_tokens",
)
ATTACHMENTS = ListOf(
    fields(
        "material_id parse_id title filename media_type content_hash parse_version",
    )
)
SUMMARY_SOURCE = fields("conversation_id message_id quote title role sequence")
SUMMARY_CARD = fields("title description card_id version", sources=ListOf(SUMMARY_SOURCE))
PUBLIC_SUMMARY = fields(
    "summary", summary_sources=ListOf(SUMMARY_SOURCE), cards=ListOf(SUMMARY_CARD)
)
IMPORT_DETAILS = fields(
    "input_path text_source source_type original_media_type title url author created_at "
    "updated_at imported_at",
    wiki_links=SCALARS,
    tags=SCALARS,
    metadata=fields(
        "title author author_name url source_url original_media_type text_source enumerate_uid "
        "created_at updated_at published_at description duration channel uploader license "
        "source_type source_id source_path original_filename image_width image_height "
        "frontmatter created updated date",
        tags=SCALARS,
        # Markdown front matter belongs to the uploaded document, not runtime metadata.
        properties=USER_ATTRIBUTES,
    ),
)
PERSONAL_GRAPH = {
    "topics": MapOf(fields("id label", members=SCALARS)),
    "assignments": MapOf(fields("topic_id hash")),
}
SEGMENT = fields("segment_id parse_id material_id ordinal kind text content_hash", locator=LOCATOR)
SEGMENTS = ListOf(SEGMENT)
PARSED_DOCUMENT = fields(
    "format line_count block_count paragraph_count page_count "
    "kind source source_format provider created_from_version_id",
    unreadable_slides=SCALARS,
    pages=ListOf(fields("page text")),
)
DOCUMENT_KNOWLEDGE = fields(
    "title summary schema_version",
    topics=ListOf(fields("id title summary description", segment_ids=SCALARS, keywords=SCALARS)),
    concepts=ListOf(fields("id title name description", segment_ids=SCALARS)),
    relations=ListOf(fields("source target relation label description", segment_ids=SCALARS)),
)
DOCUMENT_SECTION = fields(
    "section_id key title content status",
    evidence_refs=EVIDENCE_REFS,
    citation_refs=CITATIONS,
)
DOCUMENT_SECTIONS = ListOf(DOCUMENT_SECTION)
FORMATTING = fields("template_id csl_style_id locale custom_csl custom_css")
PROVENANCE = fields(
    "conversation_id agent_run_id agent_turn_id tool_call_id material_id parse_id segment_id "
    "source origin model provider version",
)
CODING_ITEMS = ListOf(
    fields(
        "item_id material_id parse_id segment_id segment_content_hash quote quote_hash quote_start "
        "quote_end code_id code_label code_definition codebook_version confidence rationale "
        "status annotation_id decision_reason",
        locator=LOCATOR,
    )
)
FINDINGS = ListOf(fields("kind statement", annotation_ids=SCALARS))
NEXT_STEPS = ListOf(fields("kind action priority"))
ANNOTATION = fields(
    "annotation_id user_id task_id material_id parse_id segment_id segment_content_hash quote "
    "quote_hash quote_start quote_end annotation_kind case_label observed_at note reflection "
    "created_at",
    locator=LOCATOR,
)
CODE = fields(
    "code_id user_id task_id label definition rationale source status version created_at "
    "conversation_id agent_run_id agent_turn_id tool_call_id decided_at decision_reason",
    annotation_ids=SCALARS,
)
MEMO = fields(
    "memo_id user_id task_id title content memo_kind source status version created_at "
    "conversation_id agent_run_id agent_turn_id tool_call_id decided_at decision_reason",
    annotation_ids=SCALARS,
    code_ids=SCALARS,
)
COMPARISON = fields(
    "comparison_id user_id task_id title question theory_implication source status version "
    "created_at conversation_id agent_run_id agent_turn_id tool_call_id decided_at decision_reason",
    case_labels=SCALARS,
    time_labels=SCALARS,
    findings=FINDINGS,
    competing_explanations=SCALARS,
    evidence_gaps=SCALARS,
    next_steps=NEXT_STEPS,
)
ANALYSIS_HANDOFF = fields(
    "schema_version task_id content_hash",
    annotations=ListOf(ANNOTATION),
    codes=ListOf(CODE),
    memos=ListOf(MEMO),
    comparisons=ListOf(COMPARISON),
    unavailable_annotation_ids=SCALARS,
)
METHOD_CONTEXT = ListOf(fields("key title content", evidence_refs=EVIDENCE_REFS))
METHOD_SECTIONS = ListOf(fields("key title content source"))
METHOD_REVIEWS = ListOf(fields("review_id note blocking created_at resolved_at"))
LOSS_REPORT = fields(
    "schema_version format direction specification_version validation_scope",
    losses=ListOf(fields("object_type object_id field reason disposition severity")),
    identities=ListOf(fields("object_type native_id exchange_guid")),
    warnings=SCALARS,
    omitted=SCALARS,
    unsupported=SCALARS,
    items=ListOf(fields("kind code message path count reason")),
)
THEORY_PROFILE = fields(
    "theory_id title content_version review_status match_eligible",
    related_knowledge_ids=SCALARS,
    core_propositions=SCALARS,
    applicable_phenomena=SCALARS,
    analysis_levels=SCALARS,
    prerequisites=SCALARS,
    exclusion_signals=SCALARS,
    observable_evidence=SCALARS,
    competing_or_complementary_theory_ids=SCALARS,
    source_ids=SCALARS,
)
THEORY_CONTENT = fields(
    "theory_id title origin problem_focus formal_adoption_eligible knowledge_id seed_theory_id "
    "content_status reviewed_profile_theory_id",
    core_claims=SCALARS,
    analysis_levels=SCALARS,
    source_ids=SCALARS,
    adoption_blockers=SCALARS,
    reviewed_profile=THEORY_PROFILE,
)
THEORY_JUDGEMENT = fields(
    "verdict match_rationale",
    **{
        key: SCALARS
        for key in (
            "applicable_conditions",
            "limitations",
            "material_requirements",
            "evidence_gaps",
            "alternative_explanations",
            "evidence_ref_ids",
            "supporting_evidence_ref_ids",
            "conflicting_evidence_ref_ids",
        )
    },
)
THEORY_CANDIDATE = fields(
    "candidate_id candidate_version trace_id request_id contract_version judgement_run_status "
    "failure_code retryable attempt",
    content=THEORY_CONTENT,
    judgement=THEORY_JUDGEMENT,
)
PHENOMENON = fields(
    "task_id phenomenon_query_id version phenomenon research_intent context content_hash",
    evidence_refs=EVIDENCE_REFS,
)
SOURCE = fields(
    "source_id source_type title year publication locator url verification_status use_boundary",
    authors_or_institution=SCALARS,
)
MATCH_SNAPSHOT = fields(
    "completion_basis partial_completion_acknowledged partial_completion_acknowledgement_reason "
    "partial_completion_acknowledged_at partial_completion_idempotency_key "
    "partial_completion_request_hash next_cursor",
    phenomenon=PHENOMENON,
    knowledge_release=fields("knowledge_release_id level content_hash"),
    evidence_bundle=fields(
        "evidence_bundle_id version content_hash",
        theory_profiles=ListOf(THEORY_PROFILE),
        evidence_items=ListOf(
            fields(
                "evidence_ref_id claim excerpt locator verification_status use_boundary",
                source=SOURCE,
            )
        ),
        retrieval=fields(
            "retrieval_index_id mode embedding_model reranker_model degraded_reason",
            retrieved_chunk_ids=SCALARS,
        ),
    ),
    candidates=ListOf(THEORY_CANDIDATE),
    candidate_failures=ListOf(THEORY_CANDIDATE),
    candidate_retry_records=ListOf(
        fields(
            "candidate_id expected_candidate_version idempotency_key request_hash "
            "resulting_match_run_version",
        )
    ),
    failed_candidate_ids=SCALARS,
    stable_candidate_order=SCALARS,
)
THEORY_DECISIONS = fields(
    "decision_set_id draft_id match_run_id version draft_version recorded_at "
    "expected_match_run_version completion_basis updated_at "
    "partial_completion_acknowledgement_reason",
    acknowledged_candidate_ids=SCALARS,
    failed_candidate_ids=SCALARS,
    decisions=ListOf(
        fields(
            "decision_id candidate_id candidate_version action reason revised_applicability "
            "recorded_at",
            related_source_ids=SCALARS,
            related_candidate_ids=SCALARS,
        )
    ),
    use_assignments=ListOf(fields("candidate_id role_code responsibility")),
    relations=ListOf(
        fields(
            "relation_id relation_kind explanation premise_compatibility",
            candidate_ids=SCALARS,
            supporting_evidence=SCALARS,
            excluding_evidence=SCALARS,
            distinguishing_evidence=SCALARS,
        )
    ),
)

# Actual public trace producers: pydantic_runner._emit_tool_event/_trace_items,
# disciplinary_agent._deep_research_summary and ResearchMap patches. Each tool
# has an explicit input/output contract; a new tool cannot inherit payload access.
TOOL_HEADER = fields("tool phase call_id detail error")
TOOL_ERROR = fields("error message code status next_action")
TRACE_ITEM = fields(
    "url knowledge_id material_id parse_id segment_id source_kind node_id source_id title "
    "excerpt content_excerpt evidence_status verification_status entry_count",
    locator=LOCATOR,
)
TRACE_ITEM["entries"] = ListOf(TRACE_ITEM)
INDEX_DOCUMENT = fields(
    "knowledge_base_id document_id parse_id filename stage knowledge_status knowledge_error "
    "index_status index_error reason",
)
INDEX_COVERAGE = fields(
    "purpose state embedding_model total_count ready_count missing_count "
    "processing_count failed_count",
    ready_document_ids=SCALARS,
    ready_documents=ListOf(INDEX_DOCUMENT),
    missing_documents=ListOf(INDEX_DOCUMENT),
)
SEARCH_INPUT = fields(
    "query url limit offset conversation_id sequence material_id segment_id parse_id before after "
    "knowledge_id",
    source_ids=SCALARS,
)
SEARCH_OUTPUT = TOOL_ERROR | fields(
    "result_count found knowledge_id title excerpt material_id segment_id context_count count "
    "next_cursor",
    items=ListOf(TRACE_ITEM),
    locator=LOCATOR,
    knowledge_index_coverage=INDEX_COVERAGE,
    knowledge_index_status=TextOrObject(INDEX_COVERAGE),
)
WRITING_TRACE = TOOL_ERROR | fields(
    "document_id version context_stale revision_id base_version action status selection_start "
    "selection_end before_characters after_characters",
    pending_revision_ids=SCALARS,
)
DOCUMENT_PROPOSAL = TOOL_ERROR | fields(
    "proposal_id document_id base_document_version section_id status requires_user_approval "
    "before after rationale knowledge_release_id kind title section_count",
)
START_PROPOSAL = TOOL_ERROR | fields(
    "proposal_id conversation_id source_run_id source_turn_id knowledge_release_id phenomenon "
    "research_intent context version status requires_user_confirmation confirmed_task_id "
    "created_at confirmed_at task_id",
)
WORKFLOW = TOOL_ERROR | fields(
    "task_id status project_title project_stage method_orientation research_intent context "
    "task_version phenomenon match_run_id match_status theory_plan_id conversation_id "
    "knowledge_release_id start_proposal_id",
)
MATCH_RESULT = TOOL_ERROR | fields(
    "match_run_id task_id version status completion_basis knowledge_release_id "
    "requires_partial_acknowledgement",
    failed_candidate_ids=SCALARS,
    candidates=ListOf(THEORY_CONTENT | THEORY_JUDGEMENT | fields("candidate_id candidate_version")),
)
ANALYSIS_TRACE = TOOL_ERROR | fields(
    "schema_version task_id",
    case_labels=SCALARS,
    time_labels=SCALARS,
    annotations=ListOf(ANNOTATION),
    memos=ListOf(MEMO),
    comparisons=ListOf(COMPARISON),
)
QUESTION = fields("question", options=SCALARS)
PENDING_RESEARCH = fields(
    "kind version state title question selected_intent",
    steps=SCALARS,
    options=SCALARS,
)
TOOL_CONTRACTS = {
    "knowledge_index_scope": ({}, SEARCH_OUTPUT),
    "knowledge_index_status": ({}, SEARCH_OUTPUT),
    "search_knowledge": (SEARCH_INPUT, SEARCH_OUTPUT),
    "search_web": (SEARCH_INPUT, SEARCH_OUTPUT),
    "read_web_page": (SEARCH_INPUT, SEARCH_OUTPUT),
    "search_research_materials": (SEARCH_INPUT, SEARCH_OUTPUT),
    "read_research_material_context": (SEARCH_INPUT, SEARCH_OUTPUT),
    "read_knowledge_entry": (SEARCH_INPUT, SEARCH_OUTPUT),
    "read_sources": (SEARCH_INPUT, SEARCH_OUTPUT),
    "browse_knowledge_directory": (SEARCH_INPUT, SEARCH_OUTPUT),
    "search_conversations": (SEARCH_INPUT, SEARCH_OUTPUT),
    "read_conversation": (SEARCH_INPUT, SEARCH_OUTPUT),
    "change_memory": (
        fields("action scope key"),
        TOOL_ERROR | fields("forgotten saved key version current_version content"),
    ),
    "read_writing_document": ({}, WRITING_TRACE),
    "propose_writing_edit": (
        fields(
            "expected_version selection_start selection_end original_characters "
            "replacement_characters"
        ),
        WRITING_TRACE,
    ),
    "writing_ui_action": (fields("origin"), {}),
    "read_research_document": (fields("document_id"), DOCUMENT_PROPOSAL | fields("version")),
    "propose_document_revision": (
        fields("document_id expected_version section_id replacement_content rationale"),
        DOCUMENT_PROPOSAL,
    ),
    "propose_document_creation": (
        fields(
            "title rationale", sections=ListOf(DOCUMENT_SECTION | fields("", citation_ids=SCALARS))
        ),
        DOCUMENT_PROPOSAL,
    ),
    "update_research_map": (MAP_PATCH | fields("title map_title"), MAP_PATCH | TOOL_ERROR),
    "ask_research_question": (QUESTION, QUESTION),
    "deep_research": ({}, fields("schema_version elapsed_seconds knowledge_count web_count")),
    "propose_start_research": (fields("phenomenon research_intent context"), START_PROPOSAL),
    "get_research_workflow_state": ({}, WORKFLOW),
    "start_theory_matching": ({}, MATCH_RESULT),
    "save_confirmed_theory_plan": (
        THEORY_DECISIONS | fields("user_confirmed"),
        WORKFLOW | fields("match_run_id knowledge_release_id", failed_candidate_ids=SCALARS),
    ),
    "get_research_analysis": ({}, ANALYSIS_TRACE),
    "get_research_comparison_context": (
        fields("", case_labels=SCALARS, time_labels=SCALARS),
        ANALYSIS_TRACE,
    ),
    "propose_analysis_memo": (MEMO, MEMO | TOOL_ERROR | fields("requires_user_confirmation")),
    "propose_case_comparison": (
        COMPARISON,
        COMPARISON | TOOL_ERROR | fields("requires_user_confirmation"),
    ),
}


def project_tool_summaries(value):
    if not isinstance(value, (list, tuple)):
        return []
    output = []
    for item in value:
        if not isinstance(item, dict):
            continue
        if item.get("kind") == "deep_research_pending":
            # Raw pending.prompt can include resumed runner instructions. The
            # row projector supplies only request_snapshot.message, if available.
            output.append(project(item, PENDING_RESEARCH))
            continue
        projected = project(item, TOOL_HEADER)
        contract = (
            TOOL_CONTRACTS.get(item.get("tool")) if isinstance(item.get("tool"), str) else None
        )
        if contract:
            for key, shape in zip(("input", "output"), contract, strict=True):
                if key in item:
                    projected[key] = project(item[key], shape)
        output.append(projected)
    return output
