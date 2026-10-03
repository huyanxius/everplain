import { CircleNotchIcon, MagnifyingGlassIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { ReactNode, Ref, MouseEventHandler } from 'react'
import { formatMaterialLocator, type ResearchMaterialSegment } from './researchMaterialsModel'
import './material-views.css'

/** A reading canvas whose source identifiers and selection anchors come from the controller. */
export function DocumentWorkspace({ children, frameRef, narrow = false, workspace = true, zoom = 100, className = '' }: {
  children: ReactNode; frameRef?: Ref<HTMLElement>; narrow?: boolean; workspace?: boolean; zoom?: number; className?: string
}) {
  return <section className={`ep-source ${className}`} data-narrow={narrow} data-workspace={workspace} data-zoom={zoom} aria-label="材料阅读台" ref={frameRef}>{children}</section>
}

export function DocumentWorkspaceToolbar({ children, workspace = true }: { children: ReactNode; workspace?: boolean }) {
  return <header className="ep-source__toolbar" data-workspace={workspace}>{children}</header>
}

export function DocumentSearch({ query, count, total, onChange }: { query: string; count: number; total: number; onChange: (value: string) => void }) {
  return <section className="ep-source__search" id="research-materials-reader-search" aria-label="原文查找">
    <label className="qx-search"><MagnifyingGlassIcon size={17} aria-hidden="true" /><input type="search" aria-label="在材料中查找" value={query} placeholder="查找原文、页码或定位" autoFocus onChange={event => onChange(event.target.value)} />{query ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="清除材料查找" onClick={() => onChange('')}><XIcon size={16} aria-hidden="true" /></button> : null}</label>
    <p className="qx-meta" role="status">{query.trim() ? `${count} 处命中` : `${total} 段原文`}</p>
  </section>
}

export function DocumentOutline({ headings, selectedId, open, onSelect }: {
  headings: readonly { segment: ResearchMaterialSegment; label: string }[]; selectedId: string | null; open: boolean; onSelect: (segment: ResearchMaterialSegment) => void
}) {
  return <nav className="ep-source__outline" aria-label="章节导航" hidden={!open}>
    <p className="qx-group-label">大纲</p>
    {headings.length ? <ol>{headings.map(({ segment, label }, index) => <li key={segment.segmentId}><button type="button" className="qx-item" aria-current={segment.segmentId === selectedId ? 'location' : undefined} title={label} onClick={() => onSelect(segment)}><span className="ep-source__chapter-number">{index + 1}</span><span>{label}</span></button></li>)}</ol> : <p className="qx-meta">此文件没有可识别的章节，可使用原文查找。</p>}
  </nav>
}

export function DocumentSourceView({ children, scrollRef, loading = false, note = null, error, empty = false, query = '', page = 0, pageCount = 1, onPageChange, railLabel = '' }: {
  children: ReactNode; scrollRef?: Ref<HTMLElement>; loading?: boolean; note?: { tone: 'plain' | 'error'; text: string } | null; error?: ReactNode; empty?: boolean; query?: string; page?: number; pageCount?: number; onPageChange: (page: number) => void; railLabel?: string
}) {
  return <section className="ep-source__scroll" ref={scrollRef} aria-label="文档阅读器">
    {loading ? <p className="ep-material-notice" role="status"><CircleNotchIcon className="ep-material-library__spin" size={17} aria-hidden="true" />正在读取原文结构</p> : null}
    {note ? <p className="ep-material-notice" role={note.tone === 'error' ? 'alert' : 'status'}>{note.tone === 'error' ? <WarningCircleIcon size={17} aria-hidden="true" /> : null}{note.text}</p> : null}
    {error}
    <article className="ep-source__document" aria-label={railLabel || '材料原文'}>{children}{empty && !loading ? <p className="ep-source__empty qx-meta">{query.trim() ? '没有匹配的原文。换个词试试。' : '暂时没有可展示的片段。'}</p> : null}</article>
    {pageCount > 1 ? <nav className="ep-source__pagination" aria-label="文档分页"><button className="qx-btn qx-btn--secondary" type="button" aria-label="上一页" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))}>上一页</button><span className="qx-meta">第 {page + 1} / {pageCount} 页</span><button className="qx-btn qx-btn--secondary" type="button" aria-label="下一页" disabled={page >= pageCount - 1} onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}>下一页</button></nav> : null}
  </section>
}

export function DocumentSourceSegment({ segment, selected, children, rail, railLabel, line, coded = false, register, onSelect, onPointer, onContextMenu, onTextSelection }: {
  segment: ResearchMaterialSegment; selected: boolean; children: ReactNode; rail?: ReactNode; railLabel?: string; line: string; coded?: boolean; register: (id: string, node: HTMLElement | null) => void; onSelect: () => void; onPointer?: () => void; onContextMenu?: MouseEventHandler<HTMLDivElement>; onTextSelection?: MouseEventHandler<HTMLElement>
}) {
  const heading = segment.kind === 'heading'
  return <div className="ep-source__segment" data-segment-id={segment.segmentId} data-heading={heading} data-coded={coded} aria-current={selected ? 'location' : undefined} ref={node => register(segment.segmentId, node)} onClick={onPointer ?? onSelect} onContextMenu={onContextMenu}>
    <div className="ep-source__margin">{rail ? <aside aria-label={railLabel}>{rail}</aside> : null}<button type="button" className="ep-source__locator" aria-label={`定位到${formatMaterialLocator(segment.locator)}`} title={formatMaterialLocator(segment.locator)} onClick={event => { event.stopPropagation(); onSelect() }}>{line}</button></div>
    <div className="ep-source__passage">{heading ? <h3 onMouseUp={onTextSelection}>{children}</h3> : <p onMouseUp={onTextSelection}>{children}</p>}<span className="ep-source__citation qx-meta">{formatMaterialLocator(segment.locator)}</span></div>
  </div>
}
