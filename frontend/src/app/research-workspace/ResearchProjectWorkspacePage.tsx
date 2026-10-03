import type { ResearchDiscussion, ResearchCanvasStreamingTurn } from '../../modules/research-workspace'
import {
  ArrowLeftIcon,
  CheckIcon,
  PlusIcon,
  SidebarSimpleIcon,
  ChartBarIcon,
  ArchiveBoxIcon,
  FileTextIcon,
  FolderOpenIcon,
  MapTrifoldIcon,
  ScalesIcon,
  WrenchIcon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'

import { readResearchTaskNavigationViaApi } from '../../api/researchWorkspace'
import { getAgentConversation, type AgentConversation } from '../../modules/research-agent'
import { ResearchArchivePanel } from '../../modules/research-exchange'
import { ResearchAnalysisPanel, ResearchMaterialsPanel, listResearchLibraryMaterials, materialMediaLabel, materialStatusLabel } from '../../modules/research-materials'
import { MethodPlanWorkspace } from '../../modules/research-method'
import { useResearchTask, type ResearchTask } from '../../modules/socio-match-workspace'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState } from '../ui/States'
import { AgentLoading } from '../ui/AgentLoading'
import { ResearchDocumentWorkbench, type ResearchDocumentWorkspaceContext } from './ResearchDocumentWorkbench'
import {
  readResearchWorkspaceResumePath,
  rememberResearchWorkspaceResumePath,
  researchWorkspaceDestination,
  researchWorkspaceToolFromProject,
  type ResearchWorkspacePosition,
  type ResearchWorkspaceTool,
} from './researchProjectWorkspaceModel'
import './research-project-workspace.css'

const MIN_AGENT_WIDTH = 320
const MAX_AGENT_WIDTH = 680
const DEFAULT_AGENT_WIDTH = 340

const tools: ReadonlyArray<{
  id: ResearchWorkspaceTool
  label: string
  icon: typeof MapTrifoldIcon
}> = [
  { id: 'map', label: '地图', icon: MapTrifoldIcon },
  { id: 'materials', label: '材料', icon: FolderOpenIcon },
  { id: 'analysis', label: '分析', icon: ChartBarIcon },
  { id: 'theory', label: '理论', icon: ScalesIcon },
  { id: 'method', label: '方法', icon: WrenchIcon },
  { id: 'writing', label: '文稿', icon: FileTextIcon },
  { id: 'archive', label: '归档', icon: ArchiveBoxIcon },
]

const toolIds = new Set(tools.map((tool) => tool.id))

type ResearchProjectWorkspacePageProps = {
  readonly userId?: string | null
}

function clampAgentWidth(value: number, availableWidth = Number.POSITIVE_INFINITY) {
  const upper = Math.min(MAX_AGENT_WIDTH, Math.max(MIN_AGENT_WIDTH, availableWidth - 360))
  return Math.round(Math.min(upper, Math.max(MIN_AGENT_WIDTH, value)))
}

function readAgentWidth(taskId: string) {
  try {
    const stored = Number(window.localStorage.getItem(`everplain.research-workspace.agent-width.v1:${taskId}`))
    return Number.isFinite(stored) && stored > 0 ? clampAgentWidth(stored) : DEFAULT_AGENT_WIDTH
  } catch {
    return DEFAULT_AGENT_WIDTH
  }
}

function projectTitle(task: ResearchTask, navigation: Awaited<ReturnType<typeof readResearchTaskNavigationViaApi>>) {
  return task.projectTitle?.trim()
    || navigation.phenomenon_summary?.phenomenon?.trim()
    || '未命名研究'
}

