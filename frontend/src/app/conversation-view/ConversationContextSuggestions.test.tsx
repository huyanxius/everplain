import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConversationContextSummary, type ConversationContextSummary } from '../../modules/research-agent'
import { ConversationContextSuggestions } from './ConversationContextSuggestions'
import { conversationContextSummaryKey } from './useConversationContextSummary'

vi.mock('../../modules/research-agent', () => ({ getConversationContextSummary: vi.fn() }))
const clients: QueryClient[] = []
const empty: ConversationContextSummary = { status: 'empty', summary: '', cards: [], updated_at: null, scope: 'conversation_messages', omitted_messages: 0, summary_sources: [] }
const ready: ConversationContextSummary = {
  status: 'ready', summary: '你最近在准备周五迁移，也聊到了读书会展示。', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], updated_at: '2026-10-05T00:00:00Z',
  cards: [{
    title: '核对周五迁移的回退入口', description: '两次对话里提到分批上线和保留旧入口，可以一起核对。', prompt: '一起核对周五分批上线和旧入口的回退方案，先确认目前的安排。',
    sources: [
      { role: 'user', sequence: 0, conversation_id: 'migration one', message_id: 'message-1', quote: '我希望周五分批上线。', title: '迁移安排' },
      { role: 'user', sequence: 0, conversation_id: 'migration/two', message_id: 'message-2', quote: '还想保留旧入口方便回退。', title: '回退讨论' },
    ],
  }, {
    title: '把读书会例子放进展示', description: '你聊到展示篇幅有限，希望保留那个对照案例。', prompt: '帮我把读书会的对照案例放进五分钟展示，先核对原始信息。',
    sources: [{ role: 'user', sequence: 0, conversation_id: 'reading', message_id: 'message-3', quote: '五分钟展示里保留那个对照案例。', title: '读书会展示' }],
  }],
}

function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(value)
  return value
}
function surface(queryClient: QueryClient, userId: string | null, onSelect = vi.fn()) {
  return <QueryClientProvider client={queryClient}><MemoryRouter><ConversationContextSuggestions userId={userId} onSelect={onSelect} /></MemoryRouter></QueryClientProvider>
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getConversationContextSummary).mockResolvedValue(ready) })
afterEach(() => { cleanup(); clients.splice(0).forEach(value => value.clear()); vi.useRealTimers() })

