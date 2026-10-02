import { afterEach, describe, expect, it, vi } from 'vitest'

const listModels = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', () => ({ apiClient: { buildUrl: ({ url }: { url: string }) => `https://synthetic.test${url}` } }))
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

  it('preserves the selected model and effort through transport retries', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('synthetic offline')).mockImplementation(async () => terminal())
    vi.stubGlobal('fetch', fetch)
    const request = streamAgentTurn({ message: 'synthetic', model_id: 'gpt-6-luna', reasoning_effort: 'high', idempotencyKey: 'retry' }, () => undefined)
    await vi.advanceTimersByTimeAsync(250)
    await request
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key'])
  })

  it('surfaces a clear server model-selection rejection without retrying it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: '当前模型路由不支持所选思考强度，请重新选择。' }), { status: 422 }))
    vi.stubGlobal('fetch', fetch)
    await expect(streamAgentTurn({ message: 'synthetic', model_id: 'gpt-6-luna', reasoning_effort: 'max', idempotencyKey: 'invalid' }, () => undefined)).rejects.toThrow('不支持所选思考强度')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
