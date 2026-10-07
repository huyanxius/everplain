import { citationGroup, type AgentCitation, type AgentConversation, type AgentRunRecovery, type AgentOutputAttempt, type AgentToolTrace, type AgentTurn } from '../../modules/research-agent'
import { formatMaterialLocator, normalizeMaterialLocator, type ResearchMaterialLocator } from '../../modules/research-materials'
import type { ResearchActivity, ResearchCitation } from '../research-workspace/ResearchContextRail'
import type { AppLocale } from '../i18n/AppLocaleProvider'
import { DELETED_MATERIAL_ANSWER, nonEmptyString, objectRecord, type AgentToolEvent, type PendingTurnAttempt, type ResearchToolStep, type StreamingTurn } from './conversationState'

const knowledgeTools = new Set([
  'search_knowledge',
  'read_knowledge_entry',
  'read_sources',
  'browse_knowledge_directory',
])

const researchMaterialTools = new Set([
  'search_research_materials',
  'read_research_material_context',
])

// Labels also cover historical traces created before workspace tool scopes were
// narrowed; displaying them does not make those tools callable from /agent.
const toolLabels: Record<string, string> = {
  search_knowledge: '检索知识库',
  read_knowledge_entry: '读取知识条目',
  read_sources: '读取来源',
  browse_knowledge_directory: '浏览知识目录',
  search_research_materials: '检索研究材料',
  read_research_material_context: '读取研究材料原文',
  search_web: '搜索公开网页',
  read_web_page: '读取网页正文',
  ask_research_question: '讨论研究下一步',
  update_research_map: '更新研究地图',
  propose_start_research: '整理研究起点',
  get_research_workflow_state: '读取研究进度',
  start_theory_matching: '启动理论匹配',
  save_confirmed_theory_plan: '保存已确认理论方案',
  read_writing_document: '读取当前文稿',
  propose_writing_edit: '提出文稿精确修订',
  read_research_document: '读取研究文档',
  propose_document_revision: '整理文档修订提议',
  propose_document_creation: '整理文档创建提议',
}

const englishToolLabels: Record<string, string> = {
  search_knowledge: 'Search knowledge base',
  read_knowledge_entry: 'Read knowledge entry',
  read_sources: 'Read sources',
  browse_knowledge_directory: 'Browse knowledge directory',
  search_research_materials: 'Search research materials',
  read_research_material_context: 'Read research material context',
  search_web: 'Search the web',
  read_web_page: 'Read web page',
  update_research_map: 'Update research map',
  propose_start_research: 'Prepare research starting point',
  get_research_workflow_state: 'Read research progress',
  start_theory_matching: 'Start theory matching',
  save_confirmed_theory_plan: 'Save confirmed theory plan',
  read_writing_document: 'Read current article',
  propose_writing_edit: 'Propose article edit',
  read_research_document: 'Read research document',
  propose_document_revision: 'Prepare document revision',
  propose_document_creation: 'Prepare document creation',
}

const toolPurposes: Record<string, string> = {
  search_knowledge: '根据当前研究问题寻找相关概念、理论与已有研究参照',
  read_knowledge_entry: '根据当前问题核对知识条目的主张、适用前提与证据边界',
  read_sources: '补充作者、年份、研究对象与原始来源信息',
  browse_knowledge_directory: '查看当前知识版本中可用于研究的内容范围',
  search_research_materials: '从当前研究任务的个人材料中寻找相关原文片段',
  read_research_material_context: '沿精确位置读取片段前后文，避免脱离整份材料解释',
  search_web: '查找当前政策、新闻、报告与其他公开网页来源',
  read_web_page: '读取网页正文，避免只根据搜索摘要形成结论',
  update_research_map: '把已确认的问题、理论与证据关系写入研究画布',
  propose_start_research: '把现象、研究意图与情境整理成待确认的研究起点',
  get_research_workflow_state: '读取当前研究任务的阶段与可继续操作',
  start_theory_matching: '基于已确认现象和证据生成可比较的理论候选',
  save_confirmed_theory_plan: '保存你已经确认的理论取舍与使用方式',
  read_writing_document: '读取当前文章、选区、版本及同文体样文',
  propose_writing_edit: '按原文与版本校验提出修订，接受前不会覆盖正文',
  read_research_document: '读取当前正式研究文档及其版本',
  propose_document_revision: '把修改整理成待你接受或拒绝的文档建议',
  propose_document_creation: '把已确认理论方案整理成 12 节研究框架草稿',
}

