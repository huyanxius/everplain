"""Reviewed personal-data portability contracts, independent of schema discovery.

Every column is classified here. New tables/columns do not become exportable by
adding an ORM property or a foreign key. Run validate_export_schema against the
migrated database in CI whenever schema or these contracts change.
"""

from dataclasses import dataclass

from . import account_export_json as shapes


@dataclass(frozen=True)
class Parent:
    column: str
    table: str
    key: str


@dataclass(frozen=True)
class ExportContract:
    fields: tuple[str, ...]
    identity: tuple[str, ...]
    owner: str | None = None
    parents: tuple[Parent, ...] = ()
    json_fields: tuple[tuple[str, object], ...] = ()
    binary_fields: tuple[str, ...] = ()
    omitted: tuple[tuple[str, str], ...] = ()
    audit_subject: bool = False


@dataclass(frozen=True)
class ExcludedTable:
    columns: tuple[str, ...]
    reason: str


def names(value: str) -> tuple[str, ...]:
    return tuple(value.split())


# Account/data capability owners must review additions; this is not generated at runtime.
EXPORTS = {
    "account_audit_events": ExportContract(
        fields=names(
            "event_id actor_user_id target_user_id actor_email target_email action outcome "
            "details ip_address user_agent created_at "
        ),
        identity=("event_id",),
        audit_subject=True,
        json_fields=(("details", shapes.AUDIT_DETAILS),),
    ),
    "agent_conversation_summaries": ExportContract(
        fields=names("user_id summary updated_at "),
        identity=("user_id",),
        owner="user_id",
        json_fields=(("summary", shapes.PUBLIC_SUMMARY),),
        omitted=(
            (
                "fingerprint",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "attempted_fingerprint",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "lease_token",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "lease_until",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "retry_after",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "attempts",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
            (
                "last_error",
                "Worker state; summary is replaced with owner-validated last-good public "
                "projection.",
            ),
        ),
    ),
    "agent_conversations": ExportContract(
        fields=names(
            "conversation_id user_id title current_research_task_id "
            "reference_knowledge_base_id canvas_edits canvas_edit_version version "
            "created_at updated_at "
        ),
        identity=("conversation_id",),
        owner="user_id",
        json_fields=(("canvas_edits", shapes.CANVAS_EDITS),),
        omitted=(
            ("context_digest", "Derived hidden context; original user messages are exported."),
        ),
    ),
    "agent_memories": ExportContract(
        fields=names(
            "memory_id user_id scope_key key content origin version created_at updated_at "
            "source_conversation_id source_message_id source_quote deleted "
        ),
        identity=("memory_id",),
        owner="user_id",
    ),
    "agent_memory_revisions": ExportContract(
        fields=names("memory_id version snapshot "),
        identity=("memory_id", "version"),
        parents=(Parent("memory_id", "agent_memories", "memory_id"),),
        json_fields=(("snapshot", shapes.MEMORY),),
    ),
    "agent_memory_scopes": ExportContract(
        fields=names("user_id scope_key task_id version use_memory learn_memory learn_after "),
        identity=("user_id", "scope_key"),
        owner="user_id",
    ),
    "agent_memory_usage": ExportContract(
        fields=names("user_id day calls input_tokens output_tokens budget_tokens "),
        identity=("user_id", "day"),
        owner="user_id",
    ),
    "agent_messages": ExportContract(
        fields=names(
            "message_id conversation_id turn_id role content citations sequence created_at "
        ),
        identity=("message_id",),
        parents=(Parent("conversation_id", "agent_conversations", "conversation_id"),),
        json_fields=(("citations", shapes.CITATIONS),),
    ),
    "agent_output_attempts": ExportContract(
        fields=names("attempt_id run_id ordinal status answer created_at "),
        identity=("attempt_id",),
        parents=(Parent("run_id", "agent_runs", "run_id"),),
    ),
    "agent_output_events": ExportContract(
        fields=names("run_id sequence attempt_id name created_at "),
        identity=("run_id", "sequence"),
        parents=(
            Parent("run_id", "agent_runs", "run_id"),
            Parent("attempt_id", "agent_output_attempts", "attempt_id"),
        ),
        omitted=(
            (
                "payload",
                "Internal execution event envelope; portable answers are in "
                "runs/messages/attempts.",
            ),
        ),
    ),
    "agent_profiles": ExportContract(
        fields=names(
            "user_id name avatar_id color speaking_style setup_step setup_completed "
            "questionnaire memory_ids version soul_text user_avatar "
        ),
        identity=("user_id",),
        owner="user_id",
        json_fields=(
            ("questionnaire", shapes.QUESTIONNAIRE),
            ("memory_ids", shapes.STRING_MAP),
            ("user_avatar", shapes.AVATAR),
        ),
    ),
    "agent_runs": ExportContract(
        fields=names(
            "run_id turn_id conversation_id user_id idempotency_key status provider model "
            "knowledge_release_id usage tool_summary material_attachments error started_at "
            "completed_at request_snapshot partial_answer updated_at cancel_requested "
            "last_event_sequence "
        ),
        identity=("run_id",),
        owner="user_id",
        json_fields=(
            ("usage", shapes.USAGE),
            ("tool_summary", shapes.TOOL_SUMMARIES),
            ("material_attachments", shapes.ATTACHMENTS),
            ("request_snapshot", shapes.RUN_REQUEST),
        ),
        omitted=(
            ("lease_token", "Worker lease credential."),
            ("lease_expires_at", "Worker scheduling state."),
        ),
    ),
    "billing_precision_adjustments": ExportContract(
        fields=names(
            "reset_id user_id reason before_precision delta_precision after_precision "
            "before_balance delta_points after_balance closed_operation_ids created_at "
        ),
        identity=("reset_id", "user_id"),
        owner="user_id",
    ),
    "channel_bindings": ExportContract(
        fields=names(
            "binding_id user_id identity_key gateway_id subject_id created_at "
            "activated_at_ms revoked_at "
        ),
        identity=("binding_id",),
        owner="user_id",
    ),
    "channel_events": ExportContract(
        fields=names(
            "event_key gateway_id payload_hash binding_id scope_key state answer created_at "
        ),
        identity=("event_key",),
        parents=(Parent("binding_id", "channel_bindings", "binding_id"),),
        omitted=(
            ("lease_token", "Worker lease credential."),
            ("lease_until", "Worker scheduling state."),
        ),
    ),
    "channel_scopes": ExportContract(
        fields=names("scope_key binding_id conversation_id active_event lease_until "),
        identity=("scope_key",),
        parents=(Parent("binding_id", "channel_bindings", "binding_id"),),
    ),
    "confirmed_theory_plans": ExportContract(
        fields=names(
            "theory_plan_id task_id match_run_id decision_set_id version "
            "adopted_candidate_ids confirmed_at idempotency_key request_hash "
        ),
        identity=("theory_plan_id",),
        parents=(
            Parent("task_id", "research_tasks", "task_id"),
            Parent("match_run_id", "match_runs", "match_run_id"),
            Parent("decision_set_id", "theory_decision_sets", "decision_set_id"),
        ),
        json_fields=(("adopted_candidate_ids", shapes.SCALARS),),
    ),
    "course_profiles": ExportContract(
        fields=names("user_id role guide_dismissed "),
        identity=("user_id",),
        owner="user_id",
    ),
    "credit_accounts": ExportContract(
        fields=names(
            "user_id balance quota_period_epoch active_run_id active_run_expires_at "
            "created_at updated_at "
        ),
        identity=("user_id",),
        owner="user_id",
    ),
    "credit_ledger": ExportContract(
        fields=names(
            "entry_id user_id run_id quota_period_epoch kind points balance_after "
            "input_tokens output_tokens model created_at "
        ),
        identity=("entry_id",),
        owner="user_id",
    ),
    "credit_quota_periods": ExportContract(
        fields=names(
            "user_id epoch plan_id limit_points started_at expires_at balance "
            "total_credit_pico closed_at reason "
        ),
        identity=("user_id", "epoch"),
        owner="user_id",
    ),
    "credit_redemption_codes": ExportContract(
        fields=names(
            "code_id batch_id code_index action plan_id created_at expires_at "
            "redeemed_by_user_id redeemed_at "
        ),
        identity=("code_id",),
        owner="redeemed_by_user_id",
        omitted=(
            ("code_hash", "Redemption credential."),
            ("created_by_user_id", "Operator identity; export the recipient redemption receipt."),
        ),
    ),
    "external_agent_connections": ExportContract(
        fields=names(
            "connection_id owner_user_id name library_ids created_at expires_at revoked_at "
        ),
        identity=("connection_id",),
        owner="owner_user_id",
        json_fields=(("library_ids", shapes.SCALARS),),
        omitted=(("token_hash", "External-agent authentication credential."),),
    ),
    "federated_identities": ExportContract(
        fields=names("provider subject user_id created_at verified_email "),
        identity=("provider", "subject"),
        owner="user_id",
    ),
    "import_attachments": ExportContract(
        fields=names(
            "id item_id user_id document_id relative_path filename media_type references "
            "size_bytes content "
        ),
        identity=("id",),
        owner="user_id",
        json_fields=(("references", shapes.SCALARS),),
        binary_fields=("content",),
    ),
    "import_batches": ExportContract(
        fields=names("id user_id library_id source_type request_key fingerprint created_at "),
        identity=("id",),
        owner="user_id",
    ),
    "import_items": ExportContract(
        fields=names(
            "id batch_id user_id source_key title filename source_url relative_path content "
            "media_type details status document_id error attempts started_at created_at "
        ),
        identity=("id",),
        owner="user_id",
        json_fields=(("details", shapes.IMPORT_DETAILS),),
        binary_fields=("content",),
    ),
    "import_sources": ExportContract(
        fields=names("user_id source_key document_id relative_path source_url details "),
        identity=("user_id", "source_key"),
        owner="user_id",
        json_fields=(("details", shapes.IMPORT_DETAILS),),
    ),
    "match_runs": ExportContract(
        fields=names(
            "match_run_id task_id version status snapshot model_provider model_version "
            "model_capability model_degraded model_knowledge_release_id trace_id request_id "
            "contract_version created_at "
        ),
        identity=("match_run_id",),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(("snapshot", shapes.MATCH_SNAPSHOT),),
    ),
    "material_intake_runs": ExportContract(
        fields=names(
            "run_id task_id idempotency_key status filename media_type "
            "processing_policy_version candidate_ids accepted_at "
        ),
        identity=("run_id",),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(("candidate_ids", shapes.SCALARS),),
    ),
    "model_invocations": ExportContract(
        fields=names(
            "trace_id request_id task_id contract_version capability provider model_version "
            "capability_tier demonstration scenario input_evidence output "
            "knowledge_release_id degraded degradation_reason error_code started_at "
            "completed_at "
        ),
        identity=("trace_id",),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(
            ("input_evidence", shapes.PERSONAL_MODEL_EVIDENCE),
            ("output", shapes.PERSONAL_MODEL_EVIDENCE),
        ),
    ),
    "personal_graphs": ExportContract(
        fields=names("user_id state pending updated_at "),
        identity=("user_id",),
        owner="user_id",
        json_fields=(("state", shapes.PERSONAL_GRAPH),),
    ),
    "phenomenon_candidate_versions": ExportContract(
        fields=names(
            "candidate_id version task_id status phenomenon research_intent context "
            "source_ref_ids evidence_refs missing_information source_traceability "
            "content_origin model_provider model_version model_capability model_degraded "
            "knowledge_release_id trace_id request_id contract_version created_at "
        ),
        identity=("candidate_id", "version"),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(
            ("source_ref_ids", shapes.SCALARS),
            ("evidence_refs", shapes.EVIDENCE_REFS),
            ("missing_information", shapes.SCALARS),
        ),
    ),
    "phenomenon_states": ExportContract(
        fields=names(
            "task_id input_id input_version candidate_id candidate_version candidate_status "
            "phenomenon research_intent context source_ref_ids evidence_refs "
            "missing_information source_traceability content_origin model_provider "
            "model_version model_capability model_degraded knowledge_release_id trace_id "
            "request_id contract_version phenomenon_query_id content_hash confirmed_at "
            "accepted_at "
        ),
        identity=("task_id",),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(
            ("source_ref_ids", shapes.SCALARS),
            ("evidence_refs", shapes.EVIDENCE_REFS),
            ("missing_information", shapes.SCALARS),
        ),
    ),
    "research_analysis_annotations": ExportContract(
        fields=names(
            "annotation_id user_id task_id material_id parse_id segment_id "
            "segment_content_hash quote quote_hash quote_start quote_end locator "
            "annotation_kind case_label observed_at note reflection created_at "
        ),
        identity=("annotation_id",),
        owner="user_id",
        json_fields=(("locator", shapes.LOCATOR),),
    ),
    "research_analysis_audit_events": ExportContract(
        fields=names(
            "event_id user_id task_id actor action entity_kind entity_id plan_id item_id "
            "annotation_id code_id idempotency_key provenance created_at "
        ),
        identity=("event_id",),
        owner="user_id",
        json_fields=(("provenance", shapes.PROVENANCE),),
        omitted=(
            (
                "payload",
                "Internal execution audit payload; authored analysis records are separate.",
            ),
        ),
    ),
    "research_analysis_case_profiles": ExportContract(
        fields=names(
            "profile_id user_id task_id case_ref display_label attributes summary "
            "annotation_ids memo_ids version updated_at "
        ),
        identity=("profile_id",),
        owner="user_id",
        json_fields=(
            ("attributes", shapes.USER_ATTRIBUTES),
            ("annotation_ids", shapes.SCALARS),
            ("memo_ids", shapes.SCALARS),
        ),
    ),
    "research_analysis_codebook_entries": ExportContract(
        fields=names(
            "code_id user_id task_id inclusion_rules exclusion_rules parent_code_id "
            "positive_example_annotation_ids negative_example_annotation_ids lifecycle "
            "related_code_ids version updated_at revision_reason "
        ),
        identity=("code_id",),
        owner="user_id",
        json_fields=(
            ("inclusion_rules", shapes.SCALARS),
            ("exclusion_rules", shapes.SCALARS),
            ("positive_example_annotation_ids", shapes.SCALARS),
            ("negative_example_annotation_ids", shapes.SCALARS),
            ("related_code_ids", shapes.SCALARS),
        ),
    ),
    "research_analysis_codes": ExportContract(
        fields=names(
            "code_id user_id task_id label definition annotation_ids rationale source "
            "status version created_at conversation_id agent_run_id agent_turn_id "
            "tool_call_id decided_at decision_reason "
        ),
        identity=("code_id",),
        owner="user_id",
        json_fields=(("annotation_ids", shapes.SCALARS),),
    ),
    "research_analysis_coding_plans": ExportContract(
        fields=names(
            "plan_id user_id task_id title rationale items source status version created_at "
            "conversation_id agent_run_id agent_turn_id tool_call_id decided_at "
            "decision_reason "
        ),
        identity=("plan_id",),
        owner="user_id",
        json_fields=(("items", shapes.CODING_ITEMS),),
    ),
    "research_analysis_comparisons": ExportContract(
        fields=names(
            "comparison_id user_id task_id title question case_labels time_labels findings "
            "competing_explanations evidence_gaps next_steps theory_implication source "
            "status version created_at conversation_id agent_run_id agent_turn_id "
            "tool_call_id decided_at decision_reason "
        ),
        identity=("comparison_id",),
        owner="user_id",
        json_fields=(
            ("case_labels", shapes.SCALARS),
            ("time_labels", shapes.SCALARS),
            ("findings", shapes.FINDINGS),
            ("competing_explanations", shapes.SCALARS),
            ("evidence_gaps", shapes.SCALARS),
            ("next_steps", shapes.NEXT_STEPS),
        ),
    ),
    "research_analysis_matrix_cells": ExportContract(
        fields=names(
            "cell_id user_id task_id case_profile_id subject_kind subject_id summary "
            "annotation_ids memo_ids finding_kinds version updated_at "
        ),
        identity=("cell_id",),
        owner="user_id",
        json_fields=(
            ("annotation_ids", shapes.SCALARS),
            ("memo_ids", shapes.SCALARS),
            ("finding_kinds", shapes.SCALARS),
        ),
    ),
    "research_analysis_memo_links": ExportContract(
        fields=names(
            "link_id user_id task_id memo_id target_kind target_ref annotation_ids created_at "
        ),
        identity=("link_id",),
        owner="user_id",
        json_fields=(("annotation_ids", shapes.SCALARS),),
    ),
    "research_analysis_memos": ExportContract(
        fields=names(
            "memo_id user_id task_id title content memo_kind annotation_ids code_ids source "
            "status version created_at conversation_id agent_run_id agent_turn_id "
            "tool_call_id decided_at decision_reason "
        ),
        identity=("memo_id",),
        owner="user_id",
        json_fields=(
            ("annotation_ids", shapes.SCALARS),
            ("code_ids", shapes.SCALARS),
        ),
    ),
    "research_analysis_method_presets": ExportContract(
        fields=names("user_id task_id method version updated_at "),
        identity=("user_id", "task_id"),
        owner="user_id",
    ),
    "research_analysis_themes": ExportContract(
        fields=names(
            "theme_id user_id task_id label central_concept code_ids annotation_ids source "
            "status version created_at decided_at decision_reason "
        ),
        identity=("theme_id",),
        owner="user_id",
        json_fields=(
            ("code_ids", shapes.SCALARS),
            ("annotation_ids", shapes.SCALARS),
        ),
    ),
    "research_batch_coding_runs": ExportContract(
        fields=names(
            "run_id user_id task_id material_id parse_id parse_version idempotency_key "
            "status total_segments processed_segments annotation_ids code_ids "
            "low_confidence_segments error_code retry_count created_at updated_at "
            "completed_at "
        ),
        identity=("run_id",),
        owner="user_id",
        json_fields=(
            ("annotation_ids", shapes.SCALARS),
            ("code_ids", shapes.SCALARS),
            ("low_confidence_segments", shapes.SCALARS),
        ),
    ),
    "research_cases": ExportContract(
        fields=names(
            "case_id user_id task_id name description attributes material_ids created_at "
            "updated_at "
        ),
        identity=("case_id",),
        owner="user_id",
        json_fields=(
            ("attributes", shapes.USER_ATTRIBUTES),
            ("material_ids", shapes.SCALARS),
        ),
    ),
    "research_cycle_snapshots": ExportContract(
        fields=names("task_id version content_hash created_at "),
        identity=("task_id", "version"),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        omitted=(
            (
                "payload",
                "Internal derived orchestration snapshot; authored research records are separate.",
            ),
        ),
    ),
    "research_document_handoffs": ExportContract(
        fields=names("user_id task_id theory_plan_id proposal_id "),
        identity=("user_id", "task_id", "theory_plan_id"),
        owner="user_id",
    ),
    "research_document_identities": ExportContract(
        fields=names("task_id theory_plan_id document_id "),
        identity=("task_id", "theory_plan_id"),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
    ),
    "research_document_proposals": ExportContract(
        fields=names(
            "proposal_id kind status user_id conversation_id agent_run_id task_id "
            "theory_plan_id knowledge_release_id title proposed_sections analysis_handoff "
            "rationale request_hash model_provider model_name document_id "
            "base_document_version target_section_id decision_reason result_document_id "
            "result_document_version created_at decided_at "
        ),
        identity=("proposal_id",),
        owner="user_id",
        json_fields=(
            ("proposed_sections", shapes.DOCUMENT_SECTIONS),
            ("analysis_handoff", shapes.ANALYSIS_HANDOFF),
        ),
    ),
    "research_document_versions": ExportContract(
        fields=names(
            "document_id version task_id theory_plan_id knowledge_release_id revision_id "
            "title sections formatting analysis_handoff status change_summary actor "
            "restored_from_version created_at confirmed_at "
        ),
        identity=("document_id", "version"),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(
            ("sections", shapes.DOCUMENT_SECTIONS),
            ("formatting", shapes.FORMATTING),
            ("analysis_handoff", shapes.ANALYSIS_HANDOFF),
        ),
    ),
    "research_literature_entries": ExportContract(
        fields=names(
            "literature_id user_id task_id item_type title doi csl_data "
            "attachment_material_ids collection_ids created_at updated_at "
        ),
        identity=("literature_id",),
        owner="user_id",
        json_fields=(
            ("csl_data", shapes.PERSONAL_BIBLIOGRAPHY),
            ("attachment_material_ids", shapes.SCALARS),
            ("collection_ids", shapes.SCALARS),
        ),
    ),
    "research_material_archive_profiles": ExportContract(
        fields=names(
            "material_id user_id task_id research_role specific_type stage batch_id tags "
            "collection_ids sensitivity consent_scope deidentification_status "
            "model_processing_scope created_at updated_at "
        ),
        identity=("material_id",),
        owner="user_id",
        json_fields=(
            ("tags", shapes.SCALARS),
            ("collection_ids", shapes.SCALARS),
        ),
    ),
    "research_material_batches": ExportContract(
        fields=names("batch_id user_id task_id name created_at "),
        identity=("batch_id",),
        owner="user_id",
    ),
    "research_material_blobs": ExportContract(
        fields=names("material_id content_hash size_bytes content "),
        identity=("material_id",),
        parents=(Parent("material_id", "research_materials", "material_id"),),
        binary_fields=("content",),
    ),
    "research_material_blocks": ExportContract(
        fields=names("parse_id segment_id material_id ordinal kind text content_hash locator "),
        identity=("parse_id", "segment_id"),
        parents=(
            Parent("material_id", "research_materials", "material_id"),
            Parent("parse_id", "research_material_parse_versions", "parse_id"),
        ),
        json_fields=(("locator", shapes.LOCATOR),),
        omitted=(
            (
                "embedding_vectors",
                "Recomputable internal embedding cache; original file and segments are exported.",
            ),
        ),
    ),
    "research_material_collections": ExportContract(
        fields=names(
            "collection_id user_id task_id name description parent_collection_id created_at "
        ),
        identity=("collection_id",),
        owner="user_id",
    ),
    "research_material_ingestion_jobs": ExportContract(
        fields=names(
            "job_id material_id user_id task_id parse_id ingestion_status attempt_count "
            "max_attempts available_at lease_expires_at error_code created_at updated_at "
            "completed_at "
        ),
        identity=("job_id",),
        owner="user_id",
    ),
    "research_material_parse_versions": ExportContract(
        fields=names(
            "parse_id material_id version parser_name parser_version schema_version status "
            "full_text structured_document content_hash error_code created_at completed_at "
        ),
        identity=("parse_id",),
        parents=(Parent("material_id", "research_materials", "material_id"),),
        json_fields=(("structured_document", shapes.PARSED_DOCUMENT),),
    ),
    "research_material_relations": ExportContract(
        fields=names(
            "relation_id user_id task_id source_material_id target_material_id "
            "relation_type note created_at "
        ),
        identity=("relation_id",),
        owner="user_id",
    ),
    "research_materials": ExportContract(
        fields=names(
            "material_id user_id task_id idempotency_key delete_idempotency_key "
            "original_filename display_name media_type material_format material_kind "
            "size_bytes content_hash status current_parse_id current_parse_version "
            "processing_policy_version last_error_code created_at updated_at deleted_at "
        ),
        identity=("material_id",),
        owner="user_id",
    ),
    "research_method_plan_identities": ExportContract(
        fields=names("task_id plan_id "),
        identity=("task_id",),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
    ),
    "research_method_plan_versions": ExportContract(
        fields=names(
            "plan_id version task_id framework_id framework_version theory_plan_id "
            "theory_plan_version method_kind decision_source rationale research_question "
            "theory_summary material_constraints ethical_constraints theory_concepts "
            "evidence_ref_ids knowledge_release_id shared_context sections reviews status "
            "revision_id change_summary actor created_at restored_from_version stale_reason "
            "confirmed_at "
        ),
        identity=("plan_id", "version"),
        parents=(Parent("task_id", "research_tasks", "task_id"),),
        json_fields=(
            ("material_constraints", shapes.SCALARS),
            ("ethical_constraints", shapes.SCALARS),
            ("theory_concepts", shapes.SCALARS),
            ("evidence_ref_ids", shapes.SCALARS),
            ("shared_context", shapes.METHOD_CONTEXT),
            ("sections", shapes.METHOD_SECTIONS),
            ("reviews", shapes.METHOD_REVIEWS),
        ),
    ),
    "research_project_audit_events": ExportContract(
        fields=names(
            "event_id user_id task_id event_type object_type object_id object_version "
            "actor_type actor_id occurred_at "
        ),
        identity=("event_id",),
        owner="user_id",
        omitted=(
            (
                "payload",
                "Internal execution audit payload; authored research records are separate.",
            ),
        ),
    ),
    "research_project_exchange_runs": ExportContract(
        fields=names(
            "exchange_id user_id task_id direction format format_version idempotency_key "
            "status artifact_sha256 loss_report created_at completed_at error_code "
        ),
        identity=("exchange_id",),
        owner="user_id",
        json_fields=(("loss_report", shapes.LOSS_REPORT),),
    ),
    "research_start_proposals": ExportContract(
        fields=names(
            "proposal_id user_id conversation_id source_run_id source_turn_id "
            "knowledge_release_id phenomenon research_intent context version status "
            "confirmed_task_id confirmed_request_hash created_at confirmed_at "
        ),
        identity=("proposal_id",),
        owner="user_id",
    ),
    "research_tasks": ExportContract(
        fields=names(
            "task_id user_id entry_type status version idempotency_key entry_mode "
            "lifecycle_status project_title project_stage method_orientation "
            "last_central_tool seed_theory_id seed_theory_name phenomenon_query_id "
            "phenomenon_version phenomenon_summary phenomenon_research_intent "
            "adopted_theory_count current_phenomenon_candidate_id "
            "current_material_intake_run_id current_match_run_id current_theory_plan_id "
            "current_framework_id current_method_plan_id current_method_plan_status "
            "knowledge_release_id conversation_id source_turn_id source_agent_run_id "
            "created_at updated_at "
        ),
        identity=("task_id",),
        owner="user_id",
    ),
    "shared_documents": ExportContract(
        fields=names(
            "id owner_user_id request_key filename media_type content_hash content "
            "size_bytes parse_id status segments knowledge_status knowledge knowledge_error "
            "index_status index_error warnings error_message created_at "
        ),
        identity=("id",),
        owner="owner_user_id",
        json_fields=(
            ("segments", shapes.SEGMENTS),
            ("knowledge", shapes.DOCUMENT_KNOWLEDGE),
            ("warnings", shapes.SCALARS),
        ),
        binary_fields=("content",),
        omitted=(
            ("job_token", "Worker lease credential."),
            ("job_started_at", "Worker scheduling state."),
            (
                "knowledge_checkpoints",
                "Internal resumable worker state; final knowledge is exported.",
            ),
            (
                "vectors",
                "Recomputable internal embedding cache; original file and segments are exported.",
            ),
        ),
    ),
    "shared_knowledge_bases": ExportContract(
        fields=names(
            "id owner_user_id request_key name description sharing_enabled deleted_at "
            "created_at updated_at "
        ),
        identity=("id",),
        owner="owner_user_id",
        omitted=(("share_token", "Live library access credential."),),
    ),
    "shared_knowledge_documents": ExportContract(
        fields=names("knowledge_base_id document_id "),
        identity=("knowledge_base_id", "document_id"),
        parents=(
            Parent("knowledge_base_id", "shared_knowledge_bases", "id"),
            Parent("document_id", "shared_documents", "id"),
        ),
    ),
    "shared_knowledge_publications": ExportContract(
        fields=names(
            "knowledge_base_id title description topics document_ids request_key published_at "
        ),
        identity=("knowledge_base_id",),
        parents=(Parent("knowledge_base_id", "shared_knowledge_bases", "id"),),
        json_fields=(
            ("topics", shapes.SCALARS),
            ("document_ids", shapes.SCALARS),
        ),
    ),
    "shared_knowledge_subscriptions": ExportContract(
        fields=names("user_id knowledge_base_id "),
        identity=("user_id", "knowledge_base_id"),
        owner="user_id",
    ),
    "subscription_checkouts": ExportContract(
        fields=names("key user_id plan_id price_id created_at session_id "),
        identity=("key",),
        owner="user_id",
        omitted=(
            ("checkout_url", "Live payment-session capability."),
            ("success_url", "Checkout redirect state."),
            ("cancel_url", "Checkout redirect state."),
        ),
    ),
    "subscriptions": ExportContract(
        fields=names(
            "provider_id user_id customer_id plan_id status current_period_start "
            "current_period_end cancel_at_period_end created_at "
        ),
        identity=("provider_id",),
        owner="user_id",
    ),
    "theory_decision_draft_requests": ExportContract(
        fields=names(
            "request_record_id match_run_id idempotency_key request_hash resulting_version "
            "response_snapshot created_at "
        ),
        identity=("request_record_id",),
        parents=(Parent("match_run_id", "match_runs", "match_run_id"),),
        json_fields=(("response_snapshot", shapes.THEORY_DECISIONS),),
    ),
    "theory_decision_drafts": ExportContract(
        fields=names("draft_id match_run_id version snapshot updated_at "),
        identity=("draft_id",),
        parents=(Parent("match_run_id", "match_runs", "match_run_id"),),
        json_fields=(("snapshot", shapes.THEORY_DECISIONS),),
    ),
    "theory_decision_sets": ExportContract(
        fields=names(
            "decision_set_id match_run_id version draft_version snapshot idempotency_key "
            "request_hash created_at "
        ),
        identity=("decision_set_id",),
        parents=(Parent("match_run_id", "match_runs", "match_run_id"),),
        json_fields=(("snapshot", shapes.THEORY_DECISIONS),),
    ),
    "theory_matching_requests": ExportContract(
        fields=names(
            "request_record_id user_id idempotency_key request_hash match_run_id created_at "
        ),
        identity=("request_record_id",),
        owner="user_id",
    ),
    "user_preferences": ExportContract(
        fields=names(
            "user_id locale timezone research_updates_enabled model_improvement_allowed "
            "consent_policy_version consent_updated_at version updated_at "
        ),
        identity=("user_id",),
        owner="user_id",
    ),
    "user_sessions": ExportContract(
        fields=names(
            "session_id user_id version created_at expires_at revoked_at last_seen_at "
            "user_agent ip_address revoked_reason "
        ),
        identity=("session_id",),
        owner="user_id",
        omitted=(("token_digest", "Authentication credential."),),
    ),
    "users": ExportContract(
        fields=names(
            "user_id email login_mode display_name role status version last_login_at "
            "deactivated_at created_at updated_at "
        ),
        identity=("user_id",),
        owner="user_id",
        omitted=(("password_hash", "Authentication credential."),),
    ),
    "writing_documents": ExportContract(
        fields=names("document_id user_id title genre markdown version created_at updated_at "),
        identity=("document_id",),
        owner="user_id",
    ),
    "writing_revisions": ExportContract(
        fields=names(
            "revision_id document_id user_id base_version action before_markdown "
            "after_markdown status warnings selection_start selection_end created_at "
        ),
        identity=("revision_id",),
        owner="user_id",
        json_fields=(("warnings", shapes.SCALARS),),
    ),
    "writing_samples": ExportContract(
        fields=names("sample_id user_id title genre text content_hash created_at "),
        identity=("sample_id",),
        owner="user_id",
    ),
}

EXCLUDED = {
    "account_mutation_requests": ExcludedTable(
        columns=names(
            "request_id actor_key idempotency_key operation request_hash status response "
            "created_at completed_at "
        ),
        reason="Account operation replay state; may contain one-time secrets.",
    ),
    "account_password_resets": ExcludedTable(
        columns=names(
            "reset_id user_id token_digest requested_by_user_id created_at expires_at used_at "
        ),
        reason="Password recovery credentials and challenge state.",
    ),
    "account_system_state": ExcludedTable(
        columns=names(
            "singleton_id initial_admin_provisioned provisioned_admin_user_id lock_version "
        ),
        reason="Administrator provisioning and locking state.",
    ),
    "personal_data_exports": ExcludedTable(
        columns=names("export_id user_id status format payload created_at expires_at "),
        reason="Previously generated archives are downloaded unchanged, not nested.",
    ),
    "agent_memory_jobs": ExcludedTable(
        columns=names(
            "conversation_id processed_sequence lease_token lease_until retry_after "
            "attempts source_sequence last_error "
        ),
        reason="Memory worker scheduling and lease state.",
    ),
    "agent_memory_requests": ExcludedTable(
        columns=names("user_id idempotency_key fingerprint memory_id version "),
        reason="Memory mutation replay state; memory content is exported separately.",
    ),
    "channel_link_codes": ExcludedTable(
        columns=names("code_hash user_id gateway_id expires_at consumed_at "),
        reason="Channel pairing credentials.",
    ),
    "oauth_transactions": ExcludedTable(
        columns=names(
            "state_digest provider browser_digest code_verifier nonce return_path "
            "link_session_id expires_at "
        ),
        reason="OAuth credentials and temporary browser-bound consent state.",
    ),
    "registration_verifications": ExcludedTable(
        columns=names("email code_hash expires_at resend_available_at attempts_remaining "),
        reason="Registration challenge credentials.",
    ),
    "model_route_attempts": ExcludedTable(
        columns=names(
            "attempt_id route_id trace_id request_id task_id agent_run_id capability "
            "endpoint_id provider model attempt_number fallback started_at completed_at "
            "latency_ms success selected failure_retryable failure_code input_tokens "
            "output_tokens "
        ),
        reason="Operator routing diagnostics; user inference evidence is separate.",
    ),
    "subscription_webhook_events": ExcludedTable(
        columns=names("event_id event_type processed_at "),
        reason="Provider webhook deduplication state, not personal receipts.",
    ),
    "phenomenon_examples": ExcludedTable(
        columns=names("example_id position title phenomenon research_intent context "),
        reason="Application example catalog, not owned personal records.",
    ),
    "research_analysis_write_requests": ExcludedTable(
        columns=names(
            "request_id user_id task_id namespace idempotency_key operation request_hash "
            "result_kind result_id created_at "
        ),
        reason="Analysis mutation replay state; authored results are separate.",
    ),
    "research_document_mutation_requests": ExcludedTable(
        columns=names(
            "request_id user_id idempotency_key operation request_hash status result_id "
            "result_version created_at "
        ),
        reason="Document mutation replay state; versions are separate.",
    ),
    "research_material_reparse_requests": ExcludedTable(
        columns=names("user_id task_id idempotency_key material_id parse_id created_at "),
        reason="Parser replay state; parsed files are separate.",
    ),
    "shared_knowledge_publication_requests": ExcludedTable(
        columns=names("knowledge_base_id request_key fingerprint "),
        reason="Publication replay state; publication content is separate.",
    ),
    "research_start_confirmations": ExcludedTable(
        columns=names(
            "confirmation_id user_id idempotency_key proposal_id request_hash task_id created_at "
        ),
        reason="Research-start replay state; proposals and tasks are separate.",
    ),
    "writing_operations": ExcludedTable(
        columns=names(
            "operation_id user_id request_key request_hash target status result created_at "
        ),
        reason="Writing operation replay state; samples, documents and revisions are separate.",
    ),
    "knowledge_entry_reviews": ExcludedTable(
        columns=names(
            "knowledge_release_id review_record_id knowledge_id review_status recorded_at "
            "theory_id reviewer_id reviewer_display_name reviewer_credentials "
            "reviewed_subject_hash decision review_notes attestation "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_entry_revisions": ExcludedTable(
        columns=names(
            "knowledge_release_id knowledge_id content_version content_hash title "
            "category_id category dimension_id dimension directory_path review_status "
            "browse_eligible rag_eligible training_candidate_eligible match_eligible "
            "review_record_ids aliases content source_path source_hash "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_relation_candidates": ExcludedTable(
        columns=names(
            "knowledge_release_id candidate_id source_knowledge_id target_knowledge_id "
            "suggested_relation_type direction evidence_excerpt evidence_locator "
            "evidence_source_id source_content_version target_content_version producer "
            "producer_config_version score trigger_reason review_status review_record_id "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_relations": ExcludedTable(
        columns=names(
            "knowledge_release_id relation_id source_knowledge_id target_knowledge_id "
            "relation_type direction description evidence_source_ids evidence_grade "
            "content_version review_status "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_releases": ExcludedTable(
        columns=names(
            "knowledge_release_id level content_hash build_config_version manifest "
            "is_current built_at "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_sources": ExcludedTable(
        columns=names(
            "knowledge_release_id source_id source_type title authors_or_institution year "
            "publication locator url verification_status use_boundary "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
    "knowledge_theory_profiles": ExcludedTable(
        columns=names(
            "knowledge_release_id theory_id related_knowledge_ids title core_propositions "
            "applicable_phenomena analysis_levels prerequisites exclusion_signals "
            "observable_evidence competing_or_complementary_theory_ids source_ids "
            "content_version review_status match_eligible "
        ),
        reason="Global reference catalog, not user-owned; personal citations remain portable.",
    ),
}

# Tables defined by raw SQL migrations are classified too. They contain operator
# prices, procurement and dispatch state. Customer receipts remain available via
# /account/credits; the personal ledger/quota records above are portable.
EXCLUDED.update(
    {
        "billing_operations": ExcludedTable(
            names(
                "run_id user_id fingerprint status hold_points exempt price_json credit_pico "
                "original_credit_pico charged_points created_at updated_at quota_period_epoch"
            ),
            "Internal billing operation; public charges are exported in credit_ledger.",
        ),
        "billing_attempts": ExcludedTable(
            names(
                "attempt_id run_id endpoint_id route_id request_hash requested_model "
                "returned_model "
                "provider_response_id outcome usage_state billable input_limit output_limit "
                "reserved_cost_pico reference_cost_pico procurement_cost_pico input_tokens "
                "cache_read_tokens cache_write_tokens output_tokens reasoning_tokens "
                "raw_usage_json "
                "provider_host api_type requested_effort requested_service_tier "
                "returned_service_tier "
                "finish_reason procurement_status overrun_cost_pico failure_code price_json "
                "created_at updated_at dispatch_state provider_request_id"
            ),
            "Procurement/dispatch audit; customer receipts use the billing public projection.",
        ),
        "billing_precision": ExcludedTable(
            ("user_id", "total_credit_pico"),
            "Internal settlement accumulator.",
        ),
        "alembic_version": ExcludedTable(("version_num",), "Migration bookkeeping."),
    }
)

# SQLite FTS projections/shadow tables duplicate content or contain index pages.
# List exact physical names and columns so new tables never inherit an exception.
EXCLUDED.update(
    {
        "knowledge_search_fts": ExcludedTable(
            ("knowledge_release_id", "knowledge_id", "title", "content", "category", "dimension"),
            "Search projection of the global reference catalog.",
        ),
        "knowledge_search_fts_config": ExcludedTable(("k", "v"), "FTS configuration."),
        "knowledge_search_fts_content": ExcludedTable(
            ("id", "c0", "c1", "c2", "c3", "c4", "c5"),
            "FTS content shadow; source records classified.",
        ),
        "knowledge_search_fts_data": ExcludedTable(("id", "block"), "FTS index pages."),
        "knowledge_search_fts_docsize": ExcludedTable(("id", "sz"), "FTS index sizes."),
        "knowledge_search_fts_idx": ExcludedTable(("segid", "term", "pgno"), "FTS index terms."),
        "research_material_search": ExcludedTable(
            ("material_id", "parse_id", "segment_id", "title", "text"),
            "Search projection; personal source files and parsed blocks are exported.",
        ),
        "research_material_search_config": ExcludedTable(("k", "v"), "FTS configuration."),
        "research_material_search_content": ExcludedTable(
            ("id", "c0", "c1", "c2", "c3", "c4"),
            "FTS content shadow; source records classified.",
        ),
        "research_material_search_data": ExcludedTable(("id", "block"), "FTS index pages."),
        "research_material_search_docsize": ExcludedTable(("id", "sz"), "FTS index sizes."),
        "research_material_search_idx": ExcludedTable(
            ("segid", "term", "pgno"), "FTS index terms."
        ),
    }
)
