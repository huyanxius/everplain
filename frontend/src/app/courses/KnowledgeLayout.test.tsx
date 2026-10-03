import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeGraphControls } from './KnowledgeLayout'

afterEach(cleanup)
it('keeps zoom, fit and relayout available through the new graph controls', () => {
  const controls = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn(), relayout: vi.fn() }
  const { container } = render(<KnowledgeGraphControls controls={controls} />)
  for (const [label, callback] of [['放大', controls.zoomIn], ['缩小', controls.zoomOut], ['适应画布', controls.fit], ['重新布局', controls.relayout]] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(callback).toHaveBeenCalledOnce()
  }
  expect(container.querySelector('.obsidian-knowledge-graph__controls')).not.toBeInTheDocument()
})
