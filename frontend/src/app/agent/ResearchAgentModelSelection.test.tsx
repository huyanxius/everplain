import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../../modules/research-agent'
import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'

vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(async () => ({ name: 'Everplain', avatar_id: 'cheng', color: '#b8c5b0', greeting: '你想研究什么？', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: { occupation: '', industry: '', goals: [], interests: [], additional: '' }, version: 1 })) }))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })
const catalog = { runtime_mode: 'base', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium' }] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const failed = () => new Response(event('turn_failed', { code: 'synthetic_failure', message: 'synthetic failure' }))
const pathFor = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname

function mount(userId = 'owner', entry = '/agent') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<ResearchAgentConversationPage userId={userId} />, { wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter></QueryClientProvider> })
}

async function openSettings() {
  fireEvent.click(await screen.findByRole('button', { name: /模型与思考强度/ }))
}
function closeTools() { fireEvent.click(screen.getByRole('button', { name: /模型与思考强度/ })) }
function submit(question: string) {
  const input = screen.getByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: question } })
  fireEvent.submit(input.closest('form')!)
}

function setup(options: { catalog?: unknown; catalogStatus?: number; conversation?: AgentConversation; reply?: (index: number) => Response } = {}) {
  const requests: RequestInit[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathFor(input)
    if (options.conversation && path === `/api/agent/conversations/${options.conversation.conversation_id}`) return json(options.conversation)
    if (path === '/api/agent/context-summary') return json({ status: 'ready', summary: '最近你聊到迁移方案与展示材料。', updated_at: '2026-10-05T00:00:00Z', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], cards: [{ title: '核对分批迁移的停机窗口', description: '你提到周五迁移，并希望保留旧入口。', prompt: '继续核对周五分批迁移的停机窗口和旧入口回退方案。', sources: [{ role: 'user', sequence: 0, conversation_id: 'migration', message_id: 'migration-user-1', quote: '我想周五分批迁移，并保留旧入口。', title: '系统迁移' }] }] })
    if (path === '/api/agent/models') return json(options.catalog ?? catalog, options.catalogStatus ?? 200)
    if (path === '/api/agent/turns') { requests.push(init!); return options.reply?.(requests.length) ?? failed() }
    return json({ items: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch }
}

describe('conversation model selection integration', () => {
  it('fills a suggested question without sending or changing request mode', async () => {
    const { requests } = setup()
    mount()
    await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    const suggestion = await screen.findByRole('button', { name: /核对分批迁移的停机窗口/ })
    expect(document.querySelectorAll('.cv-suggestions__card')).toHaveLength(1)
    fireEvent.click(suggestion)
    expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue('继续核对周五分批迁移的停机窗口和旧入口回退方案。')
    expect(requests).toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    expect(document.querySelectorAll('.cv-suggestions__card')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /缩小研究问题/ }))
    expect((screen.getByRole('textbox', { name: '问 Everplain' }) as HTMLTextAreaElement).value).toContain('3个可验证的子问题')
    expect(requests).toHaveLength(0)
  })

  it('keeps Chat a single input row and places Research tools on a separate base', async () => {
    setup()
    mount()
    const input = screen.getByRole('textbox', { name: '问 Everplain' })
    const form = input.closest('form')!
    const summary = await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
    expect(summary.closest('.conversation-composer__row')).toContainElement(screen.getByRole('button', { name: '发送给 Everplain' }))
    expect(summary.closest('.conversation-composer__model')?.nextElementSibling).toBe(screen.getByRole('button', { name: '发送给 Everplain' }))
    expect(form.querySelector('.conversation-composer__toolbar')).toBeNull()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '研究工具栏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看材料库' })).not.toBeInTheDocument()
    expect(screen.queryByText('问题示例')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Chat' })).not.toHaveTextContent('对话')
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    const toolbar = await screen.findByRole('group', { name: '研究工具栏' })
    expect(form).not.toContainElement(toolbar)
    expect(toolbar).toHaveClass('cv-research-base')
    expect(screen.getByRole('button', { name: '查看材料库' })).toBeVisible()
    expect(screen.getAllByRole('group', { name: '研究工具栏' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(screen.queryByRole('group', { name: '研究工具栏' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeVisible()
  })

  it.each(['Chat', 'Research'])('makes the server subset reachable in %s and keeps the draft while changing it', async mode => {
    const { requests } = setup()
    mount()
    if (mode === 'Research') fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    fireEvent.change(screen.getByRole('textbox', { name: '问 Everplain' }), { target: { value: '保留这份草稿' } })
    await openSettings()
    const slider = await screen.findByRole('slider', { name: '思考强度' })
    expect(slider).toHaveAttribute('aria-valuemax', '2')
    expect(screen.queryByText('最高')).not.toBeInTheDocument()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(screen.getByRole('button', { name: /模型与思考强度/ })).toHaveAccessibleName('模型与思考强度：GPT 6 Luna · 高')
    expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue('保留这份草稿')
    closeTools()
    submit('保留这份草稿')
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0].body))).toMatchObject({ model_id: 'gpt-6-luna', reasoning_effort: 'high', mode: mode === 'Research' ? 'deep_research' : 'standard' })
  })

  it.each([{ catalog: { ...catalog, items: [] }, message: '模型选择尚未启用' }, { catalogStatus: 503, message: '模型设置暂时无法读取' }])('keeps legacy requests explicit when unavailable: $message', async options => {
    const { requests } = setup(options)
    mount()
    await openSettings()
    expect(await screen.findByText(new RegExp(options.message))).toBeVisible()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByText('GPT 6 Luna')).not.toBeInTheDocument()
    closeTools()
    submit('沿用原设置')
    await waitFor(() => expect(requests).toHaveLength(1))
    const body = JSON.parse(String(requests[0].body))
    expect(body).not.toHaveProperty('model_id')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('locks controls while a turn is active and freezes its selection before sending', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(encoder.encode(event('agent_status', { status: 'thinking' }))) } }))
    const { requests } = setup({ reply: () => response })
    mount()
    await openSettings()
    fireEvent.keyDown(await screen.findByRole('slider'), { key: 'End' })
    closeTools()
    submit('正在执行')
    await waitFor(() => expect(requests).toHaveLength(1))
    await openSettings()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('radio', { name: 'GPT 6 Luna' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    expect(JSON.parse(String(requests[0].body)).reasoning_effort).toBe('high')
    await act(async () => { controller.enqueue(encoder.encode(event('turn_failed', { code: 'synthetic', message: 'synthetic' }))); controller.close() })
  })

  it('retries the original request even after the next-turn slider was changed', async () => {
    const { requests } = setup()
    mount()
    await openSettings()
    fireEvent.keyDown(await screen.findByRole('slider'), { key: 'End' })
    closeTools()
    submit('原始请求')
    await screen.findByRole('button', { name: '重试本轮' })
    await openSettings()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    closeTools()
    fireEvent.click(screen.getByRole('button', { name: '重试本轮' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(JSON.parse(String(requests[1].body)).reasoning_effort).toBe('high')
    expect(new Headers(requests[1].headers).get('Idempotency-Key')).toBe(new Headers(requests[0].headers).get('Idempotency-Key'))
  })

  it('keeps model and effort when recovering a local pending request after reload', async () => {
    localStorage.setItem('everplain.agent.pending-turn.v2.owner.draft.agent.independent', JSON.stringify({ question: '恢复原问题', idempotencyKey: 'original-pending-key', conversationId: null, materialIds: [], request: { message: '恢复原问题', model_id: 'gpt-6-luna', reasoning_effort: 'high', mode: 'standard', workspace: 'agent' } }))
    const { requests } = setup()
    mount()
    await openSettings()
    expect(await screen.findByRole('slider')).toHaveAttribute('aria-valuenow', '1')
    closeTools()
    expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue('恢复原问题')
    fireEvent.submit(screen.getByRole('textbox', { name: '问 Everplain' }).closest('form')!)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0].body))).toMatchObject({ model_id: 'gpt-6-luna', reasoning_effort: 'high' })
    expect(new Headers(requests[0].headers).get('Idempotency-Key')).toBe('original-pending-key')
  })

  it('preserves a server recovery snapshot even when the new-turn selection differs', async () => {
    const conversation: AgentConversation = {
      conversation_id: 'recover-model', title: '服务器暂停的问题', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', turn_count: 0, turns: [],
      unfinished_runs: [{ run_id: 'original-server-run', idempotency_key: 'original-server-key', status: 'interrupted', partial_answer: '保留的半段输出', updated_at: '2026-10-02T00:00:00Z', cancel_requested: true,
        request: { conversation_id: 'recover-model', message: '服务器暂停的问题', model_id: 'gpt-6-luna', reasoning_effort: 'high', mode: 'standard', workspace: 'agent' } }],
    }
    const { requests } = setup({ conversation })
    mount('owner', '/agent?conversation_id=recover-model')
    await screen.findByText('保留的半段输出')
    await openSettings()
    fireEvent.keyDown(await screen.findByRole('slider'), { key: 'Home' })
    closeTools()
    fireEvent.click(screen.getByRole('button', { name: '继续研究' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0].body))).toMatchObject({ model_id: 'gpt-6-luna', reasoning_effort: 'high', message: '服务器暂停的问题' })
    expect(new Headers(requests[0].headers).get('Idempotency-Key')).toBe('original-server-key')
  })

  it('does not reuse another signed-in user’s model catalog or selection', async () => {
    const requests: RequestInit[] = []
    let catalogs = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathFor(input)
      if (path === '/api/agent/context-summary') return json({ status: 'ready', summary: '最近你聊到迁移方案与展示材料。', updated_at: '2026-10-05T00:00:00Z', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], cards: [{ title: '核对分批迁移的停机窗口', description: '你提到周五迁移，并希望保留旧入口。', prompt: '继续核对周五分批迁移的停机窗口和旧入口回退方案。', sources: [{ role: 'user', conversation_id: 'migration', message_id: 'migration-user-1', quote: '我想周五分批迁移，并保留旧入口。', title: '系统迁移' }] }] })
      if (path === '/api/agent/models') return json(++catalogs === 1 ? catalog : { ...catalog, items: [] })
      if (path === '/api/agent/turns') { requests.push(init!); return failed() }
      return json({ items: [] })
    }))
    const view = mount('first-owner')
    await openSettings()
    fireEvent.keyDown(await screen.findByRole('slider'), { key: 'End' })
    view.rerender(<ResearchAgentConversationPage userId="second-owner" />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    await openSettings()
    expect(await screen.findByText(/模型选择尚未启用/)).toBeVisible()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    closeTools()
    submit('另一个账号的新问题')
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0].body))).not.toHaveProperty('model_id')
    expect(catalogs).toBe(2)
  })

})

it.each(['Chat', 'Research'])('sends a no-effort model from the existing %s selector', async mode => {
  const { requests } = setup({ catalog: { ...catalog, items: [...catalog.items, { model_id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoning_efforts: [], default_reasoning_effort: null }] } })
  mount()
  if (mode === 'Research') fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
  await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
  await openSettings()
  fireEvent.click(screen.getByRole('radio', { name: 'Gemini 3.5 Flash' }))
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '模型与思考强度：Gemini 3.5 Flash' })).toBeVisible()
  closeTools()
  submit('使用当前模型回答')
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(JSON.parse(String(requests[0].body))).toMatchObject({ model_id: 'gemini-3.5-flash', reasoning_effort: null, mode: mode === 'Research' ? 'deep_research' : 'standard' })
})
