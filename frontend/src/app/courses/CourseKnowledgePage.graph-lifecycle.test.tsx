import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import cytoscape, { type Core, type CytoscapeOptions } from 'cytoscape'
import { useState, type PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseKnowledgePage } from './CourseKnowledgePage'
import { getCourse, listCourses, type SharedCourse } from '../../modules/shared-knowledge'
import { ObsidianKnowledgeGraph } from '../../modules/knowledge-graph'
import type { KnowledgeGraphProjection } from '../../modules/knowledge-graph'

// Exercise the actual React component, graph elements, styles, layouts and events.
// Only the DOM canvas renderer is replaced with Cytoscape's real headless engine.
vi.mock('cytoscape', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof cytoscape }>()
  return { default: vi.fn((options: CytoscapeOptions) => {
    const graph = actual.default({ ...options, container: undefined, headless: true, styleEnabled: true })
    if (options.container) vi.spyOn(graph, 'container').mockReturnValue(options.container)
    vi.spyOn(graph, 'destroy')
    vi.spyOn(graph, 'layout')
    vi.spyOn(graph, 'resize')
    return graph
  }) }
})
vi.mock('../ui/PageShell', () => ({
  PageShell: ({ children }: PropsWithChildren) => children,
  PageContent: ({ children }: PropsWithChildren) => children,
}))
vi.mock('../../modules/shared-knowledge', () => ({ getCourse: vi.fn(), listCourses: vi.fn() }))

const projection: KnowledgeGraphProjection = {
  releaseId: 'library-lifecycle',
  nodes: [
    { id: 'root', label: 'Library', nodeType: 'dimension' },
    { id: 'document', label: 'Document', nodeType: 'category' },
    { id: 'topic', label: 'Topic', nodeType: 'entry' },
    { id: 'other', label: 'Other topic', nodeType: 'entry' },
  ],
  edges: [
    { id: 'contains', source: 'root', target: 'document', relationType: '资料', direction: 'directed', layer: 'structure' },
    { id: 'mentions', source: 'document', target: 'topic', relationType: '涉及', direction: 'directed', layer: 'structure' },
    { id: 'related', source: 'topic', target: 'other', relationType: '联系', direction: 'directed', layer: 'candidate' },
  ],
}
const engine = () => vi.mocked(cytoscape).mock.results.at(-1)!.value as Core
let resizeCallback: ResizeObserverCallback
let disconnect: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.mocked(cytoscape).mockClear()
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
  disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('preserves the single-library canvas and dragged positions across repeated focus and clear', () => {
  const props = { projection, onSelectKnowledge: vi.fn() }
  const { rerender, unmount } = render(<ObsidianKnowledgeGraph {...props} />)
  const graph = engine()
  const layoutCalls = vi.mocked(graph.layout).mock.calls.length
  graph.getElementById('topic').position({ x: 73, y: 41 })
  const positions = graph.nodes().map(node => ({ ...node.position() }))
  for (const id of ['topic', 'document', 'other']) {
    rerender(<ObsidianKnowledgeGraph {...props} focusNodeId={id} />)
    expect(engine() === graph).toBe(true)
    expect(graph.getElementById(id).hasClass('node--focus')).toBe(true)
    expect(graph.nodes().filter('.node--focus')).toHaveLength(1)
    rerender(<ObsidianKnowledgeGraph {...props} />)
    expect(graph.nodes().filter('.node--focus, .node--neighbor, .node--context')).toHaveLength(0)
  }
  expect(cytoscape).toHaveBeenCalledTimes(1)
  expect(graph.destroy).not.toHaveBeenCalled()
  expect(graph.layout).toHaveBeenCalledTimes(layoutCalls)
  expect(graph.nodes().map(node => ({ ...node.position() }))).toEqual(positions)
  unmount()
  expect(graph.destroy).toHaveBeenCalledTimes(1)
  expect(graph.destroyed()).toBe(true)
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
})