const englishToolPurposes: Record<string, string> = {
  search_knowledge: 'Find concepts, theories, and prior research relevant to the question',
  read_knowledge_entry: 'Check an entry\'s claims, assumptions, and evidence limits',
  read_sources: 'Add author, year, research subject, and original source details',
  browse_knowledge_directory: 'Review the research material available in this knowledge release',
  search_research_materials: 'Find relevant passages in the personal materials bound to this research task',
  read_research_material_context: 'Read the surrounding context at the exact source position',
  search_web: 'Find current policies, news, reports, and other public web sources',
  read_web_page: 'Read the page text instead of relying on a search snippet',
  update_research_map: 'Record confirmed questions, theories, and evidence relationships',
  propose_start_research: 'Prepare the phenomenon and research intent for confirmation',
  get_research_workflow_state: 'Read the current research phase and available next actions',
  start_theory_matching: 'Compare theory candidates against the confirmed phenomenon and evidence',
  save_confirmed_theory_plan: 'Save the theory choices and use confirmed by you',
  read_writing_document: 'Read the current article, selection, version and style samples',
  propose_writing_edit: 'Prepare an exact version-checked edit for your review',
  read_research_document: 'Read the current formal research document and version',
  propose_document_revision: 'Prepare document changes for your acceptance or rejection',
  propose_document_creation: 'Turn the confirmed theory plan into a 12-section framework draft',
}

export function localizedToolLabel(tool: string, locale: AppLocale, fallback?: string) {
  if (locale === 'en-US') return englishToolLabels[tool] ?? tool.replaceAll('_', ' ')
  return toolLabels[tool] ?? fallback ?? tool
}

export function localizedToolPurpose(tool: string, locale: AppLocale) {
  if (locale === 'en-US') return englishToolPurposes[tool] ?? 'Use this step to advance the current research task'
  return toolPurposes[tool] ?? '根据当前问题推进研究任务'
}

export function localizedToolDetail(detail: string, locale: AppLocale) {
  const publicDetail = detail
    .replaceAll('知识库预览内容（未审核）', '知识条目')
    .replaceAll('知识库预览条目（未审核）', '知识条目')
    .replaceAll('未审核预览', '知识条目')
    .replaceAll('待审核发现关系', '候选关系')
    .replaceAll('已审核知识关系', '知识关系')
  if (locale !== 'en-US') return publicDetail
  if (publicDetail === '工具调用失败') return 'Tool call failed'
  if (publicDetail === '已停止') return 'Stopped'
  return publicDetail
}

export function localizedTurnFailure(code: string, message: string, locale: AppLocale) {
  if (locale !== 'en-US') return message
  if (code === 'not_found') return 'This conversation does not exist or you do not have access.'
  if (code === 'run_in_progress') return 'A response is already being generated. Please wait.'
  if (code === 'credits_depleted') return 'Quota is exhausted. Please wait for the receipt.'
  return 'The Agent cannot complete this answer right now. Please try again later.'
}


// Server snapshots cannot contain a tail that failed to save. Preserve only
// this run's explicitly unsaved local versions; the server owns saved versions.
export function mergeOutputAttempts(current: StreamingTurn, runId: string, incoming?: AgentOutputAttempt[], redacted = false): AgentOutputAttempt[] {
  const local = current.runId === runId ? current.outputAttempts ?? [] : []
  const merged = new Map((incoming ?? local).map(output => [output.attempt_id, output]))
  for (const output of local) {
    if (output.status === 'unsaved' && !merged.has(output.attempt_id)) merged.set(output.attempt_id, output)
  }
  // The existing recovery contract represents deleted sources with a tombstone.
  // A local unsaved archive must never restore text hidden by that projection.
  const hidden = redacted || incoming?.some(output => output.answer === DELETED_MATERIAL_ANSWER)
  return [...merged.values()].map(output => hidden ? { ...output, answer: DELETED_MATERIAL_ANSWER } : output)
}


type ResearchStartHandoff = {
  proposalId: string
  conversationId: string
  knowledgeReleaseId: string
  phenomenon: string
  researchIntent: string | null
}

