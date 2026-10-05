import { afterEach, expect, it, vi } from 'vitest'
import { productCatalog } from './productIntegrationsApi'
afterEach(() => vi.unstubAllGlobals())
it('loads authoritative product data from the public catalog endpoint', async () => {
  const payload = { plans: [{ id: 'plus', name: 'Plus', price_cny_fen: 4900, weekly_points: 50, period_days: 28, period_points: 200 }], free_weekly_points: 30, reset_days: 7, top_up_points: 50, top_up_price_cny_fen: 1500, payments_enabled: false, agent_models: [], runtime_mode: 'base' }
  const fetchMock = vi.fn(async (_request: RequestInfo | URL) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(productCatalog()).resolves.toEqual(payload)
  expect(new URL((fetchMock.mock.calls[0][0] as Request).url).pathname).toBe('/api/product-catalog')
})
