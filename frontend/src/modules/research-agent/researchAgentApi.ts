import { isKnowledgeIndexStatus } from './knowledgeIndexReadiness'
import { getAgentKnowledgeIndexStatus, repairAgentKnowledgeIndex, editAgentCanvasNode, listAgentModels, readConversationSummary, type AgentCanvasNodeEditRequest } from '../../api/generated'
import { apiClient } from '../../api/client'
import type {
  AgentResearchJourneyResponse,
  AgentRunStopResponse,
  AgentTurnRequest as AgentTurnRequestDto,
} from '../../api/generated'
import type {
  RecentConversationContext,
  ConversationContextSummary,
  KnowledgeIndexStatus,
  KnowledgeIndexRepair,
  AgentModelCatalog,
  AgentCitation,
  AgentConversation,
  AgentConversationSummary,
  AgentEvent,
  AgentResearchMapPatch,
  AgentTurnRequest,
  AgentRunStopResult,
  AgentRunLookup,
  AgentStreamResume,
} from './model'
import type { ResearchStartJourney } from './researchStart'

function toResearchStartJourney(response: AgentResearchJourneyResponse): ResearchStartJourney {
  return {
    conversationId: response.conversation_id,
    status: response.status,
    taskId: response.task_id,
    proposal: response.proposal
      ? {
          proposalId: response.proposal.proposal_id,
          phenomenon: response.proposal.phenomenon,
          researchIntent: response.proposal.research_intent,
          context: response.proposal.context,
          version: response.proposal.version,
          status: response.proposal.status,
        }
      : null,
    knowledgeReleaseId: response.proposal?.knowledge_release_id ?? response.navigation?.knowledge_release_id ?? null,
    // 文件上传也会绑定草稿任务；只有已确认现象才允许跳过研究起点提案。
    phenomenonConfirmed: Boolean(response.navigation?.phenomenon_summary),
    resumePath: response.navigation?.resume_path ?? null,
  }
}

