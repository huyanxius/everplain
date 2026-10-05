import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SiteIcon } from './SiteIcon'

afterEach(cleanup)
it('uses only a safe origin, falls back after failure, and retries a different site', () => {
  const { rerender } = render(<SiteIcon url="https://townscapergame.com/private?token=secret" />)
  const icon = screen.getByRole('img', { name: '站点图标' })
  expect(icon).toHaveAttribute('src', 'https://townscapergame.com/favicon.ico')
  expect(icon).toHaveAttribute('referrerpolicy', 'no-referrer')
  fireEvent.error(icon)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<SiteIcon url="https://github.com/project" />)
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://github.com/favicon.ico')
  rerender(<SiteIcon url="http://127.0.0.1/" fallback={<span>已有来源图标</span>} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('已有来源图标')).toBeVisible()
})
