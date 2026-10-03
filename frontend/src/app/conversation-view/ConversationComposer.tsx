import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import './conversation-composer.css'

export type ComposerAttachment = { id: string; title: string; status: string; removable: boolean }
export type ConversationComposerProps = {
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
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onStop: () => void
  onToggleTools: () => void
  onUpload: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

function ComposerTools({ anchor, children }: { anchor: RefObject<HTMLButtonElement | null>; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = panel.current
    if (!menu) return
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
      const menuWidth = Math.min(320, width - 32)
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
    return () => { window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); resize?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); menu.hidePopover?.() }
  }, [anchor])
  return <div ref={panel} popover="manual" id="conversation-tools" className="qx-menu conversation-composer__menu" role="menu" aria-label="添加研究材料">{children}</div>
}

export function ConversationComposer(props: ConversationComposerProps) {
  useLayoutEffect(() => {
    const input = props.inputRef.current
    if (!input) return
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 240)}px`
      const form = input.closest('form')
      if (form) form.dataset.multiline = String(input.scrollHeight > 48)
    }
    resize()
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
  return <form className="conversation-composer" data-mode={props.mode} onSubmit={props.onSubmit}>
    <input hidden ref={props.fileRef} type="file" multiple accept={props.accept} tabIndex={-1} onChange={fileChange} />
    {(props.context || props.attachmentPicker || props.attachments.length > 0 || props.uploading) && <div className="conversation-composer__extras">
    {props.context && <div className="conversation-composer__context">{props.context}</div>}
    {props.attachmentPicker && <div className="conversation-composer__picker">{props.attachmentPicker}</div>}
    {(props.attachments.length > 0 || props.uploading) && <div className="conversation-composer__attachments" aria-label="本轮附件">
      {props.attachments.map(attachment => <div className="qx-tag conversation-composer__attachment" key={attachment.id}>
        <span title={attachment.title}>{attachment.title}</span><span className="qx-meta">{attachment.status}</span>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" disabled={!attachment.removable} aria-label={`移除附件 ${attachment.title}`} onClick={() => props.onRemoveAttachment(attachment.id)}><XIcon /></button>
      </div>)}
      {props.uploading && <span className="qx-meta" role="status">正在上传…</span>}
    </div>}
    </div>}
    <div className="conversation-composer__row">
      <div className="conversation-composer__tools" ref={props.toolsRef}>
        <button type="button" ref={props.toolsButtonRef} className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加研究材料" aria-expanded={props.toolsOpen} aria-controls="conversation-tools" disabled={props.uploading} onClick={props.onToggleTools}><PlusIcon /></button>
        {props.toolsOpen && <ComposerTools anchor={props.toolsButtonRef}>{props.tools}</ComposerTools>}
      </div>
      <textarea ref={props.inputRef} aria-label={props.label} placeholder={props.placeholder} maxLength={props.maxLength} rows={1} disabled={props.busy} value={props.value} onChange={event => props.onChange(event.target.value)} onKeyDown={props.onKeyDown} />
      {props.toolbar && <div className="conversation-composer__toolbar">{props.toolbar}</div>}
      <button type={props.canStop ? 'button' : 'submit'} className="qx-btn qx-btn--primary qx-btn--icon conversation-composer__send" aria-label={props.canStop ? '停止生成' : props.busy ? 'Agent 正在加载' : '发送给 Everplain'} disabled={props.busy ? !props.canStop : !props.canSend} onClick={props.canStop ? props.onStop : undefined}>{props.canStop ? <StopIcon weight="fill" /> : <ArrowUpIcon />}</button>
    </div>
  </form>
}