export type SelectedCitationContext = {
  citation: AgentCitation
  knowledgeReleaseId: string | null
}

export function researchStartHandoffFromSteps(steps: ResearchToolStep[]): ResearchStartHandoff | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.tool !== 'propose_start_research' || step.status !== 'completed') continue
    const output = objectRecord(step.output)
    if (!output || output.requires_user_confirmation !== true || output.status !== 'pending_confirmation') continue
    const proposalId = nonEmptyString(output.proposal_id)
    const conversationId = nonEmptyString(output.conversation_id)
    const knowledgeReleaseId = nonEmptyString(output.knowledge_release_id)
    const phenomenon = nonEmptyString(output.phenomenon)
    if (!proposalId || !conversationId || !knowledgeReleaseId || !phenomenon) continue
    return {
      proposalId,
      conversationId,
      knowledgeReleaseId,
      phenomenon,
      researchIntent: nonEmptyString(output.research_intent),
    }
  }
  return null
}


export function formatToolPayload(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatToolPayload).filter(Boolean).join(' · ') || null
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const label = formatToolPayload(item)
        return label ? `${key}: ${label}` : null
      })
      .filter(Boolean)
      .join(' · ') || null
  }
  return null
}

export function outputCandidates(output: unknown): unknown[] {
  if (Array.isArray(output)) return output
  if (!output || typeof output !== 'object') return []
  const value = output as Record<string, unknown>
  for (const key of ['items', 'results', 'entries', 'sources']) {
    if (Array.isArray(value[key])) return value[key] as unknown[]
  }
  return []
}

export function resultItemsFromOutput(output: unknown): NonNullable<ResearchActivity['resultItems']> {
  return outputCandidates(output).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const title = typeof value.title === 'string'
      ? value.title
      : typeof value.label === 'string'
        ? value.label
        : typeof value.name === 'string'
          ? value.name
          : `结果 ${index + 1}`
    const excerpt = typeof value.excerpt === 'string'
      ? value.excerpt
      : typeof value.summary === 'string'
        ? value.summary
        : typeof value.content === 'string'
          ? value.content
          : null
    const id = typeof value.knowledge_id === 'string'
      ? value.knowledge_id
      : typeof value.id === 'string'
        ? value.id
        : `${title}-${index}`
    return [{ id, title, excerpt }]
  })
}

export function citationKindLabel(kind: string, locale: AppLocale) {
  if (kind === 'preview' || kind === 'entry') return locale === 'en-US' ? 'Knowledge entry' : '知识条目'
  if (kind === 'source') return locale === 'en-US' ? 'Source' : '来源'
  if (kind === 'material' || kind === 'research_material') return locale === 'en-US' ? 'Research material' : '研究材料'
  if (kind === 'theory') return locale === 'en-US' ? 'Theory lead' : '理论线索'
  if (kind === 'directory') return locale === 'en-US' ? 'Knowledge directory' : '知识目录'
  return locale === 'en-US' ? 'Evidence' : '证据'
}

type MaterialCitationFields = {
  material_id?: unknown
  materialId?: unknown
  parse_id?: unknown
  parseId?: unknown
  segment_id?: unknown
  segmentId?: unknown
  locator?: unknown
}

export function materialCitationFields(citation: AgentCitation | null): {
  materialId: string | null
  parseId: string | null
  segmentId: string | null
  locator: ResearchMaterialLocator | null
} {
  if (!citation || (citation.kind !== 'material' && citation.kind !== 'research_material')) {
    return { materialId: null, parseId: null, segmentId: null, locator: null }
  }
  const fields = citation as AgentCitation & MaterialCitationFields
  const materialId = typeof fields.material_id === 'string'
    ? fields.material_id
    : typeof fields.materialId === 'string' ? fields.materialId : null
  const segmentId = typeof fields.segment_id === 'string'
    ? fields.segment_id
    : typeof fields.segmentId === 'string' ? fields.segmentId : null
  const parseId = typeof fields.parse_id === 'string'
    ? fields.parse_id
    : typeof fields.parseId === 'string' ? fields.parseId : null
  return {
    materialId,
    parseId,
    segmentId,
    locator: fields.locator ? normalizeMaterialLocator(fields.locator) : null,
  }
}

