import { useAnimatedDismiss } from '../../ui/usePresence'
import { CaretDownIcon, CaretRightIcon, DotsThreeIcon, FolderIcon, FolderOpenIcon, MagnifyingGlassIcon, PencilLineIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import type { AgentConversationSummary } from '../../modules/research-agent'
import { groupProjectConversations, type ResearchProject } from '../../modules/research-projects'
import { createMaterialFirstResearchProject } from '../../modules/socio-match-workspace'
import './conversation-history-view.css'

export type ConversationHistoryViewProps = {
  projects: ResearchProject[]
  setProjects: (projects: ResearchProject[]) => void
  conversations: AgentConversationSummary[]
  activeConversationId: string | null
  selectedTaskId?: string | null
  loading: boolean
  projectListError?: string | null
  onOpen: (conversation: AgentConversationSummary) => void
  onRename: (conversation: AgentConversationSummary, title: string) => Promise<void>
  onDelete: (conversation: AgentConversationSummary) => Promise<void>
  onDeleteProject: (taskId: string) => Promise<void>
  onNewConversation: (taskId?: string) => void
  modal?: boolean
  onClose?: () => void
  searchable?: boolean
  /** Optional host controller; the default uses the existing material-first project API. */
  onCreateProject?: (title: string, requestKey: string) => Promise<ResearchProject>
}

type HistoryAction = { anchor: HTMLElement } & (
  | { kind: 'create' }
  | { kind: 'conversation-menu' | 'rename' | 'delete-conversation'; conversation: AgentConversationSummary }
  | { kind: 'project-menu' | 'delete-project'; project: ResearchProject }
)

function focusables(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []).filter(node => !node.closest('[hidden]'))
}