export function parseAgentEventStream(stream: string): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const block of stream.split(/\n\n+/)) {
    const before = events.length
    const eventId = block.match(/^id:\s*(.+)$/m)?.[1]
    const eventName = block.match(/^event:\s*(.+)$/m)?.[1]
    const data = block.match(/^data:\s*(.+)$/m)?.[1]
    if (!eventName || !data) continue
    const payload = JSON.parse(data) as Record<string, unknown>
    if (eventName === 'agent_status' && (payload.status === 'thinking' || payload.status === 'answering')) {
      events.push({ type: eventName, status: payload.status })
    } else if (eventName === 'tool_started' && typeof payload.tool === 'string') {
      const event: Extract<AgentEvent, { type: 'tool_started' }> = {
        type: eventName,
        tool: payload.tool,
        call_id: typeof payload.call_id === 'string' ? payload.call_id : null,
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      }
      if ('input' in payload || 'arguments' in payload) {
        event.input = payload.input ?? payload.arguments
      }
      events.push(event)
    } else if (eventName === 'tool_finished' && typeof payload.tool === 'string') {
      const event: Extract<AgentEvent, { type: 'tool_finished' }> = {
        type: eventName,
        tool: payload.tool,
        call_id: typeof payload.call_id === 'string' ? payload.call_id : null,
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      }
      if ('output' in payload) event.output = payload.output
      events.push(event)
    } else if (eventName === 'tool_failed' && typeof payload.tool === 'string') {
      const event: Extract<AgentEvent, { type: 'tool_failed' }> = {
        type: eventName,
        tool: payload.tool,
        call_id: typeof payload.call_id === 'string' ? payload.call_id : null,
        message: String(payload.message ?? payload.detail ?? payload.error ?? '工具调用失败'),
        error_code: typeof payload.error_code === 'string' ? payload.error_code : null,
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      }
      if ('input' in payload) event.input = payload.input
      events.push(event)
    } else if (eventName === 'writing_preview') {
      const event = parseWritingPreview(payload)
      if (event) events.push(event)
    } else if (eventName === 'assistant_delta' && typeof payload.delta === 'string') {
      events.push({ type: eventName, delta: payload.delta, ...(payload.persisted === false ? { persisted: false } : {}) })
    } else if (eventName === 'agent_delivery_state') {
      events.push({ type: eventName, delivery_state: payload as AgentRunLookup['delivery_state'] })
    } else if (eventName === 'output_persistence_failed') {
      events.push({ type: eventName, message: String(payload.message ?? '正文尚未保存，请先复制保留。') })
    } else if (eventName === 'research_ask' && typeof payload.question === 'string' && Array.isArray(payload.options)) {
      events.push({
        type: eventName,
        question: payload.question,
        options: payload.options.filter((item): item is string => typeof item === 'string'),
      })
    } else if (eventName === 'research_plan' && typeof payload.title === 'string' && Array.isArray(payload.steps)) {
      events.push({
        type: eventName,
        title: payload.title,
        steps: payload.steps.filter((item): item is string => typeof item === 'string'),
      })
    } else if (eventName === 'research_step' && typeof payload.step === 'string') {
      events.push({ type: eventName, step: payload.step, status: typeof payload.status === 'string' ? payload.status : undefined })
    } else if (eventName === 'research_result') {
      events.push({
        type: eventName,
        summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        knowledge_count: typeof payload.knowledge_count === 'number' ? payload.knowledge_count : undefined,
        web_count: typeof payload.web_count === 'number' ? payload.web_count : undefined,
      })
    } else if (eventName === 'research_waiting' && typeof payload.run_id === 'string' && (payload.state === 'awaiting_clarification' || payload.state === 'awaiting_plan_confirmation')) {
      events.push({
        type: eventName,
        run_id: payload.run_id,
        state: payload.state,
        title: typeof payload.title === 'string' ? payload.title : undefined,
        question: typeof payload.question === 'string' ? payload.question : undefined,
        options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === 'string') : undefined,
        steps: Array.isArray(payload.steps) ? payload.steps.filter((item): item is string => typeof item === 'string') : undefined,
        prompt: typeof payload.prompt === 'string' ? payload.prompt : undefined,
        selected_intent: typeof payload.selected_intent === 'string' ? payload.selected_intent : undefined,
      })
    } else if (eventName === 'citation_added' && payload.citation_id) {
      events.push({ type: eventName, citation: payload as unknown as AgentCitation })
    } else if (eventName === 'canvas_patch' && isResearchMapPatch(payload)) {
      events.push({ type: eventName, patch: payload })
    } else if (eventName === 'turn_started' && payload.conversation_id && payload.run_id) {
      events.push({
        type: eventName,
        conversation_id: String(payload.conversation_id),
        run_id: String(payload.run_id),
        replayed: payload.replayed === true,
        ...(typeof payload.attempt_id === 'string' ? { attempt_id: payload.attempt_id } : {}),
        ...(Array.isArray(payload.output_attempts) ? { output_attempts: payload.output_attempts as AgentConversation['turns'][number]['output_attempts'] } : {}),
        ...(payload.runtime_mode === 'mock' || payload.runtime_mode === 'base' || payload.runtime_mode === 'sft'
          ? { runtime_mode: payload.runtime_mode }
          : {}),
      })
    } else if (eventName === 'turn_snapshot' && typeof payload.run_id === 'string') {
      const writingPreviews = writingPreviewsFromSnapshot(payload)
      events.push({ type: eventName, run: { ...payload, writing_previews: writingPreviews } as unknown as AgentRunLookup })
    } else if (eventName === 'turn_completed' && payload.conversation) {
      events.push({
        type: eventName,
        conversation: payload.conversation as AgentConversation,
        knowledge_release_id: String(payload.knowledge_release_id ?? ''),
        ...(payload.delivery_state && typeof payload.delivery_state === 'object' ? { delivery_state: payload.delivery_state as AgentRunLookup['delivery_state'] } : {}),
      })
    } else if (eventName === 'turn_interrupted') {
      events.push({
        type: eventName,
        code: String(payload.code ?? 'interrupted'),
        message: String(payload.message ?? '已停止生成。'),
      })
    } else if (eventName === 'knowledge_index_choice_required' && isKnowledgeIndexStatus(payload.status)) {
      events.push({ type: eventName, status: payload.status })
    } else if (eventName === 'turn_failed') {
      events.push({
        type: eventName,
        code: String(payload.code ?? 'agent_unavailable'),
        message: String(payload.message ?? 'Agent 暂时无法完成回答。'),
      })
    }
    if (events.length > before) {
      if (eventId) events[events.length - 1].event_id = eventId
      if (typeof payload.attempt_id === 'string') events[events.length - 1].attempt_id = payload.attempt_id
    }
  }
  return events
}

