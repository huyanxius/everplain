import { PageLoading } from '../../ui/PageLoading'
import { Select } from '../ui/Select'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { CheckCircleIcon, CircleNotchIcon, DownloadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import {
  acceptResearchDocumentProposal,
  acknowledgePartialMatch,
  createTheoryDecisions,
  confirmTheoryPlan,
  confirmResearchDocument,
  createMatchRun,
  exportResearchDocument,
  getMatchRun,
  getResearchTaskNavigation,
  listResearchDocuments,
  listResearchDocumentVersions,
  listResearchTaskDocumentProposals,
  listTheoryDecisions,
  restoreResearchDocument,
  rejectResearchDocumentProposal,
  readResearchTaskNavigationViaApi,
  updateResearchDocument,
} from '../../api/researchWorkspace'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { ResearchMapCanvas } from './ResearchMapCanvas'
import { collapseDocumentNodes, projectFormalResearchCanvas, projectResearchCanvas, type ResearchCanvasProjection, type ResearchCanvasStreamingTurn, type ResearchDiscussion } from '../../modules/research-workspace'
import {
  getAnalysisSnapshot,
  getResearchCycleSnapshot,
  type ResearchAnalysisSnapshot,
  type ResearchCycleSnapshot,
} from '../../modules/research-materials'
import type { AgentConversation } from '../../modules/research-agent'
import { PageContent, PageShell } from '../ui/PageShell'
import { M5ResearchDeliveryController } from './M5ResearchDeliveryController'
import {
  buildPrintableDocument,
  createDocumentDiff,
  createDocxExport,
  formatBibliography,
  registerCustomCslStyle,
  type DocumentTemplateId,
  type ExportCitation,
} from '../../modules/research-document'
import './research-document-workbench.css'

const M4_SECTIONS = [
  ['research_question', '研究问题'],
  ['core_phenomenon', '核心现象'],
  ['candidate_theories', '候选理论'],
  ['theory_fit', '理论适配与张力'],
  ['evidence', '证据引用'],
  ['theory_decision', '我的理论选择'],
] as const
const M5_SECTIONS = [
  ['research_question', '研究问题'],
  ['research_object_and_field', '研究对象与场域'],
  ['theoretical_perspective', '理论视角'],
  ['core_concepts', '核心概念'],
  ['mechanisms', '作用机制'],
  ['questions_or_hypotheses', '研究假设与质性问题'],
  ['methodology', '研究方法'],
  ['sample_and_sources', '样本与资料来源'],
  ['analysis_steps', '分析步骤'],
  ['ethics', '伦理风险'],
  ['limitations', '局限'],
  ['evidence_gaps', '证据缺口'],
] as const

const AGENT_PANEL_WIDTH_STORAGE_KEY = 'everplain.research.agent-panel-width'
const DEFAULT_AGENT_PANEL_WIDTH = 430
const MIN_AGENT_PANEL_WIDTH = 320
const MAX_AGENT_PANEL_WIDTH = 680
const MIN_RESEARCH_CANVAS_WIDTH = 360
const AGENT_PANEL_KEYBOARD_STEP = 24

function clampAgentPanelWidth(width: number, maxWidth = MAX_AGENT_PANEL_WIDTH) {
  return Math.round(Math.min(Math.max(width, MIN_AGENT_PANEL_WIDTH), Math.max(MIN_AGENT_PANEL_WIDTH, maxWidth)))
}

function readStoredAgentPanelWidth() {
  if (typeof window === 'undefined') return DEFAULT_AGENT_PANEL_WIDTH
  try {
    const width = Number(window.localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY))
    return Number.isFinite(width) && width > 0 ? clampAgentPanelWidth(width) : DEFAULT_AGENT_PANEL_WIDTH
  } catch {
    return DEFAULT_AGENT_PANEL_WIDTH
  }
}

function persistAgentPanelWidth(width: number) {
  try {
    window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)))
  } catch {
    // Resizing still works for the current session when storage is unavailable.
  }
}

type SectionKey = string
type ResearchDocumentProposalResponse = NonNullable<Awaited<ReturnType<typeof listResearchTaskDocumentProposals>>['data']>['items'][number]
type ResearchDocumentResponse = NonNullable<Awaited<ReturnType<typeof listResearchDocuments>>['data']>['items'][number]
type ResearchTaskNavigationResponse = NonNullable<Awaited<ReturnType<typeof getResearchTaskNavigation>>['data']>
type MatchRunResponse = NonNullable<Awaited<ReturnType<typeof getMatchRun>>['data']>
type ResearchDocumentExportResponse = NonNullable<Awaited<ReturnType<typeof exportResearchDocument>>['data']>
type TheoryDecisionSetResponse = NonNullable<Awaited<ReturnType<typeof listTheoryDecisions>>['data']>['decision_sets'][number]
type TheoryDecisionAction = TheoryDecisionSetResponse['decisions'][number]['action']
type CitationMetadataResolver = (
  sourceId: string,
  sourceVersion: string | null,
) => ({ id: string } & Record<string, unknown>) | null

type FormattingDraft = {
  template_id: string
  csl_style_id: string
  locale: string
  custom_csl?: string | null
  custom_css?: string | null
}

export type ResearchDocumentWorkspaceContext = {
  readonly mode: 'match' | 'framework'
  readonly documentId: string | null
  readonly sectionId: string | null
  readonly documentVersion: number | null
  readonly theoryPlanId: string | null
}

type ResearchDocumentWorkbenchProps = {
  readonly userId?: string | null
  readonly citationMetadataResolver?: CitationMetadataResolver
  readonly embedded?: boolean
  readonly outlineTarget?: HTMLElement | null
  readonly toolbarTarget?: HTMLElement | null
  readonly onNavigationGuardChange?: (guard: (() => Promise<boolean>) | null) => void
  readonly workspaceMode?: 'match' | 'framework'
  readonly focusDocument?: boolean
  readonly initialDocumentId?: string | null
  readonly initialSectionId?: string | null
  readonly conversation?: AgentConversation | null
  readonly refreshKey?: number
  readonly streamingTurn?: ResearchCanvasStreamingTurn | null
  readonly onDiscuss?: (discussion: ResearchDiscussion) => void
  readonly onOpenCitation?: (id: string) => void
  readonly onWorkspaceContextChange?: (context: ResearchDocumentWorkspaceContext) => void
}

function key() {
  return globalThis.crypto?.randomUUID?.() ?? `m4-m5-${Date.now()}`
}

function sectionFallback(stage: 'match' | 'framework') {
  const items = stage === 'match' ? M4_SECTIONS : M5_SECTIONS
  return items.map(([sectionId, title]) => ({
    section_id: sectionId,
    key: sectionId,
    title,
    content: '',
    status: 'needs_user_decision' as const,
    evidence_refs: [],
    citation_refs: [],
  }))
}

function selectCurrentDocument(
  items: ResearchDocumentResponse[],
  navigation: ResearchTaskNavigationResponse,
  mode: 'match' | 'framework',
  preferredDocumentId?: string | null,
) {
  const preferred = preferredDocumentId ? items.find((item) => item.document_id === preferredDocumentId) : undefined
  const currentId = mode === 'framework' ? navigation.current_framework_id : navigation.current_theory_plan_id
  return preferred
    ?? (currentId ? items.find((item) => mode === 'framework' ? item.document_id === currentId : item.theory_plan_id === currentId) : undefined)
    ?? items[0]
    ?? null
}

