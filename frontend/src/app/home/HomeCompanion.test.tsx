import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HomeCompanion } from './HomeCompanion'
vi.mock('../../modules/companion', () => ({ Companion: () => <span>小平</span> }))
afterEach(() => {cleanup(); vi.useRealTimers()})
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
