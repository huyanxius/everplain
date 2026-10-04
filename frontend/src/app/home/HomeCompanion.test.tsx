import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HomeCompanion } from './HomeCompanion'
vi.mock('../../modules/companion', () => ({ Companion: () => <span>小平</span> }))
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals()})
it('keeps the companion mounted for its exit, removes it, then peeks again on returning home', () => {
  vi.useFakeTimers()
  const view = render(<HomeCompanion active />)
  expect(screen.getByText('小平').parentElement).toHaveAttribute('data-away', 'false')
  view.rerender(<HomeCompanion active={false} />)
  expect(screen.getByText('小平').parentElement).toHaveAttribute('data-away', 'true')
  act(() => {vi.advanceTimersByTime(449)})
  expect(screen.getByText('小平')).toBeInTheDocument()
  act(() => {vi.advanceTimersByTime(1)})
  expect(screen.queryByText('小平')).not.toBeInTheDocument()
  view.rerender(<HomeCompanion active />)
  expect(screen.getByText('小平').parentElement).toHaveAttribute('data-away', 'false')
})

it('cancels a pending departure when the user rapidly returns home', () => {
  vi.useFakeTimers()
  const view = render(<HomeCompanion active />)
  view.rerender(<HomeCompanion active={false} />)
  act(() => { vi.advanceTimersByTime(200) })
  view.rerender(<HomeCompanion active />)
  act(() => { vi.advanceTimersByTime(500) })
  expect(screen.getByText('小平').parentElement).toHaveAttribute('data-away', 'false')
})
it('removes the companion immediately for reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<HomeCompanion active />)
  view.rerender(<HomeCompanion active={false} />)
  expect(screen.queryByText('小平')).not.toBeInTheDocument()
})
