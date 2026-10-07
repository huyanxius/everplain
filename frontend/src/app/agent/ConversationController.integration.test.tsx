import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentRunRecovery } from '../../modules/research-agent'
import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: async () => ({ name: 'Everplain', avatar_id: 'cheng', color: '#7c5cfc' }) }))

beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', addEventListener: vi.fn(), removeEventListener: vi.fn() })))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })
function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }) }
function urlFor(input: RequestInfo | URL) { return new URL(input instanceof Request ? input.url : input.toString(), 'http://localhost') }
function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
function eventStream(events: Array<[string, unknown]>) { return `${events.map(([name, payload]) => `event: ${name}\ndata: ${JSON.stringify(payload)}`).join('\n\n')}\n\n` }
function deferredStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), { headers: { 'Content-Type': 'text/event-stream' } })
  return { response, push(events: Array<[string, unknown]>) { controller.enqueue(new TextEncoder().encode(eventStream(events))) }, finish() { controller.close() } }
}
const fullBody = '原始正文 😀 第一段。\n\n第二段没有保存，但必须仍可复制。'
const savedBody = '原始正文 😀 第一段。'
const tombstone = '该回答引用的个人研究材料已删除，原回答内容已隐藏。'
const pending = { question: '改进原文', idempotencyKey: 'writing-ui:rewrite:stable-key', conversationId: 'conversation-a', runId: 'run-a', materialIds: [], request: { message: '改进原文', conversation_id: 'conversation-a', model_id: 'original-model', reasoning_effort: 'high' as const, writing_context: { document_id: 'doc-a', document_version: 7 } } }
function seedLocal({ emptyQuestion = false, runId = 'run-a', key = pending.idempotencyKey } = {}) {
  const scope = 'owner.conversation.conversation-a'
  localStorage.setItem(`everplain.agent.pending-turn.v2.${scope}`, JSON.stringify({ ...pending, idempotencyKey: key, runId }))
  localStorage.setItem(`everplain.agent.interrupted-turn.v2.${scope}`, JSON.stringify({ question: emptyQuestion ? '' : pending.question, runId, attemptId: 'attempt-a', answer: fullBody, outputPersistenceFailed: true, outputAttempts: [{ attempt_id: 'attempt-a', ordinal: 1, status: 'failed', answer: savedBody, created_at: '2026-10-06T00:00:00Z' }], citations: [], toolSteps: [], canvasPatches: [], startedAt: 1791244800000, interrupted: true }))
}
function recovery({ redacted = false, runId = 'run-a', key = pending.idempotencyKey } = {}): AgentRunRecovery {
  return { run_id: runId, idempotency_key: key, status: 'failed', request: pending.request, partial_answer: redacted ? tombstone : savedBody, output_attempts: [{ attempt_id: 'attempt-a', ordinal: 1, status: 'failed', answer: redacted ? tombstone : savedBody, created_at: '2026-10-06T00:00:00Z' }], tool_summary: [], updated_at: '2026-10-06T00:00:00Z', cancel_requested: false }
}
function conversation(run: AgentRunRecovery): AgentConversation { return { conversation_id: 'conversation-a', title: '对话A', created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z', turn_count: 0, turns: [], unfinished_runs: [run] } }
function bodyVisible(text: string) { return Boolean(document.body.textContent?.includes(text.replaceAll('\n', '')) || document.body.textContent?.includes(text)) }

it('controller integration: restores hidden automatic-writing body before a slow conversation read', async () => {
  seedLocal({ emptyQuestion: true })
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => urlFor(input).pathname.endsWith('/conversations/conversation-a') ? new Promise<Response>(() => {}) : Promise.resolve(json({ items: [], tasks: [] }))))
  render(<MemoryRouter><ResearchAgentConversationPage embedded userId="owner" conversationId="conversation-a" writingDocumentId="doc-a" /></MemoryRouter>)
  await waitFor(() => expect(bodyVisible('第二段没有保存，但必须仍可复制。')).toBe(true))
  expect(document.querySelector('[data-role="user-message"]')).not.toBeInTheDocument()
})

