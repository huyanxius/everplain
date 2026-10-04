import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageLoading, PageLoadingRenderer } from './PageLoading'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('page loading boundary', () => {
  it('reuses the liquid Bot for an unknown identity', () => {
    const { container } = render(<PageLoading message="正在读取页面" />)
    expect(container.querySelector('svg.aa-liquid')).toHaveAttribute('data-avatar', 'cheng')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('正在读取页面')
  })

  it('uses the authenticated application adapter rather than a second persona source', () => {
    const renderer = vi.fn(({ message }: { message: string }) => <p role="status">{message}</p>)
    render(<PageLoadingRenderer.Provider value={renderer}><PageLoading message="正在读取页面" /></PageLoadingRenderer.Provider>)
    expect(renderer).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取页面')
    expect(document.querySelector('.aa-liquid')).toBeNull()
  })

  it('keeps the message and liquid static under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { container } = render(<PageLoading message="正在读取页面" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-reduced-motion', 'true')
    expect(container.querySelector('svg')).toHaveAttribute('data-playing', 'false')
    expect(screen.getByText('正在读取页面')).toBeVisible()
  })
})
