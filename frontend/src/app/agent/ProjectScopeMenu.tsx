import { CaretDownIcon, CheckIcon, FolderIcon, ChatCircleIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { usePresence } from '../../ui/usePresence'
import type { ResearchProject } from '../../modules/research-projects'

export function ProjectScopeMenu({ projects, taskId, disabled, onChange }: {
  projects: ResearchProject[]
  taskId: string | null
  disabled: boolean
  onChange: (taskId: string) => void
}) {
  const { text } = useAppLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 })
  const entryRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const expanded = open && !disabled
  const motion = usePresence(expanded, menuRef)
  const title = projects.find((project) => project.task_id === taskId)?.project_title
    ?? (taskId ? text('当前项目', 'Current project') : text('独立对话', 'Independent conversation'))
  const options = [{ id: '', title: text('独立对话', 'Independent conversation') },
    ...projects.filter((project) => project.status !== 'archived' || project.task_id === taskId)
      .map((project) => ({ id: project.task_id, title: project.project_title }))]
  if (taskId && !options.some((option) => option.id === taskId)) options.push({ id: taskId, title })
  const filteredOptions = options.filter((option) => option.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useLayoutEffect(() => {
    if (!expanded) return
    const menu = menuRef.current
    const anchor = triggerRef.current
    if (!menu || !anchor) return
    menu.showPopover?.()
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 32)
    const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16
    const up = above >= below
    const maxHeight = Math.max(80, Math.min(320, up ? above : below))
    setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: up ? Math.max(8, rect.top - Math.min(menu.scrollHeight, maxHeight) - 8) : rect.bottom + 8, maxHeight })
    menu.querySelector('input')?.focus()
  }, [expanded])
  useLayoutEffect(() => {
    const menu = menuRef.current
    return () => menu?.hidePopover?.()
  }, [motion.present])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!entryRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])
  return <div ref={entryRef} className="cv-project-selector" onKeyDown={(event) => {
    if (disabled) return
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); return }
    if (event.key === 'Escape' && expanded) { setOpen(false); triggerRef.current?.focus(); event.stopPropagation() }
    if (event.key === 'Tab') setOpen(false)
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (!expanded) { setQuery(''); setOpen(true); return }
    const items = [...menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }}>
    <button ref={triggerRef} type="button" className="qx-btn qx-btn--ghost cv-project-selector__trigger"
      aria-label={text('对话所属项目', 'Conversation project')} title={title} aria-haspopup="dialog" aria-expanded={expanded}
      disabled={disabled} onClick={() => { setQuery(''); setOpen((current) => !current) }}>
      {taskId ? <FolderIcon size={15} /> : <ChatCircleIcon size={15} />}<span>{title}</span><CaretDownIcon size={11} />
    </button>
    {motion.present ? <div ref={menuRef} popover="manual" role="dialog" data-motion-surface="popover" {...motion.props} aria-label={text('切换项目', 'Switch project')}
      className="qx-menu cv-project-selector__menu" style={position}>
      <input className="qx-input" type="search" aria-label={text('搜索项目', 'Search projects')} placeholder={text('搜索项目', 'Search projects')}
        value={query} onChange={(event) => setQuery(event.target.value)} />
      <div role="menu" aria-label={text('选择项目', 'Choose project')} className="cv-project-selector__options">
      {filteredOptions.map((option) => <button className="qx-btn qx-btn--ghost" key={option.id} type="button" role="menuitemradio" aria-checked={option.id === (taskId ?? '')}
        onClick={() => { setOpen(false); if (option.id !== (taskId ?? '')) onChange(option.id); else triggerRef.current?.focus() }}>
        {option.id ? <FolderIcon size={16} /> : <ChatCircleIcon size={16} />}<span>{option.title}</span>
        {option.id === (taskId ?? '') ? <CheckIcon size={14} /> : null}
      </button>)}
      {!filteredOptions.length ? <p>{text('没有匹配的项目', 'No matching projects')}</p> : null}
      </div>
    </div> : null}
  </div>
}
