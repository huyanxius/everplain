import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampWritingPanel, useWritingPanelWidth } from './useWritingPanelWidth'

function Panel({ userId = 'u1' }: { userId?: string }) {
  const panel = useWritingPanelWidth(userId)
  return <div ref={panel.layoutRef}><div role="separator" tabIndex={0} aria-label="调整宽度" {...panel.separatorProps} /></div>
}
beforeEach(() => { localStorage.clear(); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, right: 1000 } as DOMRect) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('bounded writing rail', () => {
  it('starts narrow and uses keyboard bounds with persisted sizing', () => {
    const view = render(<Panel />); const separator = screen.getByRole('separator')
    expect(separator).toHaveAttribute('aria-valuenow', '320')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' }); expect(separator).toHaveAttribute('aria-valuenow', '336')
    fireEvent.keyDown(separator, { key: 'End' }); expect(separator).toHaveAttribute('aria-valuenow', '520')
    fireEvent.keyDown(separator, { key: 'Home' }); expect(separator).toHaveAttribute('aria-valuenow', '280')
    view.unmount(); render(<Panel />); expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '280')
    fireEvent.doubleClick(screen.getByRole('separator')); expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '320')
  })
  it('clamps to available editor space without destroying a preferred wider size', () => {
    render(<Panel />); fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' })
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 700, right: 700 } as DOMRect)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '292')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuemax', '292')
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 1000, right: 1000 } as DOMRect)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '520')
  })
  it('handles dragging, cancellation and stored corrupt values safely', () => {
    class Pointer extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
    vi.stubGlobal('PointerEvent', Pointer)
    localStorage.setItem('everplain.writing.agent-width.v1:u1', 'not-a-size')
    render(<Panel />); const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 600, button: 0 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 520 }); expect(separator).toHaveAttribute('aria-valuenow', '400')
    fireEvent.pointerCancel(separator, { pointerId: 1 }); expect(separator).toHaveAttribute('aria-valuenow', '320')
    fireEvent.pointerDown(separator, { pointerId: 2, clientX: 600, button: 0 })
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 100 }); fireEvent.pointerUp(separator, { pointerId: 2 })
    expect(separator).toHaveAttribute('aria-valuenow', '520')
    expect(localStorage.getItem('everplain.writing.agent-width.v1:u1')).toBe('520')
  })
  it('stays narrow when dragging beyond the minimum, then widens and persists repeated drags', () => {
    class Pointer extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
    vi.stubGlobal('PointerEvent', Pointer)
    const view = render(<Panel />); const separator = screen.getByRole('separator')
    for (const [id, target, expected] of [[1, 900, 280], [2, 400, 480], [3, 1200, 280]]) {
      fireEvent.pointerDown(separator, { pointerId: id, clientX: 600, button: 0 })
      fireEvent.pointerMove(separator, { pointerId: id, clientX: target })
      fireEvent.pointerUp(separator, { pointerId: id })
      expect(separator).toHaveAttribute('aria-valuenow', String(expected))
    }
    view.unmount(); render(<Panel />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '280')
  })
  it('fits even a container narrower than the normal minimum without losing the preference', () => {
    render(<Panel />)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 200, right: 200 } as DOMRect)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '192')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuemin', '192')
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 1000, right: 1000 } as DOMRect)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '320')
  })
  it('rejects nonfinite values and never exceeds the panel bounds', () => {
    expect(clampWritingPanel(Number.NaN)).toBe(320)
    expect(clampWritingPanel(9999)).toBe(520)
    expect(clampWritingPanel(-99)).toBe(280)
    expect(clampWritingPanel(520, 700)).toBe(292)
    expect(clampWritingPanel(520, 200)).toBe(192)
  })
})
