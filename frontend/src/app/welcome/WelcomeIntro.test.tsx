import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeIntro } from './WelcomeIntro'

let animate: ReturnType<typeof vi.fn>
const cancel = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  animate = vi.fn(() => ({ cancel }))
  cancel.mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})
function show(enabled = true) {
  return render(<main className="setup-flow"><section className="setup-avatars--companions">{Array.from({ length: 7 }, (_, index) => <button key={index} type="button" aria-label={`伙伴 ${index + 1}`}><svg style={{ width: 64, height: 64 }} /></button>)}</section><WelcomeIntro userId="owner" enabled={enabled} /></main>)
}

describe('original welcome opening', () => {
  it('uses the original ink, spread and flight timing and the actual picker rectangles', async () => {
    const view = show()
    const targets = view.container.querySelectorAll<SVGSVGElement>('.setup-avatars--companions svg')
    targets.forEach((target, index) => { target.getBoundingClientRect = () => ({ left: index * 80 + 10, top: 200, width: 64, height: 64 } as DOMRect) })
    expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ offset: .42 }), expect.objectContaining({ offset: .66 })]), { duration: 1050, fill: 'forwards' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1050 + 300 + 1500) })
    const flights = animate.mock.calls.filter(([, options]) => options.duration === 800)
    expect(flights).toHaveLength(7)
    expect(flights[0][0][1].transform).toBe('translate(6px,196px) scale(0.8888888888888888)')
    expect(flights[6][1]).toMatchObject({ duration: 800, delay: 210, easing: 'cubic-bezier(.65,0,.25,1)' })
    await act(async () => { await vi.advanceTimersByTimeAsync(800 + 7 * 35 + 500) })
    expect(screen.queryByRole('button', { name: '跳过开场动画' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('everplain:welcome-intro:owner')).toBe('seen')
  })

  it('skips on a click anywhere and cancels remaining animations after the original fade', async () => {
    const view = show()
    fireEvent.click(screen.getByRole('button', { name: '跳过开场动画' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(cancel).toHaveBeenCalled()
    expect(view.container.querySelector('main')).not.toHaveClass('setup-flow--intro-hidden')
    expect(screen.queryByRole('button', { name: '跳过开场动画' })).not.toBeInTheDocument()
  })

  it('skips immediately without running animation under reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    show()
    expect(animate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '跳过开场动画' })).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(animate).not.toHaveBeenCalled()
  })

  it('supports keyboard skipping and does not replay within the same session', () => {
    const first = show()
    fireEvent.keyDown(screen.getByRole('button', { name: '跳过开场动画' }), { key: 'Escape' })
    first.unmount()
    show()
    expect(animate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '跳过开场动画' })).not.toBeInTheDocument()
  })

  it('cleans pending timers when the setup route is interrupted', async () => {
    const view = show()
    view.unmount()
    expect(cancel).toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('does not open for a resumed or completed journey', () => {
    show(false)
    expect(animate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '跳过开场动画' })).not.toBeInTheDocument()
  })
})
