import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UserAvatar } from './UserAvatar'
import { PEOPLE } from './avatar-data'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('renders all six original heads and keeps arm/effect layers for resting', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  for (const p of PEOPLE) {
    const view = render(<UserAvatar id={p.id} variant="head" />)
    expect(view.container.querySelector('svg')).toHaveAttribute('viewBox', '12 10 176 176')
    expect(view.container.querySelector('.cp-arms')).toBeNull()
    view.rerender(<UserAvatar id={p.id} variant="resting" />)
    expect(view.container.querySelector('.cp-arms')).not.toBeNull()
    expect(view.container.querySelector('svg')).toHaveClass('user-avatar')
    view.unmount()
  }
})
it('isolates every gradient, clip path and filter between avatar instances', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<><UserAvatar id="cat" variant="resting" /><UserAvatar id="mo" variant="head" /></>)
  const ids = [...view.container.querySelectorAll('[id]')].map(el => el.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const svg of view.container.querySelectorAll('svg')) {
    const own = new Set([...svg.querySelectorAll('[id]')].map(el => el.id))
    for (const el of svg.querySelectorAll('[fill],[clip-path]')) {
      for (const value of [el.getAttribute('fill'), el.getAttribute('clip-path')]) {
        if (value?.startsWith('url(#')) expect(own.has(value.slice(5, -1))).toBe(true)
      }
    }
    expect(own.has(svg.style.getPropertyValue('--ua-soft-edge').slice(5, -1))).toBe(true)
  }
})
it('smiles for 1.6 seconds, resets on repeated clicks and supports keyboard', () => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<UserAvatar id="xiaoping" variant="resting" custom={{ blush: false }} />)
  const svg = view.getByRole('button')
  fireEvent.click(svg); expect(svg).toHaveAttribute('data-mood', 'happy')
  act(() => { vi.advanceTimersByTime(1000) }); fireEvent.keyDown(svg, { key: 'Enter' })
  act(() => { vi.advanceTimersByTime(1599) }); expect(svg).toHaveAttribute('data-mood', 'happy')
  act(() => { vi.advanceTimersByTime(1) }); expect(svg).toHaveAttribute('data-mood', 'idle')
  expect(svg.style.getPropertyValue('--blush')).toBe('0')
})
it('keeps a static angle and schedules no gaze loop for reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true })); const raf = vi.fn(); vi.stubGlobal('requestAnimationFrame', raf)
  const view = render(<UserAvatar id="sand" variant="resting" />)
  expect(view.container.querySelector('svg')?.style.getPropertyValue('--turn')).toBe('0.25')
  expect(raf).not.toHaveBeenCalled()
})
