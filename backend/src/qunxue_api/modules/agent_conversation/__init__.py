"""Knowledge-first conversational Agent domain and application service."""

from qunxue_api.modules.agent_conversation.domain import (
    AgentCitation,
    AgentMaterialAttachment,
    AgentMessage,
    AgentOutputAttempt,
    AgentOutputEvent,
    AgentRun,
    AgentTurn,
    Conversation,
    IdempotentTurn,
    UserConversation,
    display_card,
)
from qunxue_api.modules.agent_conversation.errors import (
    AgentConversationError,
    AgentInterrupted,
    AgentModelRouteFailure,
    AgentOutputStorageFailure,
    ConversationNotFound,
    ConversationTaskBindingConflict,
    ResearchMaterialCitationUnavailable,
    RunAlreadyActive,
)
from qunxue_api.modules.agent_conversation.ports import (
    AgentEvidence,
    AgentRelease,
    AgentResearchEvent,
    AgentRunResult,
    AgentRuntimeIdentity,
    AgentTerminalEventBatch,
    AgentTerminalJournalFailure,
    AgentToolContext,
    AgentToolEvent,
    AgentWritingPreviewEvent,
    SubjectAgentRunner,
)
from qunxue_api.modules.agent_conversation.research_map import (
    aggregate_research_map,
    apply_research_map_patch,
    empty_research_map,
    normalize_research_map_patch,
    patches_from_tool_summary,
)
from qunxue_api.modules.agent_conversation.service import ConversationService

from .canvas_editing import CanvasEditConflict, apply_canvas_edits, prepare_canvas_edit
from .context import excerpt, merge_digest, render_recent_context
from .context_suggestion import (
    ContextSuggestionUnavailable,
    project_context_card_prompt,
    render_context_suggestion,
)
from .model_selection import (
    LUNA_REASONING_EFFORTS,
    MOCK_AGENT_MODEL_CHOICES,
    AgentModelChoice,
    AgentModelSelection,
    AgentModelSelectionUnavailable,
    AgentReasoningEffort,
    resolve_agent_model_selection,
)
from .writing_preview import validated_writing_preview

__all__ = [
    "ContextSuggestionUnavailable",
    "display_card",
    "project_context_card_prompt",
    "render_context_suggestion",
    "validated_writing_preview",
    "excerpt",
    "ContextSummaryBatch",
    "ContextSummaryGenerationFailure",
    "ContextSummaryRepository",
    "merge_digest",
    "render_recent_context",
    "AgentModelRouteFailure",
    "AgentOutputStorageFailure",
    "AgentModelChoice",
    "AgentModelSelection",
    "AgentModelSelectionUnavailable",
    "AgentReasoningEffort",
    "LUNA_REASONING_EFFORTS",
    "MOCK_AGENT_MODEL_CHOICES",
    "resolve_agent_model_selection",
    "CanvasEditConflict",
    "apply_canvas_edits",
    "prepare_canvas_edit",
    "AgentCitation",
    "AgentMaterialAttachment",
    "AgentEvidence",
    "AgentRelease",
    "AgentRuntimeIdentity",
    "AgentTerminalEventBatch",
    "AgentTerminalJournalFailure",
    "AgentRunResult",
    "AgentResearchEvent",
    "AgentToolContext",
    "AgentToolEvent",
    "AgentWritingPreviewEvent",
    "AgentConversationError",
    "AgentInterrupted",
    "ConversationTaskBindingConflict",
    "AgentMessage",
    "AgentOutputAttempt",
    "AgentOutputEvent",
    "AgentRun",
    "AgentTurn",
    "Conversation",
    "ConversationNotFound",
    "ConversationService",
    "IdempotentTurn",
    "ResearchMaterialCitationUnavailable",
    "RunAlreadyActive",
    "UserConversation",
    "SubjectAgentRunner",
    "aggregate_research_map",
    "apply_research_map_patch",
    "empty_research_map",
    "normalize_research_map_patch",
    "patches_from_tool_summary",
]

from .summary import (
    ContextSummaryBatch,
    ContextSummaryGenerationFailure,
    ContextSummaryRepository,
)