function isResearchMapPatch(value: Record<string, unknown>): value is AgentResearchMapPatch {
  return value.schema_version === 1
    && Array.isArray(value.nodes)
    && Array.isArray(value.relations)
    && Array.isArray(value.remove_node_ids)
    && Array.isArray(value.remove_relation_ids)
    && value.nodes.every(isResearchMapNode)
    && value.relations.every(isResearchMapRelation)
    && value.remove_node_ids.every((id) => typeof id === 'string' && id.length > 0)
    && value.remove_relation_ids.every((id) => typeof id === 'string' && id.length > 0)
}

const researchNodeKinds = new Set(['question', 'theory', 'claim', 'evidence', 'gap', 'synthesis'])
const researchNodeStatuses = new Set(['developing', 'grounded', 'open', 'verified', 'challenged', 'complete'])
const researchRelationKinds = new Set(['explains', 'supports', 'challenges', 'derives', 'refines'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isResearchMapNode(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.kind === 'string'
    && researchNodeKinds.has(value.kind)
    && typeof value.title === 'string'
    && value.title.length > 0
    && (value.summary === undefined || value.summary === null || typeof value.summary === 'string')
    && typeof value.status === 'string'
    && researchNodeStatuses.has(value.status)
    && Array.isArray(value.citation_ids)
    && value.citation_ids.every((id) => typeof id === 'string' && id.length > 0)
}

function isResearchMapRelation(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.source === 'string'
    && value.source.length > 0
    && typeof value.target === 'string'
    && value.target.length > 0
    && typeof value.relation === 'string'
    && researchRelationKinds.has(value.relation)
    && (value.label === undefined || value.label === null || typeof value.label === 'string')
}

export async function getAgentModelCatalog(signal?: AbortSignal): Promise<AgentModelCatalog> {
  const result = await listAgentModels({ client: apiClient, signal })
  if (!result.data) throw new Error('无法加载可用模型，请重试。')
  return {
    runtimeMode: result.data.runtime_mode,
    models: result.data.items.map(item => ({
      id: item.model_id,
      label: item.label,
      reasoningEfforts: item.reasoning_efforts,
      defaultReasoningEffort: item.default_reasoning_effort,
    })),
  }
}

export async function listAgentConversations(signal?: AbortSignal): Promise<AgentConversationSummary[]> {
  const response = await fetch(apiClient.buildUrl({ url: '/api/agent/conversations' }), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error('无法加载对话记录')
  return ((await response.json()) as { items: AgentConversationSummary[] }).items
}

export async function getAgentConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<AgentConversation> {
  const response = await fetch(apiClient.buildUrl({
    url: '/api/agent/conversations/{conversation_id}',
    path: { conversation_id: conversationId },
  }), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error('无法加载这段对话')
  return await response.json() as AgentConversation
}

export async function renameAgentConversation(
  conversationId: string,
  title: string,
): Promise<AgentConversationSummary> {
  const response = await fetch(apiClient.buildUrl({
    url: '/api/agent/conversations/{conversation_id}',
    path: { conversation_id: conversationId },
  }), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(response.status === 404 ? '这段对话不存在或无权访问。' : '对话名称修改失败')
  return await response.json() as AgentConversationSummary
}

export async function deleteAgentConversation(conversationId: string): Promise<void> {
  const response = await fetch(apiClient.buildUrl({
    url: '/api/agent/conversations/{conversation_id}',
    path: { conversation_id: conversationId },
  }), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Idempotency-Key': `delete-agent-conversation:${conversationId}` },
  })
  if (!response.ok) throw new Error(response.status === 404 ? '这段对话不存在或无权访问。' : '对话删除失败')
}

export async function getResearchStartJourney(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ResearchStartJourney> {
  const response = await fetch(apiClient.buildUrl({
    url: '/api/agent/conversations/{conversation_id}/journey',
    path: { conversation_id: conversationId },
  }), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error(response.status === 404
    ? '这段研究对话不存在或无权访问。'
    : '无法恢复这次研究的建立状态')
  return toResearchStartJourney(await response.json() as AgentResearchJourneyResponse)
}

export async function confirmResearchStartProposal(
  request: {
    proposalId: string
    expectedVersion: number
    phenomenon: string
    researchIntent: string | null
    context: string | null
    idempotencyKey: string
  },
  signal?: AbortSignal,
): Promise<ResearchStartJourney> {
  const response = await fetch(apiClient.buildUrl({
    url: '/api/agent/research-start-proposals/{proposal_id}/confirm',
    path: { proposal_id: request.proposalId },
  }), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': request.idempotencyKey,
    },
    body: JSON.stringify({
      expected_version: request.expectedVersion,
      phenomenon: request.phenomenon,
      research_intent: request.researchIntent,
      context: request.context,
    }),
    signal,
  })
  if (response.ok) return toResearchStartJourney(await response.json() as AgentResearchJourneyResponse)
  if (response.status === 409) throw new Error('研究状态已更新，请重新加载后继续。')
  throw new Error('研究暂时未能建立，你的内容已保留。')
}

async function startAgentTurn(
  payload: AgentTurnRequest & { idempotencyKey: string },
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(apiClient.buildUrl({ url: '/api/agent/turns' }), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Idempotency-Key': payload.idempotencyKey,
    },
    body: JSON.stringify({
      ...(payload.model_id == null ? {} : { model_id: payload.model_id }),
      ...(payload.reasoning_effort === undefined ? {} : { reasoning_effort: payload.reasoning_effort }),
      conversation_id: payload.conversation_id,
      message: payload.message,
      ...(payload.context_suggestion ? { context_suggestion: { card_id: payload.context_suggestion.card_id, version: payload.context_suggestion.version } } : {}),
      mode: payload.mode ?? 'standard',
      workspace: payload.workspace ?? 'agent',
      web_search: payload.web_search ?? false,
      task_id: payload.task_id ?? null,
      document_id: payload.document_id ?? null,
      section_id: payload.section_id ?? null,
      document_version: payload.document_version ?? null,
      theory_plan_id: payload.theory_plan_id ?? null,
      ...(payload.writing_context ? { writing_context: payload.writing_context } : {}),
      material_ids: payload.material_ids ?? [],
      reference_knowledge_base_id: payload.reference_knowledge_base_id ?? null,
      knowledge_index_action: payload.knowledge_index_action ?? null,
      deep_research_run_id: payload.deep_research_run_id ?? null,
      deep_research_action: payload.deep_research_action ?? null,
      deep_research_selection: payload.deep_research_selection ?? null,
    } satisfies AgentTurnRequestDto),
    signal,
  })
}

type StreamState = { runId?: string; attemptId?: string; after: number; terminal: boolean }

function terminalEvent(event: AgentEvent) {
  return ['turn_completed', 'turn_interrupted', 'turn_failed', 'research_waiting', 'knowledge_index_choice_required'].includes(event.type)
}

function deliverEvent(event: AgentEvent, state: StreamState, onEvent: (event: AgentEvent) => void) {
  if (event.event_id) {
    const index = event.event_id.lastIndexOf(':')
    const runId = event.event_id.slice(0, index)
    const sequence = Number(event.event_id.slice(index + 1))
    if (index < 0 || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('事件续接标识无效。')
    if (state.runId && state.runId !== runId) throw new Error('事件属于另一轮回答。')
    state.runId = runId
    if (sequence <= state.after) return
    state.after = sequence
  }
  if (event.type === 'writing_preview' && state.runId && event.run_id !== state.runId) throw new Error('文稿预览属于另一轮回答。')
  if (event.type === 'writing_preview' && state.attemptId && event.attempt_id !== state.attemptId) return
  if (event.type === 'turn_started') { state.runId = event.run_id; state.attemptId = event.attempt_id }
  if (event.type === 'turn_snapshot') {
    state.runId = event.run.run_id
    state.attemptId = event.run.output_attempts?.at(-1)?.attempt_id ?? event.run.writing_previews?.[0]?.attempt_id
    state.after = Math.max(state.after, event.run.last_event_sequence ?? 0)
  }
  state.terminal ||= terminalEvent(event)
  onEvent(event)
}

async function consumeAgentResponse(response: Response, state: StreamState, onEvent: (event: AgentEvent) => void) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('登录状态已失效，请重新登录后继续研究。')
    if (response.status === 409) {
      const failure = await response.json().catch(() => null) as { error?: { message?: unknown }; detail?: unknown } | null
      const message = typeof failure?.error?.message === 'string' ? failure.error.message
        : typeof failure?.detail === 'string' ? failure.detail : '当前请求已失效，请刷新后重试。'
      // A definite rejection is not an uncertain transport failure. Never look
      // up/reconnect a run that the server has explicitly refused to start.
      throw Object.assign(new Error(message), { status: 409 })
    }
    if (response.status === 422) {
      const failure = await response.json().catch(() => null) as { detail?: unknown } | null
      throw new Error(typeof failure?.detail === 'string' ? failure.detail : '问题长度或格式不符合要求，请修改后重试。')
    }
    throw new TypeError('Agent 暂时无法连接')
  }
  if (!response.body) throw new TypeError('Agent 暂时无法连接')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\n\n+/)
      buffer = blocks.pop() ?? ''
      for (const event of parseAgentEventStream(`${blocks.join('\n\n')}\n\n`)) deliverEvent(event, state, onEvent)
      if (done) {
        if (buffer.trim()) {
          try { for (const event of parseAgentEventStream(buffer)) deliverEvent(event, state, onEvent) }
          catch (cause) { if (cause instanceof SyntaxError) throw new TypeError('最后事件不完整，请重新连接。'); throw cause }
        }
        break
      }
    }
    if (!state.terminal) throw new TypeError('Agent 流在完成前中断，请重新连接。')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function reconnectDelay(attempt: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const abort = () => { globalThis.clearTimeout(timeout); reject(new DOMException('Aborted', 'AbortError')) }
    const timeout = globalThis.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, Math.min(4000, 250 * 2 ** attempt))
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function streamAgentTurn(
  payload: AgentTurnRequest & { idempotencyKey: string },
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  resume?: AgentStreamResume,
): Promise<void> {
  const state: StreamState = { runId: resume?.runId, after: resume?.after ?? 0, terminal: false }
  let reconnect = Boolean(resume)
  for (let attempt = 0; ; attempt += 1) {
    try {
      let response: Response
      if (!reconnect) {
        // Exactly one execution command. Any uncertainty is reconciled with
        // owner-scoped reads; a transport retry never posts a new generation.
        response = await startAgentTurn(payload, signal)
      } else {
        if (!state.runId) {
          const lookup = await fetch(apiClient.buildUrl({ url: '/api/agent/runs/by-idempotency-key' }), {
            credentials: 'include', cache: 'no-store', signal,
            headers: { 'Idempotency-Key': payload.idempotencyKey },
          })
          if (lookup.status === 404) throw new TypeError('原请求仍未确认，保留内容并等待记录。')
          if (!lookup.ok) throw new Error('无法核对原回答，请重新登录后连接。')
          const raw = await lookup.json() as Record<string, unknown>
          const run = { ...raw, writing_previews: writingPreviewsFromSnapshot(raw) } as unknown as AgentRunLookup
          state.runId = run.run_id
          state.after = run.last_event_sequence ?? 0
          // If the initial response was completely lost, reconcile its exact
          // body/attempt snapshot once, then stream only events after that cursor.
          deliverEvent({ type: 'turn_snapshot', run }, state, onEvent)
        }
        response = await fetch(apiClient.buildUrl({
          url: '/api/agent/runs/{run_id}/events', path: { run_id: state.runId },
          query: { after: state.after },
        }), { credentials: 'include', signal, headers: { 'Accept': 'text/event-stream' } })
      }
      await consumeAgentResponse(response, state, onEvent)
      return
    } catch (cause: unknown) {
      if (state.terminal) return
      if (signal?.aborted || (cause as { name?: string } | null)?.name === 'AbortError') throw cause
      if (!(cause instanceof TypeError) || attempt >= 3) throw cause
      reconnect = true
      await reconnectDelay(attempt, signal)
    }
  }
}