export function tombstoneMaterialCitation(citation: AgentCitation, materialId: string): AgentCitation {
  if (materialCitationFields(citation).materialId !== materialId) return citation
  return { ...citation, deleted: true, excerpt: null }
}

export function tombstoneConversationMaterial(conversation: AgentConversation, materialId: string): AgentConversation {
  let changed = false
  const turns = conversation.turns.map((turn) => {
    const citations = turn.assistant.citations.map((citation) => {
      return tombstoneMaterialCitation(citation, materialId)
    })
    const affected = citations.some((citation, index) => citation !== turn.assistant.citations[index])
    if (!affected) return turn
    changed = true
    return {
      ...turn,
      assistant: { ...turn.assistant, content: DELETED_MATERIAL_ANSWER, citations },
      output_attempts: turn.output_attempts?.map(output => ({ ...output, answer: DELETED_MATERIAL_ANSWER })),
    }
  })
  return changed ? { ...conversation, turns } : conversation
}


// 维度既可能来自条目号（D1:C213），也可能只出现在来源路径里（价值论/02-02-1...md）。
const dimensionByName: Array<[string, string]> = [
  ['本体论', 'D1'], ['实践论', 'D2'], ['方法论', 'D3'], ['价值论', 'D4'],
  ['认识论', 'D5'], ['传统', 'D6'], ['学科史', 'D7'],
]

export function citationDimension(citation: AgentCitation): string | null {
  const fromId = citation.knowledge_id?.match(/\b(D[1-7])\b/)?.[1]
  if (fromId) return fromId
  if (citation.source_kind === 'web') return null
  const label = citation.label ?? ''
  return dimensionByName.find(([name]) => label.includes(name))?.[1] ?? null
}

