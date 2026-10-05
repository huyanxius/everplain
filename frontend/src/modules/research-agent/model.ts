export type AgentCitation = {
  knowledge_base_id?: string | null
  citation_id: string
  label: string
  kind: string
  excerpt?: string | null
  knowledge_id?: string | null
  source_id?: string | null
  source_kind?: string | null
  material_id?: string | null
  parse_id?: string | null
  segment_id?: string | null
  locator?: Record<string, unknown> | null
  deleted?: boolean
}

export type AgentResearchNodeKind = 'question' | 'theory' | 'claim' | 'evidence' | 'gap' | 'synthesis'
export type AgentResearchNodeStatus = 'developing' | 'grounded' | 'open' | 'verified' | 'challenged' | 'complete'
export type AgentResearchRelationKind = 'explains' | 'supports' | 'challenges' | 'derives' | 'refines'

export type AgentResearchMapNode = {
  user_edited?: boolean
  id: string
  kind: AgentResearchNodeKind
  title: string
  summary?: string | null
  status: AgentResearchNodeStatus
  citation_ids: string[]
}

export type AgentResearchMapRelation = {
  id: string
  source: string
  target: string
  relation: AgentResearchRelationKind
  label?: string | null
}

export type AgentResearchMapPatch = {
  schema_version: 1
  nodes: AgentResearchMapNode[]
  relations: AgentResearchMapRelation[]
  remove_node_ids: string[]
  remove_relation_ids: string[]
}

export type AgentResearchMap = {
  schema_version: 1
  nodes: AgentResearchMapNode[]
  relations: AgentResearchMapRelation[]
}

export type AgentMessage = {
  message_id: string
  role: 'user' | 'assistant'
  content: string
  citations: AgentCitation[]
  sequence: number
  created_at: string
}

export type AgentToolTrace = {
  tool: string
  phase: 'started' | 'finished' | 'failed'
  call_id: string
  input?: Record<string, unknown> | null
  output?: unknown
  detail?: string | null
  error?: string | null
}

export type AgentDeliveryState = {
  output_finish_reason?: 'complete' | 'truncated' | 'rejected' | 'upstream_error'
  usage_status?: 'known' | 'pending'
  settlement_status?: 'settled' | 'pending'
  receipt_persistence?: 'saved' | 'unsaved'
  quota_exhausted?: boolean
}

export type AgentOutputAttempt = {
  attempt_id: string
  ordinal: number
  status: string
  answer: string
  created_at: string
}

export type AgentTurn = {
  turn_id: string
  user: AgentMessage
  assistant: AgentMessage
  tool_traces?: AgentToolTrace[]
  knowledge_release_id?: string | null
  canvas_patches?: AgentResearchMapPatch[]
  output_attempts?: AgentOutputAttempt[]
  delivery_state?: AgentDeliveryState
}

export type AgentConversationSummary = {
  reference_knowledge_base_id?: string | null
  task_id?: string | null
  conversation_id: string
  title: string
  updated_at: string
  turn_count: number
}

// 恢复时使用接受问题时的完整上下文，避免入口或编辑位置变化改变原轮次。
export type AgentReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AgentModelCatalog = {
  runtimeMode: 'mock' | 'base' | 'sft'
  models: readonly {
    id: string
    label: string
    reasoningEfforts: readonly AgentReasoningEffort[]
    defaultReasoningEffort: AgentReasoningEffort | null
  }[]
}

export type AgentTurnRequest = {
  knowledge_index_action?: 'skip_missing' | null
  model_id?: string | null
  reasoning_effort?: AgentReasoningEffort | null
  reference_knowledge_base_id?: string | null
  conversation_id?: string | null
  message: string
  mode?: 'standard' | 'deep_research'
  workspace?: 'agent' | 'research'
  web_search?: boolean
  task_id?: string | null
  document_id?: string | null
  section_id?: string | null
  document_version?: number | null
  writing_context?: { document_id: string; document_version: number; selection_start?: number | null; selection_end?: number | null } | null
  theory_plan_id?: string | null
  material_ids?: string[]
  deep_research_run_id?: string | null
  deep_research_action?: 'clarify' | 'confirm' | 'skip' | null
  deep_research_selection?: string | null
}

type AgentUnfinishedRunStatus = 'running' | 'failed' | 'interrupted' | 'awaiting_clarification' | 'awaiting_plan_confirmation'

export type AgentRunRecovery = {
  run_id: string
  idempotency_key: string
  status: AgentUnfinishedRunStatus
  request: AgentTurnRequest
  partial_answer: string
  output_attempts?: AgentOutputAttempt[]
  delivery_state?: AgentDeliveryState
  last_event_sequence?: number
  tool_summary?: Record<string, unknown>[]
  updated_at: string
  cancel_requested: boolean
}

export type AgentRunStopResult = {
  run_id: string
  status: AgentUnfinishedRunStatus | 'completed'
  cancel_requested: boolean
}

