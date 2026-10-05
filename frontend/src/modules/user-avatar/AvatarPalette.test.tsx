import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarPalette, hex2hsv, hsv2hex, SKIN, skinAt } from './AvatarPalette'
import type { UserAvatarCustom, UserAvatarId } from './avatar-data'

function Palette({ id = 'xiaoping', initial, onChange, onCommit, disabled }: { id?: UserAvatarId; initial?: UserAvatarCustom; onChange?: (custom: UserAvatarCustom) => void; onCommit?: () => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(initial)
  return <AvatarPalette id={id} custom={custom} disabled={disabled} onCommit={onCommit} onChange={next => { setCustom(next); onChange?.(next) }} />
}
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly isPrimary: boolean
  constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true }
}
function bounds(element: HTMLElement) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, top: 20, left: 10, right: 110, bottom: 120, width: 100, height: 100, toJSON() {} })
}
beforeEach(() => { vi.stubGlobal('PointerEvent', TestPointerEvent) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('prototype color math', () => {
  it('round trips the original swatches and primary/achromatic colors', () => {
    for (const color of [...SKIN, '#e6d8c5', '#66728a', '#3a3330', '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000']) expect(hsv2hex(...hex2hsv(color))).toBe(color)
    expect(hsv2hex(360, 1, 1)).toBe('#ff0000')
  })
  it('limits skin picking to the seven-stop band', () => {
    expect(skinAt(-1)).toBe(SKIN[0]); expect(skinAt(2)).toBe(SKIN[6])
    for (let i = 0; i < SKIN.length; i++) expect(skinAt(i / 6)).toBe(SKIN[i])
    expect(skinAt(.75)).toBe('#c99777')
  })
})
describe('AvatarPalette', () => {
  it('uses each character original colors and selects the original swatch', () => {
    const { container } = render(<Palette id="cat" />)
    expect(screen.getByRole('button', { name: '原样' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#E6E3DE')
    fireEvent.click(screen.getByRole('button', { name: '肤色' }))
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#D8A988')
    expect(screen.getByRole('slider', { name: '肤色带' })).toHaveAttribute('aria-valuenow', '67')
  })
  it('slides the pill and never offers free hue on the skin tab', () => {
    const { container } = render(<Palette />)
    fireEvent.click(screen.getByRole('button', { name: '肤色' }))
    expect(container.querySelector('.cz-tabs')).toHaveStyle('--i: 1')
    expect(container.querySelector('.cz-picker')).toHaveClass('swap')
    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(container.querySelector('.cz-sv')).toBeNull(); expect(container.querySelector('.cz-hue')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '衣服' }))
    expect(container.querySelector('.cz-tabs')).toHaveStyle('--i: 2')
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })
  it('commits a color and restores only the active field', () => {
    const onChange = vi.fn(), onCommit = vi.fn()
    render(<Palette initial={{ skin: '#d8a988', sleeve: '#2f2f33', blush: false }} onChange={onChange} onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: '#c9a0a8' }))
    expect(onChange).toHaveBeenLastCalledWith({ skin: '#d8a988', sleeve: '#2f2f33', blush: false, hair: '#c9a0a8' })
    expect(screen.getByRole('button', { name: '#c9a0a8' })).toHaveAttribute('aria-pressed', 'true')
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '原样' }))
    expect(onChange).toHaveBeenLastCalledWith({ skin: '#d8a988', sleeve: '#2f2f33', blush: false })
    expect(screen.getByRole('button', { name: '原样' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('toggles blush off and then restores the omitted original flag', () => {
    const onChange = vi.fn(); render(<Palette initial={{ hair: '#3a3330' }} onChange={onChange} />)
    const blush = screen.getByRole('switch', { name: '腮红' })
    fireEvent.click(blush)
    expect(onChange).toHaveBeenLastCalledWith({ hair: '#3a3330', blush: false })
    expect(blush).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(blush)
    expect(onChange).toHaveBeenLastCalledWith({ hair: '#3a3330' })
    expect(blush).toHaveAttribute('aria-checked', 'true')
  })
  it('updates through an SV drag, clamps its bounds, and pulses once on release', () => {
    const onChange = vi.fn(), onCommit = vi.fn()
    const { container } = render(<Palette initial={{ hair: '#ff0000' }} onChange={onChange} onCommit={onCommit} />)
    const field = screen.getByRole('slider', { name: '发色饱和度与明度' }); bounds(field)
    fireEvent.pointerDown(field, { pointerId: 3, clientX: 110, clientY: 70, button: 0 })
    expect(field).toHaveClass('dragging'); expect(onChange).toHaveBeenLastCalledWith({ hair: '#800000' })
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#800000'); expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerMove(field, { pointerId: 9, clientX: 10, clientY: 20 }); expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(field, { pointerId: 3, clientX: -20, clientY: -40 }); expect(onChange).toHaveBeenLastCalledWith({ hair: '#ffffff' })
    fireEvent.pointerUp(field, { pointerId: 3 }); expect(field).not.toHaveClass('dragging'); expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(field, { pointerId: 3 }); expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('retains chosen hue for gray hair through a drag and updates the SV spectrum', () => {
    const { container } = render(<Palette initial={{ hair: '#808080' }} />)
    const hue = screen.getByRole('slider', { name: '发色色相' }); bounds(hue)
    fireEvent.pointerDown(hue, { pointerId: 2, clientX: 60, clientY: 20 })
    expect(hue).toHaveAttribute('aria-valuenow', '180')
    expect(container.querySelector('.cz-body')?.getAttribute('style')).toContain('hsl(180 100% 50%)')
    fireEvent.pointerUp(hue, { pointerId: 2 })
    const sv = screen.getByRole('slider', { name: '发色饱和度与明度' }); bounds(sv)
    fireEvent.pointerDown(sv, { pointerId: 2, clientX: 110, clientY: 20 })
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#00FFFF')
  })
  it('cancels an active skin drag cleanly while retaining the applied color', () => {
    const onChange = vi.fn(), onCommit = vi.fn(); render(<Palette onChange={onChange} onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: '肤色' }))
    const field = screen.getByRole('slider', { name: '肤色带' }); bounds(field)
    fireEvent.pointerDown(field, { pointerId: 4, clientX: 110, clientY: 20 })
    expect(onChange).toHaveBeenLastCalledWith({ skin: '#8d5d45' })
    fireEvent.pointerCancel(field, { pointerId: 4 }); expect(field).not.toHaveClass('dragging'); expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('supports keyboard color adjustment', () => {
    const onChange = vi.fn(); render(<Palette initial={{ hair: '#ff0000' }} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('slider', { name: '发色饱和度与明度' }), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith({ hair: '#fc0000' })
    fireEvent.click(screen.getByRole('button', { name: '肤色' }))
    fireEvent.keyDown(screen.getByRole('slider', { name: '肤色带' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith({ hair: '#fc0000', skin: '#8d5d45' })
  })
  it('never edits a disabled palette', () => {
    const onChange = vi.fn(), onCommit = vi.fn(); render(<Palette disabled onChange={onChange} onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: '#c9a0a8' })); fireEvent.click(screen.getByRole('switch', { name: '腮红' }))
    const field = screen.getByRole('slider', { name: '发色饱和度与明度' }); bounds(field)
    fireEvent.pointerDown(field, { pointerId: 3, clientX: 90, clientY: 80 }); fireEvent.keyDown(field, { key: 'End' })
    expect(field).toHaveAttribute('tabindex', '-1'); expect(onChange).not.toHaveBeenCalled(); expect(onCommit).not.toHaveBeenCalled()
  })
  it('abandons captured pointer updates when the selected character changes', () => {
    const onChange = vi.fn(), onCommit = vi.fn()
    const { rerender } = render(<AvatarPalette id="xiaoping" onChange={onChange} onCommit={onCommit} />)
    const field = screen.getByRole('slider', { name: '发色饱和度与明度' }); bounds(field)
    fireEvent.pointerDown(field, { pointerId: 8, clientX: 90, clientY: 60 })
    expect(field).toHaveClass('dragging')
    rerender(<AvatarPalette id="mo" onChange={onChange} onCommit={onCommit} />)
    expect(field).not.toHaveClass('dragging')
    const calls = onChange.mock.calls.length
    fireEvent.pointerMove(field, { pointerId: 8, clientX: 110, clientY: 20 })
    fireEvent.pointerUp(field, { pointerId: 8 })
    expect(onChange).toHaveBeenCalledTimes(calls)
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('syncs external resets and changes of character', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<AvatarPalette id="xiaoping" custom={{ hair: '#123456' }} onChange={onChange} />)
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#123456')
    rerender(<AvatarPalette id="xiaoping" custom={{}} onChange={onChange} />)
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#E6D8C5')
    rerender(<AvatarPalette id="mo" onChange={onChange} />)
    expect(container.querySelector('.cz-hex code')).toHaveTextContent('#3A3330')
  })
})
