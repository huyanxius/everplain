import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianKnowledgeGraph } from './ObsidianKnowledgeGraph'

afterEach(cleanup)
const projection = { releaseId: 'controls-test', nodes: [], edges: [] }
it('retains the existing controls by default for other graph consumers', () => {
  const { container } = render(<ObsidianKnowledgeGraph projection={projection} onSelectKnowledge={vi.fn()} variant="preview" />)
  expect(container.querySelector('.obsidian-knowledge-graph__controls')).toBeInTheDocument()
  expect(screen.getByText('0 节点 · 0 关系')).toBeInTheDocument()
  expect(screen.getByText('自动巡游 · 移入接管')).toBeInTheDocument()
})
it('lets application views replace the controls without changing the canvas engine', () => {
  const { container } = render(<ObsidianKnowledgeGraph personal projection={projection} onSelectKnowledge={vi.fn()} renderControls={({ zoomIn, zoomOut, fit, relayout }) => <nav aria-label="新图谱控件"><button onClick={zoomIn}>放大</button><button onClick={zoomOut}>缩小</button><button onClick={fit}>适应画布</button><button onClick={relayout}>重新布局</button></nav>} />)
  expect(container.querySelector('.obsidian-knowledge-graph__controls')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Obsidian 式节点知识图谱' })).toBeInTheDocument()
  for (const label of ['放大', '缩小', '适应画布', '重新布局']) fireEvent.click(screen.getByRole('button', { name: label }))
})
