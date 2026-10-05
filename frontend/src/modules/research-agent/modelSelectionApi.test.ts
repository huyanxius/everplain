import { afterEach, describe, expect, it, vi } from 'vitest'

const listModels = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', () => ({ apiClient: { buildUrl: ({ url, path, query }: {
  url: string
  path?: Record<string, unknown>
  query?: Record<string, unknown>
}) => {
  const resolvedPath = Object.entries(path ?? {}).reduce(
    (current, [key, value]) => current.replace(`{${key}}`, encodeURIComponent(String(value))),
    url,
  )
  const suffix = query ? `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}` : ''
  return `https://synthetic.test${resolvedPath}${suffix}`
} } }))
vi.mock('../../api/generated', () => ({ listAgentModels: listModels, editAgentCanvasNode: vi.fn() }))
import { getAgentModelCatalog, streamAgentTurn } from './researchAgentApi'
import type { AgentReasoningEffort } from './model'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); listModels.mockReset() })
const terminal = () => new Response('event: turn_interrupted\ndata: {"code":"interrupted","message":"synthetic"}\n\n')

describe('per-turn model selection API', () => {
  it('projects only safe server catalog fields for the controls', async () => {
    listModels.mockResolvedValue({ data: { runtime_mode: 'mock', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium' }] } })
    expect(await getAgentModelCatalog()).toEqual({ runtimeMode: 'mock', models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }] })
  })

  it('fails closed when catalog loading fails', async () => {
    listModels.mockResolvedValue({ error: { detail: 'synthetic failure' } })
    await expect(getAgentModelCatalog()).rejects.toThrow('无法加载可用模型')
  })

  it.each(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as AgentReasoningEffort[])('sends %s on the real turn body whitelist', async reasoning_effort => {
    const fetch = vi.fn(async () => terminal())
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'synthetic', model_id: 'gpt-6-luna', reasoning_effort, idempotencyKey: 'selection' }, () => undefined)
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.model_id).toBe('gpt-6-luna')
    expect(body.reasoning_effort).toBe(reasoning_effort)
    expect(body).not.toHaveProperty('api_key')
    expect(body).not.toHaveProperty('base_url')
  })

  it('omits both fields for legacy clients rather than changing their runtime', async () => {
    const fetch = vi.fn(async () => terminal())
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'synthetic', idempotencyKey: 'legacy' }, () => undefined)
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).not.toHaveProperty('model_id')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it.each([0, 2])('preserves the original model and effort through read-only recovery after %i cursor GET failures', async cursorFailures => {
    vi.useFakeTimers()
    const originalRequest = { message: 'synthetic', model_id: 'gpt-6-luna', reasoning_effort: 'high' as const }
    const snapshot = {
      run_id: 'run-1',
      conversation_id: 'conversation-1',
      idempotency_key: 'retry',
      status: 'running',
      request: originalRequest,
      partial_answer: 'already persisted',
      last_event_sequence: 7,
      cancel_requested: false,
    }
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('synthetic initial response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }))
    for (let failure = 0; failure < cursorFailures; failure += 1) {
      fetch.mockRejectedValueOnce(new TypeError('synthetic cursor transport failure'))
    }
    fetch.mockResolvedValueOnce(new Response('id: run-1:8\nevent: turn_interrupted\ndata: {"code":"interrupted","message":"synthetic"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const events = vi.fn()
    const request = streamAgentTurn({ ...originalRequest, idempotencyKey: 'retry' }, events)
    await vi.runAllTimersAsync()
    await request

    const calls = fetch.mock.calls as [string, RequestInit][]
    const executionCalls = calls.filter(([, init]) => init.method === 'POST')
    expect(executionCalls).toHaveLength(1)
    expect(executionCalls[0][0]).toBe('https://synthetic.test/api/agent/turns')
    expect(executionCalls[0][1]).toMatchObject({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Idempotency-Key': 'retry' },
    })
    expect(JSON.parse(executionCalls[0][1].body as string)).toEqual({
      ...originalRequest,
      mode: 'standard',
      workspace: 'agent',
      web_search: false,
      task_id: null,
      document_id: null,
      section_id: null,
      document_version: null,
      theory_plan_id: null,
      material_ids: [],
      reference_knowledge_base_id: null,
      knowledge_index_action: null,
      deep_research_run_id: null,
      deep_research_action: null,
      deep_research_selection: null,
    })

    const [lookupUrl, lookup] = calls[1]
    expect(lookupUrl).toBe('https://synthetic.test/api/agent/runs/by-idempotency-key')
    expect(lookup.method ?? 'GET').toBe('GET')
    expect(lookup).toMatchObject({ credentials: 'include', cache: 'no-store', headers: { 'Idempotency-Key': 'retry' } })
    expect(lookup).not.toHaveProperty('body')

    const cursorCalls = calls.slice(2)
    expect(cursorCalls).toHaveLength(cursorFailures + 1)
    for (const [url, subscription] of cursorCalls) {
      expect(url).toBe('https://synthetic.test/api/agent/runs/run-1/events?after=7')
      expect(subscription.method ?? 'GET').toBe('GET')
      expect(subscription).toMatchObject({ credentials: 'include', headers: { 'Accept': 'text/event-stream' } })
      expect(subscription).not.toHaveProperty('body')
    }
    expect(events.mock.calls.map(([event]) => event)).toEqual([
      { type: 'turn_snapshot', run: snapshot },
      { type: 'turn_interrupted', code: 'interrupted', message: 'synthetic', event_id: 'run-1:8' },
    ])
    expect(events.mock.calls[0][0].run.request).toEqual(originalRequest)
  })

  it('surfaces a clear server model-selection rejection without retrying it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: '当前模型路由不支持所选思考强度，请重新选择。' }), { status: 422 }))
    vi.stubGlobal('fetch', fetch)
    await expect(streamAgentTurn({ message: 'synthetic', model_id: 'gpt-6-luna', reasoning_effort: 'max', idempotencyKey: 'invalid' }, () => undefined)).rejects.toThrow('不支持所选思考强度')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})


it('projects no-effort catalog entries and preserves explicit null on the wire', async () => {
  listModels.mockResolvedValue({ data: { runtime_mode: 'base', items: [{ model_id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoning_efforts: [], default_reasoning_effort: null }] } })
  expect((await getAgentModelCatalog()).models[0]).toEqual({ id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoningEfforts: [], defaultReasoningEffort: null })
  const fetch = vi.fn(async () => terminal())
  vi.stubGlobal('fetch', fetch)
  await streamAgentTurn({ message: 'synthetic', model_id: 'gemini-3.5-flash', reasoning_effort: null, idempotencyKey: 'no-effort' }, () => undefined)
  const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(body).toMatchObject({ model_id: 'gemini-3.5-flash', reasoning_effort: null })
})
