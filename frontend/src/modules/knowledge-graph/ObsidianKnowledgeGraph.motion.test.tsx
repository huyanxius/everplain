import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import cytoscape, { type Core } from 'cytoscape'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { KnowledgeGraphProjection } from './types'
import { ObsidianKnowledgeGraph } from './ObsidianKnowledgeGraph'

vi.mock('./graphLayout', () => ({ layoutOptions: () => ({ name: 'preset' }), fitView: vi.fn() }))
vi.mock('./graphLayoutCache', () => ({ layoutCacheKey: () => 'motion-test', readLayout: () => ({}), saveLayout: vi.fn(), positionedElements: (elements: unknown) => elements }))
vi.mock('cytoscape', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof cytoscape }>()
  return { default: vi.fn((options) => actual.default({ ...options, container: undefined, headless: true, styleEnabled: true })) }
})
const projection: KnowledgeGraphProjection = { releaseId: 'motion', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ id: 'ab', source: 'a', target: 'b', relationType: 'related', direction: 'undirected' }] }
const engine = () => vi.mocked(cytoscape).mock.results.at(-1)!.value as Core
beforeEach(() => {
  vi.mocked(cytoscape).mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  document.documentElement.style.setProperty('--qx-motion-base', '240ms')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('updates focus and deselection on the existing canvas without relayout or losing dragged coordinates', () => {
  const props = { projection, personal: true, onSelectKnowledge: vi.fn() }
  const { rerender, unmount } = render(<ObsidianKnowledgeGraph {...props} />)
  const graph = engine()
  graph.getElementById('a').position({ x: 73, y: 41 })
  rerender(<ObsidianKnowledgeGraph {...props} focusNodeId="a" />)
  expect(vi.mocked(cytoscape)).toHaveBeenCalledTimes(1)
  expect(graph.getElementById('a').hasClass('node--focus')).toBe(true)
  expect(graph.getElementById('b').hasClass('node--neighbor')).toBe(true)
  expect(graph.getElementById('c').hasClass('node--context')).toBe(true)
  rerender(<ObsidianKnowledgeGraph {...props} />)
  expect(graph.getElementById('a').hasClass('node--focus')).toBe(false)
  expect(graph.getElementById('c').hasClass('node--context')).toBe(false)
  expect(graph.getElementById('a').position()).toEqual({ x: 73, y: 41 })
  expect(vi.mocked(cytoscape)).toHaveBeenCalledTimes(1)
  unmount()
  expect(graph.destroyed()).toBe(true)
})
it('keeps direct dragging and provides grab/release feedback', () => {
  const { container } = render(<ObsidianKnowledgeGraph projection={projection} personal onSelectKnowledge={vi.fn()} />)
  const graph = engine()
  act(() => { graph.getElementById('a').emit('grab') })
  expect(graph.getElementById('a').hasClass('is-grabbed')).toBe(true)
  expect(container.querySelector<HTMLElement>('.obsidian-knowledge-graph__canvas')!.style.cursor).toBe('grabbing')
  act(() => { graph.getElementById('a').emit('free') })
  expect(graph.getElementById('a').hasClass('is-grabbed')).toBe(false)
})
it('honours reduced motion for style and button zoom', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  render(<ObsidianKnowledgeGraph projection={projection} personal onSelectKnowledge={vi.fn()} renderControls={({ zoomIn }) => <button onClick={zoomIn}>放大</button>} />)
  const graph = engine()
  const animation = vi.spyOn(graph, 'animate')
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  expect(animation).not.toHaveBeenCalled()
  expect(graph.getElementById('a').style('transition-duration')).toBe('0ms')
})
it('uses transitions in the workspace without animating node position', () => {
  render(<ObsidianKnowledgeGraph projection={projection} personal onSelectKnowledge={vi.fn()} />)
  const node = engine().getElementById('a')
  expect(node.style('transition-duration')).toBe('240ms')
  expect(node.style('transition-property')).not.toContain('position')
})