export function ResearchDocumentWorkbench({
  userId = null,
  citationMetadataResolver = () => null,
  embedded = false,
  outlineTarget = null,
  toolbarTarget = null,
  onNavigationGuardChange,
  workspaceMode,
  focusDocument = false,
  initialDocumentId = null,
  initialSectionId = null,
  conversation = null,
  refreshKey = 0,
  streamingTurn = null,
  onDiscuss,
  onOpenCitation,
  onWorkspaceContextChange,
}: ResearchDocumentWorkbenchProps) {
  const { task_id: taskId, stage: stageParam } = useParams<{ task_id: string; stage?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const stage = workspaceMode ?? stageParam ?? (location.pathname.endsWith('/framework') ? 'framework' : 'match')
  const mode = stage === 'framework' ? 'framework' : 'match'
  const [navigation, setNavigation] = useState<ResearchTaskNavigationResponse | null>(null)
  const [document, setDocument] = useState<ResearchDocumentResponse | null>(null)
  const [proposals, setProposals] = useState<ResearchDocumentProposalResponse[]>([])
  const [versions, setVersions] = useState<ResearchDocumentResponse[]>([])
  const [rebasedProposalIds, setRebasedProposalIds] = useState<Set<string>>(() => new Set())
  const [formattingDraft, setFormattingDraft] = useState<FormattingDraft>({
    template_id: 'chinese-social-science',
    csl_style_id: 'china-national-standard-gb-t-7714-2015-author-date',
    locale: 'zh-CN',
    custom_csl: null,
    custom_css: null,
  })
  const [exportState, setExportState] = useState<'idle' | 'working'>('idle')
  const [activeSectionId, setActiveSectionId] = useState<SectionKey>(mode === 'match' ? M4_SECTIONS[0][0] : M5_SECTIONS[0][0])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [matchRun, setMatchRun] = useState<MatchRunResponse | null>(null)
  const [matchingActionState, setMatchingActionState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [matchingActionError, setMatchingActionError] = useState<string | null>(null)
  const [pendingTheoryDecisions, setPendingTheoryDecisions] = useState<Record<string, { candidate_version: number; action: TheoryDecisionAction }>>({})
  const [decisionSet, setDecisionSet] = useState<TheoryDecisionSetResponse | null>(null)
  const [analysisSnapshot, setAnalysisSnapshot] = useState<ResearchAnalysisSnapshot | null>(null)
  const [researchCycle, setResearchCycle] = useState<ResearchCycleSnapshot | null>(null)
  const [relationDraft, setRelationDraft] = useState({ explanation: '', premise: '', supporting: '', excluding: '', distinguishing: '' })
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  const [agentConversation, setAgentConversation] = useState<AgentConversation | null>(null)
  const [discussion, setDiscussion] = useState<ResearchDiscussion | null>(null)
  const [citationRequest, setCitationRequest] = useState<{ id: string; key: number } | null>(null)
  const [wholeDocument, setWholeDocument] = useState(!focusDocument)
  const [selectedPassage, setSelectedPassage] = useState<ResearchDiscussion | null>(null)
  const discuss = (value: ResearchDiscussion) => { setDiscussion(value); onDiscuss?.(value) }

  const sectionNodePrefix = `research-section:${taskId ?? 'unknown'}:${mode}:`
  const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null)
  const previousFocusDocument = useRef(focusDocument)
  const matchingAttemptKeyRef = useRef<string | null>(null)
  const matchingInFlightRef = useRef(false)
  const saveInFlightRef = useRef<Promise<ResearchDocumentResponse | null> | null>(null)
  const saveBaseRef = useRef<ResearchDocumentResponse | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const activeResizePointer = useRef<number | null>(null)
  const mouseResizeCleanup = useRef<(() => void) | null>(null)
  const [agentPanelWidth, setAgentPanelWidth] = useState(readStoredAgentPanelWidth)
  const agentPanelWidthRef = useRef(agentPanelWidth)
  const [agentPanelMaxWidth, setAgentPanelMaxWidth] = useState(MAX_AGENT_PANEL_WIDTH)
  const [resizingAgentPanel, setResizingAgentPanel] = useState(false)

  const sections = useMemo(() => document?.sections.length ? document.sections : sectionFallback(mode), [document?.sections, mode])
  const activeSection = sections.find((section) => section.section_id === activeSectionId) ?? sections[0]
  const activeContent = activeSection?.content ?? ''
  const selectedTheoryIds = Object.entries(pendingTheoryDecisions).filter(([, value]) => value.action === 'adopt' || value.action === 'combine').map(([candidateId]) => candidateId)
  const multiTheoryRelationReady = selectedTheoryIds.length < 2 || Object.values(relationDraft).every((value) => value.trim())
  const [editedConversation, setEditedConversation] = useState<AgentConversation | null>(null)
  const baseMapConversation = embedded ? conversation : agentConversation
  const mapConversation = editedConversation?.conversation_id === baseMapConversation?.conversation_id
    && (editedConversation?.canvas_edit_version ?? 0) > (baseMapConversation?.canvas_edit_version ?? 0)
    ? editedConversation : baseMapConversation
  const manuscriptNodeId = `${sectionNodePrefix}document`
  const mapProjection = useMemo<ResearchCanvasProjection>(() => collapseDocumentNodes(projectFormalResearchCanvas({
    taskId: taskId ?? null,
    mode,
    agentProjection: projectResearchCanvas({ conversation: mapConversation, streamingTurn }),
    navigation,
    matchRun,
    pendingTheoryDecisions,
    sections,
    documentTitle: document?.title,
    analysisSnapshot: mode === 'match' ? analysisSnapshot : null,
    researchCycle,
  }), manuscriptNodeId, document?.title ?? '研究方案文稿'), [analysisSnapshot, document?.title, mapConversation, matchRun, mode, navigation, pendingTheoryDecisions, researchCycle, sections, taskId, manuscriptNodeId, streamingTurn])
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: activeContent || '在这里写下你的研究判断。每次用户编辑都会形成可恢复的文档版本。',
    contentType: 'markdown',
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-labelledby': 'research-document-heading' } },
    onUpdate: () => setSaveState('unsaved'),
  })

  useEffect(() => {
    if (!editor || !activeSection) return
    editor.commands.setContent(activeSection.content || '在这里写下你的研究判断。每次用户编辑都会形成可恢复的文档版本。', { contentType: 'markdown' })
    setSaveState('saved')
  }, [activeSectionId, document?.revision_id, editor])

  useEffect(() => {
    if (document?.formatting) setFormattingDraft(document.formatting)
  }, [document?.revision_id, document?.formatting])

  useEffect(() => {
    const requestedSection = initialSectionId && sections.some((section) => section.section_id === initialSectionId)
      ? initialSectionId
      : sections[0]?.section_id
    if (!requestedSection) return
    setActiveSectionId(requestedSection)
    if (focusDocument) setSelectedMapNodeId(`${sectionNodePrefix}document`)
  }, [focusDocument, initialSectionId, sectionNodePrefix, sections])

  useEffect(() => {
    if (previousFocusDocument.current && !focusDocument && !initialSectionId) {
      setSelectedMapNodeId(current => current?.startsWith(sectionNodePrefix) ? null : current)
    }
    previousFocusDocument.current = focusDocument
  }, [focusDocument, initialSectionId, sectionNodePrefix])

  useEffect(() => {
    if (loadState !== 'ready') return
    onWorkspaceContextChange?.({
      mode,
      documentId: document?.document_id ?? null,
      sectionId: activeSection?.section_id ?? null,
      documentVersion: document?.version ?? null,
      theoryPlanId: navigation?.current_theory_plan_id ?? document?.theory_plan_id ?? null,
    })
  }, [activeSection?.section_id, document?.document_id, document?.theory_plan_id, document?.version, loadState, mode, navigation?.current_theory_plan_id, onWorkspaceContextChange])

  useEffect(() => {
    if (!taskId) {
      setLoadState('error')
      setError('研究任务地址无效。')
      return
    }
    let disposed = false
    setLoadState('loading')
    Promise.all([
      Promise.resolve().then(() => getResearchTaskNavigation({ path: { task_id: taskId } })),
      Promise.resolve().then(() => listResearchDocuments({ path: { task_id: taskId } })),
      mode === 'match'
        ? Promise.resolve().then(() => getAnalysisSnapshot(taskId)).catch(() => null)
        : Promise.resolve(null),
      Promise.resolve().then(() => getResearchCycleSnapshot(taskId)).catch(() => null),
    ]).then(async ([nav, docs, analysis, cycle]) => {
      if (disposed) return
      if (!nav.data || !docs.data) throw new Error('研究工作区暂时无法加载。')
      setNavigation(nav.data)
      setAnalysisSnapshot(analysis)
      setResearchCycle(cycle)
      if (mode === 'match' && (nav.data.allowed_actions?.includes('start_matching') || nav.data.current_match_run_id)) {
        setActiveSectionId('candidate_theories')
      }
      if (mode === 'match' && nav.data.current_match_run_id) {
        const match = await getMatchRun({ path: { match_run_id: nav.data.current_match_run_id } })
        if (match.data) setMatchRun(match.data)
        const decisions = await listTheoryDecisions({ path: { match_run_id: nav.data.current_match_run_id } })
        if (decisions.data?.decision_sets.length) {
          const restoredDecisionSet = decisions.data.decision_sets[0]
          setDecisionSet(restoredDecisionSet)
          setPendingTheoryDecisions(Object.fromEntries(restoredDecisionSet.decisions.map((decision) => [decision.candidate_id, { candidate_version: decision.candidate_version, action: decision.action }])))
        }
      }
      const current = selectCurrentDocument(docs.data.items, nav.data, mode, initialDocumentId)
      setDocument(current)
      setLoadState('ready')
      const taskProposals = await listResearchTaskDocumentProposals({ path: { task_id: taskId } })
      if (taskProposals.data) setProposals(taskProposals.data.items)
      if (current) {
        listResearchDocumentVersions({ path: { document_id: current.document_id } })
          .then((result) => result.data && setVersions(result.data.items))
          .catch(() => undefined)
      }
    }).catch(() => {
      if (!disposed) {
        setLoadState('error')
        setError('当前 Agent 运行环境未连接；不会把静态示例当作真实研究结果。')
      }
    })
    return () => { disposed = true }
  }, [initialDocumentId, mode, taskId])

  const availableAgentPanelWidth = useCallback(() => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || window.innerWidth
    return Math.max(MIN_AGENT_PANEL_WIDTH, Math.min(MAX_AGENT_PANEL_WIDTH, workspaceWidth - MIN_RESEARCH_CANVAS_WIDTH))
  }, [])

  const updateAgentPanelWidth = useCallback((width: number, persist = false) => {
    const nextWidth = clampAgentPanelWidth(width, availableAgentPanelWidth())
    agentPanelWidthRef.current = nextWidth
    setAgentPanelWidth(nextWidth)
    if (persist) persistAgentPanelWidth(nextWidth)
  }, [availableAgentPanelWidth])

  const resizeFromClientX = useCallback((clientX: number) => {
    const workspace = workspaceRef.current?.getBoundingClientRect()
    if (workspace?.width) updateAgentPanelWidth(workspace.right - clientX)
  }, [updateAgentPanelWidth])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const syncBounds = () => {
      const maxWidth = availableAgentPanelWidth()
      setAgentPanelMaxWidth(maxWidth)
      updateAgentPanelWidth(agentPanelWidthRef.current)
    }
    syncBounds()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncBounds)
      return () => window.removeEventListener('resize', syncBounds)
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [availableAgentPanelWidth, updateAgentPanelWidth])

  function startPointerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    activeResizePointer.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setResizingAgentPanel(true)
  }

  function movePointerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeResizePointer.current === event.pointerId) resizeFromClientX(event.clientX)
  }

  function finishPointerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeResizePointer.current !== event.pointerId) return
    activeResizePointer.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setResizingAgentPanel(false)
    persistAgentPanelWidth(agentPanelWidthRef.current)
  }

  function startMouseResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const targetWindow = event.currentTarget.ownerDocument.defaultView
    if (!targetWindow) return
    setResizingAgentPanel(true)
    const move = (moveEvent: MouseEvent) => resizeFromClientX(moveEvent.clientX)
    const finish = () => {
      setResizingAgentPanel(false)
      persistAgentPanelWidth(agentPanelWidthRef.current)
      targetWindow.removeEventListener('mousemove', move)
      targetWindow.removeEventListener('mouseup', finish)
      mouseResizeCleanup.current = null
    }
    mouseResizeCleanup.current = finish
    targetWindow.addEventListener('mousemove', move)
    targetWindow.addEventListener('mouseup', finish)
  }

  useEffect(() => () => mouseResizeCleanup.current?.(), [])

  function handleResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    const nextWidth = event.key === 'ArrowLeft' ? agentPanelWidth + AGENT_PANEL_KEYBOARD_STEP
      : event.key === 'ArrowRight' ? agentPanelWidth - AGENT_PANEL_KEYBOARD_STEP
        : event.key === 'Home' ? MIN_AGENT_PANEL_WIDTH
          : event.key === 'End' ? agentPanelMaxWidth
            : null
    if (nextWidth === null) return
    event.preventDefault()
    updateAgentPanelWidth(nextWidth, true)
  }

  const refreshDocumentState = useCallback(async () => {
    if (!taskId) return
    const [navigationResult, result, analysis, cycle] = await Promise.all([
      getResearchTaskNavigation({ path: { task_id: taskId } }),
      listResearchDocuments({ path: { task_id: taskId } }),
      mode === 'match' ? getAnalysisSnapshot(taskId).catch(() => null) : Promise.resolve(null),
      getResearchCycleSnapshot(taskId).catch(() => null),
    ])
    if (navigationResult.data) setNavigation(navigationResult.data)
    if (mode === 'match' && analysis) setAnalysisSnapshot(analysis)
    if (cycle) setResearchCycle(cycle)
    const refreshedMatchRunId = navigationResult.data?.current_match_run_id
    if (mode === 'match' && refreshedMatchRunId) {
      const [matchResult, decisionsResult] = await Promise.all([
        getMatchRun({ path: { match_run_id: refreshedMatchRunId } }),
        listTheoryDecisions({ path: { match_run_id: refreshedMatchRunId } }),
      ])
      if (matchResult.data) setMatchRun(matchResult.data)
      if (decisionsResult.data?.decision_sets.length) {
        const restoredDecisionSet = decisionsResult.data.decision_sets[0]
        setDecisionSet(restoredDecisionSet)
        setPendingTheoryDecisions(Object.fromEntries(
          restoredDecisionSet.decisions.map((decision) => [
            decision.candidate_id,
            { candidate_version: decision.candidate_version, action: decision.action },
          ]),
        ))
      } else {
        setDecisionSet(null)
        setPendingTheoryDecisions({})
      }
    } else if (mode === 'match') {
      setMatchRun(null)
      setDecisionSet(null)
      setPendingTheoryDecisions({})
    }
    if (!result.data) return
    const latestNavigation = navigationResult.data ?? navigation
    const current = latestNavigation
      ? selectCurrentDocument(result.data.items, latestNavigation, mode, initialDocumentId)
      : (initialDocumentId ? result.data.items.find((item) => item.document_id === initialDocumentId) : undefined) ?? result.data.items[0] ?? null
    if (saveStateRef.current === 'saved') setDocument(current)
    const taskProposals = await listResearchTaskDocumentProposals({ path: { task_id: taskId } })
    if (taskProposals.data) setProposals(taskProposals.data.items)
    if (current) {
      const versionsResult = await listResearchDocumentVersions({ path: { document_id: current.document_id } })
      if (versionsResult.data) setVersions(versionsResult.data.items)
    }
  }, [initialDocumentId, mode, navigation, taskId])

  const previousRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (previousRefreshKey.current === refreshKey) return
    previousRefreshKey.current = refreshKey
    void refreshDocumentState()
  }, [refreshDocumentState, refreshKey])

  const resumeFromServer = useCallback(async () => {
    if (!taskId) return
    const latest = await readResearchTaskNavigationViaApi(taskId)
    setNavigation(latest)
    if (!embedded && latest.resume_path !== location.pathname) {
      navigate(latest.resume_path, { replace: true })
    }
  }, [embedded, location.pathname, navigate, taskId])

  const saveSection = useCallback((): Promise<ResearchDocumentResponse | null> => {
    if (!editor || !document || !activeSection) return Promise.resolve(document)
    if (saveInFlightRef.current) return saveInFlightRef.current
    const base = saveBaseRef.current?.document_id === document.document_id && saveBaseRef.current.version > document.version
      ? saveBaseRef.current : document
    const content = editor.getMarkdown()
    if (content === base.sections.find(section => section.section_id === activeSection.section_id)?.content) {
      setSaveState('saved')
      setDocument(base)
      return Promise.resolve(base)
    }
    setSaveState('saving')
    let request: Promise<ResearchDocumentResponse | null>
    request = (async () => {
      try {
        let latest = base
        // 等待网络时仍可能继续输入；逐版保存，直到服务器版本包含当前编辑内容。
        // 中途不回填旧正文，否则会覆盖请求发出后新输入的文字。
        while (true) {
          const pendingContent = editor.getMarkdown()
          const nextSections = latest.sections.map(section => section.section_id === activeSection.section_id
            ? { ...section, content: pendingContent }
            : section)
          const result = await updateResearchDocument({
            path: { document_id: latest.document_id },
            headers: { 'Idempotency-Key': key() },
            body: { expected_version: latest.version, sections: nextSections, change_summary: '用户直接编辑正文', source: 'user_edit' },
          })
          if (!result.data) throw new Error('自动保存失败，请重试。')
          latest = result.data
          saveBaseRef.current = latest
          if (editor.getMarkdown() !== pendingContent) continue
          setDocument(latest)
          setSaveState('saved')
          return latest
        }
      } catch (cause) {
        setSaveState('unsaved')
        throw cause
      } finally {
        if (saveInFlightRef.current === request) saveInFlightRef.current = null
      }
    })()
    saveInFlightRef.current = request
    return request
  }, [activeSection, document, editor])

  useEffect(() => {
    if (saveState !== 'unsaved') return
    const timer = window.setTimeout(() => { void saveSection().catch((reason: unknown) => { setSaveState('unsaved'); setError(reason instanceof Error ? reason.message : '自动保存失败。') }) }, 900)
    return () => window.clearTimeout(timer)
  }, [saveSection, saveState])

  useEffect(() => {
    const guard = async () => {
      if (saveStateRef.current === 'saved') return true
      try { return Boolean(await saveSection()) }
      catch { setSaveState('unsaved'); setError('更改尚未保存，请重试后再离开。'); return false }
    }
    onNavigationGuardChange?.(guard)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveStateRef.current === 'saved') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { onNavigationGuardChange?.(null); window.removeEventListener('beforeunload', beforeUnload) }
  }, [onNavigationGuardChange, saveSection])

  async function startMatching() {
    const phenomenon = navigation?.phenomenon_summary
    if (
      !taskId
      || mode !== 'match'
      || matchingInFlightRef.current
      || !navigation?.allowed_actions?.includes('start_matching')
      || !phenomenon
      || !navigation.knowledge_release_id
    ) return
    const idempotencyKey = matchingAttemptKeyRef.current ?? key()
    matchingAttemptKeyRef.current = idempotencyKey
    matchingInFlightRef.current = true
    setMatchingActionState('loading')
    setMatchingActionError(null)
    try {
      const result = await createMatchRun({
        path: { task_id: taskId },
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          expected_task_version: navigation.version,
          phenomenon_query_id: phenomenon.phenomenon_query_id,
          phenomenon_version: phenomenon.version,
          knowledge_release_id: navigation.knowledge_release_id,
        },
      })
      if (!result.data) throw new Error('理论匹配暂时未能启动。')
      matchingAttemptKeyRef.current = null
      setMatchRun(result.data)
      setNavigation((current) => current
        ? {
            ...current,
            version: current.version === navigation.version ? current.version + 1 : current.version,
            current_match_run_id: result.data!.match_run_id,
          }
        : current)
      const latest = await getResearchTaskNavigation({ path: { task_id: taskId } })
      if (latest.data) {
        setNavigation(latest.data)
        setMatchingActionState('idle')
      } else {
        setMatchingActionState('error')
        setMatchingActionError('匹配结果已保存，但进度刷新失败。刷新页面即可从服务端恢复。')
      }
    } catch (reason: unknown) {
      setMatchingActionState('error')
      setMatchingActionError(
        reason instanceof Error
          ? reason.message
          : '理论匹配暂时未能启动，研究状态和固定知识发布均已保留。',
      )
    } finally {
      matchingInFlightRef.current = false
    }
  }

  async function acceptProposal(proposal: ResearchDocumentProposalResponse) {
    if (saveState !== 'saved') {
      setError('请等待当前编辑保存完成，再检查并接受修改建议。')
      return
    }
    if (proposal.status !== 'pending') return
    if (proposal.kind !== 'create' && !document) return
    if (proposal.kind !== 'create' && proposal.base_document_version !== document!.version) return
    const result = await acceptResearchDocumentProposal({
      path: { proposal_id: proposal.proposal_id },
      headers: { 'Idempotency-Key': key() },
      body: { expected_document_version: proposal.kind === 'create' ? null : document!.version },
    })
    if (result.data) {
      setDocument(result.data.document)
      setProposals((current) => current.map((item) => item.proposal_id === proposal.proposal_id ? result.data!.proposal : item))
      await refreshDocumentState()
      await resumeFromServer()
    }
  }

  async function rejectProposal(proposal: ResearchDocumentProposalResponse) {
    if (proposal.status !== 'pending') return
    const result = await rejectResearchDocumentProposal({
      path: { proposal_id: proposal.proposal_id },
      headers: { 'Idempotency-Key': key() },
      body: { reason: '用户拒绝本次局部修改建议。' },
    })
    if (result.data) setProposals((current) => current.map((item) => item.proposal_id === proposal.proposal_id ? result.data! : item))
  }

  async function confirmDocument() {
    if (!document) return
    const latestDocument = await saveSection() ?? document
    const result = await confirmResearchDocument({ path: { document_id: latestDocument.document_id }, headers: { 'Idempotency-Key': key() }, body: { expected_version: latestDocument.version } })
    if (result.data) {
      setDocument(result.data)
      await resumeFromServer()
    }
  }

  async function restoreVersion(version: number) {
    if (!document || version === document.version) return
    const latestDocument = saveStateRef.current === 'saved' ? document : await saveSection()
    if (!latestDocument) return
    const result = await restoreResearchDocument({
      path: { document_id: latestDocument.document_id },
      headers: { 'Idempotency-Key': key() },
      body: { source_version: version, expected_version: latestDocument.version, reason: `恢复到第 ${version} 版` },
    })
    if (result.data) {
      setDocument(result.data)
      setVersions((current) => [result.data!, ...current.filter((item) => item.version !== result.data!.version)])
    }
  }

  async function applyFormatting() {
    if (!document) return
    const latestDocument = await saveSection() ?? document
    if (
      latestDocument.formatting.template_id === formattingDraft.template_id
      && latestDocument.formatting.csl_style_id === formattingDraft.csl_style_id
      && latestDocument.formatting.locale === formattingDraft.locale
      && latestDocument.formatting.custom_csl === formattingDraft.custom_csl
      && latestDocument.formatting.custom_css === formattingDraft.custom_css
    ) return
    const result = await updateResearchDocument({
      path: { document_id: latestDocument.document_id },
      headers: { 'Idempotency-Key': key() },
      body: {
        expected_version: latestDocument.version,
        sections: latestDocument.sections,
        change_summary: '切换论文模板与引用格式',
        source: 'user_edit',
        formatting: formattingDraft,
      },
    })
    if (result.data) {
      setDocument(result.data)
      setVersions((current) => [result.data!, ...current.filter((item) => item.version !== result.data!.version)])
    }
  }

  async function importCsl(file: File | undefined) {
    if (!file) return
    const xml = await file.text()
    const styleId = registerCustomCslStyle(`custom-${file.name.replace(/\.csl$/i, '')}`, xml)
    setFormattingDraft((current) => ({ ...current, csl_style_id: styleId, custom_csl: xml }))
  }

  async function importPrintCss(file: File | undefined) {
    if (!file) return
    const css = await file.text()
    setFormattingDraft((current) => ({ ...current, template_id: 'custom', custom_css: css }))
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function loadFormalExport() {
    if (!document) return null
    // 导出跟随本次编辑保存后的版本，不能在自动保存期间退回旧正文。
    const latestDocument = saveState === 'saved' ? document : await saveSection()
    if (!latestDocument) return null
    const result = await exportResearchDocument({ path: { document_id: latestDocument.document_id }, query: { version: latestDocument.version } })
    return result.data ?? null
  }

  function citationsFromManifest(manifest: ResearchDocumentExportResponse['manifest']) {
    return manifest.citation_audit.map<ExportCitation>((citation) => {
      const csl = citationMetadataResolver(citation.source_id, citation.source_version)
      return {
        citationId: citation.citation_id,
        sourceId: citation.source_id,
        sourceVersion: citation.source_version,
        locator: citation.locator ?? {},
        state: citation.state === 'verified' && !csl ? 'needs_verification' : citation.state,
        csl,
      }
    })
  }

  async function exportFormalDocument(kind: 'markdown' | 'docx' | 'pdf' | 'audit') {
    if (!document || exportState === 'working') return
    setExportState('working')
    try {
      const exported = await loadFormalExport()
      if (!exported) return
      if (kind === 'markdown') {
        downloadBlob(new Blob([exported.markdown], { type: 'text/markdown;charset=utf-8' }), exported.filename)
        return
      }
      if (kind === 'audit') {
        downloadBlob(
          new Blob([JSON.stringify(exported.manifest, null, 2)], { type: 'application/json;charset=utf-8' }),
          exported.filename.replace(/\.md$/i, '.audit.json'),
        )
        return
      }
      const formal = exported.manifest.formal_document
      const citations = citationsFromManifest(exported.manifest)
      const bibliographyHtml = formatBibliography(citations, {
        styleId: exported.manifest.formatting.csl_style_id,
        locale: exported.manifest.formatting.locale,
        customStyleXml: exported.manifest.formatting.custom_csl ?? undefined,
      })
      const sections = Array.isArray(formal.sections)
        ? formal.sections.flatMap((section) => {
            if (!section || typeof section !== 'object') return []
            const item = section as { title?: unknown; content?: unknown }
            return [{ title: String(item.title ?? ''), markdown: String(item.content ?? '') }]
          })
        : []
      const templateId = (exported.manifest.formatting.template_id === 'asa'
        || exported.manifest.formatting.template_id === 'custom')
        ? exported.manifest.formatting.template_id
        : 'chinese-social-science'
      if (kind === 'docx') {
        const textContainer = globalThis.document.createElement('div')
        textContainer.innerHTML = bibliographyHtml
        const blob = await createDocxExport({
          title: String(formal.title ?? document.title),
          templateId: templateId as DocumentTemplateId,
          sections,
          citationAudit: citations,
          bibliographyText: textContainer.textContent ?? '',
        })
        downloadBlob(blob, exported.filename.replace(/\.md$/i, '.docx'))
        return
      }
      const preview = window.open('', '_blank')
      if (!preview) throw new Error('浏览器阻止了打印预览窗口。')
      preview.document.write(buildPrintableDocument({
        title: String(formal.title ?? document.title),
        templateId: templateId as DocumentTemplateId,
        sections,
        citationAudit: citations,
        bibliographyHtml,
        customCss: exported.manifest.formatting.custom_css ?? undefined,
      }))
      preview.document.close()
      preview.focus()
      preview.print()
    } finally {
      setExportState('idle')
    }
  }

  async function performDocumentAction(action: () => Promise<unknown>) {
    setError(null)
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，当前内容仍保留，请重试。') }
  }

  function openSectionNode(nodeId: string) {
    setSelectedMapNodeId(nodeId)
    if (nodeId.startsWith(sectionNodePrefix) && nodeId !== manuscriptNodeId) setActiveSectionId(nodeId.slice(sectionNodePrefix.length))
    const node = mapProjection.nodes.find(item => item.id === nodeId)
    if (node && node.kind !== 'document') discuss({ nodeId: node.id, title: node.title, content: node.summary || node.title, sectionId: null })
  }

  function recordTheoryDecision(candidateId: string, candidateVersion: number, action: TheoryDecisionAction) {
    setPendingTheoryDecisions((current) => ({ ...current, [candidateId]: { candidate_version: candidateVersion, action } }))
  }

  async function submitTheoryDecisions() {
    if (!matchRun) return
    const candidates = matchRun.candidate_page.candidates
    if (candidates.some((candidate) => !pendingTheoryDecisions[candidate.candidate_id])) return
    const adoptedCandidateIds = candidates.filter((candidate) => ['adopt', 'combine'].includes(pendingTheoryDecisions[candidate.candidate_id].action)).map((candidate) => candidate.candidate_id)
    if (adoptedCandidateIds.length > 1 && !multiTheoryRelationReady) return
    let expectedMatchVersion = matchRun.version
    if (matchRun.failed_candidate_ids.length && !matchRun.partial_completion_acknowledged) {
      const acknowledged = await acknowledgePartialMatch({
        path: { match_run_id: matchRun.match_run_id },
        headers: { 'Idempotency-Key': key() },
        body: {
          expected_version: matchRun.version,
          failed_candidate_ids: matchRun.failed_candidate_ids,
          acknowledged_candidate_ids: candidates.map((candidate) => candidate.candidate_id),
          reason: '用户确认以当前可用候选继续理论判断。',
        },
      })
      if (!acknowledged.data) return
      setMatchRun(acknowledged.data)
      expectedMatchVersion = acknowledged.data.version
    }
    const result = await createTheoryDecisions({
      path: { match_run_id: matchRun.match_run_id },
      headers: { 'Idempotency-Key': key() },
      body: {
        expected_match_run_version: expectedMatchVersion,
        completion_basis: matchRun.failed_candidate_ids.length ? 'partial_with_user_ack' : 'complete',
        decisions: candidates.map((candidate) => ({ candidate_id: candidate.candidate_id, candidate_version: pendingTheoryDecisions[candidate.candidate_id].candidate_version, action: pendingTheoryDecisions[candidate.candidate_id].action, reason: '用户在理论判断工作台确认。', related_candidate_ids: pendingTheoryDecisions[candidate.candidate_id].action === 'combine' ? adoptedCandidateIds.filter((id) => id !== candidate.candidate_id) : [], related_source_ids: [] })),
        relations: adoptedCandidateIds.length > 1 ? [{ candidate_ids: adoptedCandidateIds, relation_kind: 'complementary', explanation: relationDraft.explanation.trim(), premise_compatibility: relationDraft.premise.trim(), supporting_evidence: [relationDraft.supporting.trim()], excluding_evidence: [relationDraft.excluding.trim()], distinguishing_evidence: [relationDraft.distinguishing.trim()] }] : [],
        use_assignments: candidates.filter((candidate) => ['adopt', 'retain', 'combine'].includes(pendingTheoryDecisions[candidate.candidate_id].action)).map((candidate) => ({ candidate_id: candidate.candidate_id, role_code: pendingTheoryDecisions[candidate.candidate_id].action === 'adopt' ? 'primary' : 'secondary', responsibility: pendingTheoryDecisions[candidate.candidate_id].action === 'adopt' ? '核心解释视角' : '补充解释视角' })),
      },
    })
    if (result.data) {
      setDecisionSet(result.data)
      setPendingTheoryDecisions(Object.fromEntries(result.data.decisions.map((decision) => [decision.candidate_id, { candidate_version: decision.candidate_version, action: decision.action }])))
      const refreshed = await getMatchRun({ path: { match_run_id: matchRun.match_run_id } })
      if (refreshed.data) setMatchRun(refreshed.data)
      await resumeFromServer()
    }
  }

  async function confirmTheoryPlanChoice() {
    if (!decisionSet) return
    const result = await confirmTheoryPlan({
      path: { decision_set_id: decisionSet.decision_set_id },
      headers: { 'Idempotency-Key': key() },
      body: { expected_decision_set_version: decisionSet.version },
    })
    if (result.data) {
      setDecisionSet(null)
      await resumeFromServer()
    }
  }

  const runtimeBoundary = loadState === 'error'
  const statusText = saveState === 'saving' ? '正在保存…' : saveState === 'unsaved' ? '有未保存更改' : null
  function capturePassage(container: HTMLElement) {
    const selection = window.getSelection()
    if (!selection || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return
    const content = selection.toString().trim().slice(0, 2400)
    if (!content) { setSelectedPassage(null); return }
    const element = selection.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection.anchorNode?.parentElement
    const endElement = selection.focusNode?.nodeType === 1 ? selection.focusNode as Element : selection.focusNode?.parentElement
    const startSection = element?.closest('[data-research-section]')?.getAttribute('data-research-section')
    const endSection = endElement?.closest('[data-research-section]')?.getAttribute('data-research-section')
    const selectedSection = wholeDocument ? (startSection === endSection ? sections.find(section => section.section_id === startSection) : null) : activeSection
    setSelectedPassage({ title: selectedSection?.title ?? document?.title ?? '研究方案文稿', content, sectionId: selectedSection?.section_id ?? null })
  }

  const sectionNavigation = (
    <nav className="ep-document__sections" aria-label="文稿章节">
      <p className="qx-group-label">大纲</p>
      {sections.map((section, index) => <button className="qx-item" type="button" key={section.section_id} aria-label={`研究章节：${section.title}`} aria-pressed={!wholeDocument && activeSectionId === section.section_id} onClick={async () => {
        if (saveState !== 'saved') { try { if (!await saveSection()) return } catch { setError('请先保存当前修改。'); return } }
        setActiveSectionId(section.section_id); setSelectedPassage(null); setWholeDocument(false)
      }}><span className="ep-document__section-number">{index + 1}</span><span>{section.title}</span></button>)}
      <button className="qx-item ep-document__read-all" type="button" aria-pressed={wholeDocument} onClick={async () => { if (saveState !== 'saved') { try { if (!await saveSection()) return } catch { setError('请先保存当前修改。'); return } } setWholeDocument(true) }}>阅读全文</button>
    </nav>
  )

  const exportControls = (
<details className="ep-document__export">
            <summary className="qx-btn qx-btn--secondary" aria-label="导出研究文档"><DownloadSimpleIcon /> 导出</summary>
            <div>
              <button className="qx-btn qx-btn--ghost" type="button" disabled={!document || exportState === 'working'} onClick={() => void performDocumentAction(() => exportFormalDocument('markdown'))}>下载 Markdown</button>
              <button className="qx-btn qx-btn--ghost" type="button" disabled={!document || exportState === 'working'} onClick={() => void performDocumentAction(() => exportFormalDocument('docx'))}>下载 DOCX</button>
              <button className="qx-btn qx-btn--ghost" type="button" disabled={!document || exportState === 'working'} onClick={() => void performDocumentAction(() => exportFormalDocument('pdf'))}>打印或另存 PDF</button>
              <button className="qx-btn qx-btn--ghost" type="button" disabled={!document || exportState === 'working'} onClick={() => void performDocumentAction(() => exportFormalDocument('audit'))}>下载审计 JSON</button>
            </div>
          </details>
  )

  const documentNodeContent = (
    <article className="ep-document" aria-label="研究文档节点">
      <header className="ep-document__toolbar">
        <span className={`ep-document__save ep-document__save--${saveState}`} role="status">{statusText ?? (document ? `已保存 · v${document.version}` : '研究文稿')}</span>
        {activeSection?.status === 'confirmed' || activeSection?.status === 'reviewed' ? <span className="ep-document__reviewed"><CheckCircleIcon />已审阅</span> : null}
        {!toolbarTarget ? exportControls : null}
        <button className="qx-btn qx-btn--ghost" type="button" onClick={() => void performDocumentAction(confirmDocument)} disabled={!document || document.status === 'confirmed'}>{document?.status === 'confirmed' ? '已确认' : '确认版本'}</button>
        {!focusDocument ? <button type="button" className="qx-btn qx-btn--ghost" onClick={() => setSelectedMapNodeId(null)}>收起</button> : null}
      </header>
      <div className="ep-document__reading" onMouseUp={event => capturePassage(event.currentTarget)} onKeyUp={event => capturePassage(event.currentTarget)}>
        {!focusDocument ? sectionNavigation : null}
        {navigation?.phenomenon_summary?.phenomenon ? <p className="ep-document__question">{navigation.phenomenon_summary.phenomenon}</p> : null}
        {error ? <p className="ep-document__notice" role="alert">{error}</p> : null}
        {loadState === 'loading' ? <PageLoading message="正在恢复文档版本…" /> : <>
          <h2 id="research-document-heading" aria-label="研究文档正文" className="ep-document__heading">{wholeDocument ? document?.title ?? '研究文稿' : activeSection?.title ?? '研究文稿'}</h2>
          {runtimeBoundary && !error ? <p className="ep-document__notice"><WarningCircleIcon />当前 Agent 运行环境未连接；不会把静态示例当作真实研究结果。</p> : null}
            {mode === 'match' && activeSection?.section_id === 'candidate_theories' && navigation?.allowed_actions?.includes('start_matching') && (!matchRun || matchRun.status === 'no_reliable_candidate') ? (
              <section className="document-boundary document-boundary--action" aria-label="理论匹配操作" aria-busy={matchingActionState === 'loading'}>
                <WarningCircleIcon />
                <div>
                  <strong>{navigation.blocker?.message ?? '现象已确认，可以开始理论匹配。'}</strong>
                  {matchingActionError ? <p role="alert">{matchingActionError}</p> : null}
                  <button className="qx-btn qx-btn--ghost" type="button" disabled={matchingActionState === 'loading'} onClick={() => void startMatching()}>
                    {matchingActionState === 'loading' ? <><CircleNotchIcon className="spin" /> 正在匹配…</> : navigation.retry?.label ?? (matchRun?.status === 'no_reliable_candidate' ? '重新匹配' : '开始理论匹配')}
                  </button>
                </div>
              </section>
            ) : null}
            {mode === 'match' && activeSection?.section_id === 'candidate_theories' && matchRun && matchRun.status !== 'no_reliable_candidate' ? <section className="theory-candidates" aria-label="候选理论">
              <div className="theory-candidates__heading"><span>候选理论</span><small>{matchRun.candidate_page.candidates.length} 个候选</small></div>
              {matchRun.retrieval ? <dl className="theory-retrieval-provenance" role="group" aria-label="匹配发布与检索证据链">
                <div><dt>固定发布</dt><dd><code>{matchRun.knowledge_release_id}</code></dd></div>
                <div><dt>检索模式</dt><dd>{matchRun.retrieval.mode}</dd></div>
                <div><dt>索引</dt><dd><code>{matchRun.retrieval.retrieval_index_id ?? '未记录'}</code></dd></div>
                <div><dt>Embedding</dt><dd>{matchRun.retrieval.embedding_model ?? '未记录'}</dd></div>
                <div><dt>Reranker</dt><dd>{matchRun.retrieval.reranker_model ?? '未记录'}</dd></div>
              </dl> : null}
              {matchRun.candidate_page.candidates.map((candidate) => <article key={candidate.candidate_id} className="theory-candidate">
                <div><h3>{candidate.title}</h3><p>{candidate.applicability_rationale}</p></div>
                <div className="theory-candidate__actions"><button className="qx-btn qx-btn--ghost" type="button" aria-pressed={pendingTheoryDecisions[candidate.candidate_id]?.action === 'adopt'} onClick={() => recordTheoryDecision(candidate.candidate_id, candidate.version, 'adopt')}>采用</button><button className="qx-btn qx-btn--ghost" type="button" aria-pressed={pendingTheoryDecisions[candidate.candidate_id]?.action === 'combine'} onClick={() => recordTheoryDecision(candidate.candidate_id, candidate.version, 'combine')}>组合</button><button className="qx-btn qx-btn--ghost" type="button" aria-pressed={pendingTheoryDecisions[candidate.candidate_id]?.action === 'retain'} onClick={() => recordTheoryDecision(candidate.candidate_id, candidate.version, 'retain')}>保留</button><button className="qx-btn qx-btn--ghost" type="button" aria-pressed={pendingTheoryDecisions[candidate.candidate_id]?.action === 'exclude'} onClick={() => recordTheoryDecision(candidate.candidate_id, candidate.version, 'exclude')}>排除</button></div>
              </article>)}
              {selectedTheoryIds.length > 1 ? <fieldset className="theory-relation-editor"><legend>说明组合理论的关系</legend><textarea aria-label="组合关系说明" value={relationDraft.explanation} onChange={(event) => setRelationDraft((current) => ({ ...current, explanation: event.target.value }))} placeholder="两个理论如何共同解释研究问题" /><textarea aria-label="前提兼容性" value={relationDraft.premise} onChange={(event) => setRelationDraft((current) => ({ ...current, premise: event.target.value }))} placeholder="两者前提在哪些条件下兼容" /><textarea aria-label="支持证据要求" value={relationDraft.supporting} onChange={(event) => setRelationDraft((current) => ({ ...current, supporting: event.target.value }))} placeholder="什么证据支持组合解释" /><textarea aria-label="排除证据要求" value={relationDraft.excluding} onChange={(event) => setRelationDraft((current) => ({ ...current, excluding: event.target.value }))} placeholder="什么证据会排除组合解释" /><textarea aria-label="区分证据要求" value={relationDraft.distinguishing} onChange={(event) => setRelationDraft((current) => ({ ...current, distinguishing: event.target.value }))} placeholder="什么证据能区分各理论贡献" /></fieldset> : null}
              <button className="qx-btn qx-btn--ghost" type="button" disabled={Object.keys(pendingTheoryDecisions).length !== matchRun.candidate_page.candidates.length || !multiTheoryRelationReady} onClick={() => void performDocumentAction(submitTheoryDecisions)}>保存完整理论决定</button>
              {decisionSet ? <button className="qx-btn qx-btn--ghost" type="button" disabled={!decisionSet.allowed_actions.includes('confirm_theory_plan')} onClick={() => void performDocumentAction(confirmTheoryPlanChoice)}>确认理论方案，进入 M5</button> : null}
            </section> : null}

          {document ? wholeDocument ? <div className="ep-document__manuscript qx-prose" aria-label="研究文稿全文">{document.sections.map(section => <section key={section.section_id} data-research-section={section.section_id}>
            <h3>{section.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content || '这一节尚待共同补充。'}</ReactMarkdown>
            <div className="ep-document__section-actions"><button className="qx-btn qx-btn--ghost" type="button" onClick={() => { setActiveSectionId(section.section_id); setWholeDocument(false); setSelectedPassage(null) }}>编辑本节</button><button className="qx-btn qx-btn--ghost" type="button" onClick={() => { setActiveSectionId(section.section_id); discuss({ title: section.title, content: section.content, sectionId: section.section_id }) }}>讨论本节</button></div>
          </section>)}</div> : <EditorContent editor={editor} className="ep-document__editor qx-prose" aria-label="研究文档正文" /> : <p className="ep-document__empty" role="status">{activeSection?.section_id === 'candidate_theories' ? '在这个节点开始理论匹配，候选会直接回到画布。' : '这一部分会随着研究推进形成可编辑内容。'}</p>}
          <div className="ep-document__discussion">
            {selectedPassage ? <button className="qx-btn qx-btn--secondary" type="button" onMouseDown={event => event.preventDefault()} onClick={() => discuss(selectedPassage)}>讨论选中段落</button> : null}
            <button className="qx-btn qx-btn--ghost" type="button" onClick={() => discuss({ title: document?.title ?? '研究方案文稿', sectionId: activeSection?.section_id ?? null, content: document ? '请阅读当前文稿，结合研究地图检查尚缺的论证和依据，先提出下一步研究任务；需要修改时提交可确认的局部修订建议。' : '请承接已确认研究起点和前期调研，一起形成研究方案。先检查研究状态，已有内容直接复用；明确需要我决定什么，先提供依据再提问。' })}>围绕文稿继续研究</button>
          </div>
        </>}
        {proposals.some((proposal) => proposal.status === 'pending') ? (
          <section className="document-proposals" aria-label="Agent 修订建议">
            <header><span>Agent 修订建议</span><small>修改只会在你确认后写入正文</small></header>
            {proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => (
              <article className="proposal-card" key={proposal.proposal_id}>
                <header>
                  <strong>建议基线 v{proposal.base_document_version ?? '新建'}</strong>
                  {proposal.kind !== 'create' && proposal.base_document_version !== document?.version
                    ? <span className="proposal-card__conflict">当前文稿已是 v{document?.version}，建议基线发生冲突。</span>
                    : null}
                </header>
                <p>{proposal.rationale}</p>
                {proposal.proposed_sections.map((proposedSection) => {
                  const baseVersion = rebasedProposalIds.has(proposal.proposal_id)
                    ? document
                    : versions.find((version) => version.version === proposal.base_document_version) ?? document
                  const baseSection = baseVersion?.sections.find((section) => section.section_id === proposedSection.section_id)
                  return <div className="proposal-card__diff" key={proposedSection.section_id} aria-label={`${proposedSection.title}局部差异`}>
                    {createDocumentDiff(baseSection?.content ?? '', proposedSection.content).map((part, index) => part.kind === 'deleted'
                      ? <del key={index}>{part.text}</del>
                      : part.kind === 'inserted'
                        ? <ins key={index}>{part.text}</ins>
                        : <span key={index}>{part.text}</span>)}
                  </div>
                })}
                <div>
                  <button className="qx-btn qx-btn--ghost" type="button" disabled={proposal.kind !== 'create' && proposal.base_document_version !== document?.version} onClick={() => void performDocumentAction(() => acceptProposal(proposal))}>接受局部修改</button>
                  <button className="qx-btn qx-btn--ghost" type="button" onClick={() => void performDocumentAction(() => rejectProposal(proposal))}>拒绝建议</button>
                  {proposal.kind !== 'create' && proposal.base_document_version !== document?.version
                    ? <button className="qx-btn qx-btn--ghost" type="button" onClick={() => setRebasedProposalIds((current) => new Set(current).add(proposal.proposal_id))}>按当前版本重新比较</button>
                    : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}


        {document ? <details className="ep-document__format"><summary>论文与引用格式</summary><div className="ep-document__format-fields">
                <label>论文模板<Select className="qx-field-control" aria-label="论文模板" value={formattingDraft.template_id} onChange={(nextValue) => setFormattingDraft((current) => ({ ...current, template_id: nextValue }))} options={[{ value: "chinese-social-science", label: "中文社会科学" }, { value: "asa", label: "ASA" }, { value: "custom", label: "自定义 CSS" }]} /></label>
                <label>引用样式<Select className="qx-field-control" aria-label="引用样式" value={formattingDraft.csl_style_id} onChange={(nextValue) => setFormattingDraft((current) => ({ ...current, csl_style_id: nextValue }))} options={[{ value: "china-national-standard-gb-t-7714-2015-author-date", label: "GB/T 7714" }, { value: "american-sociological-association", label: "ASA" }, { value: "chicago-author-date", label: "Chicago" }, ...(formattingDraft.csl_style_id.startsWith('custom-') ? [{ value: formattingDraft.csl_style_id, label: "自定义 CSL" }] : [])]} /></label>
                <label>引用语言<Select className="qx-field-control" aria-label="引用语言" value={formattingDraft.locale} onChange={(nextValue) => setFormattingDraft((current) => ({ ...current, locale: nextValue }))} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English (US)" }]} /></label>
                <label className="qx-field-control document-formatting__file">导入 .csl<input aria-label="导入 CSL 样式" type="file" accept=".csl,application/xml,text/xml" onChange={(event) => void importCsl(event.target.files?.[0])} /></label>
                <label className="qx-field-control document-formatting__file">导入模板 CSS<input aria-label="导入模板 CSS" type="file" accept=".css,text/css" onChange={(event) => void importPrintCss(event.target.files?.[0])} /></label>
                <button className="qx-btn qx-btn--ghost" type="button" onClick={() => void performDocumentAction(applyFormatting)}>应用格式并形成新版本</button>
              </div></details> : null}
        {document ? <div className="ep-document__source-details">              {activeSection?.citation_refs?.length ? <aside className="document-citations" aria-label="结构化引用">
                <span>结构化引用</span>
                <ul>{activeSection.citation_refs.map((citation) => <li key={citation.citation_id}>
                  <strong>{citation.kind === 'scholarly' ? '学术' : citation.kind === 'empirical' ? '经验' : '分析'}</strong>
                  <button type="button" className="qx-cite" aria-label={`打开引用 ${citation.source_id}`} onClick={() => { setCitationRequest({ id: citation.citation_id, key: Date.now() }); onOpenCitation?.(citation.citation_id) }}>{citation.source_id}</button>
                  {citation.locator ? <small>{Object.entries(citation.locator).map(([label, value]) => `${label}: ${String(value)}`).join(' · ')}</small> : null}
                  <em>{citation.state === 'verified' ? '已核实' : citation.state === 'needs_verification' ? '待核实' : citation.state === 'broken' ? '断链' : '来源已删除'}</em>
                </li>)}</ul>
              </aside> : null}
              {document.research_analysis ? <aside className="document-analysis-basis" role="note" aria-label="分析依据">
                <span>分析依据</span><code>{document.research_analysis.content_hash}</code>
              </aside> : null}
              <div className="document-evidence">
                <span>证据边注</span>
                {activeSection?.evidence_refs?.length ? activeSection.evidence_refs.map((ref) => <code key={ref.evidence_ref_id}>{ref.source_id}</code>) : <em>本节尚未引用来源</em>}
              </div>
              <details className="document-versions">
                <summary>版本与恢复（{versions.length || document.version}）</summary>
                <ol>
                  {(versions.length ? versions : [document]).map((version) => <li key={version.version}>
                    <span>v{version.version} · {version.actor}</span>
                    <button className="qx-btn qx-btn--ghost" type="button" disabled={version.version === document.version} onClick={() => void performDocumentAction(() => restoreVersion(version.version))}>{version.version === document.version ? '当前版本' : '恢复'}</button>
                  </li>)}
                </ol>
              </details>
</div> : null}
        {mode === 'framework' && taskId && navigation?.current_theory_plan_id ? <details className="ep-document__delivery"><summary>研究方案交付</summary><M5ResearchDeliveryController taskId={taskId} theoryPlanId={navigation.current_theory_plan_id} conversationId={navigation.conversation_id} saveState={saveState} onChanged={() => { void refreshDocumentState() }} /></details> : null}
      </div>
    </article>
  )

  const workbench = (
    <section className={`ep-document-workbench${embedded ? ' ep-document-workbench--embedded' : ''}`} data-stage={mode}>
      {outlineTarget && focusDocument ? createPortal(sectionNavigation, outlineTarget) : null}
      {toolbarTarget ? createPortal(exportControls, toolbarTarget) : null}
      <div ref={workspaceRef} className="ep-document-workbench__body" data-resizing={resizingAgentPanel} style={{ '--rdw-agent-width': `${agentPanelWidth}px` } as CSSProperties}>
        <div className="ep-document-workbench__content">
          {focusDocument ? <div className="ep-document-workbench__paper" data-external-outline={Boolean(outlineTarget)}>
            {!outlineTarget ? <aside className="ep-document-workbench__outline" aria-label="文稿大纲">{sectionNavigation}{taskId ? <Link className="qx-item" to={`/research/${encodeURIComponent(taskId)}/workspace/map`}>查看研究地图</Link> : null}</aside> : null}
            {documentNodeContent}
          </div> : null}
          <div className="ep-document-workbench__map" hidden={focusDocument}>
            <ResearchMapCanvas projection={mapProjection} conversation={mapConversation} onConversationChange={setEditedConversation} selectedNodeId={selectedMapNodeId}
              onSelectNode={node => node.kind === 'document' ? openSectionNode(node.id) : setSelectedMapNodeId(node.id)} onClearSelection={() => setSelectedMapNodeId(null)} onContinueNode={node => openSectionNode(node.id)}
              onOpenCitation={id => { setCitationRequest({ id, key: Date.now() }); onOpenCitation?.(id) }} expandedNodeContent={!focusDocument && selectedMapNodeId?.startsWith(sectionNodePrefix) ? { [selectedMapNodeId]: documentNodeContent } : {}} />
          </div>
        </div>
        {!embedded ? <>
          <div className="ep-document-workbench__resize" role="separator" tabIndex={0} aria-label="调整 Agent 对话栏宽度" aria-orientation="vertical" aria-valuemin={MIN_AGENT_PANEL_WIDTH} aria-valuemax={agentPanelMaxWidth} aria-valuenow={agentPanelWidth} onKeyDown={handleResizeKey} onMouseDown={startMouseResize} onPointerDown={startPointerResize} onPointerMove={movePointerResize} onPointerUp={finishPointerResize} onPointerCancel={finishPointerResize} />
          <ResearchAgentConversationPage embedded userId={userId} conversationId={navigation?.conversation_id ?? null} knowledgeReleaseId={navigation?.knowledge_release_id ?? document?.knowledge_release_id ?? null} workspace="research" taskId={taskId ?? null} documentId={document?.document_id ?? null} sectionId={activeSection?.section_id ?? null} documentVersion={document?.version ?? null} theoryPlanId={navigation?.current_theory_plan_id ?? null} onConversationChange={setAgentConversation} discussion={discussion} onClearDiscussion={() => setDiscussion(null)} citationRequest={citationRequest} enableResearchGuidance={Boolean(navigation?.phenomenon_summary)} onTurnCompleted={() => { void refreshDocumentState() }} />
        </> : null}
      </div>
    </section>
  )

  if (embedded) return workbench

  return (
    <PageShell workspace wide>
      <PageContent>
        {workbench}
      </PageContent>
    </PageShell>
  )
}