export async function stopAgentRun(runId: string, options: { keepalive?: boolean } = {}): Promise<AgentRunStopResult> {
  const key = globalThis.crypto?.randomUUID?.() ?? `stop-agent-run:${runId}`
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(apiClient.buildUrl({
      url: '/api/agent/runs/{run_id}/stop',
      path: { run_id: runId },
    }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': key },
      ...(options.keepalive ? { keepalive: true } : {}),
    })
    if (!response.ok) throw new Error('无法暂停当前回答，请重试暂停。')
    // Older releases returned 204; retain compatibility during a rolling deployment.
    const result: AgentRunStopResult = response.status === 204
      ? { run_id: runId, status: 'interrupted', cancel_requested: true }
      : await response.json() as AgentRunStopResponse
    if (result.status !== 'running' || options.keepalive) return result
    if (attempt >= 39) throw new Error('暂停仍未确认，请重试暂停。')
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250))
  }
}

export async function saveCanvasNode(conversationId: string, nodeId: string, body: AgentCanvasNodeEditRequest): Promise<AgentConversation> {
  const result = await editAgentCanvasNode({ client: apiClient, headers: { 'Idempotency-Key': crypto.randomUUID() }, path: { conversation_id: conversationId, node_id: nodeId }, body })
  if (!result.data) {
    throw new Error(result.response?.status === 409 ? '卡片已在另一处更新。你的草稿仍保留，请载入最新版本后核对。' : '卡片未保存，请检查连接后重试。')
  }
  return result.data as AgentConversation
}