describe('shared cached conversation suggestions', () => {
  it('shows content-specific cross-session evidence and only fills the selected draft', async () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn()
    render(<form onSubmit={onSubmit}>{surface(client(), 'reader-1', onSelect)}</form>)
    const card = await screen.findByRole('button', { name: /核对周五迁移的回退入口/ })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText(ready.summary)).toBeVisible()
    expect(screen.getByText('可继续讨论的建议 · 点击填入草稿')).toBeVisible()
    expect(screen.getByRole('link', { name: '来源：迁移安排' })).toHaveAttribute('href', '/agent?conversation_id=migration%20one')
    expect(screen.getByRole('link', { name: '来源：回退讨论' })).toHaveAttribute('href', '/agent?conversation_id=migration%2Ftwo')
    expect(screen.getByText('你的消息：还想保留旧入口方便回退。')).not.toBeVisible()
    fireEvent.click(card.closest('article')!.querySelector('summary')!)
    expect(screen.getByText('你的消息：还想保留旧入口方便回退。')).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(ready.cards[0].prompt)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['empty', '最近的对话还没有足够内容形成建议。'],
    ['pending', '正在根据最近的对话整理建议…'],
    ['disabled', '对话建议暂未启用。你可以直接输入问题。'],
    ['failed', '暂时无法读取对话建议，请稍后重试。'],
  ] as const)('keeps %s honest without generic fallback cards', async (status, message) => {
    vi.mocked(getConversationContextSummary).mockResolvedValue({ ...empty, status })
    render(surface(client(), 'reader-1'))
    expect(await screen.findByText(message)).toBeVisible()
    expect(document.querySelectorAll('.cv-suggestions__card')).toHaveLength(0)
    expect(screen.queryByText('理清下一步')).not.toBeInTheDocument()
    expect(screen.queryByText('比较可选方案')).not.toBeInTheDocument()
  })

  it('handles zero ready cards and a transport error, then retries the read', async () => {
    const queryClient = client()
    vi.mocked(getConversationContextSummary).mockResolvedValueOnce({ ...ready, cards: [] })
    const view = render(surface(queryClient, 'reader-1'))
    expect(await screen.findByText('暂时没有可继续讨论的建议。')).toBeVisible()
    expect(screen.getByText(ready.summary)).toBeVisible()
    view.unmount()
    vi.mocked(getConversationContextSummary).mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(ready)
    render(surface(queryClient, 'reader-2'))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取对话建议')
    fireEvent.click(screen.getByRole('button', { name: '重新读取建议' }))
    expect(await screen.findByRole('button', { name: /核对周五迁移的回退入口/ })).toBeVisible()
  })

  it('labels assistant statements as unverified and discloses partial source coverage', async () => {
    const assistant = { sequence: 1, role: 'assistant' as const, conversation_id: 'assistant-history', message_id: 'assistant-1', title: '迁移助手答复', quote: '可以考虑保留一个旧入口。' }
    vi.mocked(getConversationContextSummary).mockResolvedValue({ ...ready, omitted_messages: 2, summary_sources: [assistant], cards: [{ ...ready.cards[0], sources: [assistant] }] })
    render(surface(client(), 'reader-1'))
    const summarySources = await screen.findByRole('list', { name: '近况依据' })
    expect(within(summarySources).getByText('助手回答（需核实）')).toBeVisible()
    expect(screen.getByRole('list', { name: '建议依据' })).toHaveTextContent('助手回答（需核实）')
    const summaryEvidence = summarySources.closest('.cv-context-suggestions__evidence')!
    fireEvent.click(summaryEvidence.querySelector('summary')!)
    expect(within(summaryEvidence as HTMLElement).getByText('助手回答（需核实）：可以考虑保留一个旧入口。')).toBeVisible()
    expect(screen.queryByText('你的消息：可以考虑保留一个旧入口。')).not.toBeInTheDocument()
    expect(screen.getByText('这里只依据部分近期消息整理，另有 2 条消息未纳入。')).toBeVisible()
  })

  it('shares identical cards between two surfaces and a remount for 60 seconds', async () => {
    const queryClient = client()
    const first = render(surface(queryClient, 'reader-1'))
    await screen.findByText(ready.summary)
    const second = render(surface(queryClient, 'reader-1'))
    expect(await within(second.container).findByText(ready.summary)).toBeVisible()
    expect(first.container.textContent).toBe(second.container.textContent)
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(conversationContextSummaryKey('reader-1'))?.data).toEqual(ready)
    first.unmount(); second.unmount()
    render(surface(queryClient, 'reader-1'))
    expect(screen.getByRole('button', { name: /核对周五迁移的回退入口/ })).toBeVisible()
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
  })

  it('does not reuse another account’s cards or expose them after logout', async () => {
    const queryClient = client()
    let resolveSecond!: (data: ConversationContextSummary) => void
    vi.mocked(getConversationContextSummary).mockResolvedValueOnce(ready).mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
    const view = render(surface(queryClient, 'reader-1'))
    await screen.findByText(ready.summary)
    view.rerender(surface(queryClient, 'reader-2'))
    expect(screen.queryByText(ready.summary)).not.toBeInTheDocument()
    expect(screen.queryByText('你的消息：我希望周五分批上线。')).not.toBeInTheDocument()
    await act(async () => { resolveSecond(empty) })
    await screen.findByText('最近的对话还没有足够内容形成建议。')
    view.rerender(surface(queryClient, null))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
  })

  it('cancels a departed account read and ignores its late response', async () => {
    const queryClient = client()
    let resolveFirst!: (data: ConversationContextSummary) => void
    let firstSignal: AbortSignal | undefined
    vi.mocked(getConversationContextSummary).mockImplementationOnce(signal => { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve }) }).mockResolvedValueOnce(empty)
    const view = render(surface(queryClient, 'reader-1'))
    view.rerender(surface(queryClient, 'reader-2'))
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => { resolveFirst(ready) })
    await screen.findByText('最近的对话还没有足够内容形成建议。')
    expect(screen.queryByText(ready.summary)).not.toBeInTheDocument()
    expect(queryClient.getQueryData(conversationContextSummaryKey('reader-1'))).toBeUndefined()
  })

  it('polls only while pending and stops once the cached result is ready', async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationContextSummary).mockResolvedValueOnce({ ...empty, status: 'pending' }).mockResolvedValueOnce(ready)
    render(surface(client(), 'reader-1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
    expect(screen.getByText(ready.summary)).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
  })

  it('does not start an anonymous read', () => {
    render(surface(client(), null))
    expect(getConversationContextSummary).not.toHaveBeenCalled()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it.each([
    ['pending', 'idle_wait', '最近对话刚刚更新，稍后会自动整理建议。'],
    ['pending', 'active_run', '当前对话还在进行，结束后会整理建议。'],
    ['pending', 'queued', '对话建议已排队，会自动更新。'],
    ['failed', 'retry_wait', '这次整理没有成功，稍后会自动重试。'],
    ['failed', 'attempt_limit', '这批对话的建议生成未成功，已暂停重试。新对话后会重新检查。'],
    ['failed', 'generator_unavailable', '对话建议的生成服务暂时不可用。'],
  ] as const)('explains %s/%s without pretending a model is running', async (status, status_reason, message) => {
    vi.mocked(getConversationContextSummary).mockResolvedValue({ ...empty, status, status_reason })
    render(surface(client(), 'reader-1'))
    expect(await screen.findByText(message)).toBeVisible()
    expect(document.querySelectorAll('.cv-suggestions__card')).toHaveLength(0)
  })

  it('automatically recovers after a scheduled failure retry and shares three actual cards', async () => {
    vi.useFakeTimers()
    const queryClient = client()
    const three = { ...ready, cards: [...ready.cards, {
      ...ready.cards[1], title: '核对读书会对照例子的篇幅', description: '五分钟展示需要保留原先提到的对照例子，可以具体分配篇幅。',
    }] }
    vi.mocked(getConversationContextSummary).mockResolvedValueOnce({
      ...empty, status: 'failed', status_reason: 'retry_wait',
      retry_at: new Date(Date.now() + 45_000).toISOString(),
    }).mockResolvedValue(three)
    const first = render(surface(queryClient, 'reader-1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByRole('alert')).toHaveTextContent('稍后会自动重试')
    await act(async () => { await vi.advanceTimersByTimeAsync(45_001) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
    expect(first.container.querySelectorAll('.cv-suggestions__card')).toHaveLength(3)
    const second = render(surface(queryClient, 'reader-1'))
    expect(second.container.textContent).toBe(first.container.textContent)
    expect(second.container.querySelectorAll('.cv-suggestions__card')).toHaveLength(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable daily budget and waits for renewal rather than spinning', async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationContextSummary).mockResolvedValue({
      ...empty, status: 'failed', status_reason: 'daily_budget',
      retry_at: new Date(Date.now() + 3_600_000).toISOString(),
    })
    render(surface(client(), 'reader-1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001) })
    expect(screen.getByRole('alert')).toHaveTextContent('今天的对话建议额度已用完')
    expect(screen.queryByText('正在根据最近的对话整理建议…')).not.toBeInTheDocument()
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
  })

  it('stops pending cache reads when the surface leaves without touching the backend worker', async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationContextSummary).mockResolvedValue({ ...empty, status: 'pending', status_reason: 'generating' })
    const view = render(surface(client(), 'reader-1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(1)
  })

  it('stops a pending polling loop when the next read fails', async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationContextSummary).mockResolvedValueOnce({ ...empty, status: 'pending' }).mockRejectedValueOnce(new Error('HTTP 503'))
    render(surface(client(), 'reader-1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_002) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取对话建议')
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
  })
})