export function ConversationHistoryView(props: ConversationHistoryViewProps) {
  const { text } = useAppLocale()
  const { projects, setProjects, conversations, activeConversationId, selectedTaskId = null, loading, projectListError, modal = false, searchable = modal, onClose } = props
  const currentTask = conversations.find(item => item.conversation_id === activeConversationId)?.task_id ?? selectedTaskId
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentTask ? [currentTask] : []))
  const [query, setQuery] = useState('')
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<HistoryAction | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const createRequest = useRef<{ title: string; key: string } | null>(null)
  const projectsRef = useRef(projects)
  const rootRef = useRef<HTMLElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const modalMotion = useAnimatedDismiss(rootRef, () => onClose?.())
  const dismissModal = modalMotion.dismiss
  const restoreActionFocus = useRef(true)
  const actionMotion = useAnimatedDismiss(popoverRef, () => {
    if (restoreActionFocus.current && action?.anchor.isConnected) action.anchor.focus({ preventScroll: true })
    setAction(null); setError(null)
  })
  const dismissPopover = actionMotion.dismiss
  const searchRef = useRef<HTMLInputElement>(null)
  const restoreModalFocus = useRef(true)
  const idPrefix = useId()
  useEffect(() => { projectsRef.current = projects }, [projects])
  useEffect(() => { if (currentTask) setExpanded(value => new Set([...value, currentTask])) }, [currentTask])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!modal) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    restoreModalFocus.current = true
    ;(searchRef.current ?? focusables(rootRef.current)[0])?.focus()
    return () => { if (restoreModalFocus.current && previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [modal])

  const dismissAction = useCallback((restore = true) => {
    if (busyRef.current) return
    restoreActionFocus.current = restore
    dismissPopover()
  }, [dismissPopover])
  useLayoutEffect(() => {
    if (!action) return
    const place = () => {
      const rect = action.anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const visibleWidth = viewport?.width ?? window.innerWidth
      const visibleHeight = viewport?.height ?? window.innerHeight
      const width = popoverRef.current?.offsetWidth || 264
      const height = popoverRef.current?.offsetHeight || 180
      setPosition({ left: Math.max(left + 8, Math.min(rect.right + 8, left + visibleWidth - width - 8)), top: Math.max(top + 8, Math.min(rect.top, top + visibleHeight - height - 8)) })
    }
    place()
    focusables(popoverRef.current)[0]?.focus({ preventScroll: true })
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { viewport?.removeEventListener('resize', place); viewport?.removeEventListener('scroll', place); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [action, error])
  useEffect(() => {
    if (!action && !modal) return
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (busyRef.current) return
        if (action) dismissAction()
        else if (modal) dismissModal()
      }
      if (modal && event.key === 'Tab') {
        if (modalMotion.props.inert) { event.preventDefault(); return }
        const items = focusables(rootRef.current)
        const first = items[0], last = items.at(-1)
        if (!first) return
        if (event.shiftKey && (document.activeElement === first || !rootRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && (document.activeElement === last || !rootRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
      if (action?.kind.endsWith('-menu') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = focusables(popoverRef.current)
        const index = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        event.preventDefault(); items[next]?.focus()
      }
    }
    function outside(event: PointerEvent) {
      if (!action || busyRef.current) return
      const target = event.target as Node
      if (!popoverRef.current?.contains(target) && !action.anchor.contains(target)) dismissAction(false)
    }
    const boundary = rootRef.current
    boundary?.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    return () => { boundary?.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside) }
  }, [action, dismissAction, modal, dismissModal, modalMotion.props.inert])

  function openAction(next: HistoryAction) {
    if (busyRef.current) return
    actionMotion.cancel()
    setError(null)
    setDraftTitle(next.kind === 'rename' ? next.conversation.title : '')
    setAction(next)
  }
  async function mutate() {
    if (!action || busyRef.current) return
    const operation = action
    const title = draftTitle.trim()
    if ((operation.kind === 'create' || operation.kind === 'rename') && !title) return
    if (operation.kind === 'rename' && title === operation.conversation.title) { dismissAction(); return }
    busyRef.current = true; setBusy(true); setError(null)
    try {
      if (operation.kind === 'create') {
        if (createRequest.current?.title !== title) createRequest.current = { title, key: crypto.randomUUID() }
        const project = props.onCreateProject
          ? await props.onCreateProject(title, createRequest.current.key)
          : await createMaterialFirstResearchProject(createRequest.current.key, title).then(result => ({ task_id: result.taskId, project_title: title, status: result.status }))
        setProjects([project, ...projectsRef.current.filter(item => item.task_id !== project.task_id)])
        createRequest.current = null
        if (mounted.current) { setExpanded(value => new Set([...value, project.task_id])); setQuery('') }
        restoreModalFocus.current = false
        props.onNewConversation(project.task_id)
      } else if (operation.kind === 'rename') await props.onRename(operation.conversation, title)
      else if (operation.kind === 'delete-conversation') await props.onDelete(operation.conversation)
      else if (operation.kind === 'delete-project') await props.onDeleteProject(operation.project.task_id)
      if (mounted.current) { setAction(null); setDraftTitle(''); if (operation.anchor.isConnected) operation.anchor.focus({ preventScroll: true }) }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : text('操作失败，请重试。', 'The operation failed. Please try again.'))
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  const groups = groupProjectConversations(projects, conversations)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  function toggleProject(id: string) {
    const update = (value: Set<string>) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next }
    if (normalizedQuery) setSearchCollapsed(update); else setExpanded(update)
  }
  const matches = (value: string) => value.toLocaleLowerCase().includes(normalizedQuery)
  const independent = groups.unassigned.filter(item => matches(item.title))
  const unavailable = groups.unavailable.filter(item => matches(item.title))
  const projectGroups = groups.projects.flatMap(group => {
    const items = matches(group.project.project_title) ? group.conversations : group.conversations.filter(item => matches(item.title))
    return !normalizedQuery || items.length || matches(group.project.project_title) ? [{ ...group, conversations: items }] : []
  })
  const openConversation = (conversation: AgentConversationSummary) => { if (busyRef.current) return; restoreModalFocus.current = false; props.onOpen(conversation) }
  const startConversation = (taskId?: string) => { if (busyRef.current) return; restoreModalFocus.current = false; props.onNewConversation(taskId) }
  function conversationRow(conversation: AgentConversationSummary) {
    return <div className="cv-history__row" key={conversation.conversation_id}>
      <button data-close-navigation className="qx-item cv-history__conversation" type="button" aria-current={conversation.conversation_id === activeConversationId ? 'true' : undefined} title={conversation.title} disabled={busy} onClick={() => openConversation(conversation)}><span>{conversation.title}</span></button>
      <button className="qx-btn qx-btn--ghost qx-btn--icon cv-history__more" type="button" aria-label={text('打开对话操作', 'Open conversation actions')} title={text(`${conversation.title}的操作`, `Actions for ${conversation.title}`)} aria-haspopup="menu" aria-expanded={Boolean(action && 'conversation' in action && action.conversation.conversation_id === conversation.conversation_id)} disabled={busy} onClick={event => { if (action?.anchor === event.currentTarget) dismissAction(); else openAction({ kind: 'conversation-menu', conversation, anchor: event.currentTarget }) }}><DotsThreeIcon /></button>
    </div>
  }

  const content = <section ref={rootRef} data-motion-surface={modal ? 'modal' : undefined} {...(modal ? modalMotion.props : {})} className={`cv-history${modal ? ' cv-history--modal qx-panel' : ''}`} role={modal ? 'dialog' : 'region'} aria-modal={modal || undefined} aria-label={modal ? text('研究记录', 'Research history') : text('Agent 对话记录', 'Agent conversation history')}>
    <header className="cv-history__head"><h2 className="qx-heading">{modal ? text('研究记录', 'Research history') : text('项目', 'Projects')}</h2><div><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('新建项目', 'New project')} title={text('新建项目', 'New project')} aria-haspopup="dialog" aria-expanded={action?.kind === 'create'} disabled={busy} onClick={event => { if (action?.kind === 'create') dismissAction(); else openAction({ kind: 'create', anchor: event.currentTarget }) }}><PlusIcon /></button>{modal && onClose ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('关闭研究记录', 'Close research history')} disabled={busy} onClick={modalMotion.dismiss}><XIcon /></button> : null}</div></header>
    {searchable ? <label className="cv-history__search"><MagnifyingGlassIcon aria-hidden="true" /><input ref={searchRef} aria-label={text('搜索研究记录', 'Search research history')} value={query} onChange={event => { setQuery(event.target.value); setSearchCollapsed(new Set()) }} placeholder={text('搜索问题或项目', 'Search questions or projects')} /></label> : null}
    {projectListError ? <p className="cv-history__error" role="alert">{projectListError}</p> : null}
    <div className="cv-history__body">{loading ? <p className="qx-meta" role="status">{text('正在加载记录…', 'Loading history…')}</p> : <>
      {projectGroups.map(({ project, conversations: items }) => {
        const open = normalizedQuery ? !searchCollapsed.has(project.task_id) : expanded.has(project.task_id)
        const childrenId = `${idPrefix}-${encodeURIComponent(project.task_id)}`
        return <section className="cv-history__project" role="group" aria-label={project.project_title} key={project.task_id}>
          <div className="cv-history__row"><button className="qx-item cv-history__project-title" type="button" aria-expanded={open} aria-controls={childrenId} title={project.project_title} onClick={() => toggleProject(project.task_id)}>{open ? <CaretDownIcon className="cv-history__caret" /> : <CaretRightIcon className="cv-history__caret" />}{open ? <FolderOpenIcon /> : <FolderIcon />}<span>{project.project_title}</span></button><button className="qx-btn qx-btn--ghost qx-btn--icon cv-history__more" type="button" aria-label={text(`${project.project_title}的项目操作`, `Project actions for ${project.project_title}`)} aria-haspopup="menu" aria-expanded={Boolean(action && 'project' in action && action.project.task_id === project.task_id)} disabled={busy} onClick={event => { if (action?.anchor === event.currentTarget) dismissAction(); else openAction({ kind: 'project-menu', project, anchor: event.currentTarget }) }}><DotsThreeIcon /></button>{project.status !== 'archived' ? <button className="qx-btn qx-btn--ghost qx-btn--icon cv-history__new" type="button" aria-label={text(`在${project.project_title}中新建对话`, `New conversation in ${project.project_title}`)} data-close-navigation disabled={busy} onClick={() => startConversation(project.task_id)}><PlusIcon /></button> : null}</div>
          <div className="cv-history__project-items" id={childrenId} hidden={!open}><div className="cv-history__resources"><Link to={`/research/${encodeURIComponent(project.task_id)}/workspace/materials`}>{text('项目材料', 'Materials')}</Link><Link to={`/research/${encodeURIComponent(project.task_id)}/workspace/map`}>{text('研究上下文', 'Research context')}</Link></div>{items.map(conversationRow)}{!items.length ? <p className="qx-meta">{text('还没有对话', 'No conversations yet')}</p> : null}</div>
        </section>
      })}
      <section role="group" aria-label={text('独立对话', 'Independent conversations')}><div className="cv-history__group-head"><h3>{text('独立对话', 'Independent conversations')}</h3><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('开始新对话', 'Start a new conversation')} data-close-navigation disabled={busy} onClick={() => startConversation()}><PlusIcon /></button></div>{independent.map(conversationRow)}{!independent.length && !normalizedQuery ? <p className="qx-meta">{text('未归属项目的对话会显示在这里', 'Conversations without a project appear here')}</p> : null}</section>
      {unavailable.length ? <section role="group" aria-label={text('项目暂不可用', 'Project unavailable')}><h3 className="cv-history__group-label">{text('项目暂不可用', 'Project unavailable')}</h3>{unavailable.map(conversationRow)}</section> : null}
      {normalizedQuery && !projectGroups.length && !independent.length && !unavailable.length ? <p className="qx-meta" role="status">{text('没有找到匹配的记录。', 'No matching history found.')}</p> : null}
    </>}</div>
  </section>

  const formActions = (label: string, danger = false) => <div className="cv-history-popover__actions"><button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => dismissAction()}>{text('取消', 'Cancel')}</button><button className={`qx-btn ${danger ? 'qx-btn--danger' : 'qx-btn--primary'}`} type="submit" aria-label={label} disabled={busy || (!danger && !draftTitle.trim())}>{busy ? text('处理中…', 'Working…') : danger ? text('删除', 'Delete') : action?.kind === 'create' ? text('创建', 'Create') : text('保存', 'Save')}</button></div>
  const popover: ReactNode = action ? <div ref={popoverRef} data-motion-surface="popover" {...actionMotion.props} className="cv-history-popover qx-panel" style={position}>
    {action.kind === 'conversation-menu' ? <div role="menu" aria-label={text('对话操作', 'Conversation actions')}><button className="qx-btn qx-btn--ghost" type="button" role="menuitem" onClick={() => openAction({ ...action, kind: 'rename' })}><PencilLineIcon />{text('修改名称', 'Rename')}</button><button className="qx-btn qx-btn--danger" type="button" role="menuitem" onClick={() => openAction({ ...action, kind: 'delete-conversation' })}><TrashIcon />{text('删除对话', 'Delete conversation')}</button></div> : action.kind === 'project-menu' ? <div role="menu" aria-label={text('项目操作', 'Project actions')}><button className="qx-btn qx-btn--danger" type="button" role="menuitem" onClick={() => openAction({ ...action, kind: 'delete-project' })}><TrashIcon />{text('删除项目', 'Delete project')}</button></div> : <form role="dialog" aria-label={action.kind === 'create' ? text('新建项目', 'New project') : action.kind === 'rename' ? text('修改对话名称', 'Rename conversation') : action.kind === 'delete-project' ? text('删除项目', 'Delete project') : text('删除对话', 'Delete conversation')} onSubmit={event => { event.preventDefault(); void mutate() }}>
      {action.kind === 'create' || action.kind === 'rename' ? <><strong>{action.kind === 'create' ? text('新建项目', 'New project') : text('修改对话名称', 'Rename conversation')}</strong><input className="qx-input" aria-label={action.kind === 'create' ? text('项目名称', 'Project name') : text('修改对话名称', 'Rename conversation')} maxLength={action.kind === 'create' ? 300 : 120} value={draftTitle} disabled={busy} onChange={event => setDraftTitle(event.target.value)} />{formActions(action.kind === 'create' ? text('创建项目', 'Create project') : text('保存对话名称', 'Save conversation name'))}</> : <><strong>{action.kind === 'delete-project' ? text(`删除“${action.project.project_title}”？`, `Delete “${action.project.project_title}”?`) : text('删除这段对话？', 'Delete this conversation?')}</strong>{action.kind === 'delete-project' ? <p>{text('项目材料和研究内容将被删除，所属对话会保留为独立对话。', 'Project materials and research will be deleted. Conversations will remain as independent conversations.')}</p> : <p>{'conversation' in action ? action.conversation.title : ''}</p>}{formActions(action.kind === 'delete-project' ? text('确认删除项目', 'Confirm delete project') : text('确认删除对话', 'Confirm delete conversation'), true)}</>}
    </form>}
    {error ? <p className="cv-history__error" role="alert">{error}</p> : null}
  </div> : null
  return <>{modal ? <div className="cv-history-backdrop" data-motion-surface="backdrop" {...modalMotion.props} onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) dismissModal() }}>{content}</div> : content}{popover ? createPortal(popover, rootRef.current ?? document.body) : null}</>
}