export async function listRecentConversationContext(signal?: AbortSignal): Promise<RecentConversationContext[]> {
  const response = await fetch(apiClient.buildUrl({ url: '/api/agent/recent-context' }), {
    credentials: 'include', signal, cache: 'no-store',
  })
  if (!response.ok) throw new Error('无法加载最近对话')
  return ((await response.json()) as { items: RecentConversationContext[] }).items
}

export async function getConversationContextSummary(signal?: AbortSignal): Promise<ConversationContextSummary> {
  const result = await readConversationSummary({ client: apiClient, signal, credentials: 'include', cache: 'no-store' })
  if (result.error || !result.data) throw new Error('无法读取最近对话建议')
  const data: unknown = result.data
  if (!isConversationContextSummary(data)) throw new Error('最近对话建议暂时不可用')
  return data
}

function isConversationContextSummary(value: unknown): value is ConversationContextSummary {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return ['ready', 'pending', 'empty', 'disabled', 'failed'].includes(String(data.status))
    && data.scope === 'conversation_messages' && typeof data.summary === 'string'
    && Number.isInteger(data.omitted_messages) && Number(data.omitted_messages) >= 0
    && validSources(data.summary_sources)
    && (data.updated_at === null || typeof data.updated_at === 'string')
    && (data.is_stale === undefined || typeof data.is_stale === 'boolean')
    && (data.usage_status == null || data.usage_status === 'known' || data.usage_status === 'pending')
    && (data.status_reason == null || ['queued', 'active_run', 'idle_wait', 'generating', 'retry_wait', 'daily_budget', 'attempt_limit', 'generation_failed', 'generator_unavailable'].includes(String(data.status_reason)))
    && (data.retry_at == null || typeof data.retry_at === 'string' && Number.isFinite(Date.parse(data.retry_at)))
    && Array.isArray(data.cards) && data.cards.length <= 3
    && data.cards.every(card => {
      if (!card || typeof card !== 'object') return false
      return [card.card_id, card.version, card.title, card.description].every(text => typeof text === 'string' && Boolean(text.trim()))
        && validSources(card.sources) && card.sources.length > 0
    })
}

