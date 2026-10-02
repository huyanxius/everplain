import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpIcon,
  BookmarkSimpleIcon,
  FilePdfIcon,
  GlobeIcon,
  NoteIcon,
  PaperclipIcon,
  PlusIcon,
  VideoCameraIcon,
  XIcon,
} from '@phosphor-icons/react'

import { topicById, type Material, type MaterialKind } from './data'

export function KindIcon({ kind }: { kind: MaterialKind }) {
  if (kind === '网页') return <GlobeIcon />
  if (kind === 'PDF') return <FilePdfIcon />
  if (kind === '视频') return <VideoCameraIcon />
  if (kind === '书签') return <BookmarkSimpleIcon />
  return <NoteIcon />
}

/* 主题色点：数据色，只用来区分主题，不承担状态含义。 */
export function TopicChip({ topicId, as = 'span', pressed, onClick }: { topicId: string; as?: 'span' | 'button'; pressed?: boolean; onClick?: () => void }) {
  const topic = topicById[topicId]
  const content = (
    <>
      <i className="mk-dot" style={{ background: topic.color }} />
      {topic.name}
    </>
  )
  if (as === 'button') {
    return (
      <button className="qx-tag" aria-pressed={pressed} onClick={onClick}>
        {content}
      </button>
    )
  }
  return <span className="qx-tag qx-tag--outline">{content}</span>
}

export function MaterialCard({ m }: { m: Material }) {
  return (
    <a className="qx-card qx-card--interactive mk-mcard" href={`#/library/${m.id}`}>
      <div className="mk-mcard__top">
        <span className="mk-mcard__kind">
          <KindIcon kind={m.kind} />
          {m.host ?? m.kind}
        </span>
        <i className="mk-dot" style={{ background: topicById[m.topicId].color }} title={topicById[m.topicId].name} />
      </div>
      <h3 className="qx-card__title">{m.title}</h3>
      <p className="qx-card__body mk-clamp">{m.summary}</p>
      <div className="qx-card__meta">
        {m.addedAt} · {m.points.length} 个知识点
      </div>
    </a>
  )
}

/*
 * Agent 输入框。单行起步，内容多了长高（最多 8 行），回车发送、Shift+回车换行。
 * 圆角在长高后从胶囊过渡到 field，避免多行文字被两端切掉。
 */
export function Composer({ placeholder, onSend, autoFocus, attachments }: { placeholder: string; onSend?: (text: string) => void; autoFocus?: boolean; attachments?: ReactNode }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 8 * 26)}px`
  }, [text])
  const multiline = text.includes('\n') || text.length > 60
  const send = () => {
    if (!text.trim()) return
    onSend?.(text.trim())
    setText('')
  }
  return (
    <div className="mk-composer" data-multiline={multiline}>
      {attachments}
      <div className="mk-composer__row">
        <button className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="添加资料或文件">
          <PlusIcon />
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg mk-only-desktop" aria-label="引用资料">
          <PaperclipIcon />
        </button>
        <button className="qx-btn qx-btn--primary qx-btn--icon qx-btn--lg" aria-label="发送" disabled={!text.trim()} onClick={send}>
          <ArrowUpIcon weight="bold" />
        </button>
      </div>
    </div>
  )
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="mk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qx-modal mk-dialog" data-wide={wide} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mk-dialog__head">
          <h2 className="qx-section-title">{title}</h2>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭" onClick={onClose}>
            <XIcon />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function PageHead({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mk-pagehead">
      <div className="mk-pagehead__row">
        <h1 className="qx-section-title">{title}</h1>
        {actions ? <div className="mk-pagehead__actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  )
}
