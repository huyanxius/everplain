import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarCustomizer } from './AvatarCustomizer'
import type { UserAvatarCustom } from './avatar-data'
vi.mock('./UserAvatar', () => ({ UserAvatar: ({ id, custom, variant, size }: { id: string; custom?: UserAvatarCustom; variant: string; size: number }) => <svg data-avatar-id={id} data-variant={variant} width={size} data-custom={JSON.stringify(custom)} /> }))
function Customizer({ onClose, onChange, initial = {} }: { onClose: () => void; onChange?: (custom: UserAvatarCustom) => void; initial?: UserAvatarCustom }) {
  const [open, setOpen] = useState(true), [custom, setCustom] = useState(initial)
  return open ? <AvatarCustomizer id="xiaoping" custom={custom} onChange={next => { setCustom(next); onChange?.(next) }} onClose={() => { setOpen(false); onClose() }} /> : null
}
function motion(matches: boolean) { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) }
beforeEach(() => {
  vi.useFakeTimers(); motion(false)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: function () { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value: function () { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('AvatarCustomizer', () => {
  it('opens a named native dialog in a portal with the original resting figure', () => {
    const { container } = render(<Customizer onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '定制外观' })
    expect(container).toBeEmptyDOMElement(); expect(dialog).toHaveAttribute('open'); expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.querySelector('svg')).toHaveAttribute('data-variant', 'resting'); expect(dialog.querySelector('svg')).toHaveAttribute('width', '380')
    expect(document.body.style.overflow).toBe('hidden')
  })
  it('applies colors immediately, pulses, and restores every override', () => {
    const onChange = vi.fn()
    render(<Customizer onClose={vi.fn()} onChange={onChange} initial={{ hair: '#123456', skin: '#d8a988', sleeve: '#2f2f33', blush: false }} />)
    fireEvent.click(screen.getByRole('button', { name: '#c9a0a8' }))
    expect(onChange).toHaveBeenLastCalledWith({ hair: '#c9a0a8', skin: '#d8a988', sleeve: '#2f2f33', blush: false })
    expect(document.querySelector('.cz-fig')).toHaveClass('pulse'); expect(document.querySelector('.cz-fig svg')?.getAttribute('data-custom')).toContain('#c9a0a8')
    fireEvent.click(screen.getByRole('button', { name: '恢复原样' }))
    expect(onChange).toHaveBeenLastCalledWith({}); expect(document.querySelector('.cz-fig svg')).toHaveAttribute('data-custom', '{}')
  })
  it('keeps the .38s Escape exit and guards repeated dismissal', () => {
    const onClose = vi.fn(); render(<Customizer onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '定制外观' })
    fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toHaveClass('out'); expect(dialog).toHaveAttribute('inert'); expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(379)); expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1)); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('prevents instant native cancellation and waits for the same exit', () => {
    const onClose = vi.fn(); render(<Customizer onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '定制外观' }), event = new Event('cancel', { cancelable: true })
    fireEvent(dialog, event)
    expect(event.defaultPrevented).toBe(true); expect(dialog).toHaveClass('out'); expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(380)); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('skips the wait for reduced motion', () => {
    motion(true); const onClose = vi.fn(); render(<Customizer onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '好了' }))
    expect(onClose).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('restores focus and scroll and cancels timers on teardown', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus(); document.body.style.overflow = 'auto'
    const onClose = vi.fn(), { unmount } = render(<Customizer onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '好了' })); unmount()
    expect(document.body.style.overflow).toBe('auto'); expect(document.activeElement).toBe(trigger)
    act(() => vi.advanceTimersByTime(380)); expect(onClose).not.toHaveBeenCalled()
    trigger.remove(); document.body.style.overflow = ''
  })
})
