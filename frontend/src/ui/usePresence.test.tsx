import { StrictMode, useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnimatedDismiss, usePresence } from './usePresence'

let reduced = false
let notifyPreference: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_event: string, listener: () => void) => { notifyPreference = listener }, removeEventListener: vi.fn() }))
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => ({
    transitionProperty: 'opacity, transform', transitionDuration: element.getAttribute('data-presence') === 'closing' ? '.14s, .14s' : '.24s, .24s', transitionDelay: '0s',
  }) as CSSStyleDeclaration)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function Fixture() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const motion = usePresence(open, ref)
  return <><button onClick={() => setOpen(value => !value)}>toggle</button>{motion.present && <div ref={ref} data-testid="surface" {...motion.props}><input defaultValue="draft" /></div>}</>
}
function end(element: Element, propertyName = 'opacity', pseudoElement = '') {
  const event = new Event('transitionend', { bubbles: true })
  Object.assign(event, { propertyName, pseudoElement })
  fireEvent(element, event)
}

describe('surface presence', () => {
  it('waits for its own opacity exit and makes closing content inert', () => {
    render(<StrictMode><Fixture /></StrictMode>)
    fireEvent.click(screen.getByText('toggle'))
    const surface = screen.getByTestId('surface')
    fireEvent.click(screen.getByText('toggle'))
    expect(surface).toHaveAttribute('inert')
    expect(surface).toHaveAttribute('aria-hidden', 'true')
    end(surface.firstElementChild!)
    end(surface, 'transform')
    end(surface, 'opacity', '::backdrop')
    expect(surface).toBeInTheDocument()
    end(surface)
    expect(surface).not.toBeInTheDocument()
  })
  it('cancels old dismissal on a rapid reopen without remounting the draft', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByText('toggle'))
    const surface = screen.getByTestId('surface')
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'unsaved' } })
    fireEvent.click(screen.getByText('toggle'))
    act(() => vi.advanceTimersByTime(60))
    fireEvent.click(screen.getByText('toggle'))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('surface')).toBe(surface)
    expect(input).toHaveValue('unsaved')
    expect(surface).not.toHaveAttribute('inert')
  })
  it('uses a bounded fallback when the browser never dispatches transitionend', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    act(() => vi.advanceTimersByTime(189))
    expect(screen.getByTestId('surface')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId('surface')).not.toBeInTheDocument()
  })
  it('finishes an in-flight exit when reduced motion is enabled', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    act(() => { reduced = true; notifyPreference?.() })
    expect(screen.queryByTestId('surface')).not.toBeInTheDocument()
  })
  it('does not retain surfaces without a motion stylesheet', () => {
    vi.mocked(window.getComputedStyle).mockReturnValue({ transitionProperty: '', transitionDuration: '', transitionDelay: '' } as CSSStyleDeclaration)
    render(<Fixture />)
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.queryByTestId('surface')).not.toBeInTheDocument()
  })
  it('cleans up an exit timer on owner teardown', () => {
    const { unmount } = render(<Fixture />)
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('coalesces repeated dismissal requests and calls the latest owner once', () => {
  const onDismiss = vi.fn()
  const latest = vi.fn()
  function Mounted({ close }: { close: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const motion = useAnimatedDismiss(ref, close)
    return <div ref={ref} data-testid="surface" {...motion.props}><button onClick={motion.dismiss}>close</button></div>
  }
  const { rerender } = render(<Mounted close={onDismiss} />)
  fireEvent.click(screen.getByText('close'))
  fireEvent.click(screen.getByText('close'))
  rerender(<Mounted close={latest} />)
  end(screen.getByTestId('surface'))
  expect(onDismiss).not.toHaveBeenCalled()
  expect(latest).toHaveBeenCalledOnce()
  act(() => vi.advanceTimersByTime(1000))
  expect(latest).toHaveBeenCalledOnce()
})

it('discards a retained surface immediately when its account/conversation scope changes', () => {
  function Scoped({ open, scope }: { open: boolean; scope: string }) {
    const ref = useRef<HTMLDivElement>(null)
    const motion = usePresence(open, ref, scope)
    return motion.present && <div ref={ref} data-testid="scope-surface" {...motion.props}>{scope}</div>
  }
  const { rerender } = render(<Scoped open scope="account-a" />)
  rerender(<Scoped open={false} scope="account-a" />)
  expect(screen.getByTestId('scope-surface')).toHaveTextContent('account-a')
  rerender(<Scoped open={false} scope="account-b" />)
  expect(screen.queryByTestId('scope-surface')).not.toBeInTheDocument()
  expect(vi.getTimerCount()).toBe(0)
})

it('prevents a native dialog cancel from closing the top layer before the owner exit', () => {
 function Mounted() {
  const ref = useRef<HTMLDialogElement>(null)
  const motion = useAnimatedDismiss(ref, () => {})
  return <dialog ref={ref} data-testid="native-surface" {...motion.props} />
 }
 render(<Mounted />)
 const event = new Event('cancel', { cancelable: true, bubbles: false })
 screen.getByTestId('native-surface').dispatchEvent(event)
 expect(event.defaultPrevented).toBe(true)
})
