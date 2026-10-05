import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPublicProductCatalog, supportedPublicModels } from './productCatalogApi'
import type { PublicProductCatalog } from './productDocs'
const base: PublicProductCatalog = {
  plans: [{ id: 'plus', name: 'Plus', description: '', price_cny_fen: 4900, weekly_points: 50, period_days: 28, period_points: 200 }],
  free_weekly_points: 30, reset_days: 7, top_up_points: 50, top_up_price_cny_fen: 1500,
  payments_enabled: false, runtime_mode: 'base',
  agent_models: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['low', 'medium'], default_reasoning_effort: 'medium' }],
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })
describe('public catalog adapter', () => {
  it('calls only the public generated read API and passes its abort signal', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(base), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    expect(await readPublicProductCatalog(controller.signal)).toEqual(base)
    expect(fetcher).toHaveBeenCalledOnce()
    const request = (fetcher.mock.calls[0] as unknown as [Request])[0]
    expect(request.url).toContain('/api/product-catalog')
    expect(request.method).toBe('GET')
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })
  it('does not turn an API error into a static advertised catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    await expect(readPublicProductCatalog()).rejects.toThrow('暂时无法读取')
  })
  it('accepts an empty live model catalog and effort-free models', () => {
    expect(supportedPublicModels([])).toEqual([])
    const models = [{ ...base.agent_models[0], reasoning_efforts: [], default_reasoning_effort: null }]
    expect(supportedPublicModels(models)).toEqual(models)
  })
  it.each([
    { model_id: '' }, { reasoning_efforts: ['unsupported'], default_reasoning_effort: 'unsupported' },
    { default_reasoning_effort: 'max' }, { default_reasoning_effort: null }, { reasoning_efforts: ['medium', 'medium'] },
  ])('keeps known model controls when another model has incompatible fields %#', patch => {
    const newer = { ...base.agent_models[0], model_id: 'newer-model', ...patch }
    expect(supportedPublicModels([...base.agent_models, newer])).toEqual(base.agent_models)
    expect(base.plans).toHaveLength(1)
  })
  it('does not produce duplicate selector entries', () => {
    expect(supportedPublicModels([...base.agent_models, ...base.agent_models])).toEqual(base.agent_models)
  })
})
