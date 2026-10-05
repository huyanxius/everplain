from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from qunxue_api.api.contracts.research_tasks import ResearchTaskNavigationResponse
from qunxue_api.modules.research_intake import ResearchStartProposal


class AgentMaterialContextRequest(BaseModel):
    conversation_id: UUID | None = None


class AgentMaterialContextResponse(BaseModel):
    conversation_id: UUID
    task_id: UUID


class AgentCitationResponse(BaseModel):
    citation_id: str
    label: str
    kind: str
    excerpt: str | None = None
    knowledge_id: str | None = None
    source_id: str | None = None
    source_kind: str | None = None
    material_id: str | None = None
    parse_id: str | None = None
    segment_id: str | None = None
    locator: dict[str, object] | None = None
    deleted: bool = False
    knowledge_base_id: str | None = None


class AgentMessageResponse(BaseModel):
    message_id: UUID
    role: str
    content: str
    citations: list[AgentCitationResponse] = Field(default_factory=list)
    sequence: int
    created_at: datetime


class AgentToolTraceResponse(BaseModel):
    tool: str
    phase: Literal["started", "finished", "failed"]
    call_id: str
    input: dict[str, object] | None = None
    output: object | None = None
    detail: str | None = None
    error: str | None = None


class AgentResearchMapNodeResponse(BaseModel):
    user_edited: bool = Field(default=False, exclude_if=lambda value: not value)
    id: str
    kind: Literal["question", "theory", "claim", "evidence", "gap", "synthesis"]
    title: str
    summary: str | None = None
    status: Literal["developing", "grounded", "open", "verified", "challenged", "complete"]
    citation_ids: list[str]


class AgentResearchMapRelationResponse(BaseModel):
    id: str
    source: str
    target: str
    relation: Literal["explains", "supports", "challenges", "derives", "refines"]
    label: str | None = None


class AgentResearchMapPatchResponse(BaseModel):
    schema_version: Literal[1]
    nodes: list[AgentResearchMapNodeResponse]
    relations: list[AgentResearchMapRelationResponse]
    remove_node_ids: list[str]
    remove_relation_ids: list[str]


class AgentResearchMapResponse(BaseModel):
    schema_version: Literal[1]
    nodes: list[AgentResearchMapNodeResponse]
    relations: list[AgentResearchMapRelationResponse]


class AgentTurnResponse(BaseModel):
    turn_id: UUID
    user: AgentMessageResponse
    assistant: AgentMessageResponse
    tool_traces: list[AgentToolTraceResponse] = Field(default_factory=list)
    knowledge_release_id: str | None = None
    canvas_patches: list[AgentResearchMapPatchResponse] = Field(default_factory=list)


class AgentConversationSummaryResponse(BaseModel):
    reference_knowledge_base_id: UUID | None = None
    task_id: UUID | None = None
    conversation_id: UUID
    title: str
    updated_at: datetime
    turn_count: int


class AgentConversationResponse(AgentConversationSummaryResponse):
    canvas_edit_version: int = 0
    created_at: datetime
    turns: list[AgentTurnResponse]
    research_map: AgentResearchMapResponse
    unfinished_runs: list["AgentRunRecoveryResponse"] = Field(default_factory=list)


class AgentConversationListResponse(BaseModel):
    items: list[AgentConversationSummaryResponse]


class AgentConversationUpdateRequest(BaseModel):
    title: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    ]


class KnowledgeIndexDocumentResponse(BaseModel):
    knowledge_base_id: UUID
    document_id: UUID
    parse_id: UUID
    filename: str
    index_status: str
    index_error: str | None = None
    reason: str | None = None
    stage: Literal["ready", "index", "knowledge"] = "index"
    knowledge_status: str | None = None
    knowledge_error: str | None = None