it.each(['same-run', 'redacted', 'partial-redacted', 'archive-redacted', 'other-run', 'other-key'] as const)('controller integration: reconciles stored unsaved tail against server recovery %s', async variant => {
  seedLocal()
  const run = recovery({ redacted: variant === 'redacted', runId: variant === 'other-run' ? 'run-b' : 'run-a', key: variant === 'other-key' ? 'different-command' : pending.idempotencyKey })
  if (variant === 'partial-redacted') run.partial_answer = tombstone
  if (variant === 'archive-redacted') run.output_attempts = [{ ...run.output_attempts![0], attempt_id: 'earlier-attempt', answer: tombstone }, ...run.output_attempts!]
  const posts = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = urlFor(input).pathname
    if (init?.method === 'POST') posts()
    return path.endsWith('/conversations/conversation-a') ? json(conversation(run)) : json({ items: [], tasks: [] })
  }))
  render(<MemoryRouter><ResearchAgentConversationPage embedded userId="owner" conversationId="conversation-a" writingDocumentId="doc-a" /></MemoryRouter>)
  await screen.findByText('这轮回答未完成，可以从保存的位置重试。')
  expect(bodyVisible('第二段没有保存，但必须仍可复制。')).toBe(variant === 'same-run')
  if (variant.includes('redacted')) expect(screen.getAllByText(tombstone).length).toBeGreaterThan(0)
  expect(posts).not.toHaveBeenCalled()
})

it('controller integration: old writing preparation failure cannot set an error in a replacement document', async () => {
  let rejectPreparation!: (reason: Error) => void
  const prepare = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectPreparation = reject }))
  const posts = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { if (init?.method === 'POST') posts(); return json({ items: [], tasks: [] }) }))
  const page = (documentId: string) => <MemoryRouter><ResearchAgentConversationPage embedded userId="owner" writingDocumentId={documentId} prepareWritingContext={prepare} /></MemoryRouter>
  const view = render(page('doc-a'))
  const input = await screen.findByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: '请改A文稿' } }); fireEvent.submit(input.closest('form')!)
  expect(prepare).toHaveBeenCalledTimes(1)
  view.rerender(page('doc-b'))
  await act(async () => rejectPreparation(new Error('A文稿保存失败，不属于B')))
  expect(screen.queryByText('A文稿保存失败，不属于B')).not.toBeInTheDocument()
  expect(posts).not.toHaveBeenCalled()
})

it('controller integration: old stream events and finalizer cannot end a replacement document preview', async () => {
  const old = deferredStream(), current = deferredStream(), received = vi.fn(), ended = vi.fn()
  let posts = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = urlFor(input).pathname
    if (path === '/api/agent/turns') return ++posts === 1 ? old.response : current.response
    return json({ items: [], tasks: [] })
  }))
  const page = (documentId: string) => <MemoryRouter><ResearchAgentConversationPage embedded userId="owner" writingDocumentId={documentId} onWritingPreview={received} onWritingPreviewEnded={ended} /></MemoryRouter>
  const view = render(page('doc-a'))
  const input = await screen.findByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: 'A的问题' } }); fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(posts).toBe(1))
  await act(async () => old.push([['turn_started', { run_id: 'run-a', conversation_id: 'conversation-a', attempt_id: 'attempt-a', replayed: false }]]))
  view.rerender(page('doc-b'))
  fireEvent.change(input, { target: { value: 'B的问题' } }); fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(posts).toBe(2))
  const preview = { run_id: 'run-b', attempt_id: 'attempt-b', call_id: 'call-b', document_id: 'doc-b', base_version: 1, selection_start: 0, selection_end: 0, sequence: 1, replacement_text: 'B预览正文', state: 'streaming' }
  await act(async () => current.push([['turn_started', { run_id: 'run-b', conversation_id: 'conversation-b', attempt_id: 'attempt-b', replayed: false }], ['writing_preview', preview]]))
  expect(received).toHaveBeenCalledTimes(1)
  await act(async () => { old.push([['assistant_delta', { delta: 'A的迟到旁白' }], ['writing_preview', { ...preview, run_id: 'run-a', attempt_id: 'attempt-a', document_id: 'doc-a' }], ['turn_interrupted', { code: 'stop', message: 'stopped' }]]); old.finish() })
  expect(received).toHaveBeenCalledTimes(1)
  expect(ended).not.toHaveBeenCalled()
  expect(screen.queryByText('A的迟到旁白')).not.toBeInTheDocument()
  await act(async () => { current.push([['turn_interrupted', { code: 'stop', message: 'stopped' }]]); current.finish() })
  await waitFor(() => expect(ended).toHaveBeenCalledTimes(1))
})

