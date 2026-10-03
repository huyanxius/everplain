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
  fireEvent.click(await screen.findByRole('button', { name: '添加研究材料' }))
  fireEvent.click(await screen.findByRole('button', { name: '模型设置' }))
}
function closeTools() { fireEvent.click(screen.getByRole('button', { name: '添加研究材料' })) }
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
    if (path === '/api/agent/models') return json(options.catalog ?? catalog, options.catalogStatus ?? 200)
    if (path === '/api/agent/turns') { requests.push(init!); return options.reply?.(requests.length) ?? failed() }
    return json({ items: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch }
}

describe('conversation model selection integration', () => {
  it('keeps Research scope controls inside the composer and preserves Chat tools', async () => {
    setup()
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    const toolbar = await screen.findByRole('group', { name: '研究工具栏' })
    const form = screen.getByRole('textbox', { name: '问 Everplain' }).closest('form')
    expect(form).toContainElement(toolbar)
    expect(toolbar.closest('.conversation-composer__toolbar')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: '研究工具栏' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(screen.queryByRole('group', { name: '研究工具栏' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加研究材料' })).toBeVisible()
  })

  it.each(['Chat', 'Research'])('makes the server subset reachable in %s and keeps the draft while changing it', async mode => {
    const { requests } = setup()
    mount()
    if (mode === 'Research') fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    fireEvent.change(screen.getByRole('textbox', { name: '问 Everplain' }), { target: { value: '保留这份草稿' } })
    await openSettings()
    const slider = await screen.findByRole('slider', { name: '思考强度' })
    expect(slider).toHaveAttribute('max', '2')
    expect(screen.queryByText('最高')).not.toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '2' } })
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
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '2' } })
    closeTools()
    submit('正在执行')
    await waitFor(() => expect(requests).toHaveLength(1))
    await openSettings()
    expect(screen.getByRole('slider')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '模型' })).toBeDisabled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    expect(JSON.parse(String(requests[0].body)).reasoning_effort).toBe('high')
    await act(async () => { controller.enqueue(encoder.encode(event('turn_failed', { code: 'synthetic', message: 'synthetic' }))); controller.close() })
  })

  it('retries the original request even after the next-turn slider was changed', async () => {
    const { requests } = setup()
    mount()
    await openSettings()
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '2' } })
    closeTools()
    submit('原始请求')
    await screen.findByRole('button', { name: '重试本轮' })
    await openSettings()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
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
    expect(await screen.findByRole('slider')).toHaveValue('1')
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
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '0' } })
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
      if (path === '/api/agent/models') return json(++catalogs === 1 ? catalog : { ...catalog, items: [] })
      if (path === '/api/agent/turns') { requests.push(init!); return failed() }
      return json({ items: [] })
    }))
    const view = mount('first-owner')
    await openSettings()
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '2' } })
    view.rerender(<ResearchAgentConversationPage userId="second-owner" />)
    expect(await screen.findByText(/模型选择尚未启用/)).toBeVisible()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    closeTools()
    submit('另一个账号的新问题')
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0].body))).not.toHaveProperty('model_id')
    expect(catalogs).toBe(2)
  })

})
