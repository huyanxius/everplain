import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDrawerPresence } from './useDrawerPresence'

type HarnessProps = { open: boolean; enabled?: boolean; scopeKey?: string; property?: string; duration?: string; delay?: string; onDismiss?: () => void }
function Harness({ open, enabled = true, scopeKey = 'account-a', property = 'transform', duration = '240ms', delay = '0s', onDismiss = () => undefined }: HarnessProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const motion = useDrawerPresence({ open, enabled, scopeKey, drawerRef, triggerRef, onDismiss })
  return <>
    <div data-testid="body" inert={motion.present}><button ref={triggerRef}>Open</button><button>Outside</button></div>
    <aside ref={drawerRef} data-testid="drawer" data-open={motion.open} data-present={motion.present} aria-hidden={!motion.present} inert={!motion.present}
      style={{ transitionProperty: property, transitionDuration: duration, transitionDelay: delay }}>
      <button data-close-drawer>Close</button><button>Last</button>
    </aside>
  </>
}

function transitionEnd(target: Element, propertyName = 'transform', pseudoElement = '') {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperties(event, { propertyName: { value: propertyName }, pseudoElement: { value: pseudoElement } })
  fireEvent(target, event)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

describe('mobile drawer presence', () => {
  it('retains modal ownership until its own transform ends and restores the trusted opener once', () => {
    const view = render(<Harness open />)
    const drawer = screen.getByTestId('drawer')
    const close = screen.getByRole('button', { name: 'Close' })
    const trigger = screen.getByText('Open')
    const focus = vi.spyOn(trigger, 'focus')
    expect(close).toHaveFocus()
    view.rerender(<Harness open={false} />)
    expect(drawer).toHaveAttribute('data-open', 'false')
    expect(drawer).toHaveAttribute('data-present', 'true')
    expect(drawer).not.toHaveAttribute('inert')
    expect(screen.getByTestId('body')).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    transitionEnd(drawer, 'opacity')
    transitionEnd(close)
    transitionEnd(drawer, 'transform', '::before')
    expect(drawer).toHaveAttribute('data-present', 'true')
    expect(focus).not.toHaveBeenCalled()
    transitionEnd(drawer)
    expect(drawer).toHaveAttribute('inert')
    expect(screen.getByTestId('body')).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
    act(() => vi.runAllTimers())
    transitionEnd(drawer)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('uses only the transform duration and its corresponding delay for the missing-event fallback', () => {
    const props = { property: 'opacity, transform', duration: '1s, 240ms', delay: '200ms, 10ms' }
    const view = render(<Harness open {...props} />)
    view.rerender(<Harness open={false} {...props} />)
    act(() => vi.advanceTimersByTime(249))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'true')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'false')
  })

  it('cancels old teardown on reversal without restoring or resetting focus', () => {
    const view = render(<Harness open />)
    const trigger = screen.getByText('Open')
    const focus = vi.spyOn(trigger, 'focus')
    view.rerender(<Harness open={false} />)
    act(() => vi.advanceTimersByTime(70))
    view.rerender(<Harness open />)
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(focus).not.toHaveBeenCalled()
    view.rerender(<Harness open={false} />)
    transitionEnd(screen.getByTestId('drawer'))
    expect(trigger).toHaveFocus()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it.each(['none', 'opacity'])('closes immediately if CSS has no transform transition (%s)', property => {
    const view = render(<Harness open property={property} />)
    view.rerender(<Harness open={false} property={property} />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'false')
    expect(document.body.style.overflow).toBe('')
  })

  it('finishes immediately when reduced motion is requested during closing', () => {
    const listeners = new Set<() => void>()
    const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
    vi.stubGlobal('matchMedia', () => media)
    const view = render(<Harness open />)
    view.rerender(<Harness open={false} />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'true')
    act(() => { media.matches = true; listeners.forEach(listener => listener()) })
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'false')
    expect(screen.getByText('Open')).toHaveFocus()
  })

  it('tears down immediately on breakpoint or immersive changes without focusing a hidden trigger', () => {
    document.body.style.overflow = 'clip'
    const view = render(<Harness open />)
    const focus = vi.spyOn(screen.getByText('Open'), 'focus')
    view.rerender(<Harness open={false} />)
    view.rerender(<Harness open={false} enabled={false} />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'false')
    expect(document.body.style.overflow).toBe('clip')
    act(() => vi.runAllTimers())
    expect(focus).not.toHaveBeenCalled()
  })

  it('discards presence on account replacement and blocks the old open request', () => {
    const view = render(<Harness open />)
    const focus = vi.spyOn(screen.getByText('Open'), 'focus')
    view.rerender(<Harness open scopeKey="account-b" />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'false')
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-open', 'false')
    expect(document.body.style.overflow).toBe('')
    expect(focus).not.toHaveBeenCalled()
    view.rerender(<Harness open={false} scopeKey="account-b" />)
    view.rerender(<Harness open scopeKey="account-b" />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-present', 'true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps the keyboard loop and Escape ownership during closing', () => {
    const onDismiss = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList)
    const view = render(<Harness open onDismiss={onDismiss} />)
    view.rerender(<Harness open={false} onDismiss={onDismiss} />)
    const first = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last' })
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus moved elsewhere and always restores the prior scroll style on unmount', () => {
    document.body.style.overflow = 'auto'
    const view = render(<Harness open />)
    const trigger = screen.getByText('Open')
    const focus = vi.spyOn(trigger, 'focus')
    view.rerender(<Harness open={false} />)
    screen.getByText('Outside').focus()
    transitionEnd(screen.getByTestId('drawer'))
    expect(focus).not.toHaveBeenCalled()
    view.rerender(<Harness open />)
    view.unmount()
    expect(document.body.style.overflow).toBe('auto')
    act(() => vi.runAllTimers())
  })
})
