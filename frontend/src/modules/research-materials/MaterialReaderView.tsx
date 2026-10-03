import { createPortal } from 'react-dom'
import { ArrowLeftIcon, FileTextIcon, IdentificationCardIcon, MagnifyingGlassIcon, SidebarSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'

import { DocumentWorkspace, DocumentWorkspaceToolbar, DocumentOutline, DocumentSearch, DocumentSourceView, DocumentSourceSegment } from './DocumentWorkspace'
import { formatMaterialSize, materialKindLabel, type ResearchMaterial, type ResearchMaterialSegment } from './researchMaterialsModel'

export type ReaderHeading = {
  readonly segment: ResearchMaterialSegment
  readonly label: string
}

export type MaterialReaderViewProps = {
  readonly material: ResearchMaterial
  readonly segments: readonly ResearchMaterialSegment[]
  readonly allSegments?: readonly ResearchMaterialSegment[]
  readonly totalSegmentCount: number
  readonly headings: readonly ReaderHeading[]
  readonly selectedSegmentId: string | null
  readonly detailLoading: boolean
  readonly note: { readonly tone: 'plain' | 'error'; readonly text: string } | null
  readonly outlineOpen: boolean
  readonly searchOpen: boolean
  readonly query: string
  readonly matchCount: number
  readonly page: number
  readonly pageCount: number
  readonly agentPanel?: ReactNode
  readonly analysisPanel?: ReactNode
  readonly workspaceNavigation?: ReactNode
  readonly outlineTarget?: HTMLElement | null
  readonly workspaceChrome?: boolean
  readonly registerSegment: (segmentId: string, element: HTMLElement | null) => void
  readonly onBack: () => void
  readonly onToggleOutline: () => void
  readonly onToggleSearch: () => void
  readonly onQueryChange: (query: string) => void
  readonly onOpenArchive: () => void
  readonly onSelectSegment: (segment: ResearchMaterialSegment) => void
  readonly onLocateSegment?: (segment: ResearchMaterialSegment) => void
  readonly onTextSelection: (segment: ResearchMaterialSegment, container: HTMLElement, range: Range) => void
  readonly onPageChange: (page: number) => void
}

/** Source reading surface: outline, uninterrupted text, and optional research tools. */
export function MaterialReaderView({
  material, segments, totalSegmentCount, headings, selectedSegmentId, detailLoading,
  note, outlineOpen, searchOpen, query, matchCount, page, pageCount,
  agentPanel, analysisPanel, workspaceNavigation, outlineTarget = null, workspaceChrome = false,
  registerSegment, onBack, onToggleOutline, onToggleSearch, onQueryChange,
  onOpenArchive, onSelectSegment, onTextSelection, onPageChange,
}: MaterialReaderViewProps) {
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        onToggleSearch()
      }
      if (event.key === 'Escape' && searchOpen) { onToggleSearch(); onQueryChange('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, onToggleSearch, onQueryChange])

  function captureSelection(segment: ResearchMaterialSegment, event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return
    const range = selection.getRangeAt(0)
    onTextSelection(segment, event.currentTarget, range)
  }

  const outline = outlineOpen ? <aside id="research-materials-outline" className="ep-source__navigation" aria-label="材料导航"><DocumentOutline headings={headings} selectedId={selectedSegmentId} open={outlineOpen} onSelect={onSelectSegment} /></aside> : null

  return <DocumentWorkspace workspace={workspaceChrome}>
    {outlineTarget ? createPortal(outline, outlineTarget) : null}
    <DocumentWorkspaceToolbar workspace={workspaceChrome}>
      {workspaceNavigation ?? <div className="ep-source__identity">
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" onClick={onBack} title="返回材料库" aria-label="材料库"><ArrowLeftIcon size={18} aria-hidden="true" /></button>
        <div><h2 className="qx-card__title"><FileTextIcon size={18} aria-hidden="true" />{material.filename}</h2><p className="qx-meta">{materialKindLabel(material.materialKind)} · {formatMaterialSize(material.sizeBytes)} · {totalSegmentCount} 段原文</p></div>
      </div>}
      <div className="ep-source__tools" role="group" aria-label="阅读工具">
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-pressed={outlineOpen} aria-controls="research-materials-outline" aria-label={outlineOpen ? '收起侧栏' : '展开侧栏'} onClick={onToggleOutline}><SidebarSimpleIcon size={18} aria-hidden="true" /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-pressed={searchOpen} aria-controls="research-materials-reader-search" aria-label="在材料中查找" onClick={onToggleSearch}><MagnifyingGlassIcon size={18} aria-hidden="true" /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="材料档案" onClick={onOpenArchive}><IdentificationCardIcon size={18} aria-hidden="true" /></button>
      </div>
    </DocumentWorkspaceToolbar>
    {searchOpen ? <DocumentSearch query={query} count={matchCount} total={totalSegmentCount} onChange={onQueryChange} /> : null}
    <div className="ep-source__body" data-outline={outlineOpen && !outlineTarget} data-inspector={Boolean(analysisPanel || agentPanel)}>
      {!outlineTarget ? outline : null}
      <DocumentSourceView scrollRef={scrollRef} loading={detailLoading} note={note} empty={!segments.length} query={query} page={page} pageCount={pageCount} onPageChange={next => { onPageChange(next); scrollRef.current?.scrollTo?.({ top: 0 }) }}>
        {segments.map(segment => <DocumentSourceSegment key={segment.segmentId} segment={segment} selected={selectedSegmentId === segment.segmentId}
          line={segment.locator.lineStart !== null ? String(segment.locator.lineStart) : `¶${segment.locator.paragraph ?? segment.ordinal + 1}`}
          register={registerSegment} onSelect={() => onSelectSegment(segment)}
          onPointer={() => { if (window.getSelection()?.isCollapsed !== false) onSelectSegment(segment) }}
          onTextSelection={event => captureSelection(segment, event)}
        >{segment.text || '此片段没有可显示的正文。'}</DocumentSourceSegment>)}
      </DocumentSourceView>
      {analysisPanel || agentPanel ? <aside className="ep-source__inspector" aria-label="研究侧栏">{analysisPanel}{agentPanel}</aside> : null}
    </div>
  </DocumentWorkspace>
}
