import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FoundationPage } from './FoundationPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Everplain concise product website', () => {
  it('introduces a personal knowledge and research product with an actual start route', () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response('{}', { status: 503 })
    })
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: /你的个人知识库，.*也是研究工作台。/ })).toBeVisible()
    expect(screen.getByRole('link', { name: '开始使用' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('region', { name: 'Everplain 工作流程' })).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '整理私有知识' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '基于来源研究' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '留下可编辑的成果' })).toBeVisible()
    expect(requests).toEqual([])
  })
  it('keeps the product introduction available with workspace navigation after login', () => {
    render(<MemoryRouter><FoundationPage authenticated /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: '开始使用' })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
  })
})