class KnowledgeIndexStatusResponse(BaseModel):
    purpose: Literal["search", "graph"] = "search"
    state: Literal["ready", "missing_index", "unavailable"]
    embedding_model: str | None
    total_count: int
    ready_count: int
    missing_count: int
    processing_count: int
    failed_count: int
    ready_document_ids: list[UUID]
    ready_documents: list[KnowledgeIndexDocumentResponse]
    missing_documents: list[KnowledgeIndexDocumentResponse]


class KnowledgeIndexRepairDocument(BaseModel):
    knowledge_base_id: UUID
    document_id: UUID
    parse_id: UUID


class KnowledgeIndexRepairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: Literal["search", "graph"] = "search"
    documents: list[KnowledgeIndexRepairDocument] = Field(min_length=1, max_length=1000)
    reference_knowledge_base_id: UUID | None = None


class KnowledgeIndexChoiceResponse(BaseModel):
    code: Literal["knowledge_index_choice_required"] = "knowledge_index_choice_required"
    status: KnowledgeIndexStatusResponse


class AgentWritingContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: UUID
    document_version: int = Field(ge=1, strict=True)
    selection_start: int | None = Field(default=None, ge=0, strict=True)
    selection_end: int | None = Field(default=None, ge=0, strict=True)

    @model_validator(mode="after")
    def validate_selection(self):
        if (self.selection_start is None) != (self.selection_end is None):
            raise ValueError("selection_start and selection_end must be supplied together")
        if self.selection_start is not None and self.selection_end < self.selection_start:
            raise ValueError("selection_end must not precede selection_start")
        return self


class AgentTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str | None = Field(default=None, min_length=1, max_length=80)
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] | None = None

    @model_validator(mode="after")
    def require_model_for_effort(self):
        if self.reasoning_effort is not None and self.model_id is None:
            raise ValueError("model_id is required when reasoning_effort is specified")
        return self

    reference_knowledge_base_id: UUID | None = None
    knowledge_index_action: Literal["skip_missing"] | None = None
    conversation_id: UUID | None = None
    message: str = Field(min_length=1, max_length=12000)
    workspace: Literal["agent", "research"] = "agent"
    web_search: bool = False
    task_id: UUID | None = None
    document_id: UUID | None = None
    section_id: str | None = None
    document_version: int | None = None
    writing_context: AgentWritingContext | None = None
    theory_plan_id: UUID | None = None
    material_ids: tuple[UUID, ...] = Field(default=(), max_length=20)
    mode: Literal["standard", "deep_research"] = "standard"
    deep_research_run_id: UUID | None = None
    deep_research_action: Literal["clarify", "confirm", "skip"] | None = None
    deep_research_selection: str | None = Field(default=None, max_length=4000)


class AgentModelChoiceResponse(BaseModel):
    model_id: str
    label: str
    reasoning_efforts: list[Literal["none", "low", "medium", "high", "xhigh", "max"]]
    default_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] | None


class AgentModelCatalogResponse(BaseModel):
    items: list[AgentModelChoiceResponse]
    runtime_mode: Literal["mock", "base", "sft"]


class AgentRunRecoveryResponse(BaseModel):
    run_id: UUID
    idempotency_key: str
    status: Literal[
        "running", "failed", "interrupted", "awaiting_clarification", "awaiting_plan_confirmation"
    ]
    request: AgentTurnRequest
    partial_answer: str
    tool_summary: list[dict[str, object]] = Field(default_factory=list)
    updated_at: datetime
    cancel_requested: bool


class AgentRunStopResponse(BaseModel):
    run_id: UUID
    status: Literal[
        "running",
        "completed",
        "failed",
        "interrupted",
        "awaiting_clarification",
        "awaiting_plan_confirmation",
    ]
    cancel_requested: bool


class AgentRunLookupResponse(BaseModel):
    """Owner-scoped observation only; looking up a run never resumes it."""

    run_id: UUID
    conversation_id: UUID
    idempotency_key: str
    status: Literal[
        "running",
        "completed",
        "failed",
        "interrupted",
        "awaiting_clarification",
        "awaiting_plan_confirmation",
    ]
    cancel_requested: bool
    partial_answer: str
    request: AgentTurnRequest | None
    updated_at: datetime
    turn_id: UUID | None


