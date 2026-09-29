import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FoundationPage } from './FoundationPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Everplain product website', () => {
  it('shows the bilingual brand and keeps product previews separate from live AI', () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response('{}', { status: 503 })
    })
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: /Room for.*your mind\./ })).toBeVisible()
    expect(screen.getByText('给思绪一处空间。')).toBeVisible()
    expect(screen.getByRole('heading', { name: /你的知识，.*你的 AI 伙伴。/ })).toBeVisible()
    expect(screen.getByRole('link', { name: '探索当前版本' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开一个想法' }))
    expect(screen.getByText('上次那个关于城市声音的想法，我想继续写。')).toBeVisible()
    expect(screen.getByRole('button', { name: '展开一个想法' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '想起一份收藏' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('我之前看过一篇关于独处的文章，想接着聊聊。')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })
  it('offers workspace navigation to authenticated users', () => {
    render(<MemoryRouter><FoundationPage authenticated /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: '回到我的空间' })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
  })
})