it('updates focus classes in place without changing library node and edge styles', () => {
  const props = { projection, onSelectKnowledge: vi.fn() }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} focusNodeId="topic" />)
  const graph = engine()
  expect(graph.getElementById('topic').hasClass('node--focus')).toBe(true)
  expect(graph.getElementById('document').hasClass('node--neighbor')).toBe(true)
  expect(graph.getElementById('root').hasClass('node--context')).toBe(true)
  expect(graph.getElementById('contains').hasClass('edge--context')).toBe(true)
  expect(graph.getElementById('related').hasClass('edge--neighbor')).toBe(true)
  rerender(<ObsidianKnowledgeGraph {...props} />)
  expect(engine() === graph).toBe(true)
  for (const [id, nodeClass, width] of [['root', 'dimension', 20], ['document', 'category', 12], ['topic', 'entry', 10]] as const) {
    const node = graph.getElementById(id)
    expect(node.hasClass(`node--${nodeClass}`)).toBe(true)
    expect(node.style('width')).toBe(`${width}px`)
    expect(node.style('transition-duration')).toBe('0ms')
  }
  expect(graph.getElementById('related').hasClass('edge--candidate')).toBe(true)
  expect(graph.getElementById('related').hasClass('edge--directed')).toBe(true)
  expect(graph.getElementById('related').data('label')).toBe('候选 · 联系')
  expect(graph.getElementById('related').style('target-arrow-shape')).toBe('triangle')
})

it('keeps panning, zoom controls, resize and explicit relayout on the same canvas', () => {
  const props = { projection, onSelectKnowledge: vi.fn(), renderControls: ({ zoomIn, zoomOut, relayout }: { zoomIn: () => void; zoomOut: () => void; relayout: () => void }) => <><button onClick={zoomIn}>Zoom in</button><button onClick={zoomOut}>Zoom out</button><button onClick={relayout}>Layout</button></> }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} />)
  const graph = engine()
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="topic" />)
  expect(engine() === graph).toBe(true)
  expect(graph.userPanningEnabled()).toBe(true)
  expect(graph.userZoomingEnabled()).toBe(true)
  graph.pan({ x: 42, y: 31 })
  graph.zoom(0.5)
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="topic" onSelectKnowledge={vi.fn()} />)
  expect(engine() === graph).toBe(true)
  expect(graph.pan()).toEqual({ x: 42, y: 31 })
  expect(graph.zoom()).toBe(0.5)
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(graph.zoom()).toBeCloseTo(0.6)
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
  expect(graph.zoom()).toBeCloseTo(0.5)
  const positions = graph.nodes().map(node => ({ ...node.position() }))
  const layoutCalls = vi.mocked(graph.layout).mock.calls.length
  act(() => resizeCallback([], {} as ResizeObserver))
  expect(graph.resize).toHaveBeenCalledTimes(1)
  expect(graph.nodes().map(node => ({ ...node.position() }))).toEqual(positions)
  expect(graph.layout).toHaveBeenCalledTimes(layoutCalls)
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  expect(graph.layout).toHaveBeenCalledTimes(layoutCalls + 1)
  expect(cytoscape).toHaveBeenCalledTimes(1)
})

it('refreshes changed graph data and reapplies current focus without keeping stale elements', () => {
  const props = { onSelectKnowledge: vi.fn(), focusNodeId: 'topic' }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} projection={projection} />)
  const previous = engine()
  const filtered: KnowledgeGraphProjection = {
    ...projection,
    nodes: projection.nodes.filter(node => node.id !== 'other').map(node => node.id === 'topic' ? { ...node, label: 'Updated topic' } : node),
    edges: projection.edges.filter(edge => edge.id !== 'related'),
  }
  rerender(<ObsidianKnowledgeGraph {...props} projection={filtered} />)
  const graph = engine()
  expect(graph === previous).toBe(false)
  expect(previous.destroy).toHaveBeenCalledTimes(1)
  expect(graph.getElementById('other').empty()).toBe(true)
  expect(graph.getElementById('related').empty()).toBe(true)
  expect(graph.getElementById('topic').data('label')).toBe('Updated topic')
  expect(graph.getElementById('topic').hasClass('node--focus')).toBe(true)
})

