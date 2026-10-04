import { useEffect, useRef, useState } from 'react'
import { ArrowClockwiseIcon, DotsThreeIcon, FileTextIcon, ImageIcon, PresentationIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { documentKind } from './libraryMaterials'
import { formatMaterialSize } from '../../modules/research-materials'
import type { SharedCourse, SharedDocument } from '../../modules/shared-knowledge'

export type LibraryMaterialSource = { source?: string; url?: string | null; image?: string | null }

function sourceLabel(source: LibraryMaterialSource | undefined, document: SharedDocument) {
  if (source?.url) {
    try { const url = new URL(source.url); if (/^https?:$/.test(url.protocol)) return url.hostname.replace(/^www\./, '') } catch { /* Use the known import source instead. */ }
  }
  return source?.source || formatMaterialSize(document.sizeBytes)
}

export function LibraryMaterialCard({ course, document, showLibrary, source, busy, onRetry, onDelete, onReupload, readOnly = false, href }: {
  course: SharedCourse; document: SharedDocument; showLibrary: boolean; source?: LibraryMaterialSource; busy: boolean
  onRetry: () => void; onDelete: () => void; onReupload: () => void; readOnly?: boolean; href?: string
}) {
  const [menu, setMenu] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menu) return
    const outside = (event: MouseEvent) => { if (!anchor.current?.contains(event.target as Node)) setMenu(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(false); trigger.current?.focus() } }
    window.document.addEventListener('mousedown', outside); window.document.addEventListener('keydown', key)
    return () => { window.document.removeEventListener('mousedown', outside); window.document.removeEventListener('keydown', key) }
  }, [menu])
  const kind = documentKind(document)
  const Icon = kind === '图片' ? ImageIcon : kind === '演示文稿' ? PresentationIcon : FileTextIcon
  const retryable = document.status === 'ready' && (document.knowledgeStatus === 'failed' || document.indexStatus === 'failed')
  const states: string[] = []
  if (document.status === 'processing') states.push('正在解析，完成后即可阅读原文')
  else if (document.status === 'failed') states.push('解析失败')
  else {
    if (document.knowledgeStatus !== 'ready') states.push(({ queued: '等待知识整理', running: '知识整理中', failed: '知识整理失败' })[document.knowledgeStatus])
    if (document.indexStatus !== 'ready') states.push(({ queued: '等待语义索引', running: '建立语义索引中', failed: '语义索引失败' })[document.indexStatus])
  }
  const errors = [document.errorMessage, document.knowledgeError, document.indexError].filter(Boolean)
  const failed = document.status === 'failed' || retryable
  return <article className="qx-card qx-card--interactive ep-library-card" data-failed={failed}>
    <div className="ep-library-card__top"><span className="qx-meta"><Icon size={16} />{kind}</span>
      {showLibrary && <Link className="qx-meta ep-library-card__library" to={`/library?kb_id=${encodeURIComponent(course.id)}`}>{course.name}</Link>}
      {!readOnly && <div className="ep-library-card__menu-anchor" ref={anchor}>
        <button ref={trigger} type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`管理资料 ${document.filename}`} aria-expanded={menu} disabled={busy} onClick={() => setMenu(value => !value)}><DotsThreeIcon weight="bold" /></button>
        {menu && <div className="qx-menu ep-library-card__menu" aria-label={`${document.filename} 选项`}>
          {retryable && <button type="button" className="qx-item" onClick={() => { setMenu(false); onRetry() }}><ArrowClockwiseIcon />重试处理</button>}
          {document.status === 'failed' && <button type="button" className="qx-item" onClick={() => { setMenu(false); onReupload() }}>重新上传</button>}
          <button type="button" className="qx-item" aria-label={`删除 ${document.filename}`} onClick={() => { setMenu(false); onDelete() }}><TrashIcon />删除资料</button>
        </div>}
      </div>}
    </div>
    {kind === '图片' && <div className="qx-media-preview">{source?.image && !imageFailed ? <img src={source.image} alt={document.filename} loading="lazy" onError={() => setImageFailed(true)} /> : <span className="qx-meta"><ImageIcon size={28} aria-hidden="true" />图片预览暂不可用</span>}</div>}
    <h2 className="qx-card__title">{document.status === 'ready' ? <Link to={href ?? `/library?kb_id=${encodeURIComponent(course.id)}&document_id=${encodeURIComponent(document.id)}`}>{document.filename}</Link> : document.filename}</h2>
    {document.status === 'processing' ? <div className="ep-library-card__skeleton" aria-label="正在读取内容"><i className="qx-skeleton" /><i className="qx-skeleton" /><i className="qx-skeleton" /></div> : <p className="qx-card__body ep-library-card__summary">{document.status === 'failed' ? '资料解析失败，可查看原因后重新上传。' : document.knowledge?.summary || '原文已保存，知识摘要将在整理完成后显示。'}</p>}
    {states.length > 0 && <div className="qx-meta ep-library-card__state" data-failed={failed}>
      {failed ? <WarningCircleIcon size={16} /> : <ArrowClockwiseIcon size={16} />}
      <span>{states.map((state, index) => <span key={state}>{index > 0 ? ' · ' : ''}<span>{state}</span></span>)}{errors.length ? `：${errors.join('；')}` : ''}</span>
      {!readOnly && retryable && <button className="qx-btn qx-btn--ghost" type="button" aria-label={`重试处理 ${document.filename}`} disabled={busy} onClick={onRetry}>重试</button>}
      {!readOnly && document.status === 'failed' && <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={onReupload}>重新上传</button>}
    </div>}
    {!showLibrary && document.warnings.map(warning => <p className="qx-meta" key={warning}>{warning}</p>)}
    <footer className="qx-card__meta">{sourceLabel(source, document)}{document.knowledge ? ` · ${document.knowledge.topics.length} 个知识点` : ''}</footer>
  </article>
}

export function LibrarySkeleton() {
  return <div className="ep-library__grid" aria-busy="true" aria-label="正在读取知识库"><span className="ep-library__loading-text" role="status">正在读取知识库…</span>{Array.from({ length: 6 }, (_, index) => <div className="qx-card ep-library-card ep-library-card--skeleton" key={index}><i className="qx-skeleton" /><i className="qx-skeleton" /><div className="ep-library-card__skeleton"><i className="qx-skeleton" /><i className="qx-skeleton" /><i className="qx-skeleton" /></div></div>)}</div>
}
