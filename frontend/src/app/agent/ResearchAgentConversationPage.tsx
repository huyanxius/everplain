import { KnowledgeReadinessChoice } from '../ui/KnowledgeReadinessChoice'
import { knowledgeReadinessDocuments, useKnowledgeIndexChoice } from './useKnowledgeIndexChoice'
import { ConversationHistoryView, ConversationHistoryView as AgentConversationHistoryRail } from '../conversation-view/ConversationHistoryView'
import { ConversationResearchFlow } from '../conversation-view/ConversationResearchFlow'
import { usePresence } from '../../ui/usePresence'
import { ConversationSourcePanel } from '../conversation-view/ConversationSourcePanel'
import { ConversationTurn } from '../conversation-view/ConversationThread'
import type { ConversationAction, ConversationHandoff } from '../conversation-view/types'
import { ConversationLayout } from '../conversation-view/ConversationLayout'
import { ConversationComposer } from '../conversation-view/ConversationComposer'
import { ModelSelectionSettings, useAgentModelSelection } from '../model-selection'
import { AgentAvatar, agentAvatarById, type AgentAvatarId } from '../../modules/agent-avatar'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notifyAccountUsageChanged } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { AgentModeSwitch } from './AgentModeSwitch'
import { ConversationActions } from './ConversationActions'
import { CompanionStatusBar, PersonalCompanion } from './PersonalCompanion'
import { CourseReferenceSelector } from '../courses/CourseReferenceSelector'
import { composeResearchDiscussion, latestResearchAsk, resolveResearchCitation, type ResearchDiscussion } from '../../modules/research-workspace'
import {
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  GlobeHemisphereWestIcon,
  ListIcon,
  SidebarSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useLocation, useNavigate, useNavigationType, useSearchParams, type NavigationType } from 'react-router'

import {
  type ResearchActivity,
  type ResearchCitation,
  type ResearchContextTab,
} from '../research-workspace/ResearchContextRail'
import { PageContent, PageShell } from '../ui/PageShell'
import {
  isKnowledgeIndexStatus,
  deleteAgentConversation,
  getAgentConversation,
  getResearchStartJourney,
  listAgentConversations,
  renameAgentConversation,
  stopAgentRun,
  streamAgentTurn,
  type AgentCitation,
  type AgentConversation,
  type AgentConversationSummary,
  type AgentEvent,
  type AgentRuntimeMode,
  type AgentToolStep,
  type AgentToolTrace,
  type AgentTurn,
  type AgentTurnRequest,
  type AgentRunRecovery,
  buildResearchReport,
  collectReferences,
  citationGroup,
  conclusionDigest,
  createResearchReportDocx,
  openResearchReportPrintWindow,
  researchReportDocxFilename,
} from '../../modules/research-agent'
import type { ResearchCanvasStreamingTurn } from '../../modules/research-workspace'
import {
  addResearchLibraryMaterial,
  AgentMaterialAttachmentPicker,
  formatMaterialLocator,
  isSupportedResearchMaterialFile,
  listAgentMaterials,
  prepareAgentMaterialContext,
  getAgentAttachmentMaterial,
  normalizeMaterialLocator,
  RESEARCH_MATERIAL_ACCEPT,
  ResearchMaterialsPanel,
  type ResearchMaterial,
  type ResearchMaterialLocator,
} from '../../modules/research-materials'
import { ProjectScopeMenu } from './ProjectScopeMenu'
import { deleteResearchProject, listResearchProjects, type ResearchProject } from '../../modules/research-projects'
import { ConversationSuggestions } from '../conversation-view/ConversationSuggestions'
import { ConversationContextSuggestions } from '../conversation-view/ConversationContextSuggestions'
import { conversationContextSummaryKey } from '../conversation-view/useConversationContextSummary'
import { useConversationGreeting } from '../conversation-view/researchPrompts'
import { readHomeSubmission, takeHomeSubmission } from '../conversation-view/homeSubmission'
import { isModelSelectionValid, toModelSelectionRequest, type ModelSelection } from '../model-selection'
import { useAppLocale, type AppLocale } from '../i18n/AppLocaleProvider'

// The conversation controller is shared by the standalone Agent and embedded
// research workspaces. Embedded callers provide the research context explicitly;
// the standalone route remains isolated in the read-only Agent workspace.
const MAX_AGENT_MESSAGE_LENGTH = 12_000
const DRAFT_STORAGE_KEY = 'everplain.agent.composer-draft.v2'
const PENDING_TURN_STORAGE_KEY = 'everplain.agent.pending-turn.v2'
const INTERRUPTED_TURN_STORAGE_KEY = 'everplain.agent.interrupted-turn.v2'
const KNOWLEDGE_RELEASE_STORAGE_KEY = 'everplain.agent.knowledge-releases.v1'
const AGENT_RUNTIME_STORAGE_KEY = 'everplain.agent.runtime-modes.v1'
const DEEP_RESEARCH_INTRO_SESSION_KEY = 'everplain.agent.deep-research-intro-session.v1'
const DEEP_RESEARCH_INTRO_TIMEOUT_MS = 10_000
const DELETED_MATERIAL_ANSWER = '该回答引用的个人研究材料已删除，原回答内容已隐藏。'
type AgentComposerMode = 'standard' | 'deep-research'
type DeepResearchMockStage = 'idle' | 'clarifying' | 'planning' | 'researching' | 'completed'
type DeepResearchExportState = 'idle' | 'docx' | 'pdf'

function attachmentStatusLabel(material: ResearchMaterial, locale: 'zh-CN' | 'en-US') {
  if (material.unavailableReason === 'ocr_required') return locale === 'en-US' ? 'OCR required' : '需要 OCR'
  if (material.unavailableReason === 'transcription_unavailable') return locale === 'en-US' ? 'Transcription unavailable' : '未配置转写'
  if (material.unavailableReason === 'transcription_required') return locale === 'en-US' ? 'Transcription required' : '等待转写'
  if (material.ingestionStatus === 'queued') return locale === 'en-US' ? 'Queued' : '等待解析'
  if (material.unavailableReason?.startsWith('material_indexing_')) return locale === 'en-US' ? 'Indexing incomplete' : '索引未完成'
  if (material.ingestionStatus === 'failed' || material.status === 'failed') return locale === 'en-US' ? 'Failed' : '解析失败'
  return locale === 'en-US' ? 'Processing' : '处理中'
}

const DEEP_RESEARCH_MOCK_STEPS = [
  '拆解研究问题',
  '检索知识库与个人材料',
  '补充并阅读公开网页',
  '核对来源，整理研究结论',
]

function DeepResearchMockFlow({
  stage,
  question,
  stepIndex,
  options = ['概念与理论背景', '现实案例与最新资料', '不同观点之间的争议', '研究方法与数据'],
  onChooseIntent,
  onSkip,
  onConfirmPlan,
  onEdit,
  knowledgeCount,
  webCount,
  toolSteps = [],
  elapsedSeconds = 0,
  conclusion,
  exportState = 'idle',
  onExport,
  onContinueResearch,
  researchEntryBusy = false,
  collaboration = false,
}: {
  collaboration?: boolean
  stage: DeepResearchMockStage
  question: string
  stepIndex: number
  options?: string[]
  onChooseIntent: (intent: string) => void
  onSkip: () => void
  onConfirmPlan: () => void
  onEdit: () => void
  knowledgeCount?: number
  webCount?: number
  toolSteps?: AgentToolStep[]
  elapsedSeconds?: number
  conclusion?: string
  exportState?: DeepResearchExportState
  onExport?: (kind: 'docx' | 'pdf') => void
  onContinueResearch?: () => void
  researchEntryBusy?: boolean
}) {
  if (stage === 'idle') return null
  return <ConversationResearchFlow stage={stage} question={question} options={options}
    label={collaboration ? '研究下一步' : undefined}
    toolSteps={toolSteps} elapsedSeconds={elapsedSeconds} phaseSteps={DEEP_RESEARCH_MOCK_STEPS} currentPhase={stepIndex}
    progressPercent={stage === 'researching' ? Math.min(95, (stepIndex + 1) / DEEP_RESEARCH_MOCK_STEPS.length * 100) : stage === 'completed' ? 100 : undefined}
    conclusion={conclusion} knowledgeCount={knowledgeCount} webCount={webCount}
    busy={researchEntryBusy} exportState={exportState} onExport={onExport}
    onChooseIntent={onChooseIntent} onSkip={onSkip} onConfirmPlan={onConfirmPlan} onEdit={onEdit}
    onContinueResearch={onContinueResearch} />
}

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

function localizedToolLabel(tool: string, locale: AppLocale, fallback?: string) {
  if (locale === 'en-US') return englishToolLabels[tool] ?? tool.replaceAll('_', ' ')
  return toolLabels[tool] ?? fallback ?? tool
}

function localizedToolPurpose(tool: string, locale: AppLocale) {
  if (locale === 'en-US') return englishToolPurposes[tool] ?? 'Use this step to advance the current research task'
  return toolPurposes[tool] ?? '根据当前问题推进研究任务'
}

function localizedToolDetail(detail: string, locale: AppLocale) {
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

function localizedTurnFailure(code: string, message: string, locale: AppLocale) {
  if (locale !== 'en-US') return message
  if (code === 'not_found') return 'This conversation does not exist or you do not have access.'
  if (code === 'run_in_progress') return 'A response is already being generated. Please wait.'
  if (code === 'credits_depleted') return 'You do not have enough credits. Review your usage in Account settings.'
  return 'The Agent cannot complete this answer right now. Please try again later.'
}

type AgentPageStatus = 'idle' | 'loading' | 'thinking' | 'retrieving' | 'answering' | 'pausing' | 'pause-failed' | 'error'
type AgentToolEvent = Extract<AgentEvent, { type: 'tool_started' | 'tool_finished' | 'tool_failed' }>
type ResearchToolStep = AgentToolStep & { interrupted?: boolean }
type StreamingTurn = {
  runId?: string | null
  progressEnd?: number
  question: string
  answer: string
  citations: AgentCitation[]
  toolSteps: ResearchToolStep[]
  canvasPatches: ResearchCanvasStreamingTurn['canvasPatches']
  startedAt: number
  interrupted?: boolean
  failure?: string
}
type PendingTurnAttempt = {
  question: string
  idempotencyKey: string
  conversationId: string | null
  runId?: string | null
  materialIds: string[]
  request?: AgentTurnRequest
}

type ResearchStartHandoff = {
  proposalId: string
  conversationId: string
  knowledgeReleaseId: string
  phenomenon: string
  researchIntent: string | null
}

type SelectedCitationContext = {
  citation: AgentCitation
  knowledgeReleaseId: string | null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function researchStartHandoffFromSteps(steps: ResearchToolStep[]): ResearchStartHandoff | null {
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

function conversationStorageScope(userId: string | null, conversationId: string | null, taskId: string | null, workspace: string) {
  return userId ? `${encodeURIComponent(userId)}.${conversationId ? `conversation.${encodeURIComponent(conversationId)}` : `draft.${workspace}.${encodeURIComponent(taskId ?? 'independent')}`}` : null
}

function scopedSessionKey(base: string, userId: string | null) {
  return userId ? `${base}.${userId}` : null
}

function readStoredDraft(userId: string | null) {
  if (typeof window === 'undefined') return ''
  try {
    const storageKey = scopedSessionKey(DRAFT_STORAGE_KEY, userId)
    return storageKey
      ? window.localStorage.getItem(storageKey)?.slice(0, MAX_AGENT_MESSAGE_LENGTH) ?? ''
      : ''
  } catch {
    return ''
  }
}

function persistDraft(userId: string | null, value: string) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(DRAFT_STORAGE_KEY, userId)
    if (!storageKey) return
    if (value) window.localStorage.setItem(storageKey, value)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Storage recovery is optional; the controlled composer remains usable.
  }
}

/** Persist a recoverable draft. This alone never authorizes sending it. */
export function seedAgentDraft(userId: string, value: string) {
  persistDraft(conversationStorageScope(userId, null, null, 'agent'), value.slice(0, MAX_AGENT_MESSAGE_LENGTH))
}

function readPendingTurnAttempt(userId: string | null): PendingTurnAttempt | null {
  if (typeof window === 'undefined') return null
  try {
    const storageKey = scopedSessionKey(PENDING_TURN_STORAGE_KEY, userId)
    if (!storageKey) return null
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingTurnAttempt>
    if (
      typeof value.question !== 'string'
      || !value.question.trim()
      || value.question.length > MAX_AGENT_MESSAGE_LENGTH
      || typeof value.idempotencyKey !== 'string'
      || !value.idempotencyKey
      || (value.conversationId !== null && typeof value.conversationId !== 'string')
    ) return null
    return {
      question: value.question,
      idempotencyKey: value.idempotencyKey,
      conversationId: value.conversationId ?? null,
      runId: typeof value.runId === 'string' && value.runId ? value.runId : null,
      // Keep the original request, including model_id/reasoning_effort; never reselect on recovery.
      request: value.request && typeof value.request.message === 'string' ? value.request : undefined,
      materialIds: Array.isArray(value.materialIds)
        ? value.materialIds.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
    }
  } catch {
    return null
  }
}

function persistPendingTurnAttempt(userId: string | null, value: PendingTurnAttempt | null) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(PENDING_TURN_STORAGE_KEY, userId)
    if (!storageKey) return
    if (value) window.localStorage.setItem(storageKey, JSON.stringify(value))
    else window.localStorage.removeItem(storageKey)
  } catch {
    // The in-memory idempotency key still protects the active retry.
  }
}

function readInterruptedTurn(userId: string | null): StreamingTurn | null {
  if (typeof window === 'undefined') return null
  try {
    const storageKey = scopedSessionKey(INTERRUPTED_TURN_STORAGE_KEY, userId)
    if (!storageKey) return null
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const value = objectRecord(JSON.parse(raw))
    if (
      !value
      || typeof value.question !== 'string'
      || !value.question.trim()
      || value.question.length > MAX_AGENT_MESSAGE_LENGTH
      || typeof value.answer !== 'string'
      || value.interrupted !== true
      || !Array.isArray(value.citations)
      || !Array.isArray(value.toolSteps)
      || !Array.isArray(value.canvasPatches)
    ) return null
    const toolSteps = value.toolSteps.filter((item): item is ResearchToolStep => {
      const step = objectRecord(item)
      return Boolean(
        step
        && typeof step.id === 'string'
        && typeof step.tool === 'string'
        && typeof step.label === 'string'
        && (step.status === 'running' || step.status === 'completed' || step.status === 'failed'),
      )
    })
    return {
      runId: typeof value.runId === 'string' ? value.runId : null,
      question: value.question,
      answer: value.answer,
      citations: value.citations as AgentCitation[],
      toolSteps,
      canvasPatches: value.canvasPatches as ResearchCanvasStreamingTurn['canvasPatches'],
      startedAt: typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : Date.now(),
      interrupted: true,
      failure: typeof value.failure === 'string' && value.failure ? value.failure : undefined,
    }
  } catch {
    return null
  }
}

function persistInterruptedTurn(userId: string | null, value: StreamingTurn | null) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(INTERRUPTED_TURN_STORAGE_KEY, userId)
    if (!storageKey) return
    if (value) window.localStorage.setItem(storageKey, JSON.stringify(value))
    else window.localStorage.removeItem(storageKey)
  } catch {
    // The stopped turn remains visible in memory when storage is unavailable.
  }
}

function readStringMap(userId: string | null, base: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const storageKey = scopedSessionKey(base, userId)
    if (!storageKey) return {}
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => (
          Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
        ))
        .slice(-100),
    )
  } catch {
    return {}
  }
}