it('reapplies current focus when the layout scope changes', () => {
  const props = { projection, onSelectKnowledge: vi.fn(), focusNodeId: 'topic' }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} layoutScope="first" />)
  const previous = engine()
  rerender(<ObsidianKnowledgeGraph {...props} layoutScope="second" />)
  expect(engine() === previous).toBe(false)
  expect(previous.destroy).toHaveBeenCalledTimes(1)
  expect(engine().getElementById('topic').hasClass('node--focus')).toBe(true)
})

it('refreshes changed style variants while preserving personal and preview behavior', () => {
  const styled: KnowledgeGraphProjection = { releaseId: 'style', nodes: [{ id: 'topic', label: 'Topic', nodeType: 'topic' }], edges: [] }
  const props = { projection: styled, onSelectKnowledge: vi.fn(), focusNodeId: 'topic' }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} />)
  const workspace = engine()
  rerender(<ObsidianKnowledgeGraph {...props} personal />)
  const personal = engine()
  expect(workspace.destroy).toHaveBeenCalledTimes(1)
  expect(personal.getElementById('topic').style('width')).toBe('18px')
  expect(personal.getElementById('topic').hasClass('node--focus')).toBe(true)
  rerender(<ObsidianKnowledgeGraph {...props} personal focusNodeId={undefined} />)
  expect(engine() === personal).toBe(true)
  expect(personal.getElementById('topic').hasClass('node--focus')).toBe(false)
  rerender(<ObsidianKnowledgeGraph {...props} variant="preview" />)
  expect(personal.destroy).toHaveBeenCalledTimes(1)
  expect(engine().userZoomingEnabled()).toBe(false)
  expect(engine().getElementById('topic').hasClass('node--focus')).toBe(true)
})

it('keeps the real library canvas when selecting a topic or document and closing details', async () => {
  const course: SharedCourse = {
    id: 'kb-lifecycle', name: 'Synthetic library', description: '', access: 'owner', sharingEnabled: false, shareToken: null, readyDocumentCount: 1,
    documents: [{ id: 'd1', filename: 'Synthetic.txt', mediaType: 'text/plain', sizeBytes: 100, parseId: 'p1', status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '2026-10-02', knowledge: { summary: 'Document summary', topics: [{ title: 'Topic', summary: 'Topic evidence', segmentIds: ['s1'] }], relations: [] } }],
  }
  vi.mocked(listCourses).mockResolvedValue([{ ...course, documents: [] }])
  vi.mocked(getCourse).mockResolvedValue(course)
  const { unmount } = render(<MemoryRouter initialEntries={['/my/graph?kb_id=kb-lifecycle']}><CourseKnowledgePage libraryChrome /></MemoryRouter>)
  const canvas = await screen.findByRole('img', { name: 'Obsidian 式节点知识图谱' })
  // The canvas DOM can appear before React runs the graph initialization effect.
  await waitFor(() => {
    expect(cytoscape).toHaveBeenCalledTimes(1)
    expect(engine().container()).toBe(canvas)
    expect(engine().destroyed()).toBe(false)
  })
  const graph = engine()
  const layoutCalls = vi.mocked(graph.layout).mock.calls.length
  for (const id of ['topic:Topic', 'document:d1']) {
    act(() => { graph.getElementById(id).emit('tap') })
    expect(screen.getByRole('complementary', { name: '知识点原文依据' })).toBeInTheDocument()
    expect(engine() === graph).toBe(true)
    expect(graph.getElementById(id).hasClass('node--focus')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭知识详情' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(engine() === graph).toBe(true)
  }
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索知识' }), { target: { value: 'Topic' } })
  fireEvent.click(screen.getByRole('button', { name: '查看知识点 Topic' }))
  expect(engine() === graph).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '关闭知识详情' }))
  expect(screen.getByRole('searchbox', { name: '搜索知识' })).toHaveValue('')
  expect(cytoscape).toHaveBeenCalledTimes(1)
  expect(graph.destroy).not.toHaveBeenCalled()
  expect(graph.layout).toHaveBeenCalledTimes(layoutCalls)
  unmount()
  expect(graph.destroy).toHaveBeenCalledTimes(1)
})