class ResearchStartProposalResponse(BaseModel):
    proposal_id: UUID
    conversation_id: UUID
    source_run_id: UUID
    source_turn_id: UUID
    knowledge_release_id: str
    phenomenon: str
    research_intent: str | None
    context: str | None
    version: int
    status: Literal["pending_confirmation", "confirmed"]
    requires_user_confirmation: bool
    confirmed_task_id: UUID | None
    created_at: datetime
    confirmed_at: datetime | None

    @classmethod
    def from_domain(cls, proposal: ResearchStartProposal) -> "ResearchStartProposalResponse":
        return cls(
            proposal_id=proposal.proposal_id,
            conversation_id=proposal.conversation_id,
            source_run_id=proposal.source_run_id,
            source_turn_id=proposal.source_turn_id,
            knowledge_release_id=proposal.knowledge_release_id,
            phenomenon=proposal.phenomenon,
            research_intent=proposal.research_intent,
            context=proposal.context,
            version=proposal.version,
            status=proposal.status.value,
            requires_user_confirmation=proposal.confirmed_task_id is None,
            confirmed_task_id=proposal.confirmed_task_id,
            created_at=proposal.created_at,
            confirmed_at=proposal.confirmed_at,
        )


class ConfirmResearchStartRequest(BaseModel):
    expected_version: int = Field(ge=1)
    phenomenon: str = Field(min_length=1, max_length=10000)
    research_intent: str | None = Field(default=None, max_length=4000)
    context: str | None = Field(default=None, max_length=10000)


class ConfirmResearchStartResponse(BaseModel):
    conversation_id: UUID
    status: Literal["task_bound"]
    task_id: UUID
    proposal: ResearchStartProposalResponse
    navigation: ResearchTaskNavigationResponse


class AgentResearchJourneyResponse(BaseModel):
    conversation_id: UUID
    status: Literal["collecting", "proposal_pending", "task_bound"]
    task_id: UUID | None
    proposal: ResearchStartProposalResponse | None
    navigation: ResearchTaskNavigationResponse | None


class AgentCanvasNodeEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
    summary: str = Field(max_length=1200)
    expected_title: str = Field(max_length=240)
    expected_summary: str | None = Field(default=None, max_length=1200)
    expected_version: int = Field(ge=0)


class ConversationExcerptResponse(BaseModel):
    message_id: UUID
    sequence: int
    excerpt: str


class RecentConversationContextResponse(BaseModel):
    conversation_id: UUID
    title: str
    updated_at: datetime
    kind: Literal["user_excerpt"]
    excerpt: str
    source_message_id: UUID | None
    recent_excerpts: list[ConversationExcerptResponse]


class RecentConversationContextsResponse(BaseModel):
    items: list[RecentConversationContextResponse]


class ConversationSummarySourceResponse(BaseModel):
    role: Literal["user", "assistant"]
    sequence: int = Field(ge=0)
    conversation_id: UUID
    message_id: UUID
    quote: str
    title: str


class ConversationSuggestionResponse(BaseModel):
    title: str
    description: str
    prompt: str
    sources: list[ConversationSummarySourceResponse]


class ConversationSummaryResponse(BaseModel):
    status: Literal["ready", "pending", "empty", "disabled", "failed"]
    summary: str
    summary_sources: list[ConversationSummarySourceResponse]
    cards: list[ConversationSuggestionResponse]
    updated_at: datetime | None
    scope: Literal["conversation_messages"]
    omitted_messages: int
    status_reason: Literal[
        "queued", "active_run", "idle_wait", "generating", "retry_wait",
        "daily_budget", "attempt_limit", "generation_failed", "generator_unavailable",
    ] | None = None
    retry_at: datetime | None = None
