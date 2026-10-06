import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentRunRecovery, AgentTurnRequest } from '../../modules/research-agent'
import { AppLocaleProvider } from '../i18n/AppLocaleProvider'
import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'

vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(async () => ({ name: 'Everplain', avatar_id: 'cheng', color: '#b8c5b0', greeting: '', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1 })) }))

beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', addEventListener: vi.fn(), removeEventListener: vi.fn() })))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

const card = { card_id: 'migration-card', version: 'summary-version-7', title: '核对迁移的停机窗口', description: '你希望周五分批迁移，并保留旧入口。', sources: [{ role: 'user', sequence: 0, conversation_id: 'migration-source', message_id: 'source-message', quote: '周五分批迁移，保留旧入口。', title: '迁移计划' }] }
const publicCard = { title: card.title, description: card.description }
const publicMessage = `${card.title}\n${card.description}`
const selection = { card_id: card.card_id, version: card.version }
const catalog = { runtime_mode: 'base', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium' }] }
const summary = { status: 'ready', summary: '最近你聊到迁移方案。', updated_at: '2026-10-05T00:00:00Z', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], cards: [card] }
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const stream = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
const failed = () => stream(event('turn_failed', { code: 'card_test_failure', message: '本轮未完成，请明确重试。' }))
const pathFor = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
type CapturedRequest = { body: AgentTurnRequest; key: string | null }

function conversation(id: string, withHistory = false): AgentConversation {
  const created = '2026-10-05T00:00:00Z'
  return { conversation_id: id, title: '迁移讨论', created_at: created, updated_at: created, turn_count: withHistory ? 1 : 0, turns: withHistory ? [{
    turn_id: `${id}-turn`,
    user: { message_id: `${id}-user`, role: 'user', content: `${publicMessage}\n\n只比较两种方案。`, context_card: publicCard, citations: [], sequence: 1, created_at: created },
    assistant: { message_id: `${id}-assistant`, role: 'assistant', content: '已经比较两种迁移方案。', citations: [], sequence: 2, created_at: created },
    tool_traces: [],
  }] : [] }
}

function setup(options: { conversation?: AgentConversation; summary?: unknown; reply?: (request: CapturedRequest, index: number) => Response | Promise<Response>; lookup?: unknown } = {}) {
  const requests: CapturedRequest[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathFor(input)
    if (path === '/api/agent/models') return json(catalog)
    if (path === '/api/agent/context-summary') return json(options.summary ?? summary)
    if (options.conversation && path === `/api/agent/conversations/${options.conversation.conversation_id}`) return json(options.conversation)
    if (path === '/api/agent/turns') {
      const request = { body: JSON.parse(String(init?.body)) as AgentTurnRequest, key: new Headers(init?.headers).get('Idempotency-Key') }
      requests.push(request)
      return options.reply ? options.reply(request, requests.length) : failed()
    }
    if (path === '/api/agent/runs/by-idempotency-key' && options.lookup) return json(options.lookup)
    if (/^\/api\/agent\/runs\/[^/]+\/events$/.test(path)) return failed()
    return json({ items: [], tasks: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch }
}

function mount(userId = 'owner', entry = '/agent') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(<ResearchAgentConversationPage userId={userId} />, { wrapper: ({ children }) => <StrictMode><QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><AppLocaleProvider>{children}</AppLocaleProvider></MemoryRouter></QueryClientProvider></StrictMode> })
}

function input() { return screen.getByRole('textbox', { name: '问 Everplain' }) }
async function chooseCard() {
  await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(card.title) }))
  return screen.getByRole('region', { name: '已选对话卡片' })
}
function edit(value: string) { fireEvent.change(input(), { target: { value } }) }
function submit() { fireEvent.submit(input().closest('form')!) }
async function retryButton() {
  const button = await screen.findByRole('button', { name: '重试本轮' })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}

