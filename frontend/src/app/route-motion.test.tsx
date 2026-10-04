import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router'

import { RouteMotionSurface } from './route-motion'

function MotionFixture({ identityKey }: { identityKey?: string } = {}) {
  return (
    <>
      <Link to="/app">工作台</Link>
      <Link to="/agent">研究 Agent</Link>
      <Link to="/agent?conversation=recent">最近对话</Link>
      <Link to="/agent#composer">输入框</Link>
      <Link to="/research/new">研究画布</Link>
      <Link to="/research/materials">研究列表</Link>
      <Link to="/settings">设置</Link>
      <Link to="/research/task-1/match">文档节点</Link>
      <RouteMotionSurface identityKey={identityKey}>
        <Routes>
          <Route path="/app" element={<main className="application-frame__main">工作台页面</main>} />
          <Route path="/agent" element={<main className="application-frame__main">Agent 页面</main>} />
          <Route path="/settings" element={<main>设置</main>} />
          <Route path="/research/materials" element={<main className="application-frame__main">研究列表页面</main>} />
          <Route path="/research/new" element={<main className="application-frame__main">研究画布</main>} />
          <Route path="/research/task-1/match" element={<main className="application-frame__main">文档节点</main>} />
        </Routes>
      </RouteMotionSurface>
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

describe('RouteMotionSurface', () => {
  it('keeps vertical navigation direction through StrictMode double renders', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/app']}>
          <MotionFixture />
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionDirection).toBe('forward')

    fireEvent.click(screen.getByRole('link', { name: '工作台' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionDirection).toBe('backward')
  })

  it.each(['最近对话', '输入框'])('does not activate motion for an isolated %s navigation', (link) => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/agent']}>
          <MotionFixture />
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('link', { name: link }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
  })

  it('lets an in-flight pathname transition finish when the destination writes query state', () => {
    vi.useFakeTimers()
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/app']}>
          <MotionFixture />
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
    fireEvent.click(screen.getByRole('link', { name: '最近对话' }))

    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('true')
    expect(screen.getByTestId('route-motion-surface').dataset.motionDirection).toBe('forward')

    act(() => vi.advanceTimersByTime(240))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('true')
    act(() => vi.advanceTimersByTime(60))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
  })

  it('keeps research stages visually on the same canvas', () => {
    render(
      <MemoryRouter initialEntries={['/research/new']}>
        <MotionFixture />
      </MemoryRouter>,
    )

    const surface = screen.getByTestId('route-motion-surface')
    fireEvent.click(screen.getByRole('link', { name: '文档节点' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
    expect(screen.getByTestId('route-motion-surface')).toBe(surface)
  })
})

it('restarts the real content animation on rapid navigation without changing the surface identity', () => {
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const { unmount } = render(<MemoryRouter initialEntries={['/app']}><MotionFixture /></MemoryRouter>)
  const surface = screen.getByTestId('route-motion-surface')
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  fireEvent.click(screen.getByRole('link', { name: '工作台' }))
  expect(animate).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('route-motion-surface')).toBe(surface)
  unmount()
  expect(cancel).toHaveBeenCalledTimes(2)
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})


function trackAnimation() {
  const cancel = vi.fn()
  const animate = vi.fn(function (this: HTMLElement) { return { cancel } })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  return { animate, cancel }
}

it('animates actual main content with a perceptible fade, leaving the sidebar and fixed-position geometry alone', () => {
  const { animate } = trackAnimation()
  render(<MemoryRouter initialEntries={['/app']}><MotionFixture /></MemoryRouter>)
  expect(animate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  expect(animate.mock.instances[0]).toBe(screen.getByRole('main'))
  expect(animate).toHaveBeenCalledWith([{ opacity: .58 }, { opacity: 1 }], {
    duration: 300, easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
  })
})

it('uses the same theme-derived duration for animation and completion instead of cancelling at 240ms', () => {
  vi.useFakeTimers()
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => name === '--qx-motion-base' ? '0.4s' : '' }))
  const { animate, cancel } = trackAnimation()
  render(<MemoryRouter initialEntries={['/app']}><MotionFixture /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  expect(animate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 500 }))
  act(() => vi.advanceTimersByTime(499))
  expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('true')
  expect(cancel).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('animates navigation from the research list to a new research page', () => {
  const { animate } = trackAnimation()
  render(<MemoryRouter initialEntries={['/research/materials']}><MotionFixture /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '研究画布' }))
  expect(animate).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('true')
})

it('leaves the settings background stationary on entry and return', () => {
  const { animate } = trackAnimation()
  render(<MemoryRouter initialEntries={['/agent']}><MotionFixture /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '设置' }))
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  expect(animate).not.toHaveBeenCalled()
})

it('immediately cancels an in-flight fade on account identity change without remounting its surface', () => {
  const { animate, cancel } = trackAnimation()
  const view = render(<MemoryRouter initialEntries={['/app']}><MotionFixture identityKey="account-a" /></MemoryRouter>)
  const surface = screen.getByTestId('route-motion-surface')
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  view.rerender(<MemoryRouter initialEntries={['/app']}><MotionFixture identityKey="account-b" /></MemoryRouter>)
  expect(animate).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('route-motion-surface')).toBe(surface)
  expect(surface.dataset.motionActive).toBe('false')
})

it.each([false, true])('respects reduced motion initially and when it becomes enabled (%s)', (initiallyReduced) => {
  const listeners = new Set<() => void>()
  const media = { matches: initiallyReduced, addEventListener: (_name: string, listener: () => void) => listeners.add(listener), removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener) }
  vi.stubGlobal('matchMedia', () => media)
  const { animate, cancel } = trackAnimation()
  render(<MemoryRouter initialEntries={['/app']}><MotionFixture /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))
  if (initiallyReduced) expect(animate).not.toHaveBeenCalled()
  else {
    expect(animate).toHaveBeenCalledTimes(1)
    act(() => { media.matches = true; listeners.forEach(listener => listener()) })
    expect(cancel).toHaveBeenCalledTimes(1)
  }
  expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
})
