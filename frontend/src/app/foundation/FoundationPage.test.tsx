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
  it('introduces model brands and lets visitors filter the sample knowledge space', () => {
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    for (const name of ['Claude 标志', 'ChatGPT 标志', 'Gemini 标志']) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: /好模型，用得起。.*好想法，尽管聊。/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '灵感' }))
    expect(screen.queryByText('城市记忆与日常生活')).not.toBeInTheDocument()
    expect(screen.getByText('光落在书架上的那个下午')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '文档' }))
    expect(screen.getByText('城市记忆与日常生活')).toBeVisible()
    expect(screen.queryByText('光落在书架上的那个下午')).not.toBeInTheDocument()
  })
})