function persistStringMap(userId: string | null, base: string, values: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(base, userId)
    if (storageKey) window.sessionStorage.setItem(storageKey, JSON.stringify(values))
  } catch {
    // URL state and persisted turns remain authoritative when storage is disabled.
  }
}

function readStoredRuntimeModes(userId: string | null): Record<string, AgentRuntimeMode> {
  const stored = readStringMap(userId, AGENT_RUNTIME_STORAGE_KEY)
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, AgentRuntimeMode] => (
      entry[1] === 'mock' || entry[1] === 'base' || entry[1] === 'sft'
    )),
  )
}

function formatToolPayload(value: unknown): string | null {
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

function outputCandidates(output: unknown): unknown[] {
  if (Array.isArray(output)) return output
  if (!output || typeof output !== 'object') return []
  const value = output as Record<string, unknown>
  for (const key of ['items', 'results', 'entries', 'sources']) {
    if (Array.isArray(value[key])) return value[key] as unknown[]
  }
  return []
}

function resultItemsFromOutput(output: unknown): NonNullable<ResearchActivity['resultItems']> {
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

function citationKindLabel(kind: string, locale: AppLocale) {
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

function materialCitationFields(citation: AgentCitation | null): {
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

function tombstoneMaterialCitation(citation: AgentCitation, materialId: string): AgentCitation {
  if (materialCitationFields(citation).materialId !== materialId) return citation
  return { ...citation, deleted: true, excerpt: null }
}

function tombstoneConversationMaterial(conversation: AgentConversation, materialId: string): AgentConversation {
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
    }
  })
  return changed ? { ...conversation, turns } : conversation
}


// 维度既可能来自条目号（D1:C213），也可能只出现在来源路径里（价值论/02-02-1...md）。
const dimensionByName: Array<[string, string]> = [
  ['本体论', 'D1'], ['实践论', 'D2'], ['方法论', 'D3'], ['价值论', 'D4'],
  ['认识论', 'D5'], ['传统', 'D6'], ['学科史', 'D7'],
]

function citationDimension(citation: AgentCitation): string | null {
  const fromId = citation.knowledge_id?.match(/\b(D[1-7])\b/)?.[1]
  if (fromId) return fromId
  if (citation.source_kind === 'web') return null
  const label = citation.label ?? ''
  return dimensionByName.find(([name]) => label.includes(name))?.[1] ?? null
}

// 网页来源的副标题给域名，比统一写"来源"更能让人判断这条证据可不可信。
function citationHost(citation: AgentCitation) {
  if (citation.source_kind !== 'web' || !citation.source_id) return null
  try {
    return new URL(citation.source_id).host.replace(/^www\./, '')
  } catch {
    return null
  }
}

function citationToRail(citation: AgentCitation, locale: AppLocale): ResearchCitation {
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

function toActivity(step: ResearchToolStep, locale: AppLocale): ResearchActivity {
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

function updateToolSteps(steps: ResearchToolStep[], event: AgentToolEvent): ResearchToolStep[] {
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

function researchStepForTools(steps: ResearchToolStep[]): number {
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
function deepResearchRecord(turn: AgentTurn | undefined): DeepResearchRecord | null {
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

function persistedToolSteps(traces: AgentToolTrace[] | undefined): ResearchToolStep[] {
  let steps: ResearchToolStep[] = []
  for (const trace of traces ?? []) {
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

function attachLocalToolSteps(conversation: AgentConversation, steps: ResearchToolStep[]): AgentConversation {
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

function interruptedSteps(steps: ResearchToolStep[], locale: AppLocale) {
  return steps.map((step) => step.status === 'running'
    ? { ...step, status: 'failed' as const, interrupted: true, detail: locale === 'en-US' ? 'Stopped' : '已停止' }
    : step)
}

function hasKnowledgeActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => knowledgeTools.has(step.tool))
}

function hasCompletedKnowledgeActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => knowledgeTools.has(step.tool) && step.status === 'completed')
}

function hasResearchMaterialActivity(steps: ResearchToolStep[]) {
  return steps.some((step) => researchMaterialTools.has(step.tool))
}

function ConversationHistory({
  projects,
  setProjects,
  onNewConversation,
  onRename,
  onDelete,
  onDeleteProject,
  selectedTaskId,
  conversations,
  activeConversationId,
  loading,
  onOpen,
  onClose,
}: {
  projects: ResearchProject[]
  setProjects: (projects: ResearchProject[]) => void

  onNewConversation: (taskId?: string) => void
  onRename: (conversation: AgentConversationSummary, title: string) => Promise<void>
  onDelete: (conversation: AgentConversationSummary) => Promise<void>
  onDeleteProject: (taskId: string) => Promise<void>
  selectedTaskId: string | null

  conversations: AgentConversationSummary[]
  activeConversationId: string | null
  loading: boolean
  onOpen: (conversation: AgentConversationSummary) => void
  onClose: () => void
}) {
  return <ConversationHistoryView modal projects={projects} setProjects={setProjects}
    onNewConversation={onNewConversation} onRename={onRename} onDelete={onDelete}
    onDeleteProject={onDeleteProject} selectedTaskId={selectedTaskId}
    conversations={conversations} activeConversationId={activeConversationId}
    loading={loading} onOpen={onOpen} onClose={onClose} />
}

function AssistantTurn({
  userId,
  turnId,
  question,
  answer,
  citations,
  toolSteps,
  conversationId,
  interrupted,
  failure,
  streaming,
  streamingStatus,
  progressEnd = 0,
  embedded,
  showResearchHandoff,
  knowledgeReleaseId,
  onOpenActivity,
  onSelectCitation,
  onRegenerate,
  onContinueResearch,
  researchEntryBusy,
}: {
  userId: string | null
  turnId: string
  question: string
  answer: string
  citations: AgentCitation[]
  toolSteps: ResearchToolStep[]
  conversationId: string | null
  interrupted?: boolean
  failure?: string
  streaming?: boolean
  streamingStatus?: AgentPageStatus
  progressEnd?: number
  embedded?: boolean
  showResearchHandoff?: boolean
  knowledgeReleaseId: string | null
  onOpenActivity: (step?: ResearchToolStep) => void
  onSelectCitation: (citation: AgentCitation, knowledgeReleaseId: string | null) => void
  onRegenerate?: () => void
  onContinueResearch?: () => void
  researchEntryBusy?: boolean
}) {
  const { locale, text } = useAppLocale()
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), staleTime: 30_000 })
  const avatarId = profile.data?.avatar_id as AgentAvatarId | undefined
  const avatar = avatarId && agentAvatarById[avatarId] ? avatarId : 'shi'
  const researchHandoff = researchStartHandoffFromSteps(toolSteps)
  const knowledgeHandoffCitation = showResearchHandoff && conversationId && knowledgeReleaseId
    && hasCompletedKnowledgeActivity(toolSteps)
    ? citations.find((citation) => Boolean(citation.knowledge_id)) ?? null
    : null
  const completedStepCount = toolSteps.filter(step => step.status === 'completed').length
  const handoffs: ConversationHandoff[] = []
  if (knowledgeHandoffCitation?.knowledge_id && conversationId && knowledgeReleaseId) {
    const returnParams = new URLSearchParams({ conversation_id: conversationId, knowledge_release_id: knowledgeReleaseId })
    const entryParams = new URLSearchParams({ knowledge_release_id: knowledgeReleaseId, return_to: `/agent?${returnParams}` })
    const graphParams = new URLSearchParams({ knowledge_release_id: knowledgeReleaseId, center: knowledgeHandoffCitation.knowledge_id, query: knowledgeHandoffCitation.label })
    handoffs.push({ id: 'knowledge', label: text('知识库建议', 'Knowledge base suggestion'), title: knowledgeHandoffCitation.label, actions: [
      { id: 'read', label: text('打开知识条目', 'Open knowledge entry'), href: `/knowledge/${encodeURIComponent(knowledgeHandoffCitation.knowledge_id)}?${entryParams}` },
      { id: 'graph', label: text('查看知识节点', 'View knowledge node'), href: `/knowledge/graph?${graphParams}` },
    ] })
  }
  if (showResearchHandoff && researchHandoff && onContinueResearch) handoffs.push({
    id: researchHandoff.proposalId, label: text('研究建议', 'Research suggestion'), title: researchHandoff.phenomenon, description: researchHandoff.researchIntent ?? undefined,
    actions: [{ id: 'start-research', label: text('去新建研究', 'Open new research'), onClick: onContinueResearch, disabled: researchEntryBusy }],
  })
  const partialIndex = toolSteps.map(step => objectRecord(step.output))
    .filter(output => output?.error !== 'knowledge_index_choice_required')
    .map(output => output?.knowledge_index_coverage)
    .find(value => isKnowledgeIndexStatus(value) && value.missing_count > 0)
  const coverageNotice = !interrupted && !failure && isKnowledgeIndexStatus(partialIndex)
    ? text(`本轮仅覆盖已就绪的 ${partialIndex.ready_count} / ${partialIndex.total_count} 份资料，其余 ${partialIndex.missing_count} 份未参与检索。`, `This answer searched only ${partialIndex.ready_count} of ${partialIndex.total_count} ready documents; ${partialIndex.missing_count} documents were excluded.`)
    : undefined
  const provenance = coverageNotice ?? (!streaming && answer && !citations.length
    ? hasKnowledgeActivity(toolSteps) ? text('已检索知识库，但没有可展示的来源，请谨慎引用。', 'The knowledge base was searched, but no displayable source was returned. Cite with care.')
    : hasResearchMaterialActivity(toolSteps) ? text('已检索个人材料，但没有可展示的原文位置，请谨慎引用。', 'Personal materials were searched, but no displayable source position was returned. Cite with care.')
    : undefined : undefined)
  const runningTool = [...toolSteps].reverse().find(step => step.status === 'running')?.tool
  const statusText = runningTool && ['read_knowledge_entry', 'read_sources', 'read_research_document', 'read_research_material_context'].includes(runningTool)
    ? text('正在阅读研究材料', 'Reading research materials')
    : runningTool === 'search_research_materials' ? text('正在检索个人材料', 'Searching personal research materials')
    : runningTool && ['search_knowledge', 'browse_knowledge_directory'].includes(runningTool) ? text('正在检索知识库', 'Searching the knowledge base')
    : runningTool === 'start_theory_matching' ? text('正在比较理论视角', 'Comparing theoretical perspectives')
    : runningTool && ['propose_document_creation', 'propose_document_revision'].includes(runningTool) ? text('正在整理研究框架', 'Preparing the research framework')
    : runningTool ? text('正在更新研究进度', 'Updating research progress')
    : streamingStatus === 'answering' ? text('正在生成回答', 'Writing the answer') : text('正在理解并整理研究问题', 'Understanding and structuring the research question')
  return <ConversationTurn
    agent={{ name: profile.data?.name.trim() || 'Everplain', avatar, color: profile.data?.color }}
    turn={{ id: turnId, question, answer, citations, knowledgeReleaseId,
      toolSteps: toolSteps.map(step => ({ ...step, label: localizedToolLabel(step.tool, locale, step.label), detail: step.detail ? localizedToolDetail(step.detail, locale) : undefined, purpose: localizedToolPurpose(step.tool, locale), resultItems: resultItemsFromOutput(step.output) })),
      streaming, statusText,
      progressEnd, interrupted, failure, provenance, handoffs,
      notice: interrupted ? answer.trim() || embedded
        ? text(`本轮已停止，已保留生成内容和 ${completedStepCount} 个已完成步骤。`, `This turn was stopped. Generated content and ${completedStepCount} steps were retained.`)
        : text('本轮已停止，未保存未完成的回答。', 'This turn stopped before an unfinished answer was saved.') : undefined,
      onRegenerate, onResume: interrupted && !failure ? onRegenerate : undefined,
      onCopy: onRegenerate && answer ? async content => { if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable'); await navigator.clipboard.writeText(content) } : undefined,
    }}
    renderAvatar={state => <PersonalCompanion userId={userId} compact thinking={state === 'think'} working={state === 'work'} fallback={<AgentAvatar avatar="shi" size={32} state={state} />} />}
    onSelectCitation={(citation, release) => onSelectCitation(citation, release)}
    onOpenActivity={(_turnId, step) => onOpenActivity(step)}
  />
}

type ResearchAgentConversationPageProps = {
  userId: string | null
  entryNavigationType?: NavigationType
  embedded?: boolean
  referenceKnowledgeBaseId?: string | null
  onOpenCourseCitation?: (citation: AgentCitation) => void
  conversationId?: string | null
  knowledgeReleaseId?: string | null
  workspace?: 'agent' | 'research'
  taskId?: string | null
  documentId?: string | null
  sectionId?: string | null
  documentVersion?: number | null
  writingDocumentId?: string | null
  initialWritingMessage?: { id: string; text: string } | null
  writingAction?: { id: string; text: string } | null
  onWritingActionFinished?: (id: string) => void
  onBusyChange?: (busy: boolean) => void
  prepareWritingContext?: () => Promise<AgentTurnRequest['writing_context']>
  theoryPlanId?: string | null
  onTurnCompleted?: () => void
  onWritingRevisionCreated?: () => void
  onConversationStarted?: (identity: { conversation_id: string; task_id: string | null }) => void
  onConversationChange?: (conversation: AgentConversation) => void
  onStreamingTurnChange?: (turn: ResearchCanvasStreamingTurn | null) => void
  conversationTail?: ReactNode
  composerPrefix?: ReactNode
  showConversationManagement?: boolean
  historyRailTarget?: HTMLElement | null
  composerAriaLabel?: string
  suggestedPrompt?: string | null
  suggestedPromptKey?: number
  introSessionId?: string | null
  discussion?: ResearchDiscussion | null
  onClearDiscussion?: () => void
  citationRequest?: { id: string; key: number } | null
  enableResearchGuidance?: boolean
  researchContext?: boolean
}

export function ResearchAgentConversationPage({
  userId,
  entryNavigationType,
  embedded = false,
  referenceKnowledgeBaseId: boundReferenceKnowledgeBaseId = null,
  onOpenCourseCitation,
  conversationId: boundConversationId = null,
  knowledgeReleaseId: boundKnowledgeReleaseId = null,
  workspace: boundWorkspace = 'agent',
  taskId: boundTaskId = null,
  documentId = null,
  sectionId = null,
  documentVersion = null,
  writingDocumentId = null,
  initialWritingMessage = null,
  writingAction = null,
  onWritingActionFinished,
  onBusyChange,
  prepareWritingContext,
  theoryPlanId = null,
  onTurnCompleted,
  onWritingRevisionCreated,
  onConversationChange,
  onConversationStarted,
  onStreamingTurnChange,
  conversationTail,
  composerPrefix,
  showConversationManagement = !embedded,
  historyRailTarget = null,
  composerAriaLabel,
  suggestedPrompt = null,
  suggestedPromptKey = 0,
  introSessionId = null,
  discussion = null,
  onClearDiscussion,
  citationRequest = null,
  enableResearchGuidance = false,
  researchContext = false,
}: ResearchAgentConversationPageProps) {
  const { locale, text } = useAppLocale()
  const queryClient = useQueryClient()
  const modelSelection = useAgentModelSelection(userId)
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedConversationId = embedded ? boundConversationId : searchParams.get('conversation_id')
  const homeSubmission = (entryNavigationType ?? navigationType) !== 'POP' && !embedded && !requestedConversationId && !searchParams.get('task_id')
    ? readHomeSubmission(location.state?.homeSubmitId, userId) : null
  const requestedKnowledgeReleaseId = embedded ? boundKnowledgeReleaseId : searchParams.get('knowledge_release_id')
  const storageWorkspace = writingDocumentId ? `writing:${writingDocumentId}` : embedded && boundReferenceKnowledgeBaseId ? `course:${boundReferenceKnowledgeBaseId}` : embedded ? boundWorkspace : 'agent'
  const requestedScope = conversationStorageScope(userId, requestedConversationId, embedded ? boundTaskId : searchParams.get('task_id'), storageWorkspace)
  const storageScope = useRef(requestedScope)
  const restoredPendingTurn = useRef<PendingTurnAttempt | null>(readPendingTurnAttempt(storageScope.current))
  const restoredInterruptedTurn = useRef<StreamingTurn | null>(readInterruptedTurn(storageScope.current))
  const [draft, setDraft] = useState(() => homeSubmission?.question ?? (readStoredDraft(storageScope.current) || restoredPendingTurn.current?.question || ''))
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<AgentConversation | null>(null)
  const taskId = embedded ? boundTaskId : (
    activeConversation?.conversation_id === requestedConversationId && activeConversation.task_id !== undefined
      ? activeConversation.task_id : searchParams.get('task_id')
  )
  const workspace = embedded ? boundWorkspace : taskId ? 'research' : 'agent'
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [projectListError, setProjectListError] = useState<string | null>(null)
  const projectScopeKey = conversations.map((item) => item.task_id ?? '').join(',')
  useEffect(() => {
    const controller = new AbortController()
    void listResearchProjects(controller.signal).then((items) => {
      if (!controller.signal.aborted) { setProjects(items); setProjectListError(null) }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && (cause as { name?: string })?.name !== 'AbortError') setProjectListError(text('项目列表暂时无法加载', 'Projects are unavailable'))
    })
    return () => controller.abort()
  }, [projectScopeKey, text])

  // Presentation identity survives temporary stream → saved turn, without changing request state.
  const visualTurnKeys = useRef(new Map<string, string>())
  const streamVisualKey = useRef(0)
  const [streamingTurn, setStreamingTurnState] = useState<StreamingTurn | null>(restoredInterruptedTurn.current)
  const streamingTurnRef = useRef(streamingTurn)
  const setStreamingTurn = useCallback((update: SetStateAction<StreamingTurn | null>) => {
    const next = typeof update === 'function' ? update(streamingTurnRef.current) : update
    // A freshly loaded/restored turn owns a new identity; in-place stream updates keep it.
    if (next && typeof update !== 'function' && next !== streamingTurnRef.current) streamVisualKey.current += 1
    streamingTurnRef.current = next
    setStreamingTurnState(next)
  }, [])
  const [toolStepsByTurnId, setToolStepsByTurnId] = useState<Record<string, ResearchToolStep[]>>({})
  const [knowledgeReleaseByConversationId, setKnowledgeReleaseByConversationId] = useState<Record<string, string>>(() => {
    const stored = readStringMap(userId, KNOWLEDGE_RELEASE_STORAGE_KEY)
    return requestedConversationId && requestedKnowledgeReleaseId
      ? { ...stored, [requestedConversationId]: requestedKnowledgeReleaseId }
      : stored
  })
  const [runtimeModeByConversationId, setRuntimeModeByConversationId] = useState<Record<string, AgentRuntimeMode>>(() => readStoredRuntimeModes(userId))
  const [runtimeMode, setRuntimeMode] = useState<AgentRuntimeMode | null>(() => (
    requestedConversationId ? readStoredRuntimeModes(userId)[requestedConversationId] ?? null : null
  ))
  const [status, setStatus] = useState<AgentPageStatus>('idle')
  const writingIntentStarted = useRef<string | null>(null)
  const writingActionStarted = useRef<string | null>(null)
  const quickWritingAttempt = useRef<string | null>(null)
  const writingCallbacks = useRef({ onWritingActionFinished, onBusyChange }); writingCallbacks.current = { onWritingActionFinished, onBusyChange }
  const writingPreparation = useRef(false)
  const [preparingWriting, setPreparingWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(!embedded)
  const greeting = useConversationGreeting(locale, conversations.some(item => item.turn_count > 0), userId, !historyLoading)
  const [contextOpen, setContextOpen] = useState(false)
  // 研究工作区里内嵌的面板仍然保留这个浮层入口，独立 Agent 页已经由左侧对话记录栏取代它。
  const [historyOpen, setHistoryOpen] = useState(false)
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  // 用户手动收起研究面板后就不再自动弹出，直到换一段对话。
  const researchPanelDismissed = useRef(false)
  const sourceTriggerRef = useRef<HTMLElement | null>(null)
  // 收起时先播完退场动画再卸载，所以挂载状态比 contextOpen 多活一小会儿。
  const sourceMotionRef = useRef<HTMLDivElement>(null)
  const sourceMotion = usePresence(contextOpen && storageScope.current === requestedScope, sourceMotionRef, requestedScope)
  const railMounted = sourceMotion.present
  const [contextTab, setContextTab] = useState<ResearchContextTab>('agent')
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false)
  const [materialPickerLoading, setMaterialPickerLoading] = useState(false)
  const [availableMaterials, setAvailableMaterials] = useState<ResearchMaterial[]>([])
  const materialContextKey = useRef<string | null>(null)
  const uploadTaskId = useRef<string | null>(null)
  const [attachedMaterials, setAttachedMaterials] = useState<ResearchMaterial[]>([])
  const [materialUploading, setMaterialUploading] = useState(false)
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false)
  const [composerMode, setComposerMode] = useState<AgentComposerMode>(() => restoredPendingTurn.current?.request?.mode === 'deep_research' ? 'deep-research' : 'standard')
  // Presentation context is distinct from the request workspace: a new research has no task yet.
  const researchToolsVisible = researchContext || (embedded && workspace === 'research') || composerMode === 'deep-research'
  const [deepResearchIntroVisible, setDeepResearchIntroVisible] = useState(false)
  const deepResearchIntroShown = useRef(false)
  const [deepResearchMockStage, setDeepResearchMockStage] = useState<DeepResearchMockStage>('idle')
  const [deepResearchMockQuestion, setDeepResearchMockQuestion] = useState('')
  const [deepResearchMockOptions, setDeepResearchMockOptions] = useState<string[]>([])
  const [deepResearchMockStep, setDeepResearchMockStep] = useState(0)
  const [deepResearchElapsedSeconds, setDeepResearchElapsedSeconds] = useState(0)
  const deepResearchStartedAt = useRef<number | null>(null)
  const [deepResearchResult, setDeepResearchResult] = useState<{ summary?: string; knowledgeCount?: number; webCount?: number }>({})
  const deepResearchLifecycleStarted = useRef(false)
  const [reportExportState, setReportExportState] = useState<DeepResearchExportState>('idle')
  const [researchEntryBusy, setResearchEntryBusy] = useState(false)
  const researchEntryAbortController = useRef<AbortController | null>(null)
  const hasDeepResearchMockConversation = deepResearchMockStage !== 'idle'
  const [webSearchEnabled, setWebSearchEnabled] = useState(true)
  const [materialLocatorTarget, setMaterialLocatorTarget] = useState<{ taskId?: string; materialId: string; parseId: string | null; segmentId: string | null } | null>(null)
  const [selectedCitationContext, setSelectedCitationContext] = useState<SelectedCitationContext | null>(null)
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null)
  const [, setLandingBackdropPhase] = useState<'visible' | 'leaving' | 'hidden'>('visible')
  const streamAbortController = useRef<AbortController | null>(null)
  const activeRunId = useRef<string | null>(null)
  const pausePending = useRef(false)
  const streamGeneration = useRef(0)
  const conversationLoadAbortController = useRef<AbortController | null>(null)
  const conversationLoadGeneration = useRef(0)
  const pendingToolSteps = useRef<ResearchToolStep[]>([])
  const failedTurnAttempt = useRef<PendingTurnAttempt | null>(restoredPendingTurn.current)
  const activeTurnAttempt = useRef<PendingTurnAttempt | null>(null)
  const materialsOpenRef = useRef(false)
  const locallyDeletedMaterialIds = useRef(new Set<string>())
  const redactedStreamingMaterialIds = useRef(new Set<string>())
  const pendingConversationId = useRef<string | null>(requestedConversationId ?? restoredPendingTurn.current?.conversationId ?? null)
  const loadedConversationId = useRef<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const materialMenuRef = useRef<HTMLDivElement>(null)
  const materialMenuButtonRef = useRef<HTMLButtonElement>(null)
  const materialFileInputRef = useRef<HTMLInputElement>(null)




  function openMaterials() {
    materialsOpenRef.current = true
    setMaterialsOpen(true)
  }

  function closeMaterials() {
    materialsOpenRef.current = false
    setMaterialsOpen(false)
  }

  useEffect(() => {
    if (!materialMenuOpen) return undefined

    function closeMaterialMenu(event: globalThis.KeyboardEvent | PointerEvent) {
      if (event instanceof globalThis.KeyboardEvent) {
        if (event.key !== 'Escape') return
        setMaterialMenuOpen(false)
        materialMenuButtonRef.current?.focus()
        return
      }
      if (!materialMenuRef.current?.contains(event.target as Node)) setMaterialMenuOpen(false)
    }

    document.addEventListener('keydown', closeMaterialMenu)
    document.addEventListener('pointerdown', closeMaterialMenu)
    return () => {
      document.removeEventListener('keydown', closeMaterialMenu)
      document.removeEventListener('pointerdown', closeMaterialMenu)
    }
  }, [materialMenuOpen])



  function openResearchMaterials() {
    setMaterialMenuOpen(false)
    if (workspace === 'research' && taskId) {
      setMaterialLocatorTarget(null)
      openMaterials()
      return
    }
    navigate('/research/materials')
  }

  async function openMaterialAttachmentPicker() {
    setMaterialMenuOpen(false)
    setMaterialPickerOpen(true)
    setMaterialPickerLoading(true)
    try {
      setAvailableMaterials(await listAgentMaterials())
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : text('研究材料暂时无法加载。', 'Research materials are unavailable.'))
      setMaterialPickerOpen(false)
    } finally {
      setMaterialPickerLoading(false)
    }
  }

  function toggleAttachedMaterial(material: ResearchMaterial) {
    if (material.status !== 'ready') return
    setAttachedMaterials((current) => {
      if (current.some((item) => item.materialId === material.materialId)) {
        return current.filter((item) => item.materialId !== material.materialId)
      }
      if (current.length >= 20) {
        setError(text('每轮最多附加 20 份研究材料。', 'You can attach up to 20 research materials per turn.'))
        return current
      }
      return [...current, material]
    })
  }

  async function uploadComposerMaterials(files: File[]) {
    if (!files.length || materialUploading) return
    const generation = conversationLoadGeneration.current
    const unsupported = files.find((file) => !isSupportedResearchMaterialFile(file))
    if (unsupported) {
      setError(text(`不支持“${unsupported.name}”的文件格式。`, `The file type for “${unsupported.name}” is not supported.`))
      return
    }
    const remaining = Math.max(0, 20 - attachedMaterials.length)
    if (files.length > remaining) {
      setError(text('每轮最多附加 20 份研究材料。', 'You can attach up to 20 research materials per turn.'))
      return
    }
    setMaterialUploading(true)
    setError(null)
    try {
      let destinationTaskId = taskId ?? uploadTaskId.current
      if (!destinationTaskId) {
        const context = await prepareAgentMaterialContext(
          activeConversation?.conversation_id ?? pendingConversationId.current, materialContextKey.current ??= crypto.randomUUID(),
        )
        if (generation !== conversationLoadGeneration.current) return
        pendingConversationId.current = context.conversation_id
        uploadTaskId.current = context.task_id
        destinationTaskId = context.task_id
      }
      for (const file of files) {
        const material = await addResearchLibraryMaterial(destinationTaskId, file)
        if (generation !== conversationLoadGeneration.current) return
        setAttachedMaterials((current) => [...current.filter((item) => item.materialId !== material.materialId), material])
        setAvailableMaterials((current) => [material, ...current.filter((item) => item.materialId !== material.materialId)])
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : text('研究材料上传失败。', 'Research material upload failed.'))
    } finally {
      setMaterialUploading(false)
      if (materialFileInputRef.current) materialFileInputRef.current.value = ''
    }
  }
  const pendingAttachedMaterials = attachedMaterials
    .filter((material) => material.ingestionStatus === 'queued' || material.ingestionStatus === 'processing')
    .map((material) => `${material.taskId}/${material.materialId}`).join(',')

  useEffect(() => {
    if (!pendingAttachedMaterials) return undefined
    let active = true
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      const results = await Promise.allSettled(pendingAttachedMaterials.split(',').map((key) => {
        const [sourceTaskId, materialId] = key.split('/')
        return getAgentAttachmentMaterial(sourceTaskId, materialId)
      }))
      running = false
      if (!active) return
      const byId = new Map(results.flatMap((result) => result.status === 'fulfilled' ? [[result.value.materialId, result.value] as const] : []))
      setAttachedMaterials((current) => current.map((item) => byId.get(item.materialId) ?? item))
    }
    const timer = window.setInterval(() => { void refresh() }, 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [pendingAttachedMaterials])

  const turns = useMemo(() => activeConversation?.turns ?? [], [activeConversation])
  const [guidanceDismissed, setGuidanceDismissed] = useState(false)
  const researchAsk = latestResearchAsk(activeConversation)
  const hasResearchWork = turns.some(turn => turn.tool_traces?.some(trace =>
    ['ask_research_question', 'get_research_state', 'start_theory_matching', 'propose_document_revision', 'propose_document_creation'].includes(trace.tool)))
  const currentResearchAsk = researchAsk ?? (!hasResearchWork && !guidanceDismissed ? {
    question: '已有研究起点，接下来你想先推进什么？',
    options: ['把研究方案搭起来', '先查清依据', '再推敲研究问题'],
  } : null)
  useEffect(() => { setGuidanceDismissed(false) }, [requestedConversationId, turns.at(-1)?.turn_id])
  useEffect(() => {
    if (!citationRequest || !activeConversation) return
    const resolved = resolveResearchCitation(activeConversation, citationRequest.id)
    if (resolved) {
      setSelectedCitationContext(resolved)
      setSelectedActivityId(null)
      setContextTab('basis')
      setContextOpen(true)
    } else setError('这条依据未在当前对话中找到，暂时无法打开原文。')
  }, [citationRequest, activeConversation])

  const canStopGeneration = status === 'thinking' || status === 'retrieving' || status === 'answering'
  const isBusy = preparingWriting || status === 'loading' || status === 'pausing' || status === 'pause-failed' || canStopGeneration
  const knowledgeIndex = useKnowledgeIndexChoice(requestedScope, (request, idempotencyKey) => {
    if (isBusy || writingPreparation.current || streamAbortController.current || researchEntryAbortController.current) return false
    void submitQuestion(request.message, idempotencyKey, undefined, false, undefined, false, request)
    return true
  }, !isBusy)
  useEffect(() => { writingCallbacks.current.onBusyChange?.(isBusy) }, [isBusy])
  const canSubmit = draft.trim().length > 0
    && !isBusy
    && (!homeSubmission || modelSelection.status === 'ready')
    && !researchEntryBusy
    && !materialUploading
    && attachedMaterials.every((material) => material.status === 'ready')
  const isEmpty = !turns.length && !streamingTurn && !hasDeepResearchMockConversation
  const isLanding = isEmpty && !homeSubmission

  useEffect(() => {
    if (embedded || !isLanding || composerMode !== 'standard' || deepResearchIntroShown.current) return undefined
    if (introSessionId && window.localStorage.getItem(DEEP_RESEARCH_INTRO_SESSION_KEY) === introSessionId) return undefined
    deepResearchIntroShown.current = true
    if (introSessionId) window.localStorage.setItem(DEEP_RESEARCH_INTRO_SESSION_KEY, introSessionId)
    setDeepResearchIntroVisible(true)
    const timeout = window.setTimeout(
      () => setDeepResearchIntroVisible(false),
      introSessionId ? DEEP_RESEARCH_INTRO_TIMEOUT_MS : 5000,
    )
    return () => window.clearTimeout(timeout)
  }, [composerMode, embedded, introSessionId, isLanding])

  useEffect(() => {
    onStreamingTurnChange?.(streamingTurn)
  }, [onStreamingTurnChange, streamingTurn])

  useEffect(() => {
    const question = searchParams.get('prompt')
    if (!question || requestedConversationId) return
    // Only explicit text submitted by a public-page composer may seed this route.
    // Legacy automatic suggestion URLs must never overwrite a user's saved draft.
    if (searchParams.get('prompt_source') === 'user') updateDraft(question)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('prompt')
      next.delete('prompt_source')
      return next
    }, { replace: true })
  }, [searchParams, requestedConversationId, setSearchParams])

  useEffect(() => {
    if (!suggestedPrompt) return
    updateDraft(suggestedPrompt)
    globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
  }, [suggestedPrompt, suggestedPromptKey])

  useEffect(() => {
    if (isEmpty) {
      setLandingBackdropPhase('visible')
      return
    }
    setLandingBackdropPhase((current) => current === 'hidden' ? 'hidden' : 'leaving')
    const timeout = window.setTimeout(() => setLandingBackdropPhase('hidden'), 680)
    return () => window.clearTimeout(timeout)
  }, [isEmpty])

  function updateDraft(value: string) {
    if (homeSubmission && value !== homeSubmission.question) takeHomeSubmission(homeSubmission.id, userId)
    setDraft(value)
    persistDraft(storageScope.current, value)
  }

  async function revealFirstStreamingTurn(turn: StreamingTurn, isCurrent: () => boolean) {
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { ready: Promise<void> }
    }
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const homeBot = document.querySelector(
      '.research-agent-conversation.is-empty .research-agent-page__empty-copy :is([data-research-agent-bot], .agent-avatar)',
    )
    if (!homeBot || reducedMotion || !transitionDocument.startViewTransition) {
      if (isCurrent()) setStreamingTurn(turn)
      return
    }

    let updated = false
    try {
      const transition = transitionDocument.startViewTransition(() => {
        if (!isCurrent()) return
        updated = true
        flushSync(() => setStreamingTurn(turn))
      })
      await transition.ready
    } catch {
      if (!updated && isCurrent()) setStreamingTurn(turn)
    }
  }

  const rememberKnowledgeRelease = useCallback((conversationId: string, releaseId: string) => {
    if (!conversationId || !releaseId) return
    setKnowledgeReleaseByConversationId((current) => {
      const next = { ...current, [conversationId]: releaseId }
      persistStringMap(userId, KNOWLEDGE_RELEASE_STORAGE_KEY, next)
      return next
    })
  }, [userId])

  const rememberRuntimeMode = useCallback((conversationId: string, mode: AgentRuntimeMode) => {
    if (!conversationId) return
    setRuntimeModeByConversationId((current) => {
      const next = { ...current, [conversationId]: mode }
      persistStringMap(userId, AGENT_RUNTIME_STORAGE_KEY, next)
      return next
    })
  }, [userId])

  function retainUnfinishedTurn(attempt: PendingTurnAttempt, turn: StreamingTurn) {
    if (!attempt.runId || !attempt.conversationId || !attempt.request) return
    const saved: AgentRunRecovery = {
      run_id: attempt.runId,
      idempotency_key: attempt.idempotencyKey,
      status: turn.failure ? 'failed' : 'interrupted',
      request: attempt.request,
      partial_answer: turn.answer,
      tool_summary: turn.toolSteps.map((step) => ({
        tool: step.tool,
        phase: step.status === 'completed' ? 'finished' : step.status === 'failed' ? 'failed' : 'started',
        call_id: step.id,
        input: objectRecord(step.input),
        output: step.output,
        detail: step.detail,
      })),
      updated_at: new Date().toISOString(),
      cancel_requested: true,
    }
    setActiveConversation((current) => {
      const conversation = current ?? {
        conversation_id: attempt.conversationId!, title: attempt.question,
        task_id: attempt.request?.task_id ?? null,
        created_at: new Date(turn.startedAt).toISOString(), updated_at: saved.updated_at,
        turn_count: 0, turns: [],
      }
      return { ...conversation, unfinished_runs: [...(conversation.unfinished_runs ?? []).filter((run) => run.run_id !== saved.run_id), saved] }
    })
  }

  function recoveryAttempt(run: AgentRunRecovery): PendingTurnAttempt {
    return {
      question: run.request.message,
      idempotencyKey: run.idempotency_key,
      conversationId: run.request.conversation_id ?? null,
      runId: run.run_id,
      materialIds: run.request.material_ids ?? [],
      request: run.request,
    }
  }

  function recoveryTurn(run: AgentRunRecovery): StreamingTurn {
    const traces = (run.tool_summary ?? []).filter((item) => typeof item.tool === 'string' && typeof item.phase === 'string') as AgentToolTrace[]
    return {
      runId: run.run_id,
      question: run.request.message,
      answer: run.partial_answer,
      citations: [],
      toolSteps: run.status === 'running' ? persistedToolSteps(traces) : interruptedSteps(persistedToolSteps(traces), locale),
      canvasPatches: [],
      startedAt: Date.parse(run.updated_at) || Date.now(),
      interrupted: run.status !== 'running' && !run.status.startsWith('awaiting_'),
      failure: run.status === 'failed' ? text('这轮回答未完成，可以从保存的位置重试。', 'This answer did not finish. Retry from the saved state.') : undefined,
    }
  }

  function restoreRecovery(run: AgentRunRecovery) {
    const attempt = recoveryAttempt(run)
    const turn = recoveryTurn(run)
    failedTurnAttempt.current = attempt
    activeTurnAttempt.current = run.status === 'running' || run.status.startsWith('awaiting_') ? attempt : null
    activeRunId.current = run.status === 'running' ? run.run_id : null
    pendingToolSteps.current = turn.toolSteps
    setStreamingTurn(turn)
    setComposerMode(run.request.mode === 'deep_research' ? 'deep-research' : 'standard')
    persistPendingTurnAttempt(storageScope.current, attempt)
    persistInterruptedTurn(storageScope.current, { ...turn, interrupted: true })
    const waiting = (run.tool_summary ?? []).find((item) => 'kind' in item && item.kind === 'deep_research_pending') as Record<string, unknown> | undefined
    if (run.status.startsWith('awaiting_') && waiting) {
      setDeepResearchMockStage(run.status === 'awaiting_clarification' ? 'clarifying' : 'planning')
      setDeepResearchMockQuestion(String(waiting.question ?? waiting.title ?? run.request.message))
      const options = waiting.options ?? waiting.steps
      setDeepResearchMockOptions(Array.isArray(options) ? options.filter((item): item is string => typeof item === 'string') : [])
      deepResearchLifecycleStarted.current = true
    }
    setStatus(run.status === 'running' ? 'thinking' : 'idle')
  }

  function resumeRecovery(run: AgentRunRecovery) {
    if (isBusy) return
    failedTurnAttempt.current = recoveryAttempt(run)
    void submitQuestion(run.request.message, run.idempotency_key)
  }

  const loadConversation = useCallback(async (conversationId: string) => {
    if (activeTurnAttempt.current?.conversationId === conversationId && streamAbortController.current) return
    if (loadedConversationId.current === conversationId && activeConversation?.conversation_id === conversationId) return
    conversationLoadAbortController.current?.abort()
    const controller = new AbortController()
    conversationLoadAbortController.current = controller
    const requestGeneration = conversationLoadGeneration.current + 1
    conversationLoadGeneration.current = requestGeneration
    setError(null)
    setStatus('loading')
    try {
      const conversation = await getAgentConversation(conversationId, controller.signal)
      if (controller.signal.aborted || requestGeneration !== conversationLoadGeneration.current) return
      const persistedReleaseId = [...conversation.turns]
        .reverse()
        .map((turn) => turn.knowledge_release_id?.trim() || null)
        .find((releaseId): releaseId is string => Boolean(releaseId)) || null
      const releaseId = knowledgeReleaseByConversationId[conversationId]
        || (conversationId === requestedConversationId ? requestedKnowledgeReleaseId : null)
        || persistedReleaseId
      setActiveConversation(conversation)
      if (conversation.unfinished_runs) {
        const unfinished = conversation.unfinished_runs
        const selected = unfinished.find((run) => run.status === 'running' || run.status.startsWith('awaiting_'))
          ?? unfinished.find((run) => run.run_id === failedTurnAttempt.current?.runId)
          ?? unfinished.at(-1)
        if (selected) restoreRecovery(selected)
        else {
          setStreamingTurn(null)
          failedTurnAttempt.current = null
          persistPendingTurnAttempt(storageScope.current, null)
          persistInterruptedTurn(storageScope.current, null)
        }
      }
      onConversationChange?.(conversation)
      setRuntimeMode(runtimeModeByConversationId[conversationId] ?? null)
      loadedConversationId.current = conversationId
      pendingConversationId.current = conversationId
      if (releaseId) rememberKnowledgeRelease(conversationId, releaseId)
      if (!embedded) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current)
          next.set('conversation_id', conversationId)
          if (releaseId) next.set('knowledge_release_id', releaseId)
          else next.delete('knowledge_release_id')
          return next
        }, { replace: true })
      }
    } catch (cause: unknown) {
      if (controller.signal.aborted || requestGeneration !== conversationLoadGeneration.current) return
      if ((cause as { name?: string } | null)?.name !== 'AbortError') {
        setError(text('这段对话暂时无法打开。你可以从一个新问题继续。', 'This conversation cannot be opened right now. You can continue with a new question.'))
      }
    } finally {
      if (!controller.signal.aborted && requestGeneration === conversationLoadGeneration.current) setStatus((current) => current === 'loading' ? 'idle' : current)
      if (conversationLoadAbortController.current === controller) conversationLoadAbortController.current = null
    }
  }, [activeConversation?.conversation_id, embedded, knowledgeReleaseByConversationId, onConversationChange, rememberKnowledgeRelease, requestedConversationId, requestedKnowledgeReleaseId, runtimeModeByConversationId, setSearchParams])

  useEffect(() => {
    if (!showConversationManagement) {
      setHistoryLoading(false)
      return undefined
    }
    const controller = new AbortController()
    listAgentConversations(controller.signal)
      .then((items) => setConversations(items))
      .catch((cause: unknown) => {
        if ((cause as { name?: string } | null)?.name !== 'AbortError' && !controller.signal.aborted) {
          setError(text('对话记录暂时无法加载，但你仍然可以开始新对话。', 'Conversation history is unavailable, but you can still start a new conversation.'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false)
      })
    return () => controller.abort()
  }, [showConversationManagement, text, userId])

  useEffect(() => {
    if (requestedConversationId) void loadConversation(requestedConversationId)
    else {
      conversationLoadAbortController.current?.abort()
      conversationLoadGeneration.current += 1
      setStatus((current) => current === 'loading' ? 'idle' : current)
    }
  }, [loadConversation, requestedConversationId])

  useEffect(() => {
    const endpoint = transcriptEndRef.current
    if (endpoint && typeof endpoint.scrollIntoView === 'function') {
      endpoint.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [streamingTurn?.answer, streamingTurn?.toolSteps.length, turns.length])

  const leaveConversation = useRef<() => void>(() => undefined)
  leaveConversation.current = () => {
    researchEntryAbortController.current?.abort()
    const attempt = activeTurnAttempt.current ?? failedTurnAttempt.current
    if (attempt && streamingTurnRef.current) {
      const saved = { ...streamingTurnRef.current, interrupted: true, toolSteps: interruptedSteps(pendingToolSteps.current, locale) }
      persistPendingTurnAttempt(storageScope.current, attempt)
      persistInterruptedTurn(storageScope.current, saved)
    }
    const runId = activeRunId.current
    activeRunId.current = null
    pausePending.current = false
    if (runId) void stopAgentRun(runId, { keepalive: true }).catch(() => undefined)
    streamGeneration.current += 1
    streamAbortController.current?.abort()
    streamAbortController.current = null
    conversationLoadGeneration.current += 1
    conversationLoadAbortController.current?.abort()
  }

  useEffect(() => {
    const onPageHide = () => {
      leaveConversation.current()
      failedTurnAttempt.current = activeTurnAttempt.current ?? failedTurnAttempt.current
      activeTurnAttempt.current = null
      setStreamingTurn(readInterruptedTurn(storageScope.current))
      resetDeepResearchMock()
      setStatus('idle')
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      leaveConversation.current()
    }
  }, [])

  useLayoutEffect(() => {
    if (storageScope.current === requestedScope) return
    leaveConversation.current()
    storageScope.current = requestedScope
    const pending = readPendingTurnAttempt(requestedScope)
    failedTurnAttempt.current = pending
    activeTurnAttempt.current = null
    pendingConversationId.current = requestedConversationId
    loadedConversationId.current = null
    setActiveConversation(null)
    // Account/conversation replacement must never retain a previous source or modal.
    sourceTriggerRef.current = null
    setSelectedCitationContext(null)
    setSelectedActivityId(null)
    setContextOpen(false)
    setHistoryOpen(false)
    setMaterialsOpen(false)
    setMaterialPickerOpen(false)
    setMaterialMenuOpen(false)
    setAvailableMaterials([])
    setStreamingTurn(readInterruptedTurn(requestedScope))
    setDraft(readStoredDraft(requestedScope))
    setStatus('idle')
    setError(null)
    setAttachedMaterials([])
    setToolStepsByTurnId({})
    setRuntimeMode(null)
    setKnowledgeReleaseByConversationId(readStringMap(userId, KNOWLEDGE_RELEASE_STORAGE_KEY))
    setRuntimeModeByConversationId(readStoredRuntimeModes(userId))
    pendingToolSteps.current = []
    resetDeepResearchMock()
    setComposerMode(pending?.request?.mode === 'deep_research' ? 'deep-research' : 'standard')
  }, [requestedScope, requestedConversationId, setStreamingTurn])

  function cancelActiveStream() {
    leaveConversation.current()
    researchEntryAbortController.current = null
    setResearchEntryBusy(false)
    pendingToolSteps.current = []
    failedTurnAttempt.current = null
    activeTurnAttempt.current = null
    setStreamingTurn(null)
  }

  function prepareConversationSwitch() {
    setAttachedMaterials([])
    setAvailableMaterials([])
    setMaterialPickerOpen(false)
    uploadTaskId.current = null
    materialContextKey.current = null
    cancelActiveStream()
    resetDeepResearchMock()
    conversationLoadAbortController.current?.abort()
    conversationLoadGeneration.current += 1
    loadedConversationId.current = null
    pendingConversationId.current = null
    setActiveConversation(null)
    setRuntimeMode(null)
    setToolStepsByTurnId({})
    setAttachedMaterials([])
    setAvailableMaterials([])
    setMaterialPickerOpen(false)
    setSelectedCitationContext(null)
    setSelectedActivityId(null)
    setContextOpen(false)
    setContextTab('agent')
    researchPanelDismissed.current = false
    closeMaterials()
    setMaterialLocatorTarget(null)
  }

  function openConversation(summary: AgentConversationSummary) {
    if (location.pathname !== '/research/new' && embedded) {
      const next = new URLSearchParams({ conversation_id: summary.conversation_id })
      if (summary.task_id) next.set('task_id', summary.task_id)
      navigate(`/research/new?${next}`)
      return
    }
    prepareConversationSwitch()
    setHistoryOpen(false)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('conversation_id', summary.conversation_id)
      if (summary.task_id) next.set('task_id', summary.task_id)
      else next.delete('task_id')
      next.delete('knowledge_release_id')
      return next
    }, { replace: true })
  }

  async function renameSavedConversation(
    summary: AgentConversationSummary,
    title: string,
  ) {
    const updated = await renameAgentConversation(summary.conversation_id, title)
    setConversations((current) => current.map((conversation) => (
      conversation.conversation_id === updated.conversation_id ? updated : conversation
    )))
    setActiveConversation((current) => current?.conversation_id === updated.conversation_id
      ? { ...current, title: updated.title, updated_at: updated.updated_at }
      : current)
  }

  async function deleteSavedConversation(summary: AgentConversationSummary) {
    await deleteAgentConversation(summary.conversation_id)
    void queryClient.resetQueries({ queryKey: conversationContextSummaryKey(userId), exact: true })
    setConversations((current) => current.filter((conversation) => (
      conversation.conversation_id !== summary.conversation_id
    )))
    if (
      activeConversation?.conversation_id === summary.conversation_id
      || requestedConversationId === summary.conversation_id
    ) {
      newConversation()
    }
  }

  async function deleteSavedProject(projectId: string) {
    if (taskId === projectId && (isBusy || materialUploading)) throw new Error(text('请先结束当前回答或材料上传，再删除项目', 'Finish the current answer or upload before deleting this project'))
    await deleteResearchProject(projectId)
    void queryClient.resetQueries({ queryKey: conversationContextSummaryKey(userId), exact: true })
    setProjects((current) => current.filter((project) => project.task_id !== projectId))
    setConversations((current) => current.map((conversation) => conversation.task_id === projectId
      ? { ...conversation, task_id: null } : conversation))
    setActiveConversation((current) => current?.task_id === projectId ? { ...current, task_id: null } : current)
    if (taskId === projectId) {
      setAttachedMaterials([])
      if (embedded) {
        navigate(requestedConversationId ? `/agent?conversation_id=${encodeURIComponent(requestedConversationId)}` : '/agent')
      } else {
        setSearchParams((current) => {
          const next = new URLSearchParams(current)
          next.delete('task_id')
          return next
        }, { replace: true })
      }
    }
  }

  function newConversation(projectId?: string) {
    if (location.pathname !== '/research/new' && embedded) {
      navigate(projectId ? `/research/new?task_id=${encodeURIComponent(projectId)}` : '/research/new')
      return
    }
    prepareConversationSwitch()
    storageScope.current = conversationStorageScope(userId, null, projectId || null, storageWorkspace)
    updateDraft('')
    setError(null)
    setStatus('idle')
    setHistoryOpen(false)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversation_id')
      next.delete('knowledge_release_id')
      if (projectId) next.set('task_id', projectId)
      else next.delete('task_id')
      return next
    }, { replace: true })
    globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
  }

  function switchComposerProject(projectId: string) {
    const pendingDraft = !activeConversation?.turn_count ? draft : ''
    newConversation(projectId || undefined)
    storageScope.current = conversationStorageScope(userId, null, projectId || null, storageWorkspace)
    if (pendingDraft) updateDraft(pendingDraft)
  }

  async function continueResearch() {
    const conversation = activeConversation
    if (!conversation || isBusy || materialUploading || attachedMaterials.some((material) => material.status !== 'ready') || researchEntryAbortController.current) return
    const controller = new AbortController()
    researchEntryAbortController.current = controller
    setResearchEntryBusy(true)
    setError(null)
    try {
      let journey = await getResearchStartJourney(conversation.conversation_id, controller.signal)
      if (controller.signal.aborted) return
      let completed = conversation
      if (!journey.proposal && !journey.phenomenonConfirmed) {
        // 两个入口都走普通 Agent 的同一工具，深入研究仅在已有对话中多一份调研参照。
        const hasResearchReference = conversation.turns.some((turn) => deepResearchRecord(turn))
        const prompt = '请基于这段对话整理待确认的研究起点，包括现象、研究意图与情境，等待我确认。不要重新运行深入研究，不要替我确认或开展理论匹配。'
          + (hasResearchReference ? '前面已完成的调研报告及其引用是参考资料，请沿用已有成果和来源，不要从零追问，也不要把初步结论当作我已确认的研究判断。' : '')
        setComposerMode('standard')
        const retryKey = failedTurnAttempt.current?.question === prompt ? failedTurnAttempt.current.idempotencyKey : undefined
        const result = await submitQuestion(prompt, retryKey, undefined, true)
        if (!result || controller.signal.aborted) return
        completed = result
        journey = await getResearchStartJourney(conversation.conversation_id, controller.signal)
      }
      if (controller.signal.aborted) return
      if (!journey.proposal && !journey.phenomenonConfirmed) {
        setError('尚未形成待确认的研究起点，请根据 Agent 的回复补充信息后再继续。')
        return
      }
      const releaseId = journey.knowledgeReleaseId || completed.turns.at(-1)?.knowledge_release_id
        || knowledgeReleaseByConversationId[conversation.conversation_id] || requestedKnowledgeReleaseId
      const query = new URLSearchParams({ conversation_id: conversation.conversation_id })
      if (releaseId) query.set('knowledge_release_id', releaseId)
      if (journey.taskId) query.set('task_id', journey.taskId)
      navigate(`/research/new?${query.toString()}`)
    } catch (cause: unknown) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '研究起点暂时无法恢复，请重试。')
    } finally {
      if (researchEntryAbortController.current === controller) {
        researchEntryAbortController.current = null
        setResearchEntryBusy(false)
      }
    }
  }

  async function submitQuestion(rawQuestion: string, retryIdempotencyKey?: string, deepAction?: { action: 'clarify' | 'confirm' | 'skip'; selection?: string }, researchEntry = false, entrySelection?: ModelSelection, writingShortcut = false, resumeRequest?: AgentTurnRequest): Promise<AgentConversation | null> {
    const question = resumeRequest || retryIdempotencyKey || deepAction || researchEntry ? rawQuestion.trim() : composeResearchDiscussion(rawQuestion.trim(), discussion)
    if (!rawQuestion.trim()) return null
    if (question.length > MAX_AGENT_MESSAGE_LENGTH) {
      setError('讨论内容过长，请缩短问题或重新选择较短的段落。')
      return null
    }
    if (!question || writingPreparation.current || isBusy || streamAbortController.current || (!researchEntry && researchEntryAbortController.current)) return null
    const turnMode = resumeRequest ? (resumeRequest.mode === 'deep_research' ? 'deep-research' : 'standard') : (researchEntry || writingShortcut) ? 'standard' : (failedTurnAttempt.current?.idempotencyKey === retryIdempotencyKey && failedTurnAttempt.current?.request ? failedTurnAttempt.current.request.mode === 'deep_research' ? 'deep-research' : 'standard' : composerMode)
    let resultConversation: AgentConversation | null = null
    const idempotencyKey = retryIdempotencyKey
      ?? globalThis.crypto?.randomUUID?.()
      ?? `agent-${Date.now()}`
    quickWritingAttempt.current = writingShortcut ? idempotencyKey : null
    const resumableAttempt = failedTurnAttempt.current?.idempotencyKey === idempotencyKey
      ? failedTurnAttempt.current
      : activeTurnAttempt.current?.idempotencyKey === idempotencyKey
        ? activeTurnAttempt.current
        : null
    const newModelFields = resumeRequest || resumableAttempt?.request ? {} : entrySelection
      ? toModelSelectionRequest(entrySelection, modelSelection.catalog) : modelSelection.requestFields()
    const attempt: PendingTurnAttempt = {
      question,
      idempotencyKey,
      conversationId: resumeRequest?.conversation_id ?? activeConversation?.conversation_id ?? pendingConversationId.current,
      runId: resumableAttempt?.runId ?? null,
      materialIds: resumeRequest?.material_ids ?? resumableAttempt?.materialIds ?? attachedMaterials.map((item) => item.materialId),
      request: resumableAttempt?.request,
    }
    let writingContext: AgentTurnRequest['writing_context']
    if (!resumeRequest && !attempt.request && prepareWritingContext) {
      const preparationGeneration = streamGeneration.current
      writingPreparation.current = true
      setPreparingWriting(true)
      try { writingContext = await prepareWritingContext(); if (preparationGeneration !== streamGeneration.current) return null }
      catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存当前文稿，请重试。'); return null }
      finally { writingPreparation.current = false; setPreparingWriting(false) }
    }
    const request: AgentTurnRequest = resumeRequest ? { ...resumeRequest } : attempt.request ? { ...attempt.request, conversation_id: attempt.conversationId } : {
          ...newModelFields,
          conversation_id: activeConversation?.conversation_id ?? pendingConversationId.current,
          message: question,
          mode: turnMode === 'deep-research' ? 'deep_research' : 'standard',
          workspace,
          ...(writingContext ? { writing_context: writingContext } : {}),
          web_search: webSearchEnabled,
          task_id: workspace === 'research' ? taskId : null,
          document_id: workspace === 'research' ? documentId : null,
          section_id: workspace === 'research' ? (discussion && 'sectionId' in discussion ? discussion.sectionId : sectionId) : null,
          document_version: workspace === 'research' ? documentVersion : null,
          theory_plan_id: workspace === 'research' ? theoryPlanId : null,
          material_ids: attempt.materialIds,
          reference_knowledge_base_id: activeConversation ? activeConversation.reference_knowledge_base_id ?? null : embedded ? boundReferenceKnowledgeBaseId : searchParams.get('reference_knowledge_base_id'),
          deep_research_run_id: deepAction ? (activeTurnAttempt.current?.runId ?? null) : null,
          deep_research_action: deepAction?.action ?? null,
          deep_research_selection: deepAction?.selection ?? null,
    }
    if (!resumeRequest) knowledgeIndex.cancel()
    if (deepAction) {
      request.deep_research_run_id = attempt.runId ?? null
      request.deep_research_action = deepAction.action
      request.deep_research_selection = deepAction.selection ?? null
    }
    attempt.request = request
    const previousAttempt = failedTurnAttempt.current ?? activeTurnAttempt.current
    const previousTurn = streamingTurnRef.current
    if (previousAttempt && previousAttempt.idempotencyKey !== idempotencyKey && previousTurn && (previousTurn.interrupted || previousTurn.failure)) {
      retainUnfinishedTurn(previousAttempt, previousTurn)
    }
    activeTurnAttempt.current = attempt
    failedTurnAttempt.current = null
    persistInterruptedTurn(storageScope.current, null)
    persistPendingTurnAttempt(storageScope.current, attempt)
    if (!writingShortcut) updateDraft('')
    setError(null)
    setStatus('thinking')
    pendingToolSteps.current = []
    redactedStreamingMaterialIds.current.clear()
    const firstStreamingTurn: StreamingTurn = { runId: attempt.runId, question, answer: '', citations: [], toolSteps: [], canvasPatches: [], startedAt: Date.now() }
    const controller = new AbortController()
    const runGeneration = streamGeneration.current + 1
    streamGeneration.current = runGeneration
    streamAbortController.current = controller
    pausePending.current = false
    if (isEmpty) await revealFirstStreamingTurn(firstStreamingTurn, () => !controller.signal.aborted && streamGeneration.current === runGeneration)
    else setStreamingTurn(firstStreamingTurn)
    if (controller.signal.aborted || streamGeneration.current !== runGeneration) return null

    try {
      await streamAgentTurn(
        { ...request, idempotencyKey },
        (event: AgentEvent) => {
          if (['turn_completed', 'turn_interrupted', 'turn_failed', 'research_waiting'].includes(event.type)) notifyAccountUsageChanged()
          if (streamGeneration.current !== runGeneration) return
          if (event.type === 'turn_started') {
            activeRunId.current = event.run_id
            pendingConversationId.current = event.conversation_id
            const startedAttempt = {
              ...attempt,
              conversationId: event.conversation_id,
              runId: event.run_id,
            }
            startedAttempt.request = { ...request, conversation_id: event.conversation_id }
            activeTurnAttempt.current = startedAttempt
            const nextScope = conversationStorageScope(userId, event.conversation_id, taskId, embedded && (boundReferenceKnowledgeBaseId || writingDocumentId) ? storageWorkspace : workspace)
            if (storageScope.current !== nextScope) {
              persistPendingTurnAttempt(storageScope.current, null)
              persistInterruptedTurn(storageScope.current, null)
              persistDraft(storageScope.current, '')
              storageScope.current = nextScope
              if (writingShortcut) persistDraft(nextScope, draft)
            }
            setStreamingTurn((current) => current ? { ...current, runId: event.run_id } : current)
            persistPendingTurnAttempt(storageScope.current, startedAttempt)
            setConversations((current) => current.some((item) => item.conversation_id === event.conversation_id) ? current : [{
              conversation_id: event.conversation_id, task_id: taskId,
              title: question.slice(0, 100), updated_at: new Date().toISOString(), turn_count: 0,
            }, ...current])
            if (!embedded) setSearchParams((current) => {
              const next = new URLSearchParams(current)
              next.set('conversation_id', event.conversation_id)
              return next
            }, { replace: true })
            else onConversationStarted?.({ conversation_id: event.conversation_id, task_id: taskId })
            if (event.runtime_mode) {
              setRuntimeMode(event.runtime_mode)
              rememberRuntimeMode(event.conversation_id, event.runtime_mode)
            }
            if (event.replayed) {
              pendingToolSteps.current = []
              setStreamingTurn((current) => current ? {
                ...current,
                answer: '',
                citations: [],
                toolSteps: [],
                canvasPatches: [],
              } : current)
            }
            if (!pausePending.current) setStatus('thinking')
          } else if (event.type === 'agent_status') {
            if (!pausePending.current) setStatus(event.status === 'answering' ? 'answering' : 'thinking')
          } else if (event.type === 'research_ask') {
            deepResearchLifecycleStarted.current = true
            setDeepResearchMockQuestion(event.question)
            setDeepResearchMockOptions(event.options)
            setDeepResearchMockStep(0)
            setDeepResearchMockStage('clarifying')
          } else if (event.type === 'research_plan') {
            deepResearchLifecycleStarted.current = true
            setDeepResearchMockQuestion(event.title)
            setDeepResearchMockOptions(event.steps)
            setDeepResearchMockStep(0)
            setDeepResearchMockStage('planning')
          } else if (event.type === 'research_step') {
            deepResearchLifecycleStarted.current = true
            setDeepResearchMockStage('researching')
            setDeepResearchMockStep(Math.min(Math.max(0, DEEP_RESEARCH_MOCK_STEPS.indexOf(event.step)), DEEP_RESEARCH_MOCK_STEPS.length - 1))
          } else if (event.type === 'research_result') {
            deepResearchLifecycleStarted.current = true
            setDeepResearchResult({ summary: event.summary, knowledgeCount: event.knowledge_count, webCount: event.web_count })
            settleDeepResearchElapsed()
            setDeepResearchMockStage('completed')
          } else if (event.type === 'tool_started' || event.type === 'tool_finished' || event.type === 'tool_failed') {
            if (event.type === 'tool_finished' && event.tool === 'propose_writing_edit') onWritingRevisionCreated?.()
            const next = updateToolSteps(pendingToolSteps.current, event)
            pendingToolSteps.current = next
            if (turnMode === 'deep-research' && event.type === 'tool_started') {
              if (deepResearchStartedAt.current === null) deepResearchStartedAt.current = Date.now()
              setDeepResearchMockStage('researching')
              setDeepResearchMockStep(researchStepForTools(next))
            }
            if (!pausePending.current) setStatus(event.type === 'tool_started' ? 'retrieving' : 'thinking')
            // 工具开始前的文字是阶段说明；之后的最终回答仍保留原段落。
            setStreamingTurn((current) => current ? {
              ...current,
              toolSteps: next,
              progressEnd: event.type === 'tool_started' ? current.answer.length : current.progressEnd,
            } : current)
          } else if (event.type === 'assistant_delta') {
            if (!pausePending.current) setStatus('answering')
            if (!redactedStreamingMaterialIds.current.size) {
              setStreamingTurn((current) => current ? { ...current, answer: current.answer + event.delta } : current)
            }
          } else if (event.type === 'citation_added') {
            const materialId = materialCitationFields(event.citation).materialId
            const citation = materialId && locallyDeletedMaterialIds.current.has(materialId)
              ? tombstoneMaterialCitation(event.citation, materialId)
              : event.citation
            if (materialId && citation.deleted) redactedStreamingMaterialIds.current.add(materialId)
            setStreamingTurn((current) => current ? {
              ...current,
              answer: citation.deleted ? DELETED_MATERIAL_ANSWER : current.answer,
              citations: [...current.citations, citation],
            } : current)
          } else if (event.type === 'research_waiting') {
            deepResearchLifecycleStarted.current = true
            activeRunId.current = event.run_id
            const waitingAttempt = { ...(activeTurnAttempt.current ?? attempt), runId: event.run_id }
            activeTurnAttempt.current = waitingAttempt
            persistPendingTurnAttempt(storageScope.current, waitingAttempt)
            setDeepResearchMockQuestion(event.question ?? event.title ?? question)
            setDeepResearchMockOptions(event.options ?? event.steps ?? [])
            setDeepResearchMockStep(0)
            setDeepResearchMockStage(event.state === 'awaiting_clarification' ? 'clarifying' : 'planning')
            // Keep the question card in the transcript while waiting for the
            // user's answer; it is part of the conversation history.
            setStatus('idle')
          } else if (event.type === 'canvas_patch') {
            setStreamingTurn((current) => current ? { ...current, canvasPatches: [...current.canvasPatches, event.patch] } : current)
          } else if (event.type === 'turn_completed') {
            pausePending.current = false
            if (turnMode === 'deep-research' && deepResearchLifecycleStarted.current) {
              settleDeepResearchElapsed()
              setDeepResearchMockStage('completed')
            }
            else if (turnMode === 'deep-research') resetDeepResearchMock()
            activeRunId.current = null
            failedTurnAttempt.current = null
            activeTurnAttempt.current = null
            persistPendingTurnAttempt(storageScope.current, null)
            persistInterruptedTurn(storageScope.current, null)
            persistDraft(storageScope.current, writingShortcut ? draft : '')
            const localToolSteps = pendingToolSteps.current
            const completedConversation = [...locallyDeletedMaterialIds.current].reduce(
              (conversation, materialId) => tombstoneConversationMaterial(conversation, materialId),
              attachLocalToolSteps(event.conversation, localToolSteps),
            )
            resultConversation = completedConversation
            const completedTurn = completedConversation.turns.at(-1)
            if (completedTurn) visualTurnKeys.current.set(completedTurn.turn_id, `live-${streamVisualKey.current}`)
            const releaseId = event.knowledge_release_id.trim()
            if (releaseId) rememberKnowledgeRelease(completedConversation.conversation_id, releaseId)
            if (completedTurn && localToolSteps.length) {
              setToolStepsByTurnId((current) => ({ ...current, [completedTurn.turn_id]: localToolSteps }))
            }
            pendingToolSteps.current = []
            redactedStreamingMaterialIds.current.clear()
            setActiveConversation(completedConversation)
            onConversationChange?.(completedConversation)
            loadedConversationId.current = completedConversation.conversation_id
            pendingConversationId.current = completedConversation.conversation_id
            setConversations((current) => [
              {
                task_id: completedConversation.task_id ?? null,
                conversation_id: completedConversation.conversation_id,
                title: completedConversation.title,
                updated_at: completedConversation.updated_at,
                turn_count: completedConversation.turn_count,
              },
              ...current.filter((item) => item.conversation_id !== completedConversation.conversation_id),
            ])
            setStreamingTurn(null)
            setAttachedMaterials([])
            setStatus('idle')
            if (!embedded) {
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.set('conversation_id', completedConversation.conversation_id)
                if (releaseId) next.set('knowledge_release_id', releaseId)
                else next.delete('knowledge_release_id')
                return next
              }, { replace: true })
            }
            void queryClient.invalidateQueries({ queryKey: conversationContextSummaryKey(userId), exact: true, refetchType: 'none' })
            onTurnCompleted?.()
          } else if (event.type === 'turn_interrupted') {
            pausePending.current = false
            activeRunId.current = null
            settleInterruptedTurn()
          } else if (event.type === 'knowledge_index_choice_required') {
            activeRunId.current = null
            pausePending.current = false
            const pending = { ...(activeTurnAttempt.current ?? attempt) }
            failedTurnAttempt.current = pending
            activeTurnAttempt.current = null
            persistPendingTurnAttempt(storageScope.current, pending)
            updateDraft(question)
            setStreamingTurn((current) => {
              if (!current) return current
              const saved = { ...current, interrupted: true }
              persistInterruptedTurn(storageScope.current, saved)
              return saved
            })
            setStatus('idle')
            setError(null)
            knowledgeIndex.present(event.status, { ...request, conversation_id: pending.conversationId }, storageScope.current, idempotencyKey)
          } else if (event.type === 'turn_failed') {
            pausePending.current = false
            activeRunId.current = null
            const failedAttempt = { ...(activeTurnAttempt.current ?? attempt) }
            failedTurnAttempt.current = failedAttempt
            activeTurnAttempt.current = null
            persistPendingTurnAttempt(storageScope.current, failedAttempt)
            if (!writingShortcut) updateDraft(question)
            const failureMessage = localizedTurnFailure(event.code, event.message, locale)
            setStreamingTurn((current) => {
              if (!current) return current
              const failedTurn = { ...current, interrupted: true, failure: failureMessage }
              persistInterruptedTurn(storageScope.current, failedTurn)
              return failedTurn
            })
            setError(failureMessage)
            setStatus('error')
          }
        },
        controller.signal,
      )
    } catch (cause: unknown) {
      if (!controller.signal.aborted && streamGeneration.current === runGeneration) {
        const causeMessage = cause instanceof Error ? cause.message : ''
        const message = locale === 'en-US'
          ? (causeMessage.includes('完成前中断')
              ? 'The connection ended before the answer completed. Retry this turn; no answer has been fabricated.'
              : 'The Agent is unavailable. Check the model service and retry; no answer has been fabricated.')
          : causeMessage.includes('完成前中断')
            ? '连接在回答完成前中断。请重试，这一轮不会伪造回答。'
            : causeMessage && causeMessage !== 'Agent 暂时无法连接'
              ? causeMessage
              : 'Agent 暂时无法连接。请检查模型服务后重试，这一轮不会伪造回答。'
        const failedAttempt = { ...(activeTurnAttempt.current ?? attempt) }
        failedTurnAttempt.current = failedAttempt
        activeTurnAttempt.current = null
        persistPendingTurnAttempt(storageScope.current, failedAttempt)
        if (!writingShortcut) updateDraft(question)
        setStreamingTurn((current) => {
          if (!current) return current
          const failed = { ...current, failure: message }
          persistInterruptedTurn(storageScope.current, { ...failed, interrupted: true })
          return failed
        })
        setError(message)
        setStatus('error')
      }
    } finally {
      if (streamAbortController.current === controller) streamAbortController.current = null
    }
    return controller.signal.aborted || streamGeneration.current !== runGeneration ? null : resultConversation
  }

  useEffect(() => {
    if (deepResearchMockStage !== 'researching' || deepResearchStartedAt.current === null) return undefined
    const updateElapsed = () => setDeepResearchElapsedSeconds(Math.max(0, Math.floor((Date.now() - (deepResearchStartedAt.current ?? Date.now())) / 1000)))
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [deepResearchMockStage])

  function submitDraft() {
    if (homeSubmission && modelSelection.status !== 'ready') return
    const normalized = draft.trim()
    const attempt = failedTurnAttempt.current
    void submitQuestion(normalized, attempt?.question === normalized ? attempt.idempotencyKey : undefined)
  }

  const sendHomeSubmission = useEffectEvent(() => {
    if (!homeSubmission) return
    const intent = takeHomeSubmission(homeSubmission.id, userId)
    if (!intent) return
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    if (!isModelSelectionValid(intent.selection, modelSelection.catalog)) {
      updateDraft(intent.question)
      setError(text('所选模型暂时不可用。问题已保留，请选择模型后重试。', 'The selected model is unavailable. Your question is saved; choose a model and retry.'))
      return
    }
    modelSelection.onChange(intent.selection)
    void submitQuestion(intent.question, intent.id, undefined, false, intent.selection)
  })
  useEffect(() => {
    if (!writingAction || writingActionStarted.current === writingAction.id || isBusy) return
    if (initialWritingMessage && !requestedConversationId && writingIntentStarted.current !== initialWritingMessage.id) return
    if (modelSelection.status === 'loading' || modelSelection.owner !== userId) return
    writingActionStarted.current = writingAction.id
    if (modelSelection.status !== 'ready') {
      setError('模型设置暂不可用，优化尚未开始。请检查后重试。')
      writingCallbacks.current.onWritingActionFinished?.(writingAction.id)
      return
    }
    setComposerMode('standard')
    void submitQuestion(writingAction.text, writingAction.id, undefined, false, undefined, true)
      .catch(cause => setError(cause instanceof Error ? cause.message : '优化未完成，请检查后重试。'))
      .finally(() => writingCallbacks.current.onWritingActionFinished?.(writingAction.id))
  }, [writingAction, isBusy, modelSelection.status, modelSelection.owner, userId, initialWritingMessage, requestedConversationId])

  useEffect(() => {
    if (!initialWritingMessage || requestedConversationId || modelSelection.owner !== userId || modelSelection.status !== 'ready' || isBusy || writingIntentStarted.current === initialWritingMessage.id) return
    writingIntentStarted.current = initialWritingMessage.id
    void submitQuestion(initialWritingMessage.text, initialWritingMessage.id)
  }, [initialWritingMessage, requestedConversationId, userId, modelSelection.owner, modelSelection.status, isBusy])

  useEffect(() => {
    if (!homeSubmission || modelSelection.owner !== userId || modelSelection.status !== 'ready' || isBusy) return
    // One task lets StrictMode finish setup/cleanup before the real request.
    // Atomically claim the in-memory capability immediately before submitting.
    const timer = window.setTimeout(sendHomeSubmission, 0)
    return () => window.clearTimeout(timer)
  }, [homeSubmission, userId, modelSelection.owner, modelSelection.status, isBusy])

  // 计时器一秒一跳，收尾时按真实起止时间再算一次，卡片上不会出现少一秒的用时。
  function settleDeepResearchElapsed() {
    const startedAt = deepResearchStartedAt.current
    if (startedAt === null) return
    setDeepResearchElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)))
  }

  async function exportResearchReport(kind: 'docx' | 'pdf') {
    const conversation = activeConversation
    if (!conversation || reportExportState !== 'idle') return
    setReportExportState(kind)
    try {
      const report = buildResearchReport({
        conversation,
        elapsedSeconds: deepResearchElapsedSeconds,
        fallbackTitle: deepResearchMockQuestion,
      })
      if (kind === 'pdf') {
        openResearchReportPrintWindow(report)
        return
      }
      const blob = await createResearchReportDocx(report)
      const url = URL.createObjectURL(blob)
      const anchor = globalThis.document.createElement('a')
      anchor.href = url
      anchor.download = researchReportDocxFilename(report)
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '导出研究报告失败，请重试。')
    } finally {
      setReportExportState('idle')
    }
  }

  function resetDeepResearchMock() {
    setDeepResearchMockStage('idle')
    setDeepResearchMockQuestion('')
    setDeepResearchMockOptions([])
    setDeepResearchMockStep(0)
    setDeepResearchResult({})
    setDeepResearchElapsedSeconds(0)
    deepResearchStartedAt.current = null
    deepResearchLifecycleStarted.current = false
  }

  function continueDeepResearch(action: 'clarify' | 'confirm' | 'skip', selection?: string) {
    const attempt = activeTurnAttempt.current
    if (!attempt?.runId) return
    if (action === 'confirm') {
      deepResearchLifecycleStarted.current = true
      deepResearchStartedAt.current = Date.now()
      setDeepResearchElapsedSeconds(0)
      setDeepResearchMockStage('researching')
      setDeepResearchMockStep(0)
    }
    void submitQuestion(attempt.question, attempt.idempotencyKey, { action, selection })
  }

  function retryFailedTurn(question: string) {
    const attempt = failedTurnAttempt.current
    void submitQuestion(question, attempt?.question === question ? attempt.idempotencyKey : undefined)
  }

  function settleInterruptedTurn({ resumable = true }: { resumable?: boolean } = {}) {
    const attempt = activeTurnAttempt.current
    if (attempt && resumable) {
      failedTurnAttempt.current = attempt
      activeTurnAttempt.current = null
      persistPendingTurnAttempt(storageScope.current, attempt)
      if (quickWritingAttempt.current !== attempt.idempotencyKey) updateDraft(attempt.question)
    } else if (attempt) {
      failedTurnAttempt.current = null
      activeTurnAttempt.current = null
      persistPendingTurnAttempt(storageScope.current, null)
      if (quickWritingAttempt.current !== attempt.idempotencyKey) updateDraft(attempt.question)
    }
    const next = interruptedSteps(pendingToolSteps.current, locale)
    pendingToolSteps.current = next
    setStreamingTurn((current) => {
      if (!current) return current
      const interruptedTurn = { ...current, interrupted: true, toolSteps: next, failure: undefined }
      persistInterruptedTurn(storageScope.current, interruptedTurn)
      return interruptedTurn
    })
    setStatus('idle')
  }

  async function stopGeneration() {
    const runId = activeRunId.current ?? activeTurnAttempt.current?.runId ?? failedTurnAttempt.current?.runId
    if (status === 'pausing') return
    pausePending.current = true
    setStatus('pausing')
    setError(null)
    const generation = streamGeneration.current
    if (runId) {
      try {
        const result = await stopAgentRun(runId)
        if (generation !== streamGeneration.current) return
        if (result.status === 'completed') {
          activeRunId.current = null
          if (pendingConversationId.current) {
            streamAbortController.current?.abort()
            streamAbortController.current = null
            activeTurnAttempt.current = null
            loadedConversationId.current = null
            await loadConversation(pendingConversationId.current)
          }
          return
        }
      } catch (cause) {
        if (generation !== streamGeneration.current) return
        setError(cause instanceof Error ? cause.message : text('暂停未被服务端确认，请重试暂停。', 'The server has not confirmed the pause. Try again.'))
        pausePending.current = false
        setStatus('pause-failed')
        return
      }
    }
    activeRunId.current = null
    streamGeneration.current += 1
    streamAbortController.current?.abort()
    streamAbortController.current = null
    pausePending.current = false
    resetDeepResearchMock()
    settleInterruptedTurn()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitDraft()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submitDraft()
    }
  }

  function choosePrompt(question: string) {
    updateDraft(question)
    globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
  }

  const allToolSteps = useMemo(() => {
    const values = [
      ...turns.flatMap((turn) => toolStepsByTurnId[turn.turn_id] ?? persistedToolSteps(turn.tool_traces)),
      ...(streamingTurn?.toolSteps ?? []),
    ]
    return [...new Map(values.map((step) => [step.id, step])).values()]
  }, [streamingTurn?.toolSteps, toolStepsByTurnId, turns])
  const activities = useMemo(() => allToolSteps.map((step) => toActivity(step, locale)), [allToolSteps, locale])
  const citationContexts = useMemo(() => {
    const conversationReleaseId = activeConversation?.conversation_id
      ? knowledgeReleaseByConversationId[activeConversation.conversation_id] ?? null
      : null
    const values: SelectedCitationContext[] = turns.flatMap((turn) => turn.assistant.citations.map((citation) => ({
      citation,
      knowledgeReleaseId: turn.knowledge_release_id?.trim() || (embedded ? conversationReleaseId : null),
    })))
    values.push(...(streamingTurn?.citations ?? []).map((citation) => ({ citation, knowledgeReleaseId: null })))
    return [...new Map(values.map((context) => [context.citation.citation_id, context])).values()]
  }, [activeConversation?.conversation_id, embedded, knowledgeReleaseByConversationId, streamingTurn?.citations, turns])
  const citations = useMemo(() => citationContexts.map((context) => context.citation), [citationContexts])

  // 深入研究是这段对话的既成事实，重开时要连卡片带输入器模式一起回来；只认最后一轮，
  // 后面接了普通提问就不该再把研究完成卡片挂在末尾。
  useEffect(() => {
    if (streamingTurn) return
    const record = deepResearchRecord(turns.at(-1))
    if (!record) return
    deepResearchLifecycleStarted.current = true
    // 恢复历史报告只改变展示，研究画布仍使用共同的协作模式。
    if (workspace !== 'research' && !researchEntryAbortController.current) setComposerMode('deep-research')
    setDeepResearchMockStage('completed')
    setDeepResearchMockStep(DEEP_RESEARCH_MOCK_STEPS.length)
    setDeepResearchElapsedSeconds(record.elapsedSeconds)
    setDeepResearchResult((current) => ({
      ...current,
      knowledgeCount: record.knowledgeCount,
      webCount: record.webCount,
    }))
  }, [streamingTurn, turns, workspace])

  // 这一轮结束后 streamingTurn 已清空，卡片上"查看工具调用"要改从落库的这一轮里取。
  const lastTurnToolSteps = useMemo(() => {
    const lastTurn = turns.at(-1)
    if (!lastTurn) return []
    return toolStepsByTurnId[lastTurn.turn_id] ?? persistedToolSteps(lastTurn.tool_traces)
  }, [toolStepsByTurnId, turns])

  // 结论优先取深度研究事件带回的正文；普通轮次没有这个事件，就退回最后一轮回答。
  const deepResearchConclusion = useMemo(() => {
    const summary = deepResearchResult.summary ?? turns.at(-1)?.assistant.content ?? ''
    return summary ? conclusionDigest(summary) : ''
  }, [deepResearchResult.summary, turns])

  // research_result 只在确认计划的深度研究里发出，条数缺席时按整段对话的引用现算。
  const reportReferenceCounts = useMemo(() => {
    const references = collectReferences(citations)
    return {
      knowledge: references.filter((reference) => reference.group === 'knowledge').length,
      web: references.filter((reference) => reference.group === 'web').length,
    }
  }, [citations])
  const citationsForRail = useMemo(() => citations.map((citation) => citationToRail(citation, locale)), [citations, locale])
  const selectedCitation = selectedCitationContext?.citation ?? null
  const selectedCitationReleaseId = selectedCitationContext?.knowledgeReleaseId ?? null
  const selectedMaterialCitation = materialCitationFields(selectedCitation)
  const selectedActivity = allToolSteps.find((activity) => activity.id === selectedActivityId)
  // 这轮一旦产生来源或工具活动，右侧研究面板自己展开；独立 Agent 页才这样，
  // 研究工作区里内嵌的窄栏仍然只按用户点击开合。
  useEffect(() => {
    if (embedded || researchPanelDismissed.current) return
    if (!citationsForRail.length && !activities.length) return
    setContextOpen(true)
  }, [activities.length, citationsForRail.length, embedded])

  useEffect(() => {
    if (contextOpen || railMounted) return
    // Restore only after the native mobile sheet has closed; a rapid reopen cancels exit.
    if (sourceTriggerRef.current?.isConnected) sourceTriggerRef.current.focus({ preventScroll: true })
    sourceTriggerRef.current = null
  }, [contextOpen, railMounted])

  function toggleResearchPanel() {
    if (contextOpen) {
      researchPanelDismissed.current = true
      setContextOpen(false)
      return
    }
    researchPanelDismissed.current = false
    setContextTab('sources')
    setContextOpen(true)
  }

  function closeResearchPanel() {
    researchPanelDismissed.current = true
    setContextOpen(false)
  }

  function backToResearchPanel() {
    setSelectedActivityId(null)
    setContextTab('sources')
  }

  function openCitation(citation: AgentCitation, knowledgeReleaseId: string | null) {
    if (citation.knowledge_base_id && citation.material_id && !citation.deleted && onOpenCourseCitation) { onOpenCourseCitation(citation); return }
    const conversationReleaseId = activeConversation?.conversation_id
      ? knowledgeReleaseByConversationId[activeConversation.conversation_id] ?? null
      : null
    sourceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedActivityId(null)
    setSelectedCitationContext({ citation, knowledgeReleaseId: knowledgeReleaseId?.trim() || (embedded ? conversationReleaseId : null) })
    setContextTab('basis')
    setContextOpen(true)
  }

  function handleMaterialDeleted(materialId: string) {
    locallyDeletedMaterialIds.current.add(materialId)
    if (streamingTurn?.citations.some((citation) => materialCitationFields(citation).materialId === materialId)) {
      redactedStreamingMaterialIds.current.add(materialId)
    }
    setActiveConversation((current) => current ? tombstoneConversationMaterial(current, materialId) : current)
    setStreamingTurn((current) => {
      if (!current) return current
      const citations = current.citations.map((citation) => tombstoneMaterialCitation(citation, materialId))
      if (!citations.some((citation, index) => citation !== current.citations[index])) return current
      const next = { ...current, answer: DELETED_MATERIAL_ANSWER, citations }
      if (next.interrupted) persistInterruptedTurn(storageScope.current, next)
      return next
    })
    setSelectedCitationContext((current) => current
      ? { ...current, citation: tombstoneMaterialCitation(current.citation, materialId) }
      : current)
  }

  function knowledgeEntryHref(citation: AgentCitation, releaseId: string | null) {
    if (!citation.knowledge_id || !releaseId) return null
    const conversationId = activeConversation?.conversation_id ?? ''
    const returnParams = new URLSearchParams({ conversation_id: conversationId, knowledge_release_id: releaseId })
    const query = new URLSearchParams({
      knowledge_release_id: releaseId,
      return_to: `${location.pathname}?${returnParams.toString()}`,
    })
    return `/knowledge/${encodeURIComponent(citation.knowledge_id)}?${query.toString()}`
  }

  function knowledgeGraphHref(citation: AgentCitation, releaseId: string | null) {
    if (!citation.knowledge_id || !releaseId) return null
    const query = new URLSearchParams({
      knowledge_release_id: releaseId,
      center: citation.knowledge_id,
      query: citation.label,
    })
    return `/knowledge/graph?${query.toString()}`
  }

  function webSourceHref(citation: AgentCitation) {
    if (citation.source_kind !== 'web' || !citation.source_id) return null
    try {
      const url = new URL(citation.source_id)
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
    } catch {
      return null
    }
  }

  const selectedKnowledgeEntryHref = selectedCitation
    ? knowledgeEntryHref(selectedCitation, selectedCitationReleaseId)
    : null
  const selectedKnowledgeGraphHref = selectedCitation
    ? knowledgeGraphHref(selectedCitation, selectedCitationReleaseId)
    : null
  const selectedWebSourceHref = selectedCitation ? webSourceHref(selectedCitation) : null

  const sourceActions: ConversationAction[] = []
  if (selectedCitation && !selectedCitation.deleted) {
    if (selectedCitation.knowledge_base_id && selectedCitation.material_id) sourceActions.push({ id: 'material', label: '打开资料原文', href: `/library?kb_id=${encodeURIComponent(selectedCitation.knowledge_base_id)}&document_id=${encodeURIComponent(selectedCitation.material_id)}&segment_id=${encodeURIComponent(selectedCitation.segment_id ?? '')}` })
    if (citationGroup(selectedCitation) === 'material' && (typeof selectedCitation.locator?.task_id === 'string' || taskId || uploadTaskId.current) && selectedMaterialCitation.materialId) sourceActions.push({ id: 'location', label: text('打开原文位置', 'Open source location'), onClick: () => {
      setMaterialLocatorTarget({ taskId: typeof selectedCitation.locator?.task_id === 'string' ? selectedCitation.locator.task_id : taskId ?? uploadTaskId.current ?? undefined,
        materialId: selectedMaterialCitation.materialId as string, parseId: selectedMaterialCitation.parseId, segmentId: selectedMaterialCitation.segmentId })
      setContextOpen(false); openMaterials()
    } })
    if (selectedKnowledgeEntryHref) sourceActions.push({ id: 'knowledge', label: text('打开知识条目', 'Open knowledge entry'), href: selectedKnowledgeEntryHref })
    if (selectedKnowledgeGraphHref) sourceActions.push({ id: 'graph', label: text('在知识图谱中查看', 'View in knowledge graph'), href: selectedKnowledgeGraphHref })
    if (selectedWebSourceHref) sourceActions.push({ id: 'web', label: text('打开网页', 'Open web page'), href: selectedWebSourceHref, external: true })
  }

  const conversationActions = (<>
                <section className="cv-conversation-settings" aria-label={text('对话设置', 'Conversation settings')} onClick={event => event.stopPropagation()}>
                  <h3 className="qx-meta">{text('联网搜索', 'Web search')}</h3>
                  <button type="button" className="qx-btn qx-btn--ghost" aria-label={text('联网搜索', 'Web search')} aria-pressed={webSearchEnabled} disabled={isBusy} onClick={() => setWebSearchEnabled(enabled => !enabled)}><GlobeHemisphereWestIcon size={16} /><span>{webSearchEnabled ? text('联网已开启', 'Web on') : text('联网搜索', 'Web search')}</span></button>
                </section>

                {workspace === 'research' && !embedded ? (
                  <button className="qx-btn qx-btn--ghost"
                    type="button"
                    aria-label={text('研究材料', 'Research materials')}
                    aria-pressed={materialsOpen}
                    title={text('研究材料', 'Research materials')}
                    onClick={() => {
                      if (!taskId) {
                        navigate('/research/materials')
                        return
                      }
                      setMaterialLocatorTarget(null)
                      openMaterials()
                    }}
                  >
                    <FileTextIcon size={16} />{text('研究材料', 'Research materials')}
                  </button>
                ) : null}
                <button className="qx-btn qx-btn--ghost" type="button" aria-label={text('研究面板', 'Research panel')} aria-pressed={contextOpen} aria-expanded={contextOpen} title={text('研究面板', 'Research panel')} onClick={toggleResearchPanel}><SidebarSimpleIcon size={16} />{!embedded && text('研究面板', 'Research panel')}{citations.length ? <i>{citations.length}</i> : null}</button>

  </>)

  const modeIntroduction = deepResearchIntroVisible ? <aside className="qx-panel cv-mode-intro" role="dialog" aria-label={text('深入研究介绍', 'Deep research introduction')}>
    <header><h2 className="qx-card__title">{text('深入研究', 'Deep research')}</h2><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('关闭深入研究介绍', 'Close deep research introduction')} onClick={() => setDeepResearchIntroVisible(false)}><XIcon /></button></header>
    <p>{text('检索你的资料与网页，核对来源，整理成有依据的研究结果。', 'Search your materials and the web, check sources, and develop a grounded research result.')}</p>
    <div><button className="qx-btn qx-btn--ghost" type="button" onClick={() => setDeepResearchIntroVisible(false)}>{text('稍后再说', 'Maybe later')}</button><button className="qx-btn qx-btn--primary" type="button" onClick={() => { setComposerMode('deep-research'); setDeepResearchIntroVisible(false) }}>{text('试试看', 'Try it')}</button></div>
  </aside> : null

  const conversationSurface = <ConversationLayout
    embedded={embedded} empty={isLanding} composerOrigin={homeSubmission?.origin} runtimeMode={runtimeMode ?? 'unknown'} research={composerMode === 'deep-research'}
    sourceOpen={railMounted}
    sourceMotionRef={sourceMotionRef}
    sourceClosing={!contextOpen}
    title={activeConversation?.title || text('新对话', 'New conversation')}
    label={writingDocumentId ? text('写作 Agent 对话栏', 'Writing Agent conversation panel') : embedded ? text('研究 Agent 对话栏', 'Research Agent conversation panel') : text('Everplain Agent 对话', 'Everplain conversation')}
    modes={<AgentModeSwitch mode={composerMode} disabled={isBusy} avatar={<PersonalCompanion userId={userId} compact working={isBusy} fallback={<AgentAvatar avatar="shi" size={32} state={isBusy ? 'work' : 'idle'} />} />} onChange={mode => { setComposerMode(mode); setMaterialMenuOpen(false); if (mode === 'deep-research') setDeepResearchIntroVisible(false) }}>{modeIntroduction}</AgentModeSwitch>}
    actions={<ConversationActions key={requestedScope} label={text('更多对话操作', 'More conversation actions')}>{conversationActions}</ConversationActions>}
    history={!embedded && showConversationManagement ? <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon cv-layout__history-button" aria-label={text('打开研究记录', 'Open research history')} onClick={() => setHistoryOpen(true)}><ListIcon /></button> : null}
    companionBar={<CompanionStatusBar userId={userId} status={status} />}
    pet={<PersonalCompanion userId={userId} fallback={<AgentAvatar avatar="shi" size={96} state="greet" />} />}
    prompt={greeting}
    thread={              <div className="cv-thread">
                {[...turns.map((turn) => (
                  <AssistantTurn
                    userId={userId}
                    key={visualTurnKeys.current.get(turn.turn_id) ?? turn.turn_id}
                    turnId={visualTurnKeys.current.get(turn.turn_id) ?? turn.turn_id}
                    question={turn.user.content}
                    answer={turn.assistant.content}
                    citations={turn.assistant.citations}
                  toolSteps={toolStepsByTurnId[turn.turn_id] ?? persistedToolSteps(turn.tool_traces)}
                  conversationId={activeConversation?.conversation_id ?? null}
                  knowledgeReleaseId={turn.knowledge_release_id?.trim() || null}
                  embedded={embedded}
                  showResearchHandoff={!embedded}
                  onContinueResearch={() => { void continueResearch() }}
                  researchEntryBusy={researchEntryBusy || isBusy || materialUploading || attachedMaterials.some((material) => material.status !== 'ready')}
                    onOpenActivity={step => { setSelectedCitationContext(null); setSelectedActivityId(step?.id ?? null); setContextTab(step ? 'basis' : 'activity'); setContextOpen(true) }}
                    onSelectCitation={openCitation}
                    onRegenerate={() => { void submitQuestion(turn.user.content) }}
                  />
                )),
                ...(activeConversation?.unfinished_runs ?? []).filter((run) => run.run_id !== streamingTurn?.runId).map((run) => {
                  const saved = recoveryTurn(run)
                  return <AssistantTurn
                    userId={userId}
                    key={run.run_id}
                    turnId={run.run_id}
                    question={saved.question}
                    answer={saved.answer}
                    citations={saved.citations}
                    toolSteps={saved.toolSteps}
                    conversationId={activeConversation?.conversation_id ?? null}
                    knowledgeReleaseId={null}
                    interrupted={saved.interrupted}
                    failure={saved.failure}
                    embedded={embedded}
                    onOpenActivity={step => { setSelectedCitationContext(null); setSelectedActivityId(step?.id ?? null); setContextTab(step ? 'basis' : 'activity'); setContextOpen(true) }}
                    onSelectCitation={openCitation}
                    onRegenerate={isBusy ? undefined : () => resumeRecovery(run)}
                  />
                }),
                streamingTurn && deepResearchMockStage === 'researching' ? (
                  <DeepResearchMockFlow key="live-research"
                    stage={deepResearchMockStage}
                    question={deepResearchMockQuestion}
                    stepIndex={deepResearchMockStep}
                    options={deepResearchMockOptions}
                    knowledgeCount={deepResearchResult.knowledgeCount}
                    webCount={deepResearchResult.webCount}
                    toolSteps={streamingTurn.toolSteps}
                    elapsedSeconds={deepResearchElapsedSeconds}
                    onChooseIntent={(intent) => continueDeepResearch('clarify', intent)}
                    onSkip={() => continueDeepResearch('skip')}
                    onConfirmPlan={() => continueDeepResearch('confirm')}
                    onEdit={() => {
                      resetDeepResearchMock()
                      globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
                    }}
                  />
                ) : null,
                status === 'pausing' ? <p key="pausing" role="status">正在暂停，等待当前操作结束…</p> : null,
                status === 'pause-failed' ? <button key="pause-failed" className="qx-btn qx-btn--ghost" type="button" onClick={() => { void stopGeneration() }}>重试暂停</button> : null,
                streamingTurn ? (
                  <AssistantTurn key={`live-${streamVisualKey.current}`} turnId={`live-${streamVisualKey.current}`}
                    userId={userId}
                    question={streamingTurn.question}
                    answer={streamingTurn.answer}
                    citations={streamingTurn.citations}
                    toolSteps={streamingTurn.toolSteps}
                    conversationId={activeConversation?.conversation_id ?? pendingConversationId.current}
                    knowledgeReleaseId={null}
                    interrupted={streamingTurn.interrupted}
                    failure={streamingTurn.failure}
                    streaming={canStopGeneration && !streamingTurn.interrupted && !streamingTurn.failure}
                    streamingStatus={status}
                    progressEnd={streamingTurn.progressEnd}
                    embedded={embedded}
                    onOpenActivity={step => { setSelectedCitationContext(null); setSelectedActivityId(step?.id ?? null); setContextTab(step ? 'basis' : 'activity'); setContextOpen(true) }}
                    onSelectCitation={openCitation}
                    onRegenerate={isBusy ? undefined : () => retryFailedTurn(streamingTurn.question)}
                  />
                ) : null]}
                {hasDeepResearchMockConversation && deepResearchMockStage !== 'researching' ? (
                  <DeepResearchMockFlow
                    stage={deepResearchMockStage}
                    question={deepResearchMockQuestion}
                    stepIndex={deepResearchMockStep}
                    options={deepResearchMockOptions}
                    knowledgeCount={deepResearchResult.knowledgeCount ?? reportReferenceCounts.knowledge}
                    webCount={deepResearchResult.webCount ?? reportReferenceCounts.web}
                    toolSteps={streamingTurn?.toolSteps ?? lastTurnToolSteps}
                    elapsedSeconds={deepResearchElapsedSeconds}
                    conclusion={deepResearchConclusion}
                    exportState={reportExportState}
                    onExport={activeConversation ? (kind) => { void exportResearchReport(kind) } : undefined}
                    onContinueResearch={() => { void continueResearch() }}
                    researchEntryBusy={researchEntryBusy || isBusy || materialUploading || attachedMaterials.some((material) => material.status !== 'ready')}
                    onChooseIntent={(intent) => continueDeepResearch('clarify', intent)}
                    onSkip={() => continueDeepResearch('skip')}
                    onConfirmPlan={() => continueDeepResearch('confirm')}
                    onEdit={() => {
                      resetDeepResearchMock()
                      globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
                    }}
                  />
                ) : null}
                {conversationTail}
                <div ref={transcriptEndRef} />
              </div>}
    composer={<>{knowledgeIndex.choice && <KnowledgeReadinessChoice
              locale={locale} totalCount={knowledgeIndex.choice.status.total_count} readyCount={knowledgeIndex.choice.status.ready_count}
              documents={knowledgeReadinessDocuments(knowledgeIndex.choice.status)} busy={knowledgeIndex.busy || isBusy}
              waiting={knowledgeIndex.choice.waiting} error={knowledgeIndex.error}
              onSkip={knowledgeIndex.skip} onRepair={() => void knowledgeIndex.repair()} onRefresh={() => void knowledgeIndex.refresh()} onCancel={knowledgeIndex.cancel}
            />}{error ? (
              <div className="cv-error" role="alert">
                <WarningCircleIcon size={16} /><span>{error}</span>
                <button className="qx-btn qx-btn--ghost" type="button" aria-label={text('关闭错误提示', 'Close error message')} onClick={() => setError(null)}><XIcon size={14} /></button>
              </div>
            ) : null}
            {enableResearchGuidance && composerMode === 'standard' && currentResearchAsk && !isBusy && !guidanceDismissed && (researchAsk || !discussion) ? (
              <DeepResearchMockFlow
                key={`${turns.at(-1)?.turn_id ?? 'entry'}:${currentResearchAsk.question}:${error ?? ''}`}
                collaboration stage="clarifying" question={currentResearchAsk.question}
                options={currentResearchAsk.options} stepIndex={0} knowledgeCount={0} webCount={0}
                onChooseIntent={(answer) => { void submitQuestion(`关于“${currentResearchAsk.question}”：${answer}`) }}
                onSkip={() => setGuidanceDismissed(true)} onConfirmPlan={() => {}} onEdit={() => composerInputRef.current?.focus()}
              />
            ) : null}
            {discussion ? <div className="cv-discussion" role="status"><span>正在讨论：{discussion.title}</span><button className="qx-btn qx-btn--ghost" type="button" disabled={isBusy} onClick={() => { void submitQuestion('请围绕这项内容继续推进。先说明已有依据和待解决的问题，需要我判断时提出一个具体问题。') }}>继续研究</button><button className="qx-btn qx-btn--ghost" type="button" aria-label="结束当前讨论" onClick={onClearDiscussion}><XIcon size={14} /></button></div> : null}
            {composerMode === 'deep-research' && deepResearchMockStage === 'clarifying' && !streamingTurn ? (
              <DeepResearchMockFlow
                stage={deepResearchMockStage}
                question={deepResearchMockQuestion}
                stepIndex={deepResearchMockStep}
                options={deepResearchMockOptions}
                knowledgeCount={deepResearchResult.knowledgeCount}
                webCount={deepResearchResult.webCount}
                toolSteps={streamingTurn?.toolSteps ?? []}
                onChooseIntent={(intent) => continueDeepResearch('clarify', intent)}
                onSkip={() => continueDeepResearch('skip')}
                onConfirmPlan={() => continueDeepResearch('confirm')}
                onEdit={() => {
                  resetDeepResearchMock()
                  globalThis.requestAnimationFrame?.(() => composerInputRef.current?.focus())
                }}
              />
            ) : null}

            <ConversationComposer
              scopeKey={requestedScope}
              mode={composerMode} value={draft} label={composerAriaLabel ?? text('问 Everplain', 'Ask Everplain')}
              placeholder={composerMode === 'deep-research' ? text('描述你想弄清楚的问题', 'Describe what you want to investigate') : text('问一个问题', 'Ask a question')}
              maxLength={MAX_AGENT_MESSAGE_LENGTH} busy={isBusy} canSend={canSubmit} canStop={canStopGeneration}
              uploading={materialUploading} toolsOpen={materialMenuOpen}
              inputRef={composerInputRef} toolsRef={materialMenuRef} toolsButtonRef={materialMenuButtonRef}
              fileRef={materialFileInputRef} accept={RESEARCH_MATERIAL_ACCEPT}
              onChange={updateDraft} onKeyDown={handleKeyDown} onSubmit={handleSubmit}
              onStop={() => { void stopGeneration() }} onToggleTools={() => setMaterialMenuOpen(open => !open)}
              onUpload={files => { void uploadComposerMaterials(files) }}
              onRemoveAttachment={id => setAttachedMaterials(items => items.filter(item => item.materialId !== id))}
              attachments={attachedMaterials.map(material => ({ id: material.materialId, title: material.filename,
                status: material.status === 'ready' ? text('已添加', 'Added') : attachmentStatusLabel(material, locale), removable: !isBusy }))}
              researchLayout={researchToolsVisible}
              modelSelector={<ModelSelectionSettings key={requestedScope} state={modelSelection} disabled={isBusy || materialUploading}
                activeRequest={isBusy ? activeTurnAttempt.current?.request : null} />}
              context={composerPrefix}
              attachmentPicker={materialPickerOpen ? <AgentMaterialAttachmentPicker inline loading={materialPickerLoading}
                materials={materialPickerLoading ? [] : availableMaterials} selectedIds={new Set(attachedMaterials.map(item => item.materialId))}
                locale={locale} onToggle={toggleAttachedMaterial} onClose={() => setMaterialPickerOpen(false)} /> : null}
              tools={<>
                <section className="cv-tool-group" aria-label={text('添加内容', 'Add content')}>
                  <div className="cv-tool-attachments">
                    <button className="qx-btn qx-btn--secondary" type="button" role="menuitem" disabled={isBusy} onClick={() => { setMaterialMenuOpen(false); materialFileInputRef.current?.click() }}><FilePlusIcon size={18} /><span>{text('上传文件', 'Upload a file')}</span></button>
                    <button className="qx-btn qx-btn--secondary" type="button" role="menuitem" disabled={isBusy} onClick={() => { void openMaterialAttachmentPicker() }}><FolderOpenIcon size={18} /><span>{text('从研究材料添加', 'Add from research materials')}</span></button>
                  </div>
                </section>
                  {!embedded ? <CourseReferenceSelector menu value={activeConversation ? activeConversation.reference_knowledge_base_id ?? '' : searchParams.get('reference_knowledge_base_id') ?? ''} hasConversation={Boolean(activeConversation)} disabled={isBusy}
                    onChange={value => { newConversation(); setSearchParams(value ? { reference_knowledge_base_id: value } : {}) }} /> : null}
              </>}
            />
            {researchToolsVisible && <>
              <div className="cv-research-base" role="group" aria-label={text('研究工具栏', 'Research tools')}>
                {!embedded && <ProjectScopeMenu key={requestedScope} projects={projects} taskId={taskId} disabled={isBusy || materialUploading} onChange={switchComposerProject} />}
                <button type="button" className="qx-btn qx-btn--ghost" aria-label={text('查看材料库', 'Open material library')} onClick={openResearchMaterials}><FolderOpenIcon size={16} /><span>{text('材料库', 'Materials')}</span></button>
              </div>
            </>}
            {isLanding && <div className="cv-research-suggestions">{researchToolsVisible ? <ConversationSuggestions
              mode="research" taskId={taskId}
              projects={projects} conversations={conversations} attachedMaterials={attachedMaterials}
              onSelect={choosePrompt} /> : !embedded && !searchParams.get('reference_knowledge_base_id') ? <ConversationContextSuggestions userId={userId} onSelect={choosePrompt} /> : null}</div>}
</>}

    source={<ConversationSourcePanel
      closing={!contextOpen}
      detail={contextTab === 'basis' && selectedCitation && !selectedActivity ? { citation: selectedCitation,
        kindLabel: citationGroup(selectedCitation) === 'knowledge' ? text('知识库资料', 'Library material') : citationKindLabel(selectedCitation.kind, locale),
        locatorLabel: selectedMaterialCitation.locator ? formatMaterialLocator(selectedMaterialCitation.locator) : undefined,
        unavailableReason: selectedCitation.knowledge_id && !selectedCitationReleaseId ? text('当前回合的知识版本尚未确认，暂不提供跳转。', 'The knowledge release for this turn has not been confirmed; navigation is unavailable.') : undefined,
        actions: sourceActions } : null}
      activity={contextTab === 'basis' && selectedActivity ? { ...selectedActivity, label: localizedToolLabel(selectedActivity.tool, locale, selectedActivity.label), detail: selectedActivity.detail ? localizedToolDetail(selectedActivity.detail, locale) : undefined, resultItems: resultItemsFromOutput(selectedActivity.output) } : null}
      citations={citations} toolSteps={allToolSteps.map(step => ({ ...step, label: localizedToolLabel(step.tool, locale, step.label), detail: step.detail ? localizedToolDetail(step.detail, locale) : undefined, resultItems: resultItemsFromOutput(step.output) }))}
      onClose={closeResearchPanel} onBack={backToResearchPanel}
      onSelectActivity={step => { setSelectedCitationContext(null); setSelectedActivityId(step.id); setContextTab('basis') }}
      onSelectCitation={citation => {
        const context = selectedCitationContext?.citation.citation_id === citation.citation_id ? selectedCitationContext : citationContexts.find(item => item.citation.citation_id === citation.citation_id)
        if (!context) return
        setSelectedActivityId(null); setSelectedCitationContext(context); setContextTab('basis')
      }}
    />}
    dialogs={<>          {showConversationManagement && historyOpen ? (
            <ConversationHistory
              projects={projects}
              setProjects={setProjects}
              selectedTaskId={taskId}
              onNewConversation={newConversation}
              onRename={renameSavedConversation}
              onDelete={deleteSavedConversation} onDeleteProject={deleteSavedProject}
              conversations={conversations}
              activeConversationId={activeConversation?.conversation_id ?? null}
              loading={historyLoading}
              onOpen={openConversation}
              onClose={closeHistory}
            />
          ) : null}
          {materialsOpen && (materialLocatorTarget?.taskId ?? taskId) ? (
            <ResearchMaterialsPanel
              taskId={(materialLocatorTarget?.taskId ?? taskId)!}
              initialMaterialId={materialLocatorTarget?.materialId ?? null}
              initialParseId={materialLocatorTarget?.parseId ?? null}
              initialSegmentId={materialLocatorTarget?.segmentId ?? null}
              onMaterialDeleted={handleMaterialDeleted}
              onClose={() => {
                closeMaterials()
                setMaterialLocatorTarget(null)
              }}
            />
          ) : null}</>}
  />

  if (embedded) {
    return (
      <>
        {conversationSurface}
        {showConversationManagement && historyRailTarget ? createPortal(
          <AgentConversationHistoryRail
            projects={projects} setProjects={setProjects} projectListError={projectListError}
            selectedTaskId={taskId}
            activeConversationId={activeConversation?.conversation_id ?? null}
            conversations={conversations}
            loading={historyLoading}
            onDelete={deleteSavedConversation} onDeleteProject={deleteSavedProject}
            onNewConversation={newConversation}
            onOpen={openConversation}
            onRename={renameSavedConversation}
          />,
          historyRailTarget,
        ) : null}
      </>
    )
  }

  return (
    <PageShell
      workspace
      railContent={(
        <AgentConversationHistoryRail
          projects={projects} setProjects={setProjects} projectListError={projectListError}
          selectedTaskId={taskId}
          activeConversationId={activeConversation?.conversation_id ?? null}
          conversations={conversations}
          loading={historyLoading}
          onDelete={deleteSavedConversation} onDeleteProject={deleteSavedProject}
          onNewConversation={newConversation}
          onOpen={openConversation}
          onRename={renameSavedConversation}
        />
      )}
      wide
    >
      <PageContent>{conversationSurface}</PageContent>
    </PageShell>
  )
}