it('review: clears native node selection on close and returns overview styling', () => {
  const props = { projection, onSelectKnowledge: vi.fn() }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} />)
  const node = engine().getElementById('topic')
  const baselineBorder = node.style('border-width')
  const baselineOpacity = node.style('opacity')
  // Canvas renderer normally does this after a real pointer tap; emitting tap alone does not.
  act(() => { node.select() })
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="topic" />)
  rerender(<ObsidianKnowledgeGraph {...props} />)
  const cleared = engine().getElementById('topic')
  expect(cleared.selected(), 'closed detail must not leave stale native selection').toBe(false)
  expect(cleared.style('border-width')).toBe(baselineBorder)
  expect(cleared.style('opacity')).toBe(baselineOpacity)
})

it('clears native selection when switching nodes, including selection after the focus effect', () => {
  const props = { projection, onSelectKnowledge: vi.fn() }
  const { rerender } = render(<ObsidianKnowledgeGraph {...props} />)
  const graph = engine()
  const topic = graph.getElementById('topic')
  const other = graph.getElementById('other')
  const baselineBorder = topic.style('border-width')
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="topic" />)
  // A renderer can finish native tap selection after React has applied focus.
  act(() => { topic.select() })
  expect(topic.selected()).toBe(true)
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="other" />)
  expect(topic.selected()).toBe(false)
  expect(topic.hasClass('node--focus')).toBe(false)
  expect(topic.style('border-width')).toBe(baselineBorder)
  expect(other.hasClass('node--focus')).toBe(true)
  act(() => { other.select() })
  rerender(<ObsidianKnowledgeGraph {...props} />)
  expect(other.selected()).toBe(false)
  expect(other.hasClass('node--focus')).toBe(false)
  expect(other.style('border-width')).toBe(baselineBorder)
  expect(cytoscape).toHaveBeenCalledTimes(1)
  expect(graph.destroy).not.toHaveBeenCalled()
})

it('preserves a clicked edge when leaving node details and clears it for a new sidebar node focus', () => {
  function ControlledGraph() {
    const [focusNodeId, setFocusNodeId] = useState<string>()
    return <>
      <ObsidianKnowledgeGraph projection={projection} focusNodeId={focusNodeId} onSelectKnowledge={setFocusNodeId} onSelectEdge={() => setFocusNodeId(undefined)} />
      <button onClick={() => setFocusNodeId('other')}>Select sidebar topic</button>
    </>
  }
  render(<ControlledGraph />)
  const graph = engine()
  const node = graph.getElementById('topic')
  const edge = graph.getElementById('related')
  // Match the renderer order: tap callback first, then native tapselect.
  act(() => { node.emit('tap'); graph.elements(':selected').not(node).unselect(); node.select() })
  expect(node.hasClass('node--focus')).toBe(true)
  act(() => { edge.emit('tap'); graph.elements(':selected').not(edge).unselect(); edge.select() })
  expect(node.hasClass('node--focus')).toBe(false)
  expect(node.selected()).toBe(false)
  expect(edge.selected()).toBe(true)
  expect(edge.style('width')).toBe('2.2px')
  fireEvent.click(screen.getByRole('button', { name: 'Select sidebar topic' }))
  expect(edge.selected()).toBe(false)
  expect(graph.getElementById('other').hasClass('node--focus')).toBe(true)
  expect(cytoscape).toHaveBeenCalledTimes(1)
  expect(graph.destroy).not.toHaveBeenCalled()
})