function validSources(value: unknown): value is ConversationContextSummary['summary_sources'] {
  return Array.isArray(value) && value.every(source => source && typeof source === 'object'
    && Number.isInteger(source.sequence) && Number(source.sequence) >= 0
    && (source.role === 'user' || source.role === 'assistant')
    && [source.conversation_id, source.message_id, source.quote, source.title].every(text => typeof text === 'string' && Boolean(text.trim())))
}

export async function readKnowledgeIndexStatus(referenceKnowledgeBaseId?: string | null, signal?: AbortSignal, purpose: 'search' | 'graph' = 'search'): Promise<KnowledgeIndexStatus> {
  const result = await getAgentKnowledgeIndexStatus({ client: apiClient, query: { reference_knowledge_base_id: referenceKnowledgeBaseId, purpose }, signal })
  if (!result.data) throw new Error('无法检查资料整理进度，请重试。')
  return result.data
}
export async function repairKnowledgeIndex(body: KnowledgeIndexRepair, idempotencyKey: string, signal?: AbortSignal): Promise<KnowledgeIndexStatus> {
  const result = await repairAgentKnowledgeIndex({ client: apiClient, body, headers: { 'Idempotency-Key': idempotencyKey }, signal })
  if (!result.data) throw new Error(result.response?.status === 409 ? '资料已更新，请重新检查整理状态后再补齐。' : '补齐任务未能确认，请检查进度后再试。')
  return result.data
}
import { parseWritingPreview, writingPreviewsFromSnapshot } from './writingPreview'
