import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentLiquid } from './AgentLiquid'

const frames = new Map<number, FrameRequestCallback>()
let next = 0
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++next, callback); return next }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); frames.clear(); vi.restoreAllMocks() })
function at(time: number) { act(() => { const frame = frames.entries().next().value!; frames.delete(frame[0]); frame[1](time) }) }
it('keeps one body and idle eyes while visiting every preset from the real lead', () => {
  vi.spyOn(window.performance, 'now').mockReturnValue(0)
  const view = render(<AgentLiquid lead="qi" color="#123456" />)
  const svg = view.container.querySelector('svg')!
  const body = view.container.querySelector('.aa-body')!
  expect(svg).toHaveAttribute('data-avatar', 'qi'); expect(svg.style.getPropertyValue('--aa-color')).toBe('#123456')
  const order = ['qi', 'cheng', 'you', 'ruo', 'heng', 'shi', 'nian', 'qi']
  order.forEach((avatar, i) => { at(i * (600 + 1000 / 1.5) + 1); expect(svg).toHaveAttribute('data-avatar', avatar) })
  expect(view.container.querySelectorAll('.aa-body')).toHaveLength(1)
  expect(view.container.querySelector('.aa-body')).toBe(body)
  expect(svg).toHaveAttribute('data-state', 'idle')
  expect(view.container.querySelectorAll('.aa-eye')).toHaveLength(2)
  expect(view.container.querySelectorAll('.aa-liquid-decor')).toHaveLength(7)
  view.unmount(); expect(frames.size).toBe(0)
})
it('unknown identity cycles generically, and identity changes restart at that user', () => {
  vi.spyOn(window.performance, 'now').mockReturnValue(0)
  const view = render(<AgentLiquid />)
  at(1270); expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'you')
  view.rerender(<AgentLiquid lead="nian" />)
  expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'nian')
  expect(frames.size).toBe(1)
})
it('draws only the first frame in reduced motion, including live preference changes', () => {
  let notify!: () => void
  const media = { matches: true, addEventListener: vi.fn((_e, cb) => { notify = cb }), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  const view = render(<AgentLiquid lead="heng" />)
  expect(frames.size).toBe(0); expect(view.container.querySelector('svg')).toHaveAttribute('data-playing', 'false')
  act(() => { media.matches = false; notify() }); expect(frames.size).toBe(1)
  act(() => { media.matches = true; notify() }); expect(frames.size).toBe(0)
  view.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', notify)
})
