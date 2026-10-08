import { ArrowUpIcon, FileTextIcon, PlusIcon, StopIcon, XIcon } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { usePresence } from '../../ui/usePresence'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { markLaunch, settleComposer } from './sendFlight'
import './conversation-composer.css'

export type ComposerAttachment = { id: string; title: string; status: string; removable: boolean }
export type ConversationComposerProps = {
  scopeKey?: string
  mode: 'standard' | 'deep-research'
  value: string
  label: string
  placeholder: string
  maxLength: number
  busy: boolean
  canSend: boolean
  canStop: boolean
  uploading: boolean
  toolsOpen: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  toolsRef: RefObject<HTMLDivElement | null>
  toolsButtonRef: RefObject<HTMLButtonElement | null>
  fileRef: RefObject<HTMLInputElement | null>
  accept: string
  attachments: readonly ComposerAttachment[]
  tools: ReactNode
  attachmentPicker?: ReactNode
  context?: ReactNode
  toolbar?: ReactNode
  modelSelector?: ReactNode
  researchLayout?: boolean
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onStop: () => void
  onToggleTools: () => void
  onUpload: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

function ComposerTools({ open, anchor, onClose, children }: { open: boolean; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const motion = usePresence(open, panel)
  useLayoutEffect(() => {
    const menu = panel.current
    if (!open || !menu) return
    menu.showPopover?.()
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const width = viewport?.width ?? window.innerWidth
      const above = rect.top - 16
      const below = height - rect.bottom - 16
      const openAbove = above >= below
      const available = Math.max(64, openAbove ? above : below)
      const menuWidth = Math.min(240, width - 32)
      menu.style.width = `${menuWidth}px`
      menu.style.maxHeight = `${Math.min(420, available)}px`
      menu.style.left = `${Math.max(16, Math.min(rect.left, width - menuWidth - 16))}px`
      menu.style.top = `${openAbove ? Math.max(8, rect.top - Math.min(menu.scrollHeight, 420, available) - 8) : rect.bottom + 8}px`
    }
    place()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    resize?.observe(menu)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); resize?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, open])
  useLayoutEffect(() => {
    const menu = panel.current
    return () => menu?.hidePopover?.()
  }, [motion.present])
  return motion.present ? <div ref={panel} data-motion-surface="popover" {...motion.props} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.focus() }
  }} popover="manual" id="conversation-tools" className="qx-menu conversation-composer__menu" role="menu" aria-label="添加附件">{children}</div> : null
}