export function ResearchProjectWorkspacePage({ userId = null }: ResearchProjectWorkspacePageProps) {
  const { task_id: taskId = '', tool: toolParam } = useParams<{ task_id: string; tool?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedConversationId = searchParams.get('conversation_id')
  const task = useResearchTask(taskId)
  const navigation = useQuery({
    queryKey: ['research-project-navigation', taskId],
    queryFn: () => readResearchTaskNavigationViaApi(taskId),
    enabled: Boolean(taskId),
    refetchOnWindowFocus: false,
    retry: false,
  })
  const [startedConversation, setStartedConversation] = useState<{ conversation_id: string; task_id: string | null } | null>(null)
  const knownConversationId = startedConversation?.task_id === taskId ? startedConversation.conversation_id : null
  const conversationQuery = useQuery({
    queryKey: ['research-project-conversation', taskId, requestedConversationId],
    queryFn: ({ signal }) => getAgentConversation(requestedConversationId!, signal),
    enabled: Boolean(requestedConversationId && requestedConversationId !== knownConversationId),
    refetchOnWindowFocus: false,
    retry: false,
  })
  const syncConversationIdentity = useCallback((identity: { conversation_id: string; task_id: string | null }) => {
    if (identity.task_id !== taskId) return
    setStartedConversation(identity)
    setSearchParams((current) => {
      if (current.get('conversation_id') === identity.conversation_id) return current
      const next = new URLSearchParams(current)
      next.set('conversation_id', identity.conversation_id)
      return next
    }, { replace: true })
  }, [setSearchParams, taskId])
  const [agentConversation, setAgentConversation] = useState<AgentConversation | null>(null)
  const syncConversation = useCallback((conversation: AgentConversation) => {
    setAgentConversation(conversation)
    syncConversationIdentity({ conversation_id: conversation.conversation_id, task_id: conversation.task_id ?? null })
  }, [syncConversationIdentity])
  const preserveConversation = useCallback((path: string) => {
    const conversationId = requestedConversationId ?? knownConversationId
    if (!conversationId) return path
    const target = new URL(path, window.location.origin)
    target.searchParams.set('conversation_id', conversationId)
    return `${target.pathname}${target.search}${target.hash}`
  }, [knownConversationId, requestedConversationId])
  const [discussion, setDiscussion] = useState<ResearchDiscussion | null>(null)
  const [citationRequest, setCitationRequest] = useState<{ id: string; key: number } | null>(null)
  const [streamingTurn, setStreamingTurn] = useState<ResearchCanvasStreamingTurn | null>(null)
  useEffect(() => { setDiscussion(null); setCitationRequest(null) }, [taskId, toolParam])
  const discuss = (next: ResearchDiscussion) => { setDiscussion(next); setSide('agent'); setMobilePane('agent') }

  const [documentContext, setDocumentContext] = useState<ResearchDocumentWorkspaceContext | null>(null)
  const [centerRefreshKey, setCenterRefreshKey] = useState(0)
  const [mobilePane, setMobilePane] = useState<'center' | 'outline' | 'materials' | 'agent'>('center')
  const [side, setSide] = useState<'materials' | 'agent'>('materials')
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [outlineTarget, setOutlineTarget] = useState<HTMLDivElement | null>(null)
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const leaveDocument = useRef<null | (() => Promise<boolean>)>(null)
  const registerDocumentGuard = useCallback((guard: (() => Promise<boolean>) | null) => { leaveDocument.current = guard }, [])
  const resources = useQuery({
    queryKey: ['research-workspace-materials', taskId, centerRefreshKey],
    queryFn: ({ signal }) => listResearchLibraryMaterials(taskId, signal),
    enabled: Boolean(taskId), retry: false,
  })
  const [historyRailTarget, setHistoryRailTarget] = useState<HTMLDivElement | null>(null)
  const [agentWidth, setAgentWidth] = useState(() => readAgentWidth(taskId))
  const resizePointer = useRef<number | null>(null)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  const tool = toolIds.has(toolParam as ResearchWorkspaceTool)
    ? toolParam as ResearchWorkspaceTool
    : null

  useEffect(() => {
    if (!taskId || !tool) return
    rememberResearchWorkspaceResumePath(taskId, `${location.pathname}${location.search}${location.hash}`)
  }, [location.hash, location.pathname, location.search, taskId, tool])

  useEffect(() => {
    setDocumentContext(null)
  }, [tool])

  useEffect(() => {
    const layout = layoutRef.current
    if (!layout) return
    const fit = () => {
      const width = layout.getBoundingClientRect().width
      if (width > 0) setAgentWidth(current => clampAgentWidth(current, width))
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(layout)
    window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
  }, [task.isPending, navigation.isPending, taskId, tool])

  const resizeAgent = useCallback((clientX: number) => {
    const bounds = layoutRef.current?.getBoundingClientRect()
    if (!bounds?.width) return
    setAgentWidth(clampAgentWidth(bounds.right - clientX, bounds.width))
  }, [])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    resizePointer.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizePointer.current !== event.pointerId) return
    resizePointer.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    try {
      window.localStorage.setItem(`everplain.research-workspace.agent-width.v1:${taskId}`, String(agentWidth))
    } catch {
      // The current layout remains usable when storage is unavailable.
    }
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizePointer.current === event.pointerId) resizeAgent(event.clientX)
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? agentWidth + 24
      : event.key === 'ArrowRight' ? agentWidth - 24
        : event.key === 'Home' ? MIN_AGENT_WIDTH
          : event.key === 'End' ? MAX_AGENT_WIDTH
            : null
    if (next == null) return
    event.preventDefault()
    const width = clampAgentWidth(next, layoutRef.current?.getBoundingClientRect().width || Number.POSITIVE_INFINITY)
    setAgentWidth(width)
    try {
      window.localStorage.setItem(`everplain.research-workspace.agent-width.v1:${taskId}`, String(width))
    } catch {
      // Keyboard resizing remains available for this session.
    }
  }

  async function openWorkspace(event: React.MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (leaveDocument.current && !(await leaveDocument.current())) return
    setMobilePane('center')
    navigate(destination)
  }

  const updateMaterialLocation = useCallback((next: {
    materialId: string | null
    parseId: string | null
    segmentId: string | null
  }) => {
    if (!next.materialId) { navigate('/research/materials'); return }
    const params = new URLSearchParams(researchWorkspaceDestination(taskId, 'materials', next).split('?')[1])
    const destination = preserveConversation(`${researchWorkspaceDestination(taskId, 'materials')}?${params}`)
    if (`${location.pathname}${location.search}` !== destination) navigate(destination, { replace: true })
  }, [location.pathname, location.search, navigate, preserveConversation, taskId])

  const updateDocumentLocation = useCallback((next: ResearchDocumentWorkspaceContext) => {
    setDocumentContext((current) => current
      && current.mode === next.mode
      && current.documentId === next.documentId
      && current.sectionId === next.sectionId
      && current.documentVersion === next.documentVersion
      && current.theoryPlanId === next.theoryPlanId
      ? current
      : next)
    const nextTool = next.mode === 'framework' ? 'writing' : tool === 'map' ? 'map' : 'theory'
    const destination = preserveConversation(researchWorkspaceDestination(taskId, nextTool, {
      documentId: next.documentId,
      sectionId: next.sectionId,
      version: next.documentVersion,
    }))
    if (`${location.pathname}${location.search}` !== destination) navigate(destination, { replace: true })
  }, [location.pathname, location.search, navigate, preserveConversation, taskId, tool])

  if (!taskId) return <ErrorState detail="研究项目地址无效。" />
  if (task.isPending || navigation.isPending) return <AgentLoading message="正在恢复研究项目" />
  if (task.isError || navigation.isError || !task.data || !navigation.data) {
    return <ErrorState
      title="研究项目暂时无法打开"
      detail="项目内容仍然保留，请稍后重试。"
      onRetry={() => { void Promise.all([task.refetch(), navigation.refetch()]) }}
    />
  }
  if (requestedConversationId && requestedConversationId !== knownConversationId) {
    if (conversationQuery.isPending) return <AgentLoading message="正在恢复研究对话" />
    if (conversationQuery.isError || !conversationQuery.data) return <ErrorState
      detail="研究对话暂时无法打开。"
      onRetry={() => { void conversationQuery.refetch() }}
    />
    if (conversationQuery.data.task_id !== taskId) return <ErrorState detail="这段对话不属于当前研究项目。" />
  }
  if (!tool) {
    const restored = readResearchWorkspaceResumePath(taskId)
    const destination = restored
      ?? researchWorkspaceDestination(
        taskId,
        researchWorkspaceToolFromProject(task.data.lastCentralTool),
      )
    return <Navigate replace to={preserveConversation(destination)} />
  }

  const taskData = task.data
  const navigationData = navigation.data
  const position: ResearchWorkspacePosition = {
    materialId: searchParams.get('material_id'),
    parseId: searchParams.get('parse_id'),
    segmentId: searchParams.get('segment_id'),
    documentId: searchParams.get('document_id'),
    sectionId: searchParams.get('section_id'),
    version: searchParams.get('version') !== null && Number.isFinite(Number(searchParams.get('version')))
      ? Number(searchParams.get('version'))
      : null,
  }

  const center = tool === 'materials'
    ? <ResearchMaterialsPanel taskId={taskId} outlineTarget={outlineTarget} onMaterialsChange={() => { void resources.refetch() }} presentation="workspace" initialMaterialId={position.materialId ?? null} initialParseId={position.parseId ?? null} initialSegmentId={position.segmentId ?? null} refreshKey={centerRefreshKey} onWorkspaceLocationChange={updateMaterialLocation} />
    : tool === 'analysis'
      ? <ResearchAnalysisPanel taskId={taskId} refreshKey={centerRefreshKey} />
      : tool === 'method'
      ? <MethodPlanWorkspace taskId={taskId} />
      : tool === 'archive'
        ? <ResearchArchivePanel taskId={taskId} />
      : (
          <ResearchDocumentWorkbench
            embedded
            outlineTarget={outlineTarget}
            toolbarTarget={toolbarTarget}
            onNavigationGuardChange={registerDocumentGuard}
            userId={userId}
            workspaceMode={tool === 'writing' ? 'framework' : 'match'}
            focusDocument={tool !== 'map'}
            initialDocumentId={position.documentId ?? null}
            initialSectionId={position.sectionId ?? null}
            conversation={agentConversation}
            streamingTurn={streamingTurn}
            onDiscuss={discuss}
            onOpenCitation={(id) => { setSide('agent'); setMobilePane('agent'); setCitationRequest({ id, key: Date.now() }) }}
            refreshKey={centerRefreshKey}
            onWorkspaceContextChange={updateDocumentLocation}
          />
        )

  const stageLabel = taskData.projectStage ?? ''
  const progress = /写作|文稿|已完成|成果|交付/.test(stageLabel) ? 3
    : /大纲|框架|研究方案|方案确认|方法/.test(stageLabel) ? 2
      : /资料|材料|理论|匹配|分析|编码/.test(stageLabel) ? 1
        : /提问|现象|问题/.test(stageLabel) ? 0 : -1
  const materialItems = resources.data?.items.filter(item => item.status !== 'deleted') ?? []
  const selectSide = (value: 'materials' | 'agent') => { setSide(value); setMobilePane(value); if (value === 'materials') void resources.refetch() }

  return (
    <PageShell workspace wide railContentRef={setHistoryRailTarget}>
      <PageContent>
        <main className="ep-workspace" aria-label="研究项目工作区" data-outline={outlineOpen}>
          <header className="ep-workspace__bar">
            <Link className="qx-btn qx-btn--ghost qx-btn--icon" to="/research/materials" aria-label="返回研究" onClick={event => void openWorkspace(event, '/research/materials')}><ArrowLeftIcon /></Link>
            <button className="qx-btn qx-btn--ghost qx-btn--icon ep-workspace__outline-toggle" type="button" aria-label="大纲" aria-pressed={outlineOpen} onClick={() => setOutlineOpen(value => !value)}><SidebarSimpleIcon /></button>
            <h1 className="qx-heading ep-workspace__title">{projectTitle(taskData, navigationData)}</h1>
            <ol className="ep-workspace__steps" aria-label="研究进度">
              {['提问', '找资料', '写大纲', '写作'].map((label, index) => <li key={label} data-done={index < progress} data-current={index === progress}><span>{index < progress ? <CheckIcon weight="bold" /> : index + 1}</span>{label}</li>)}
            </ol>
            <div ref={setToolbarTarget} className="ep-workspace__document-actions" />
          </header>

          <div className="ep-workspace__mobile-switcher qx-segmented" role="group" aria-label="移动工作区视图">
            {([{ id: 'center', label: '内容' }, { id: 'outline', label: '大纲与工具' }, { id: 'materials', label: '资料' }, { id: 'agent', label: 'Agent' }] as const).map(item => <button key={item.id} type="button" aria-pressed={mobilePane === item.id} onClick={() => { setMobilePane(item.id); if (item.id === 'agent' || item.id === 'materials') setSide(item.id) }}>{item.label}</button>)}
          </div>

          <div ref={layoutRef} className="ep-workspace__body" data-mobile-pane={mobilePane} data-testid="research-workspace-layout" style={{ '--research-agent-width': `${agentWidth}px` } as CSSProperties}>
            <aside className="ep-workspace__outline" aria-label="研究大纲与工具">
              <div ref={setOutlineTarget} className="ep-workspace__outline-content" />
              <nav className="ep-workspace__tools" aria-label="研究中心工具">
                <p className="qx-group-label">研究工具</p>
                {tools.map(({ id, label, icon: Icon }) => {
                  const destination = preserveConversation(researchWorkspaceDestination(taskId, id))
                  return <Link key={id} className="qx-item" to={destination} aria-current={tool === id ? 'page' : undefined} onClick={event => void openWorkspace(event, destination)}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>
                })}
              </nav>
            </aside>
            <section className="ep-workspace__center" aria-label="中心工具区">{center}</section>
            <div className="ep-workspace__separator" role="separator" tabIndex={0} aria-label="调整 Agent 对话栏宽度" aria-orientation="vertical" aria-valuemin={MIN_AGENT_WIDTH} aria-valuemax={MAX_AGENT_WIDTH} aria-valuenow={agentWidth} onKeyDown={handleResizeKey} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={finishResize} />
            <aside className="ep-workspace__side" aria-label="研究资料与 Agent">
              <div className="qx-segmented ep-workspace__side-tabs" role="tablist" aria-label="研究侧栏">
                <button id="workspace-materials-tab" type="button" role="tab" aria-selected={side === 'materials'} aria-controls="workspace-materials-panel" onClick={() => selectSide('materials')}>资料 {resources.isSuccess ? materialItems.length : ''}</button>
                <button id="workspace-agent-tab" type="button" role="tab" aria-selected={side === 'agent'} aria-controls="workspace-agent-panel" onClick={() => selectSide('agent')}>Agent</button>
              </div>
              <section id="workspace-materials-panel" className="ep-workspace__resources" role="tabpanel" aria-labelledby="workspace-materials-tab" hidden={side !== 'materials'}>
                {resources.isPending ? <AgentLoading compact state="work" message="正在读取研究资料…" /> : null}
                {resources.isError ? <div role="alert"><p>资料暂时无法读取。</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => void resources.refetch()}>重试读取资料</button></div> : null}
                {materialItems.map((material, index) => {
                  const destination = preserveConversation(researchWorkspaceDestination(taskId, 'materials', { materialId: material.materialId }))
                  return <Link className="qx-card ep-workspace__resource" key={material.materialId} to={destination} data-active={position.materialId === material.materialId} onClick={event => void openWorkspace(event, destination)}><span className="qx-meta"><FileTextIcon size={16} />{index + 1} · {materialMediaLabel(material.mediaType, material.filename)}</span><strong>{material.filename}</strong><span className="qx-meta">{materialStatusLabel(material.status)} · {material.segmentCount} 个片段</span></Link>
                })}
                {resources.isSuccess && !materialItems.length ? <p className="qx-meta ep-workspace__resource-empty">把与问题有关的资料放在这里，写作时随时查阅。</p> : null}
                <Link className="qx-btn qx-btn--secondary qx-btn--block" to={`/research/materials?task_id=${encodeURIComponent(taskId)}`} onClick={event => void openWorkspace(event, `/research/materials?task_id=${encodeURIComponent(taskId)}`)}><PlusIcon />添加研究资料</Link>
              </section>
              <section id="workspace-agent-panel" className="ep-workspace__agent" role="tabpanel" aria-labelledby="workspace-agent-tab" hidden={side !== 'agent'}>
                <ResearchAgentConversationPage
                  showConversationManagement historyRailTarget={historyRailTarget} embedded userId={userId}
                  conversationId={requestedConversationId ?? knownConversationId ?? navigationData.conversation_id}
                  knowledgeReleaseId={navigationData.knowledge_release_id} workspace="research" taskId={taskId}
                  documentId={documentContext?.documentId ?? null} sectionId={documentContext?.sectionId ?? null}
                  documentVersion={documentContext?.documentVersion ?? null} theoryPlanId={navigationData.current_theory_plan_id}
                  onConversationStarted={syncConversationIdentity} onConversationChange={syncConversation}
                  onStreamingTurnChange={setStreamingTurn} discussion={discussion} onClearDiscussion={() => setDiscussion(null)}
                  citationRequest={citationRequest} enableResearchGuidance={Boolean(navigationData.phenomenon_summary)}
                  onTurnCompleted={() => setCenterRefreshKey(value => value + 1)}
                  composerAriaLabel={`和 Agent 讨论当前${tools.find(item => item.id === tool)?.label ?? '研究'}`}
                />
              </section>
            </aside>
          </div>
        </main>
      </PageContent>
    </PageShell>
  )
}
