import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationThinking } from './ConversationThinking'
import type { ConversationTurnView } from './types'
const turn: ConversationTurnView = { id: 'live', question: '问题', answer: '', citations: [], streaming: true }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('uses real statuses, reaches resting for a single message, and collapses for exactly 420ms', () => {
  const view = render(<ConversationThinking turn={turn} />)
  expect(screen.getByRole('status', { name: '正在思考' })).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(960) })
  expect(view.container.querySelector('[data-copy-phase="resting"]')).toBeInTheDocument()
  view.rerender(<ConversationThinking turn={{ ...turn, toolSteps: [{ id: 'tool', label: '正在检索实际资料', tool: 'search', status: 'running' }] }} />)
  expect(screen.getByRole('status', { name: '正在检索实际资料' })).toBeInTheDocument()
  view.rerender(<ConversationThinking turn={{ ...turn, statusText: '正在核对来源', answer: '首字' }} />)
  expect(view.container.querySelector('.cv-thinking')).toHaveAttribute('data-collapsed')
  act(() => { vi.advanceTimersByTime(419) }); expect(view.container.querySelector('.cv-thinking')).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(1) }); expect(view.container.querySelector('.cv-thinking')).not.toBeInTheDocument()
  view.unmount(); expect(vi.getTimerCount()).toBe(0)
})
it('cleans up replacement timers on interruption/unmount and never rotates synthetic messages', () => {
  const view = render(<ConversationThinking turn={{ ...turn, statusText: '真实状态' }} />)
  act(() => { vi.advanceTimersByTime(12000) })
  expect(screen.getByRole('status')).toHaveAttribute('aria-label', '真实状态')
  expect(view.container.querySelector('[data-copy-index]')).toHaveAttribute('data-copy-index', '0')
  view.rerender(<ConversationThinking turn={{ ...turn, streaming: false, interrupted: true }} />)
  view.unmount(); expect(vi.getTimerCount()).toBe(0)
})