// 网页来源的副标题给域名，比统一写"来源"更能让人判断这条证据可不可信。
export function citationHost(citation: AgentCitation) {
  if (citation.source_kind !== 'web' || !citation.source_id) return null
  try {
    return new URL(citation.source_id).host.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function citationToRail(citation: AgentCitation, locale: AppLocale): ResearchCitation {
  const material = materialCitationFields(citation)
  const materialLocator = material.locator ? formatMaterialLocator(material.locator) : null
  const host = citationHost(citation)
  // 知识条目号形如 D1:C213，前缀就是知识库的维度，用它取和知识库页面同一套色。
  const dimension = citationDimension(citation)
  return {
    id: citation.citation_id,
    title: citation.label,
    kind: citation.kind,
    subtitle: host ?? `${citationGroup(citation) === 'knowledge' ? (locale === 'en-US' ? 'Library material' : '知识库资料') : citationKindLabel(citation.kind, locale)}${materialLocator ? ` · ${materialLocator}` : ''}`,
    excerpt: citation.excerpt,
    knowledgeId: citation.knowledge_id,
    group: citationGroup(citation),
    dimension,
  }
}

export function toActivity(step: ResearchToolStep, locale: AppLocale): ResearchActivity {
  return {
    id: step.id,
    tool: step.tool,
    label: localizedToolLabel(step.tool, locale, step.label),
    status: step.status,
    interrupted: step.interrupted,
    input: step.input,
    detail: step.detail ? localizedToolDetail(step.detail, locale) : step.detail,
    resultItems: resultItemsFromOutput(step.output),
  }
}

export function updateToolSteps(steps: ResearchToolStep[], event: AgentToolEvent): ResearchToolStep[] {
  if (event.type === 'tool_started') {
    const id = event.call_id || `${event.tool}:${steps.filter((step) => step.tool === event.tool).length + 1}`
    const next: ResearchToolStep = {
      id,
      tool: event.tool,
      label: toolLabels[event.tool] || event.tool,
      status: 'running',
      input: event.input,
      detail: event.detail,
    }
    const existing = steps.findIndex((step) => step.id === id)
    return existing < 0 ? [...steps, next] : steps.map((step, index) => index === existing ? next : step)
  }

  const index = event.call_id
    ? steps.findIndex((step) => step.id === event.call_id)
    : steps.findLastIndex((step) => step.tool === event.tool && step.status === 'running')
  const existing = index >= 0 ? steps[index] : undefined
  const next: ResearchToolStep = {
    id: existing?.id || event.call_id || `${event.tool}:${steps.length + 1}`,
    tool: event.tool,
    label: existing?.label || toolLabels[event.tool] || event.tool,
    status: event.type === 'tool_failed' ? 'failed' : 'completed',
    input: existing?.input ?? (event.type === 'tool_failed' ? event.input : undefined),
    output: event.type === 'tool_finished' ? event.output : existing?.output,
    detail: event.type === 'tool_failed'
      ? event.detail || event.message
      : event.detail || formatToolPayload(event.output),
  }
  return index < 0 ? [...steps, next] : steps.map((step, stepIndex) => stepIndex === index ? next : step)
}

export function researchStepForTools(steps: ResearchToolStep[]): number {
  const active = [...steps].reverse().find((step) => step.status === 'running')
  const tool = active?.tool || steps[steps.length - 1]?.tool
  if (!tool) return 0
  if (['search_knowledge', 'browse_knowledge_directory', 'search_research_materials'].includes(tool)) return 1
  if (['search_web', 'read_web_page'].includes(tool)) return 2
  if (['read_knowledge_entry', 'read_sources', 'read_research_material_context'].includes(tool)) return 2
  return 3
}

const DEEP_RESEARCH_TRACE = 'deep_research'

type DeepResearchRecord = { elapsedSeconds: number; knowledgeCount: number; webCount: number }

/** 深入研究完成时后端留在工具轨迹里的一条记录，重开对话靠它还原那张卡片。 */
export function deepResearchRecord(turn: AgentTurn | undefined): DeepResearchRecord | null {
  const trace = turn?.tool_traces?.find((item) => item.tool === DEEP_RESEARCH_TRACE)
  const output = trace?.output
  if (!output || typeof output !== 'object') return null
  const value = output as Record<string, unknown>
  if (value.schema_version !== 1) return null
  return {
    elapsedSeconds: typeof value.elapsed_seconds === 'number' ? value.elapsed_seconds : 0,
    knowledgeCount: typeof value.knowledge_count === 'number' ? value.knowledge_count : 0,
    webCount: typeof value.web_count === 'number' ? value.web_count : 0,
  }
}

export function persistedToolSteps(traces: AgentToolTrace[] | undefined): ResearchToolStep[] {
  let steps: ResearchToolStep[] = []
  for (const trace of traces ?? []) {
    if (trace.tool === 'writing_ui_action') continue
    if (trace.tool === DEEP_RESEARCH_TRACE) continue
    const event: AgentToolEvent = trace.phase === 'started'
      ? { type: 'tool_started', tool: trace.tool, call_id: trace.call_id, input: trace.input ?? undefined, detail: trace.detail }
      : trace.phase === 'failed'
        ? {
            type: 'tool_failed',
            tool: trace.tool,
            call_id: trace.call_id,
            input: trace.input ?? undefined,
            message: trace.detail ?? '工具调用失败',
            error_code: trace.error ?? null,
            detail: trace.detail ?? null,
          }
        : { type: 'tool_finished', tool: trace.tool, call_id: trace.call_id, output: trace.output, detail: trace.detail }
    steps = updateToolSteps(steps, event)
  }
  return steps
}

export function attachLocalToolSteps(conversation: AgentConversation, steps: ResearchToolStep[]): AgentConversation {
  if (!steps.length || !conversation.turns.length) return conversation
  const lastIndex = conversation.turns.length - 1
  const lastTurn = conversation.turns[lastIndex]
  const existingIds = new Set((lastTurn.tool_traces ?? []).map((trace) => trace.call_id))
  const localTraces: AgentToolTrace[] = steps
    .filter((step) => !existingIds.has(step.id))
    .map((step) => ({
      tool: step.tool,
      phase: step.status === 'failed' ? 'failed' : 'finished',
      call_id: step.id,
      input: step.input && typeof step.input === 'object' && !Array.isArray(step.input)
        ? step.input as Record<string, unknown>
        : null,
      output: step.output,
      detail: step.detail,
      error: step.status === 'failed' ? 'tool_failed' : null,
    }))
  if (!localTraces.length) return conversation
  return {
    ...conversation,
    turns: conversation.turns.map((turn, index) => index === lastIndex
      ? { ...turn, tool_traces: [...(turn.tool_traces ?? []), ...localTraces] }
      : turn),
  }
}

export function interruptedSteps(steps: ResearchToolStep[], locale: AppLocale) {
  return steps.map((step) => step.status === 'running'
    ? { ...step, status: 'failed' as const, interrupted: true, detail: locale === 'en-US' ? 'Stopped' : '已停止' }
    : step)
}

export function hasKnowledgeActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => knowledgeTools.has(step.tool))
}

export function hasCompletedKnowledgeActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => knowledgeTools.has(step.tool) && step.status === 'completed')
}

export function hasResearchMaterialActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => researchMaterialTools.has(step.tool))
}


export function recoveryTurn(run: AgentRunRecovery, locale: AppLocale, now = Date.now()): StreamingTurn {
  const hidden = run.partial_answer === DELETED_MATERIAL_ANSWER || run.output_attempts?.some(output => output.answer === DELETED_MATERIAL_ANSWER)
  const traces = (run.tool_summary ?? []).filter((item) => typeof item.tool === 'string' && typeof item.phase === 'string') as AgentToolTrace[]
  return {
    runId: run.run_id,
    question: run.idempotency_key.startsWith('writing-ui:') && run.request.writing_context ? '' : run.request.message,
    contextCard: run.context_card,
    answer: hidden ? DELETED_MATERIAL_ANSWER : run.output_attempts?.at(-1)?.answer ?? run.partial_answer,
    attemptId: run.output_attempts?.at(-1)?.attempt_id,
    outputAttempts: run.output_attempts?.map(output => hidden ? { ...output, answer: DELETED_MATERIAL_ANSWER } : output) ?? [],
    deliveryState: run.delivery_state,
    citations: [],
    toolSteps: run.status === 'running' ? persistedToolSteps(traces) : interruptedSteps(persistedToolSteps(traces), locale),
    canvasPatches: [],
    startedAt: Date.parse(run.updated_at) || now,
    interrupted: run.status !== 'running' && !run.status.startsWith('awaiting_'),
    failure: run.status === 'failed' ? (locale === 'en-US' ? 'This answer did not finish. Retry from the saved state.' : '这轮回答未完成，可以从保存的位置重试。') : undefined,
  }
}


/** Server recovery owns saved output; only a matching run may contribute unsaved local text. */
export function recoverTurnWithLocalOutput(run: AgentRunRecovery, locale: AppLocale, saved: { turn: StreamingTurn; attempt: PendingTurnAttempt } | null, now = Date.now()): StreamingTurn {
  const recovered = recoveryTurn(run, locale, now)
  if (!saved || saved.attempt.runId !== run.run_id || saved.attempt.idempotencyKey !== run.idempotency_key || saved.turn.runId !== run.run_id) return recovered
  const local = saved.turn
  const hidden = run.partial_answer === DELETED_MATERIAL_ANSWER || recovered.answer === DELETED_MATERIAL_ANSWER
    || local.outputAttempts?.some(output => output.answer === DELETED_MATERIAL_ANSWER)
    || local.answer === DELETED_MATERIAL_ANSWER || local.citations.some(citation => citation.deleted)
  const localOutputs = [...(local.outputAttempts ?? [])]
  if (local.outputPersistenceFailed && local.answer) {
    const attemptId = `unsaved:${local.attemptId ?? local.startedAt}`
    if (!localOutputs.some(output => output.attempt_id === attemptId)) localOutputs.push({
      attempt_id: attemptId,
      ordinal: local.outputAttempts?.at(-1)?.ordinal ?? 1,
      status: 'unsaved',
      answer: local.answer,
      created_at: new Date(local.startedAt).toISOString(),
    })
  }
  const sameAttempt = !recovered.attemptId || recovered.attemptId === local.attemptId
  const preserveLocalBody = sameAttempt && local.outputPersistenceFailed === true && Boolean(local.answer)
  return {
    ...recovered,
    answer: hidden ? DELETED_MATERIAL_ANSWER : preserveLocalBody ? local.answer : recovered.answer,
    outputPersistenceFailed: preserveLocalBody,
    outputAttempts: mergeOutputAttempts({ ...local, outputAttempts: localOutputs }, run.run_id, run.output_attempts, hidden),
  }
}
