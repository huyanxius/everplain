import { Select } from '../ui/Select'
import { DocumentKnowledgeEditor } from './DocumentKnowledgeEditor'
import { copyCourseText } from './copyCourseText'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, ChatCircleIcon, CopyIcon, FileTextIcon, InfoIcon, ListBulletsIcon, MagnifyingGlassIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import type { SharedSource, SharedDocument } from '../../modules/shared-knowledge'
import { formatMaterialLocator, formatMaterialSize, type ResearchMaterialSegment } from '../../modules/research-materials'
import './material-reader.css'

const PAGE_SIZE = 24

/** Private source reading retains original segment identities while edited knowledge remains separate. */
export function ReadOnlyMaterialReader({ source, selectedSegmentId, onBack, navigation, agentPanel, onKnowledgeSaved }: {
  source: SharedSource; selectedSegmentId?: string | null; navigation?: ReactNode; onBack: () => void; agentPanel?: ReactNode; onKnowledgeSaved?: (document: SharedDocument) => void
}) {
  const segments = useMemo<ResearchMaterialSegment[]>(() => source.segments.map((item) => ({ segmentId: item.id, materialId: source.document.id, parseId: item.parseId, ordinal: item.ordinal, kind: item.kind, text: item.text, locator: item.location })), [source.segments, source.document.id])
  const headings = useMemo(() => {
    const pages = new Set<number>()
    return segments.filter((item) => {
      if (item.kind === 'heading') return true
      if (item.locator.page !== null && !pages.has(item.locator.page)) { pages.add(item.locator.page); return true }
      return false
    }).map((segment) => ({ segment, label: segment.locator.headingPath.at(-1) ?? formatMaterialLocator(segment.locator) }))
  }, [segments])
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selected, setSelected] = useState(selectedSegmentId ?? null)
  const [page, setPage] = useState(() => Math.floor(Math.max(0, segments.findIndex((s) => s.segmentId === selectedSegmentId)) / PAGE_SIZE))
  const [agentOpen, setAgentOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const nodes = useRef(new Map<string, HTMLElement>())
  const scrollRef = useRef<HTMLElement>(null)
  const pendingScroll = useRef<string | null>(selectedSegmentId ?? null)
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? segments.filter((item) => `${item.text} ${formatMaterialLocator(item.locator)}`.toLocaleLowerCase().includes(needle)) : segments
  }, [segments, query])
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const activePage = Math.min(page, pageCount - 1)
  const paged = visible.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)
  const selectedSource = segments.find((item) => item.segmentId === selected)
  function select(segment: ResearchMaterialSegment) {
    setQuery(''); setSelected(segment.segmentId); setCopied(false)
    setPage(Math.floor(segments.findIndex((item) => item.segmentId === segment.segmentId) / PAGE_SIZE))
    pendingScroll.current = segment.segmentId
  }
  useEffect(() => {
    if (!selectedSegmentId) return
    const segment = segments.find((item) => item.segmentId === selectedSegmentId)
    if (segment) { setSelected(segment.segmentId); setPanelOpen(true); setQuery(''); setPage(Math.floor(segments.indexOf(segment) / PAGE_SIZE)); pendingScroll.current = segment.segmentId }
  }, [selectedSegmentId, segments])
  useEffect(() => {
    const node = pendingScroll.current ? nodes.current.get(pendingScroll.current) : null
    if (node) { node.scrollIntoView?.({ block: 'center' }); pendingScroll.current = null }
  }, [activePage, selected, query])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen((value) => !value) }
      if (event.key === 'Escape') { setSearchOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  function changePage(next: number) { setPage(next); scrollRef.current?.scrollIntoView?.({ block: 'start' }) }
  const warnings = source.document.warnings.join(' ')
  const knowledge = source.document.knowledge
  const canEdit = onKnowledgeSaved && !['queued', 'running'].includes(source.document.knowledgeStatus)
  return <section className="ep-material" aria-label="资料阅读工作区">
    <header className="ep-material__bar">
      {navigation ?? <button className="qx-btn qx-btn--ghost" onClick={onBack}><ArrowLeftIcon size={18} />知识库</button>}
      <div className="ep-material__actions">
        {agentPanel && <button type="button" className="qx-btn qx-btn--secondary" aria-expanded={agentOpen} onClick={() => { setAgentOpen(!agentOpen); setPanelOpen(true) }}><ChatCircleIcon size={18} />结合本库提问</button>}
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={outlineOpen ? '收起章节' : '展开章节'} aria-pressed={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><ListBulletsIcon size={18} /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="在材料中查找" title="查找（⌘⇧F）" aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><MagnifyingGlassIcon size={18} /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={panelOpen ? '收起研究侧栏' : '展开研究侧栏'} aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)}><InfoIcon size={18} /></button>
      </div>
    </header>
    <div className="ep-material__layout" data-rail={panelOpen}>
      <article className="ep-material__article" ref={scrollRef}>
        <div className="ep-material__meta"><span className="qx-tag"><FileTextIcon size={16} />原文</span><span className="qx-meta">{source.knowledgeBaseName} · {formatMaterialSize(source.document.sizeBytes)} · {segments.length} 段</span><label className="ep-material__zoom"><span>缩放</span><Select aria-label="阅读缩放" value={zoom} onChange={nextValue => setZoom(Number(nextValue))} options={[90, 100, 110, 125].map(value => ({ value: value, label: value + "%" }))} /></label></div>
        <h1 className="ep-material__title">{source.document.filename}</h1>
        {knowledge?.summary && <p className="ep-material__summary">{knowledge.summary}</p>}
        {outlineOpen && <nav className="ep-material__outline" aria-label="材料导航"><h2 className="qx-heading">章节</h2>{headings.length ? headings.map(({ segment, label }) => <button className="qx-item" type="button" key={segment.segmentId} aria-current={selected === segment.segmentId ? 'location' : undefined} onClick={() => select(segment)}>{label}</button>) : <p className="qx-meta">这份资料没有章节目录。</p>}</nav>}
        {searchOpen && <div className="ep-material__search"><label className="qx-search"><MagnifyingGlassIcon size={18} /><input autoFocus type="search" aria-label="搜索原文" placeholder="在原文中查找" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label><span className="qx-meta">{visible.length} / {segments.length} 段</span><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭查找" onClick={() => { setSearchOpen(false); setQuery('') }}><XIcon size={16} /></button></div>}
        {warnings && <p className="qx-notice">{warnings}</p>}
        <div className="qx-prose ep-material__prose" style={{ fontSize: `${zoom}%` }}>
          {paged.map(segment => <section key={segment.segmentId} className="ep-material__segment" data-selected={selected === segment.segmentId} ref={node => { if (node) nodes.current.set(segment.segmentId, node); else nodes.current.delete(segment.segmentId) }}>
            <button type="button" className="ep-material__locator" aria-label={`定位原文 ${formatMaterialLocator(segment.locator)}`} onClick={() => { select(segment); setPanelOpen(true) }}>{formatMaterialLocator(segment.locator)}</button>
            {segment.kind === 'heading' ? <h2 onClick={() => { select(segment); setPanelOpen(true) }}>{segment.text}</h2> : <p onClick={() => { select(segment); setPanelOpen(true) }}>{segment.text}</p>}
          </section>)}
          {!paged.length && <p className="qx-meta">没有找到相关原文，换个关键词试试。</p>}
        </div>
        <nav className="ep-material__pagination" aria-label="原文分页"><button type="button" className="qx-btn qx-btn--secondary" disabled={activePage === 0} onClick={() => changePage(activePage - 1)}>上一页</button><span className="qx-meta">第 {activePage + 1} / {pageCount} 页</span><button type="button" className="qx-btn qx-btn--secondary" disabled={activePage + 1 >= pageCount} onClick={() => changePage(activePage + 1)}>下一页</button></nav>
      </article>
      <aside className="ep-material__rail" aria-label="资料研究侧栏" hidden={!panelOpen}>
        {agentPanel && <section className="qx-card ep-material__rail-block ep-material__agent" hidden={!agentOpen}><header className="ep-material__rail-head"><h2 className="qx-heading">结合本库提问</h2><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="收起 Agent" onClick={() => setAgentOpen(false)}><XIcon size={16} /></button></header><div className="ep-material__agent-content">{agentPanel}</div></section>}
        <section className="qx-card ep-material__rail-block"><header className="ep-material__rail-head"><h2 className="qx-heading">知识点</h2>{canEdit && !editing && <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="编辑知识" onClick={() => setEditing(true)}><PencilSimpleIcon size={17} /></button>}</header>
          {editing && onKnowledgeSaved ? <DocumentKnowledgeEditor source={source} onCancel={() => setEditing(false)} onSaved={document => { onKnowledgeSaved(document); setEditing(false) }} /> : knowledge ? <ul className="ep-material__points">{knowledge.topics.map((topic, index) => <li key={`${topic.title}:${index}`}><button type="button" className="qx-item" onClick={() => { const segment = segments.find(item => item.segmentId === topic.segmentIds[0]); if (segment) select(segment) }}>{topic.title}</button><p className="qx-meta">{topic.summary}</p><div className="ep-material__citations">{topic.segmentIds.map((id, index) => <button className="qx-tag qx-tag--outline" key={id} type="button" onClick={() => { const segment = segments.find(item => item.segmentId === id); if (segment) select(segment) }}>原文 {index + 1}</button>)}</div></li>)}</ul> : <p className="qx-meta">{source.document.knowledgeStatus === 'failed' ? '知识整理暂未完成，请到资料详情重试。' : '正在整理知识点，完成后会显示在这里。'}</p>}
        </section>
        {!!knowledge?.relations.length && <section className="qx-card ep-material__rail-block"><h2 className="qx-heading">知识关系</h2>{knowledge.relations.map((relation, index) => <article className="ep-material__relation" key={index}><strong>{relation.source} → {relation.target}</strong><p className="qx-meta">{relation.label}</p><div className="ep-material__citations">{relation.segmentIds.map((id, i) => <button className="qx-tag qx-tag--outline" key={id} onClick={() => { const segment = segments.find(item => item.segmentId === id); if (segment) select(segment) }}>依据 {i + 1}</button>)}</div></article>)}</section>}
        {selectedSource && <section className="qx-card ep-material__rail-block" aria-label="原文依据"><header className="ep-material__rail-head"><h2 className="qx-heading">原文依据</h2><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭原文依据" onClick={() => setSelected(null)}><XIcon size={16} /></button></header><span className="qx-meta">{formatMaterialLocator(selectedSource.locator)}</span><blockquote>{selectedSource.text}</blockquote><button className="qx-btn qx-btn--secondary" type="button" onClick={() => { setCopyError(false); void copyCourseText(`${source.document.filename}\n${formatMaterialLocator(selectedSource.locator)}\n${selectedSource.text}`).then(() => setCopied(true)).catch(() => setCopyError(true)) }}><CopyIcon size={15} />{copied ? '已复制' : '复制原文与定位'}</button>{copyError && <p role="alert">复制失败，请手动选择原文复制。</p>}<p className="qx-meta">{source.document.filename} · {source.knowledgeBaseName}</p></section>}
      </aside>
    </div>
  </section>
}