describe('context card privacy integration', () => {
  it('selects a public card without sending or replacing the natural-language draft, then explicitly sends its reference once', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { requests } = setup({ reply: async () => { await gate; return failed() } })
    const { container } = mount()
    edit('先保留我的补充。')
    const chip = await chooseCard()
    expect(chip).toHaveTextContent(card.title)
    expect(chip).toHaveTextContent(card.description)
    expect(input()).toHaveValue('先保留我的补充。')
    expect(input().closest('form')).toContainElement(chip)
    expect(requests).toHaveLength(0)
    expect(localStorage.getItem('everplain.agent.composer-draft.v2.owner.draft.agent.independent')).toBe('先保留我的补充。')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(card.card_id)

    edit('只比较两种方案。')
    act(() => { submit(); submit() })
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].body).toMatchObject({ message: `${publicMessage}\n\n只比较两种方案。`, context_suggestion: selection, workspace: 'agent', mode: 'standard' })
    expect(requests[0].body).not.toHaveProperty('prompt')
    expect(Object.keys(requests[0].body.context_suggestion!)).toEqual(['card_id', 'version'])
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    const sentCard = await screen.findByRole('region', { name: '对话卡片' })
    expect(sentCard).toHaveTextContent(card.title)
    const userMessage = container.querySelector('[data-role="user-message"]')!
    expect(userMessage.querySelector('.qx-bubble')).toHaveTextContent('只比较两种方案。')
    expect(userMessage.querySelector('.qx-bubble')).not.toHaveTextContent(card.description)
    await act(async () => release())
    await retryButton()
    expect(input()).toHaveValue('只比较两种方案。')
    expect(requests).toHaveLength(1)
  })

  it('can send a card with no added text and keeps the Chat controls in their existing row', async () => {
    const { requests } = setup()
    mount()
    await chooseCard()
    expect(input()).toHaveValue('')
    const send = screen.getByRole('button', { name: '发送给 Everplain' })
    expect(send).toBeEnabled()
    const model = screen.getByRole('button', { name: /模型与思考强度/ })
    expect(model.closest('.conversation-composer__row')).toContainElement(send)
    expect(input().closest('form')!.querySelector('.conversation-composer__toolbar')).toBeNull()
    fireEvent.click(send)
    await retryButton()
    expect(requests).toHaveLength(1)
    expect(requests[0].body).toMatchObject({ message: publicMessage, context_suggestion: selection })
    expect(document.querySelector('[data-role="user-message"] .qx-bubble')).not.toBeInTheDocument()
    expect(input()).toHaveValue('')
  })

  it('removes the chip without changing a draft and sends ordinary text without a card reference', async () => {
    const { requests } = setup()
    mount()
    await chooseCard()
    edit('这是我自己输入的普通问题。')
    fireEvent.click(screen.getByRole('button', { name: '移除对话卡片' }))
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(input()).toHaveValue('这是我自己输入的普通问题。')
    submit()
    await retryButton()
    expect(requests[0].body.message).toBe('这是我自己输入的普通问题。')
    expect(requests[0].body).not.toHaveProperty('context_suggestion')
    expect(screen.queryByRole('region', { name: '对话卡片' })).not.toBeInTheDocument()
  })

  it('does not infer card selection when the user types the same public title and description', async () => {
    const { requests } = setup()
    mount()
    await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    edit(publicMessage)
    submit()
    await retryButton()
    expect(requests[0].body.message).toBe(publicMessage)
    expect(requests[0].body).not.toHaveProperty('context_suggestion')
    expect(screen.queryByRole('region', { name: '对话卡片' })).not.toBeInTheDocument()
  })

  it('retains the original reference and idempotency key only for explicit retry', async () => {
    const { requests } = setup()
    mount()
    await chooseCard()
    edit('原来的补充。')
    submit()
    const retry = await retryButton()
    edit('这段编辑不应改写原请求。')
    fireEvent.click(retry)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual(requests[0])
    expect(requests[1].body.context_suggestion).toEqual(selection)
    await retryButton()
    expect(screen.getAllByRole('region', { name: '对话卡片' })).toHaveLength(1)
  })

  it.each(['unchanged', 'edited'] as const)('does not reuse a failed card reference through an ordinary %s draft submission', async variant => {
    const { requests } = setup()
    mount()
    await chooseCard()
    edit('原来的补充。')
    submit()
    await retryButton()
    const nextMessage = variant === 'unchanged' ? requests[0].body.message : '我现在只想问一个普通问题。'
    edit(nextMessage)
    submit()
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].body.message).toBe(nextMessage)
    expect(requests[1].body).not.toHaveProperty('context_suggestion')
    expect(requests[1].key).not.toBe(requests[0].key)
    await retryButton()
  })

  it('clears an unsent selection on owner replacement', async () => {
    const { requests } = setup()
    const view = mount('first-owner')
    await chooseCard()
    edit('第一个账号的补充。')
    view.rerender(<ResearchAgentConversationPage userId="second-owner" />)
    await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(input()).toHaveValue('')
    edit('第二个账号的问题。')
    submit()
    await retryButton()
    expect(requests[0].body).not.toHaveProperty('context_suggestion')
  })

  it('does not restore an unsent selection after a refresh-like remount', async () => {
    const { requests } = setup()
    const view = mount()
    await chooseCard()
    edit('刷新后保留的自然语言草稿。')
    view.unmount()
    mount()
    await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    expect(input()).toHaveValue('刷新后保留的自然语言草稿。')
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
    submit()
    await retryButton()
    expect(requests[0].body).not.toHaveProperty('context_suggestion')
  })

  it('clears an unsent selection when starting a new conversation', async () => {
    const { requests } = setup()
    mount()
    await chooseCard()
    fireEvent.click(screen.getByRole('button', { name: '打开研究记录' }))
    const history = await screen.findByRole('dialog', { name: '研究记录' })
    fireEvent.click(within(history).getByRole('button', { name: '开始新对话' }))
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(input()).toHaveValue('')
    expect(requests).toHaveLength(0)
    edit('新对话中的问题。')
    submit()
    await retryButton()
    expect(requests[0].body).not.toHaveProperty('context_suggestion')
  })

  it('renders a persisted server-labelled user card separately from its added text', async () => {
    const saved = conversation('history-card', true)
    const { requests } = setup({ conversation: saved })
    const { container } = mount('owner', '/agent?conversation_id=history-card')
    const restored = await screen.findByRole('region', { name: '对话卡片' })
    expect(within(restored).getByText(card.title)).toBeVisible()
    expect(restored).toHaveTextContent(card.description)
    expect(container.querySelector('[data-role="user-message"] .qx-bubble')).toHaveTextContent('只比较两种方案。')
    expect(container.querySelector('[data-role="user-message"] .qx-bubble')).not.toHaveTextContent(card.description)
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })

  it('restores an unfinished server card and resumes only with its original explicit request', async () => {
    const saved = conversation('unfinished-card')
    const run: AgentRunRecovery = { run_id: 'card-run', idempotency_key: 'original-card-key', status: 'interrupted', context_card: publicCard, partial_answer: '服务器保存的未完成输出。', updated_at: saved.updated_at, cancel_requested: true,
      request: { conversation_id: saved.conversation_id, message: `${publicMessage}\n\n只比较两种方案。`, context_suggestion: selection, mode: 'standard', workspace: 'agent', model_id: 'gpt-6-luna', reasoning_effort: 'high' } }
    saved.unfinished_runs = [run]
    const { requests } = setup({ conversation: saved })
    mount('owner', `/agent?conversation_id=${saved.conversation_id}`)
    await screen.findByText(run.partial_answer)
    expect(screen.getByRole('region', { name: '对话卡片' })).toHaveTextContent(card.description)
    expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '继续研究' }))
    await retryButton()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ body: run.request, key: run.idempotency_key })
  })

  it('restores server card metadata after a lost response through idempotency lookup without reposting', async () => {
    const snapshot = { run_id: 'lookup-card-run', conversation_id: 'lookup-card', idempotency_key: 'lookup-card-key', status: 'failed', cancel_requested: false, partial_answer: '从服务器找回的部分回答。', last_event_sequence: 2, context_card: publicCard }
    const { requests, fetch } = setup({ lookup: snapshot, reply: () => { throw new TypeError('Response headers lost') } })
    mount()
    await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    edit(`${publicMessage}\n\n只比较两种方案。`)
    submit()
    await screen.findByText(snapshot.partial_answer)
    expect(screen.getByRole('region', { name: '对话卡片' })).toHaveTextContent(card.description)
    expect(document.querySelector('[data-role="user-message"] .qx-bubble')).toHaveTextContent('只比较两种方案。')
    await retryButton()
    expect(requests).toHaveLength(1)
    const lookup = fetch.mock.calls.find(([url]) => pathFor(url) === '/api/agent/runs/by-idempotency-key')
    expect(new Headers(lookup?.[1]?.headers).get('Idempotency-Key')).toBe(requests[0].key)
  })

  it('rejects a legacy prompt-only API suggestion and never copies its hidden text', async () => {
    const hiddenPrompt = 'INTERNAL_PROMPT_MUST_NEVER_ENTER_COMPOSER'
    const { requests } = setup({ summary: { ...summary, cards: [{ title: card.title, description: card.description, prompt: hiddenPrompt, sources: [] }] } })
    mount()
    expect(await screen.findByRole('button', { name: '重新读取建议' })).toBeVisible()
    expect(screen.queryByRole('button', { name: new RegExp(card.title) })).not.toBeInTheDocument()
    expect(input()).toHaveValue('')
    expect(document.body).not.toHaveTextContent(hiddenPrompt)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(hiddenPrompt)
    expect(requests).toHaveLength(0)
  })
})


it.each(['zh-CN', 'en-US'] as const)('shows a stale card rejection without claiming a network failure or issuing a lookup in %s', async locale => {
  localStorage.setItem('qunxue.interface-locale', locale)
  const reason = '这张背景卡已更新或来源不可访问，请重新选择。'
  const { requests, fetch } = setup({ reply: () => new Response(JSON.stringify({ error: { code: 'conflict', message: reason, trace_id: 'private-trace-id' } }), { status: 409, headers: { 'Content-Type': 'application/json' } }) })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(card.title) }))
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: '保留我的补充。' } })
  fireEvent.submit(textbox.closest('form')!)
  const expected = locale === 'zh-CN' ? reason : 'This conversation card has changed or its sources are unavailable. Please select it again.'
  await screen.findAllByText(expected)
  expect(requests).toHaveLength(1)
  expect(fetch.mock.calls.some(([url]) => pathFor(url) === '/api/agent/runs/by-idempotency-key')).toBe(false)
  expect(textbox).toHaveValue('保留我的补充。')
  expect(document.body.textContent).not.toMatch(/private-trace-id|Agent 暂时无法连接|The Agent is unavailable/)
})
