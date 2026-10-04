import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeGraphControls } from './KnowledgeLayout'

afterEach(cleanup)
it('keeps zoom and relayout while the corner button enters real fullscreen', () => {
  const controls = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn(), relayout: vi.fn(), enterFullscreen: vi.fn() }
  const { container } = render(<KnowledgeGraphControls controls={controls} />)
  for (const [label, callback] of [['放大', controls.zoomIn], ['缩小', controls.zoomOut], ['进入全屏', controls.enterFullscreen], ['重新布局', controls.relayout]] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(callback).toHaveBeenCalledOnce()
  }
  expect(controls.fit).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '适应画布' })).not.toBeInTheDocument()
  expect(container.querySelector('.obsidian-knowledge-graph__controls')).not.toBeInTheDocument()
})
