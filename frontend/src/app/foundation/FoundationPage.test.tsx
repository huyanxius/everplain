import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FoundationPage } from './FoundationPage'
import { HeroFilm } from './HeroFilm'

let reduced = false
beforeEach(() => {
  reduced = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
function Location() { const location = useLocation(); return <output aria-label="当前地址">{location.pathname + location.search}</output> }

describe('Everplain product website', () => {
  it('states the brand, the three acts and the price without calling any live service', () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { requests.push(String(input)); return new Response('{}', { status: 503 }) })
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: /^Everplain，帮你/ })).toBeVisible()
    for (const name of ['你的知识，你的 AI。', '散落各处的，收到一处。', '一键，建成你的知识库。', '只属于你的 AI。', '用 1/10 的价格，和全球最顶尖的模型对话。']) {
      expect(screen.getByRole('heading', { name })).toBeVisible()
    }
    const models = screen.getByRole('list', { name: '模型示意' })
    for (const name of ['Claude Opus 5.5', 'GPT-6 Sol', 'Gemini 3.1 Pro']) expect(within(models).getByText(name)).toBeInTheDocument()
    for (const provider of ['Anthropic', 'OpenAI', 'Google']) expect(within(models).getAllByText(provider)).toHaveLength(2)
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: '免登录查看静态演示' })).not.toBeInTheDocument()
    expect(screen.queryByText(/下方演示使用预设示例/)).not.toBeInTheDocument()
    expect(screen.getByText('1/10')).toBeVisible()
    expect(screen.getByText(/当前提供 GPT 6 Luna/)).toBeVisible()
    expect(requests).toEqual([])
  })

  it('carries the opening thought through login', () => {
    render(<MemoryRouter initialEntries={['/welcome']}><FoundationPage /><Location /></MemoryRouter>)
    const [input] = screen.getAllByRole('textbox', { name: '你的想法' })
    expect(screen.getAllByRole('button', { name: '开始对话' })[0]).toBeDisabled()
    fireEvent.change(input, { target: { value: '  我的收藏 & 城市记忆？  ' } })
    fireEvent.submit(input.closest('form')!)
    const address = new URL(screen.getByLabelText('当前地址').textContent!, 'https://everplain.local')
    expect(address.pathname).toBe('/login')
    const destination = new URL(address.searchParams.get('redirect')!, address.origin)
    expect(destination.pathname).toBe('/agent')
    expect(destination.searchParams.get('prompt')).toBe('我的收藏 & 城市记忆？')
  })

  it('provides the official repository and Gmail contact in the footer', () => {
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    const footer = screen.getByRole('contentinfo')
    const repository = within(footer).getByRole('navigation', { name: '代码仓库' })
    const github = within(repository).getByRole('link', { name: 'Everplain · GitHub（在新窗口打开）' })
    expect(github).toHaveAttribute('href', 'https://github.com/huyanxius/everplain')
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveAttribute('rel', 'noopener noreferrer')
    const contact = within(footer).getByRole('region', { name: '联系我们' })
    expect(within(contact).getByRole('link', { name: 'huyanxius@gmail.com' })).toHaveAttribute('href', 'mailto:huyanxius@gmail.com')
    expect(within(footer).getByRole('link', { name: 'Everplain' })).toHaveAttribute('href', '/welcome')
    expect(within(footer).getByText('© 2026 Everplain')).toBeVisible()
    expect(within(footer).getAllByRole('link')).toHaveLength(3)
  })

  it('opens the conversation directly for a signed-in visitor, from the closing composer too', () => {
    render(<MemoryRouter><FoundationPage authenticated /><Location /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '继续' })).toHaveAttribute('href', '/app')
    const inputs = screen.getAllByRole('textbox', { name: '你的想法' })
    expect(inputs).toHaveLength(2)
    fireEvent.change(inputs[1], { target: { value: '接着聊聊上次的想法' } })
    fireEvent.submit(inputs[1].closest('form')!)
    const address = new URL(screen.getByLabelText('当前地址').textContent!, 'https://everplain.local')
    expect(address.pathname).toBe('/agent')
    expect(address.searchParams.get('prompt')).toBe('接着聊聊上次的想法')
  })

  it('waits for session resolution before showing the account CTA', () => {
    const { rerender } = render(<MemoryRouter><FoundationPage checkingSession /></MemoryRouter>)
    expect(screen.getByText('确认登录中…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '继续' })).not.toBeInTheDocument()
    rerender(<MemoryRouter><FoundationPage authenticated /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '继续' })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
    rerender(<MemoryRouter><FoundationPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
  })

  it('lists the platforms that can be imported', () => {
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    const wall = screen.getByRole('list', { name: '支持导入的平台' })
    for (const name of ['浏览器收藏', 'Obsidian', 'Notion', 'B 站收藏']) expect(within(wall).getByText(name)).toBeInTheDocument()
  })

  it('organizes the collection into a knowledge base, hands it to the AI, then loops', () => {
    vi.useFakeTimers()
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    const demo = screen.getByLabelText('知识库演示')
    act(() => { vi.advanceTimersByTime(7000) })
    expect(within(demo).getByText('公共讨论中的沉默')).toHaveAttribute('data-shown', 'true')
    expect(within(demo).getByText('自我审查', { selector: '.ep-outline strong' }).closest('li')).toHaveAttribute('data-shown', 'true')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(within(demo).getByText('给 AI 用')).toHaveAttribute('data-on', 'true')
    act(() => { vi.advanceTimersByTime(4200) }) // 停留后淡出、重新开始
    expect(within(demo).getByText('给你看')).toHaveAttribute('data-on', 'true')
    expect(within(demo).getByText('一键整理')).toBeInTheDocument()
  })

  it('shows the finished demos at once when motion is reduced, and citations point at sources', () => {
    reduced = true
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    const library = screen.getByLabelText('知识库演示')
    expect(within(library).getByText('给 AI 用')).toHaveAttribute('data-on', 'true')
    const conversation = screen.getByLabelText('对话演示')
    fireEvent.click(within(conversation).getByRole('button', { name: '查看来源 2' }))
    expect(within(conversation).getByText('沉默的螺旋，十分钟讲清楚', { selector: '.ep-sources li' })).toHaveAttribute('data-focus', 'true')
  })

  it('lets visitors forget a memory and undo it', () => {
    render(<MemoryRouter><FoundationPage /></MemoryRouter>)
    const memory = screen.getByLabelText('记忆演示')
    fireEvent.click(within(memory).getByRole('button', { name: '忘掉：参考文献用 APA 格式' }))
    expect(within(memory).queryByText('参考文献用 APA 格式')).not.toBeInTheDocument()
    expect(within(memory).getByText('3 条')).toBeInTheDocument()
    fireEvent.click(within(memory).getByRole('button', { name: '撤销' }))
    expect(within(memory).getByText('参考文献用 APA 格式')).toBeInTheDocument()
    expect(within(memory).getByText('4 条')).toBeInTheDocument()
  })
})

describe('hero film slot', () => {
  it('renders only the paper background while no film is configured', () => {
    const { container } = render(<HeroFilm />)
    expect(container.querySelector('[data-film="empty"]')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('loops a configured film, can pause, and keeps the poster when the video fails', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { container } = render(<HeroFilm film={{ src: '/meadow.mp4', poster: '/meadow.jpg' }} />)
    const video = container.querySelector('video')!
    expect(video.loop).toBe(true)
    expect(play).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '暂停首屏影像' }))
    expect(pause).toHaveBeenCalled()
    fireEvent.error(video.querySelector('source')!)
    expect(container.querySelector('[data-film="fallback"]')).not.toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', '/meadow.jpg')
    expect(container.querySelector('video')).toBeNull()
  })
})
