import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountProvider } from '../modules/account'
import { AppRoutes } from './App'

// Keep the production AppRoutes, its location override, authentication provider,
// homepage, ResearchAgentPage wrapper and conversation controller all real.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); delete (HTMLElement.prototype as { animate?: unknown }).animate })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const catalog = { runtime_mode: 'base', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium' }] }
const question = '通过真实 App 首页发送'
function setup({ holdOpen = false, reducedMotion = false } = {}) {
  let failTurn = () => {}
  let disconnectTurn = () => {}
  let blockCatalog = false
  let releaseCatalog = () => {}
  const gate = new Promise<void>(resolve => { releaseCatalog = resolve })
  const requests: { body: Record<string, unknown>; key: string | null }[] = []
  const subscriptions: { runId: string; after: number; method: string; body: BodyInit | null | undefined }[] = []
  const runs = new Map<string, { id: string; sequence: number; attempt: number }>()
  const liveResponse = (run: { id: string; sequence: number; attempt: number }, command: boolean) => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      let open = true
      const emit = (name: string, data: unknown) => {
        if (open) controller.enqueue(encoder.encode(`id: ${run.id}:${++run.sequence}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      if (command) {
        emit('turn_started', { conversation_id: 'qa-live-conversation', run_id: run.id, attempt_id: `qa-attempt-${run.attempt}`, replayed: false, runtime_mode: 'base' })
        emit('agent_status', { status: 'thinking' })
      }
      failTurn = () => { if (open) { emit('turn_failed', { code: 'qa_failure', message: 'QA 失败，可重试' }); open = false; controller.close() } }
      disconnectTurn = () => { if (open) { open = false; controller.close() } }
    } })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost'), path = url.pathname
    if (path === '/api/agent/models') { if (blockCatalog) await gate; return json(catalog) }
    if (path === '/api/agent-profile') return json({ name: 'QA', avatar_id: 'cheng', color: '#5d8fe6', greeting: '', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1 })
    if (path === '/api/personal-graph') return json({ name: 'QA', avatar_id: 'cheng', color: '#5d8fe6', releaseId: 'qa', nodes: [], edges: [], sources: {}, document_count: 0, topic_count: 0, pending_count: 0, mode: 'mock' })
    if (path === '/api/agent/turns') {
      requests.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') })
      if (holdOpen) {
        const key = requests.at(-1)!.key!
        const run = runs.get(key) ?? { id: `qa-live-run-${runs.size + 1}`, sequence: 0, attempt: 0 }
        run.attempt += 1; runs.set(key, run)
        return liveResponse(run, true)
      }
      return new Response('event: turn_failed\ndata: {"code":"qa_failure","message":"QA 失败，可重试"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const eventRun = /^\/api\/agent\/runs\/([^/]+)\/events$/.exec(path)
    if (eventRun) {
      const run = [...runs.values()].find(value => value.id === eventRun[1])
      if (!run) throw new Error('cursor subscription must target an existing execution')
      subscriptions.push({ runId: run.id, after: Number(url.searchParams.get('after')), method: init?.method ?? 'GET', body: init?.body })
      return liveResponse(run, false)
    }
    return json({ items: [], next_cursor: null })
  }))
  const dock: Keyframe[][] = []
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLFormElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLFormElement) {
    return this.closest('.hm-me') ? new DOMRect(280, 390, 400, 56) : new DOMRect(500, 800, 720, 56)
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[]) {
    if (this.matches('.conversation-composer') && frames[0]?.transform) dock.push(frames)
    return { cancel() {}, finished: new Promise<void>(() => {}) }
  } })
  return { requests, subscriptions, dock, failTurn: () => failTurn(), disconnectTurn: () => disconnectTurn(), delayDestination: () => { blockCatalog = true }, releaseCatalog }
}
function HistoryControls() {
  const navigate = useNavigate(), location = useLocation(), action = useNavigationType()
  return <><button onClick={() => navigate(-1)}>QA Back</button><button onClick={() => navigate(1)}>QA Forward</button>
    <output data-testid="actual-history-action">{action}</output><output data-testid="actual-location">{location.pathname}</output></>
}
function mount(entry = '/app') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryDefaults(['account', 'session'], { staleTime: Infinity })
  client.setQueryData(['account', 'session'], { sessionId: 'qa-session', expiresAt: '2099-01-01T00:00:00Z', user: { userId: 'qa-owner', email: 'qa@example.invalid', displayName: null } })
  return render(<StrictMode><MemoryRouter initialEntries={[entry]}><QueryClientProvider client={client}><AccountProvider>
    <HistoryControls /><AppRoutes />
  </AccountProvider></QueryClientProvider></MemoryRouter></StrictMode>)
}
async function sendHome(delayDestination: () => void) {
  const input = await screen.findByRole('textbox', { name: '问QA' })
  const form = input.closest('form')!
  fireEvent.click(await within(form).findByRole('button', { name: /GPT 6 Luna · 中/ }))
  fireEvent.keyDown(within(form).getByRole('slider'), { key: 'End' })
  fireEvent.change(input, { target: { value: question } })
  delayDestination()
  fireEvent.click(within(form).getByRole('button', { name: '发送给 Everplain' }))
  await screen.findByRole('textbox', { name: '问 Everplain' })
}

it('preserves the real PUSH through App background-location routing, docks, and sends once after catalog readiness', async () => {
  const qa = setup()
  mount()
  await sendHome(qa.delayDestination)
  expect(screen.getByTestId('actual-history-action')).toHaveTextContent('PUSH')
  expect(document.querySelector('.cv-layout')).toHaveAttribute('data-empty', 'false')
  expect(document.querySelector('.cv-research-suggestions')).toBeNull()
  expect(screen.queryByRole('dialog', { name: '深入研究介绍' })).not.toBeInTheDocument()
  expect(qa.dock).not.toHaveLength(0)
  expect(qa.dock.at(-1)?.[0]).toMatchObject({ transform: 'translate(-220px, -410px)', width: '400px' })
  expect(qa.requests).toHaveLength(0)
  await act(async () => qa.releaseCatalog())
  await waitFor(() => expect(qa.requests).toHaveLength(1))
  expect(qa.requests[0].body).toMatchObject({ message: question, model_id: 'gpt-6-luna', reasoning_effort: 'high', workspace: 'agent' })
  await waitFor(() => expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue(question))
  fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' }))
  await waitFor(() => expect(qa.requests).toHaveLength(2))
  expect(qa.requests[1].key).toBe(qa.requests[0].key)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue(question))
  fireEvent.click(screen.getByText('QA Back'))
  await screen.findByRole('textbox', { name: '问QA' })
  fireEvent.click(screen.getByText('QA Forward'))
  await screen.findByRole('textbox', { name: '问 Everplain' })
  expect(qa.requests).toHaveLength(2)
})

it('still rejects a genuine POP before the pending destination catalog resolves', async () => {
  const qa = setup()
  mount()
  await sendHome(qa.delayDestination)
  fireEvent.click(screen.getByText('QA Back'))
  await screen.findByRole('textbox', { name: '问QA' })
  fireEvent.click(screen.getByText('QA Forward'))
  await screen.findByRole('textbox', { name: '问 Everplain' })
  expect(screen.getByTestId('actual-history-action')).toHaveTextContent('POP')
  await act(async () => qa.releaseCatalog())
  await screen.findByRole('button', { name: /模型与思考强度：GPT 6 Luna/ })
  expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue(question)
  expect(qa.requests).toHaveLength(0)
})


it.each([false, true])('preserves the real busy input focus and rejects duplicate sends with reduced-motion=%s', async reducedMotion => {
  const qa = setup({ holdOpen: true, reducedMotion })
  mount('/agent')
  const input = await screen.findByRole('textbox', { name: '问 Everplain' })
  await screen.findByRole('button', { name: /模型与思考强度：GPT 6 Luna/ })
  input.focus()
  fireEvent.change(input, { target: { value: question } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(qa.requests).toHaveLength(1))
  expect(screen.getByRole('textbox', { name: '问 Everplain' })).toBe(input)
  expect(input).toHaveFocus()
  expect(input).not.toBeDisabled()
  expect(input).toHaveAttribute('readonly')
  expect(input).toHaveValue('')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter', repeat: true })
  fireEvent.submit(input.closest('form')!)
  fireEvent.change(input, { target: { value: '生成中不允许编辑' } })
  expect(input).toHaveValue('')
  expect(qa.requests).toHaveLength(1)
  await act(async () => qa.disconnectTurn())
  await waitFor(() => expect(qa.subscriptions).toHaveLength(1), { timeout: 1500 })
  expect(qa.requests).toHaveLength(1)
  expect(qa.subscriptions[0]).toEqual({ runId: 'qa-live-run-1', after: 2, method: 'GET', body: undefined })
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('readonly')
  await act(async () => qa.failTurn())
  await waitFor(() => expect(input).toHaveValue(question))
  expect(input).not.toHaveAttribute('readonly')
  expect(input).toHaveFocus()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(qa.requests).toHaveLength(2))
  expect(qa.requests[1].key).toBe(qa.requests[0].key)
  expect(qa.requests[1].body).toEqual({ ...qa.requests[0].body, conversation_id: 'qa-live-conversation' })
  expect(qa.subscriptions).toHaveLength(1)
  await act(async () => qa.failTurn())
  await waitFor(() => expect(input).toHaveValue(question))
  const nextQuestion = '第二条真实新消息'
  fireEvent.change(input, { target: { value: nextQuestion } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(qa.requests).toHaveLength(3))
  expect(qa.requests[2].body).toMatchObject({ message: nextQuestion, conversation_id: 'qa-live-conversation', model_id: 'gpt-6-luna', reasoning_effort: 'medium' })
  expect(qa.requests[2].key).not.toBe(qa.requests[0].key)
  expect(input).toHaveFocus(); expect(input).toHaveAttribute('readonly')
  await act(async () => qa.failTurn())
  await waitFor(() => expect(input).toHaveValue(nextQuestion))
})
