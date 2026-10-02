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

/** The existing reading shell retains source identities and annotation selection. */
export function MaterialReaderView({
  material, segments, totalSegmentCount, headings, selectedSegmentId, detailLoading,
  note, outlineOpen, searchOpen, query, matchCount, page, pageCount,
  agentPanel, analysisPanel, workspaceNavigation, workspaceChrome = false,
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

  return <DocumentWorkspace workspace={workspaceChrome} className={agentPanel || analysisPanel ? undefined : 'is-source-reading'}>
    <DocumentWorkspaceToolbar workspace={workspaceChrome}>
      {workspaceNavigation ?? <>
        <button type="button" className="qx-reader__back" onClick={onBack} title="返回材料库"><ArrowLeftIcon size={16} aria-hidden="true" />材料库</button>
        <div className="qx-reader__identity">
          <div className="qx-reader__identity-line"><FileTextIcon size={17} aria-hidden="true" /><h2>{material.filename}</h2></div>
          <p>{materialKindLabel(material.materialKind)} · {formatMaterialSize(material.sizeBytes)} · {totalSegmentCount} 段原文</p>
        </div>
      </>}
      <div className="qx-reader__tools">
        <div className="qx-reader__tool-group" aria-label="阅读工具">
          <button type="button" className="qx-icon-button" aria-pressed={outlineOpen} aria-controls="research-materials-outline" aria-label={outlineOpen ? '收起侧栏' : '展开侧栏'} onClick={onToggleOutline}><SidebarSimpleIcon size={17} aria-hidden="true" /></button>
          <button type="button" className="qx-icon-button" aria-pressed={searchOpen} aria-controls="research-materials-reader-search" aria-label="在材料中查找" onClick={onToggleSearch}><MagnifyingGlassIcon size={17} aria-hidden="true" /></button>
          <button type="button" className="qx-icon-button" aria-label="材料档案" onClick={onOpenArchive}><IdentificationCardIcon size={17} aria-hidden="true" /></button>
        </div>
      </div>
    </DocumentWorkspaceToolbar>
    {searchOpen ? <DocumentSearch query={query} count={matchCount} total={totalSegmentCount} onChange={onQueryChange} /> : null}
    <div className={`qx-reader__body${outlineOpen ? ' is-outline-open' : ''}${analysisPanel || agentPanel ? ' has-inspector' : ''}`}>
      <aside id="research-materials-outline" className="qx-reader__sidebar" aria-label="材料导航" aria-hidden={!outlineOpen}>
        <DocumentOutline headings={headings} selectedId={selectedSegmentId} open={outlineOpen} onSelect={onSelectSegment} />
      </aside>
      <DocumentSourceView scrollRef={scrollRef} railLabel="" loading={detailLoading} note={note} empty={!segments.length} query={query} page={page} pageCount={pageCount} onPageChange={(next) => { onPageChange(next); scrollRef.current?.scrollTo?.({ top: 0 }) }}>
        {segments.map((segment) => <DocumentSourceSegment
          key={segment.segmentId} segment={segment} selected={selectedSegmentId === segment.segmentId}
          line={segment.locator.lineStart !== null ? String(segment.locator.lineStart) : `¶${segment.locator.paragraph ?? segment.ordinal + 1}`}
          register={registerSegment} onSelect={() => onSelectSegment(segment)}
          onPointer={() => { if (window.getSelection()?.isCollapsed !== false) onSelectSegment(segment) }}
          onTextSelection={(event) => captureSelection(segment, event)}
        >{segment.text || '此片段没有可显示的正文。'}</DocumentSourceSegment>)}
      </DocumentSourceView>
      {analysisPanel || agentPanel ? <aside className="qx-reader__inspector is-integrated" aria-label="研究侧栏">{analysisPanel}{agentPanel}</aside> : null}
    </div>
  </DocumentWorkspace>
}
