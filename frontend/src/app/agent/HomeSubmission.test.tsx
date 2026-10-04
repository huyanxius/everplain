import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { ResearchAgentConversationPage, seedAgentDraft } from './ResearchAgentConversationPage'
import { createHomeSubmission, readHomeSubmission } from '../conversation-view/homeSubmission'

vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(async () => ({ name: 'Everplain', avatar_id: 'cheng', color: '#b8c5b0', greeting: '', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1 })) }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })
const catalog = { runtime_mode: 'base', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium' }] }
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const question = '首页明确发送的问题'
let intentId: string

function setup({ delay = false, incompatible = false } = {}) {
  const requests: { body: Record<string, unknown>; key: string | null }[] = []
  let release = () => {}
  const gate = delay ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
    if (path === '/api/agent/models') { await gate; return json(incompatible ? { ...catalog, items: [{ ...catalog.items[0], reasoning_efforts: ['medium'] }] } : catalog) }
    if (path === '/api/agent/turns') {
      requests.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') })
      return new Response('event: turn_failed\ndata: {"code":"qa_failure","message":"QA 失败，可重试"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return json({ items: [] })
  }))
  return { requests, release }
}
function Entry() {
  const navigate = useNavigate()
  return <button onClick={() => {
    seedAgentDraft('owner', question)
    intentId = createHomeSubmission('owner', question, { modelId: 'gpt-6-luna', reasoningEffort: 'high' })
    navigate('/agent', { state: { homeSubmitId: intentId } })
  }}>首页发送</button>
}
function Navigation() {
  const navigate = useNavigate(), location = useLocation()
  return <><button onClick={() => navigate(-1)}>返回</button><button onClick={() => navigate(1)}>前进</button><output data-testid="route">{location.pathname}</output></>
}
function mount({ owner = 'owner', entry = '/' as string | { pathname: string; state: unknown } } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<StrictMode><QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Navigation /><Routes>
    <Route path="/" element={<Entry />} /><Route path="/agent" element={<ResearchAgentConversationPage userId={owner} />} />
  </Routes></MemoryRouter></QueryClientProvider></StrictMode>)
}

it('waits for the owning live catalog, sends once in StrictMode, and retries with the original model and key', async () => {
  const { requests, release } = setup({ delay: true })
  mount()
  fireEvent.click(screen.getByText('首页发送'))
  expect(await screen.findByRole('textbox')).toHaveValue(question)
  expect(screen.getByRole('button', { name: '发送给 Everplain' })).toBeDisabled()
  expect(requests).toHaveLength(0)
  await act(async () => release())
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0].body).toMatchObject({ message: question, model_id: 'gpt-6-luna', reasoning_effort: 'high', mode: 'standard', workspace: 'agent' })
  expect(requests[0].key).toBe(intentId)
  expect(readHomeSubmission(intentId, 'owner')).toBeNull()
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(question))
  expect(localStorage.getItem('everplain.agent.composer-draft.v2.owner.draft.agent.independent')).toBe(question)
  fireEvent.submit(screen.getByRole('textbox').closest('form')!)
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1]).toEqual(requests[0])
})

it('does not turn a stored draft or refresh/history state into permission to send', async () => {
  const { requests } = setup()
  seedAgentDraft('owner', '从未发送的旧草稿')
  mount({ entry: { pathname: '/agent', state: { homeSubmitId: 'a-stale-history-id' } } })
  await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
  expect(screen.getByRole('textbox')).toHaveValue('从未发送的旧草稿')
  expect(requests).toHaveLength(0)
})

it('does not replay a consumed intent after a refresh-like remount', async () => {
  const { requests } = setup()
  const first = mount()
  fireEvent.click(screen.getByText('首页发送'))
  await waitFor(() => expect(requests).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(question))
  first.unmount()
  mount({ entry: { pathname: '/agent', state: { homeSubmitId: intentId } } })
  await screen.findByRole('button', { name: /GPT 6 Luna/ })
  expect(screen.getByRole('textbox')).toHaveValue(question)
  expect(requests).toHaveLength(1)
})

it('does not send for another owner', async () => {
  const { requests } = setup()
  mount({ owner: 'other-owner' })
  fireEvent.click(screen.getByText('首页发送'))
  await screen.findByRole('button', { name: /GPT 6 Luna · 中/ })
  expect(screen.getByRole('textbox')).toHaveValue('')
  expect(requests).toHaveLength(0)
})

it('does not auto-send when Back and Forward restore an unconsumed route', async () => {
  const { requests, release } = setup({ delay: true })
  mount()
  fireEvent.click(screen.getByText('首页发送'))
  await screen.findByRole('textbox')
  fireEvent.click(screen.getByText('返回'))
  expect(screen.getByTestId('route')).toHaveTextContent('/')
  fireEvent.click(screen.getByText('前进'))
  await act(async () => release())
  await screen.findByRole('button', { name: /GPT 6 Luna/ })
  expect(screen.getByRole('textbox')).toHaveValue(question)
  expect(requests).toHaveLength(0)
})

it('preserves the question if the chosen effort disappeared from the catalog', async () => {
  const { requests } = setup({ incompatible: true })
  mount()
  fireEvent.click(screen.getByText('首页发送'))
  await screen.findByText('所选模型暂时不可用。问题已保留，请选择模型后重试。')
  expect(screen.getByRole('textbox')).toHaveValue(question)
  expect(requests).toHaveLength(0)
  expect(readHomeSubmission(intentId, 'owner')).toBeNull()
})

it('editing a question while catalog loading cancels the queued send', async () => {
  const { requests, release } = setup({ delay: true })
  mount()
  fireEvent.click(screen.getByText('首页发送'))
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: '我改了，先不发送' } })
  await act(async () => release())
  await screen.findByRole('button', { name: /GPT 6 Luna/ })
  expect(screen.getByRole('textbox')).toHaveValue('我改了，先不发送')
  expect(requests).toHaveLength(0)
})


it('keeps the explicit question in memory when browser draft storage is unavailable', async () => {
  const { requests, release } = setup({ delay: true })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  mount()
  fireEvent.click(screen.getByText('首页发送'))
  expect(await screen.findByRole('textbox')).toHaveValue(question)
  await act(async () => release())
  await waitFor(() => expect(requests).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(question))
})