export function ConversationComposer(props: ConversationComposerProps) {
  const reduced = useReducedMotion()
  const formRef = useRef<HTMLFormElement>(null)
  const beforeSendHeight = useRef<number | null>(null)
  const cancelLaunch = useRef<(() => void) | undefined>(undefined)
  const cancelSettle = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => () => { cancelLaunch.current?.(); cancelSettle.current?.() }, [])
  useLayoutEffect(() => { if (reduced) cancelSettle.current?.() }, [reduced])
  function recordLaunch() {
    if (!props.canSend || props.busy || !props.value.trim() || !props.inputRef.current) return
    cancelLaunch.current?.(); cancelSettle.current?.()
    beforeSendHeight.current = formRef.current?.getBoundingClientRect().height ?? null
    const style = getComputedStyle(props.inputRef.current)
    cancelLaunch.current = markLaunch(props.inputRef.current.getBoundingClientRect(), props.value, { left: parseFloat(style.paddingLeft) || 0, top: parseFloat(style.paddingTop) || 0 })
  }

  useLayoutEffect(() => {
    const input = props.inputRef.current
    if (!input) return
    const resize = () => {
      const form = input.closest('form')
      if (form) {
        const narrow = form.clientWidth > 0 && form.clientWidth < 480
        // Use stable content/container inputs: changing textarea width must not toggle this back and forth.
        form.dataset.multiline = String(props.value.includes('\n') || props.value.length > 40 || (narrow && props.value.length > 0))
      }
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 240)}px`
    }
    resize()
    cancelSettle.current?.()
    if (!props.value && beforeSendHeight.current !== null && formRef.current) {
      cancelSettle.current = settleComposer(formRef.current, beforeSendHeight.current)
      beforeSendHeight.current = null
    }
    let width = input.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize() }
    })
    observer?.observe(input)
    return () => observer?.disconnect()
  }, [props.value, props.mode, props.inputRef])
  const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onUpload(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ''
  }
  return <form ref={formRef} className="conversation-composer" data-mode={props.mode} data-layout={props.researchLayout || props.mode === 'deep-research' ? 'research' : 'chat'} onSubmit={event => {
    if (props.busy || !props.canSend) { event.preventDefault(); return }
    recordLaunch(); props.onSubmit(event)
  }}>
    <input hidden ref={props.fileRef} type="file" multiple accept={props.accept} tabIndex={-1} onChange={fileChange} />
    {(props.context || props.attachmentPicker || props.attachments.length > 0 || props.uploading) && <div className="conversation-composer__extras">
    {props.context && <div className="conversation-composer__context">{props.context}</div>}
    {props.attachmentPicker && <div className="conversation-composer__picker">{props.attachmentPicker}</div>}
    {(props.attachments.length > 0 || props.uploading) && <div className="conversation-composer__attachments" aria-label="本轮附件">
      {props.attachments.map(attachment => <div className="qx-tag conversation-composer__attachment" key={attachment.id}>
        <FileTextIcon aria-hidden="true" /><span title={attachment.title}>{attachment.title}</span><span className="qx-meta">{attachment.status}</span>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" disabled={!attachment.removable} aria-label={`移除附件 ${attachment.title}`} onClick={() => props.onRemoveAttachment(attachment.id)}><XIcon /></button>
      </div>)}
      {props.uploading && <span className="qx-meta" role="status">正在上传…</span>}
    </div>}
    </div>}
    <div className="conversation-composer__row">
      <div className="conversation-composer__tools" ref={props.toolsRef}>
        <button type="button" ref={props.toolsButtonRef} className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加附件" aria-expanded={props.toolsOpen} aria-controls="conversation-tools" disabled={props.uploading} onClick={props.onToggleTools}><PlusIcon /></button>
        <ComposerTools key={props.scopeKey} open={props.toolsOpen} anchor={props.toolsButtonRef} onClose={props.onToggleTools}>{props.tools}</ComposerTools>
      </div>
      <textarea ref={props.inputRef} aria-label={props.label} placeholder={props.placeholder} maxLength={props.maxLength} rows={1} readOnly={props.busy} aria-busy={props.busy || undefined} value={props.value} onChange={event => { if (!props.busy) props.onChange(event.target.value) }} onKeyDown={event => {
        // Keep native focus/keyboard during docking while locking edits and sends.
        // readonly alone does not prevent an Enter handler or form submission.
        if (props.busy) { if (event.key === 'Enter') event.preventDefault(); return }
        const sends = event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
        if (sends && (!props.canSend || event.repeat)) { event.preventDefault(); return }
        if (sends) recordLaunch()
        props.onKeyDown(event)
      }} />
      {props.modelSelector && <div className="conversation-composer__model">{props.modelSelector}</div>}
      <button type={props.canStop ? 'button' : 'submit'} className="qx-btn qx-btn--primary qx-btn--icon conversation-composer__send" aria-label={props.canStop ? '停止生成' : props.busy ? 'Agent 正在加载' : '发送给 Everplain'} disabled={props.busy ? !props.canStop : !props.canSend} onClick={props.canStop ? props.onStop : undefined}>{props.canStop ? <StopIcon weight="fill" /> : <ArrowUpIcon weight="bold" />}</button>
    </div>
    {props.toolbar && <div className="conversation-composer__toolbar">{props.toolbar}</div>}
  </form>
}