export type AgentConversation = AgentConversationSummary & {
  canvas_edit_version?: number
  created_at: string
  turns: AgentTurn[]
  research_map?: AgentResearchMap
  unfinished_runs?: AgentRunRecovery[]
}

export type AgentRuntimeMode = 'mock' | 'base' | 'sft'

export type AgentToolStep = {
  id: string
  tool: string
  label: string
  status: 'running' | 'completed' | 'failed'
  input?: unknown
  output?: unknown
  detail?: string | null
}

export type AgentStreamResume = { runId: string; after: number }

export type AgentRunLookup = AgentRunStopResult & {
  output_persistence_failed?: boolean
  conversation_id: string
  idempotency_key: string
  partial_answer: string
  output_attempts?: AgentOutputAttempt[]
  delivery_state?: AgentDeliveryState
  last_event_sequence: number
}

export type AgentEvent = AgentEventData & { event_id?: string; attempt_id?: string }

type AgentEventData =
  | { type: 'turn_started'; conversation_id: string; run_id: string; replayed: boolean; runtime_mode?: AgentRuntimeMode; attempt_id?: string; output_attempts?: AgentOutputAttempt[] }
  | { type: 'turn_snapshot'; run: AgentRunLookup }
  | { type: 'agent_delivery_state'; delivery_state: AgentDeliveryState }
  | { type: 'agent_status'; status: 'thinking' | 'answering' }
  | {
      type: 'tool_started'
      tool: string
      call_id: string | null
      input?: unknown
      detail?: string | null
    }
  | {
      type: 'tool_finished'
      tool: string
      call_id: string | null
      output?: unknown
      detail?: string | null
    }
  | {
      type: 'tool_failed'
      tool: string
      call_id: string | null
      input?: unknown
      message: string
      error_code: string | null
      detail: string | null
    }
  | { type: 'assistant_delta'; delta: string; persisted?: boolean }
  | { type: 'output_persistence_failed'; message: string }
  | { type: 'research_ask'; question: string; options: string[] }
  | { type: 'research_plan'; title: string; steps: string[] }
  | { type: 'research_step'; step: string; status?: string }
  | { type: 'research_result'; summary?: string; knowledge_count?: number; web_count?: number }
  | { type: 'research_waiting'; run_id: string; state: 'awaiting_clarification' | 'awaiting_plan_confirmation'; title?: string; question?: string; options?: string[]; steps?: string[]; prompt?: string; selected_intent?: string }
  | { type: 'citation_added'; citation: AgentCitation }
  | { type: 'canvas_patch'; patch: AgentResearchMapPatch }
  | { type: 'turn_completed'; conversation: AgentConversation; knowledge_release_id: string; delivery_state?: AgentDeliveryState }
  | { type: 'turn_interrupted'; code: string; message: string }
  | { type: 'knowledge_index_choice_required'; status: KnowledgeIndexStatus }
  | { type: 'turn_failed'; code: string; message: string }

export type RecentConversationContext = {
  conversation_id: string
  title: string
  updated_at: string
  kind: 'user_excerpt'
  excerpt: string
  source_message_id: string | null
  recent_excerpts: { message_id: string; sequence: number; excerpt: string }[]
}

export type ConversationContextSource = {
  sequence: number
  role: 'user' | 'assistant'
  conversation_id: string
  message_id: string
  quote: string
  title: string
}
export type ConversationContextSuggestion = {
  title: string
  description: string
  prompt: string
  sources: ConversationContextSource[]
}
export type ConversationContextSummary = {
  status: 'ready' | 'pending' | 'empty' | 'disabled' | 'failed'
  summary: string
  summary_sources: ConversationContextSource[]
  cards: ConversationContextSuggestion[]
  updated_at: string | null
  scope: 'conversation_messages'
  omitted_messages: number
  status_reason?: 'queued' | 'active_run' | 'idle_wait' | 'generating' | 'retry_wait' | 'daily_budget' | 'attempt_limit' | 'generation_failed' | 'generator_unavailable' | null
  retry_at?: string | null
}

export type KnowledgeIndexDocument = {
  stage?: 'ready' | 'index' | 'knowledge'
  knowledge_status?: string | null
  knowledge_error?: string | null
  knowledge_base_id: string
  document_id: string
  parse_id: string
  filename: string
  index_status: string
  index_error?: string | null
  reason?: string | null
}
export type KnowledgeIndexStatus = {
  purpose?: 'search' | 'graph'
  state: 'ready' | 'missing_index' | 'unavailable'
  embedding_model: string | null
  total_count: number
  ready_count: number
  missing_count: number
  processing_count: number
  failed_count: number
  ready_document_ids: string[]
  ready_documents: KnowledgeIndexDocument[]
  missing_documents: KnowledgeIndexDocument[]
}
export type KnowledgeIndexRepair = {
  purpose?: 'search' | 'graph'
  documents: Pick<KnowledgeIndexDocument, 'knowledge_base_id' | 'document_id' | 'parse_id'>[]
  reference_knowledge_base_id?: string | null
}