it.each(['resolve', 'reject'] as const)('controller integration: replaced writing preparation %s cannot unlock the next save or duplicate its command', async outcome => {
  type Context = { document_id: string; document_version: number }
  const promises: Array<{ resolve: (value: Context) => void; reject: (reason: Error) => void }> = []
  const prepare = vi.fn(() => new Promise<Context>((resolve, reject) => promises.push({ resolve, reject })))
  const requests: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (urlFor(input).pathname === '/api/agent/turns') {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(eventStream([['turn_failed', { code: 'agent_unavailable', message: '受控测试结束' }]]), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return json({ items: [], tasks: [] })
  }))
  const page = (documentId: string) => <MemoryRouter><ResearchAgentConversationPage embedded userId="owner" writingDocumentId={documentId} prepareWritingContext={prepare} /></MemoryRouter>
  const view = render(page('doc-a'))
  let input = await screen.findByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: 'A修改要求' } }); fireEvent.submit(input.closest('form')!)
  view.rerender(page('doc-b'))
  input = screen.getByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: 'B修改要求' } }); fireEvent.submit(input.closest('form')!)
  expect(prepare).toHaveBeenCalledTimes(2)
  await act(async () => outcome === 'resolve' ? promises[0].resolve({ document_id: 'doc-a', document_version: 1 }) : promises[0].reject(new Error('A已过期错误')))
  expect(requests).toHaveLength(0)
  fireEvent.submit(input.closest('form')!)
  expect(prepare).toHaveBeenCalledTimes(2)
  await act(async () => promises[1].resolve({ document_id: 'doc-b', document_version: 3 }))
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({ message: 'B修改要求', writing_context: { document_id: 'doc-b', document_version: 3 } })
  expect(screen.queryByText('A已过期错误')).not.toBeInTheDocument()
})

it('controller integration: confirmed server-completed stop ends the current writing preview', async () => {
  const stream = deferredStream(), received = vi.fn(), ended = vi.fn()
  let stops = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = urlFor(input).pathname
    if (path === '/api/agent/turns') return stream.response
    if (path === '/api/agent/runs/run-a/stop') { stops += 1; return json({ run_id: 'run-a', status: 'completed', cancel_requested: false }) }
    if (path.endsWith('/conversations/conversation-a')) return json({ ...conversation(recovery()), unfinished_runs: [] })
    return json({ items: [], tasks: [] })
  }))
  render(<MemoryRouter><ResearchAgentConversationPage embedded userId="owner" writingDocumentId="doc-a" onWritingPreview={received} onWritingPreviewEnded={ended} /></MemoryRouter>)
  const input = await screen.findByRole('textbox', { name: '问 Everplain' })
  fireEvent.change(input, { target: { value: '修改文稿' } }); fireEvent.submit(input.closest('form')!)
  await act(async () => stream.push([
    ['turn_started', { run_id: 'run-a', conversation_id: 'conversation-a', attempt_id: 'attempt-a', replayed: false }],
    ['writing_preview', { run_id: 'run-a', attempt_id: 'attempt-a', call_id: 'call-a', document_id: 'doc-a', base_version: 1, selection_start: 0, selection_end: 0, sequence: 1, replacement_text: '尚未收到ready的草稿', state: 'streaming' }],
  ]))
  expect(received).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  await waitFor(() => expect(stops).toBe(1))
  await act(async () => stream.finish())
  await waitFor(() => expect(ended).toHaveBeenCalledTimes(1))
})
