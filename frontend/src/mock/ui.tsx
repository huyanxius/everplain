import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpIcon,
  ArrowClockwiseIcon,
  DotsThreeIcon,
  FileDocIcon,
  FilePdfIcon,
  FilePptIcon,
  GlobeIcon,
  ImageIcon,
  NoteIcon,
  TrashIcon,
  WarningCircleIcon,
  PaperclipIcon,
  PlusIcon,
  XIcon,
  CaretDownIcon,
  CheckIcon,
} from '@phosphor-icons/react'

import { libraries, libraryById, joinedLibraries, researches, topicById, type Material, type MaterialKind } from './data'

export function KindIcon({ kind }: { kind: MaterialKind }) {
  if (kind === '网页') return <GlobeIcon />
  if (kind === 'PDF') return <FilePdfIcon />
  if (kind === 'Word') return <FileDocIcon />
  if (kind === '演示文稿') return <FilePptIcon />
  if (kind === '图片') return <ImageIcon />
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

const stateText: Record<NonNullable<Material['state']>, string> = {
  parsing: '正在解析，完成后即可阅读原文',
  organizing: '原文可读，正在整理知识点',
  indexing: '原文可读，正在建立语义索引',
  'failed-parse': '解析失败',
  'failed-knowledge': '知识整理失败',
  'failed-index': '语义索引失败',
}

/*
 * 资料卡片。三段处理状态（解析 / 整理 / 索引）只在没好或出错时露一行，正常完成什么都不显示；
 * 出错时给原因和重试。卡片自己的菜单里是重试和删除——原来这两个按钮只在进了某个库之后才出现。
 * showLibrary：在「全部资料」里显示所属库，点了进库；在某个库里就不显示。
 */
export function MaterialCard({ m, showLibrary, onDelete }: { m: Material; showLibrary?: boolean; onDelete?: (m: Material) => void }) {
  const [menu, setMenu] = useState(false)
  const failed = m.state?.startsWith('failed')
  const readable = m.state !== 'parsing' && m.state !== 'failed-parse'
  return (
    <article className="qx-card qx-card--interactive mk-mcard" data-failed={failed}>
      <div className="mk-mcard__top">
        <span className="mk-mcard__kind">
          <KindIcon kind={m.kind} />
          {m.kind}
        </span>
        {showLibrary ? (
          <a className="mk-mcard__lib" href={`#/library?lib=${m.libraryId}`}>
            {libraryById[m.libraryId].name}
          </a>
        ) : null}
        <div className="mk-menu-anchor">
          <button className="qx-btn qx-btn--ghost qx-btn--icon mk-mcard__more" aria-label={`管理 ${m.title}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <DotsThreeIcon weight="bold" />
          </button>
          {menu ? (
            <div className="qx-menu mk-menu" role="menu">
              {failed && m.state !== 'failed-parse' ? (
                <button className="qx-item" role="menuitem" onClick={() => setMenu(false)}>
                  <ArrowClockwiseIcon /> 重试处理
                </button>
              ) : null}
              <button className="qx-item mk-danger" role="menuitem" onClick={() => { setMenu(false); onDelete?.(m) }}>
                <TrashIcon /> 删除
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <h3 className="qx-card__title">{readable ? <a href={`#/library/${m.id}`}>{m.title}</a> : m.title}</h3>
      <p className="qx-card__body mk-clamp">{m.state === 'failed-parse' ? '资料解析失败，可查看原因后重新上传。' : m.summary}</p>
      {m.state ? (
        <p className="mk-mcard__state" data-failed={failed}>
          {failed ? <WarningCircleIcon /> : <ArrowClockwiseIcon className="mk-spin" />}
          <span>
            {stateText[m.state]}
            {m.error ? `：${m.error}` : ''}
          </span>
          {failed && m.state !== 'failed-parse' ? <button className="qx-btn qx-btn--ghost">重试</button> : null}
        </p>
      ) : null}
      <div className="qx-card__meta">
        {m.size}
        {readable ? ` · ${m.points.length} 个知识点` : ''} · {m.addedAt}
      </div>
    </article>
  )
}

/*
 * Agent 输入框。单行起步，内容多了长高（最多 8 行），回车发送、Shift+回车换行。
 * 圆角在长高后从胶囊过渡到 field，避免多行文字被两端切掉。
 */
export function Composer({ placeholder, onSend, autoFocus, attachments, footer }: { placeholder: string; onSend?: (text: string) => void; autoFocus?: boolean; attachments?: ReactNode; footer?: ReactNode }) {
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
      {footer ? <div className="mk-composer__foot">{footer}</div> : null}
    </div>
  )
}

/*
 * 对话范围：Agent 在哪些资料里找。替代现在对话页的"对话所属项目"菜单——
 * 用户关心的是"它会翻哪些东西"，项目只是其中一种范围。
 */
export function ScopePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const groups: [string, [string, string][]][] = [
    ['', [['all', '全部资料']]],
    ['库', [...libraries, ...joinedLibraries].map((l) => [`lib:${l.id}`, l.name])],
    ['研究', researches.map((r) => [`research:${r.id}`, r.title])],
    ['', [['none', '不用资料，随便聊']]],
  ]
  const label = groups.flatMap(([, items]) => items).find(([id]) => id === value)?.[1] ?? '全部资料'
  return (
    <div className="mk-menu-anchor" ref={ref}>
      <button className="qx-btn qx-btn--ghost mk-scope" aria-expanded={open} onClick={() => setOpen(!open)}>
        在「{label}」里找 <CaretDownIcon />
      </button>
      {open ? (
        <div className="qx-menu mk-menu mk-scope__menu" role="menu">
          {groups.map(([title, items], gi) => (
            <div key={gi}>
              {gi > 0 ? <div className="qx-menu__divider" /> : null}
              {title ? <p className="qx-group-label">{title}</p> : null}
              {items.map(([id, name]) => (
                <button key={id} className="qx-item" role="menuitemradio" aria-checked={value === id} onClick={() => { onChange(id); setOpen(false) }}>
                  <span>{name}</span>
                  {value === id ? <CheckIcon className="qx-item__trail" /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
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
