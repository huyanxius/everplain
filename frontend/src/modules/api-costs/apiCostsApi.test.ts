import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiCostsApi } from './apiCostsApi'
import { ApiCostsRequestError } from './apiCostsModel'

const rawMetrics = {
  attempt_count: 7, confirmed_usage_attempts: 3, confirmed_token_attempts: 2,
  unpriced_attempts: 1, unknown_usage_attempts: 3, not_sent_attempts: 1,
  active_reserved_attempts: 1, pending_unknown_attempts: 2, missing_token_attempts: 1, unverified_procurement_attempts: 6,
  input_tokens: 100, output_tokens: 40, cache_read_tokens: 20, cache_write_tokens: null, reasoning_tokens: null,
  cache_read_reported_attempts: 1, cache_write_reported_attempts: 0, reasoning_reported_attempts: 0,
  reference_cost_pico: '9007199254740993123456789', active_reserved_cost_pico: '3000000000000', pending_unknown_cost_pico: '4000000000000', actual_procurement_cost_pico: null,
}
const rawReport = {
  start_date: '2026-10-01', end_date: '2026-10-05', timezone: 'UTC', date_basis: 'attempt_created_at', currency: 'USD', group_by: 'model',
  filters: { model: null, provider_host: null, endpoint_id: null, user_id: null }, summary: rawMetrics,
  items: [{ ...rawMetrics, group_value: null }], total_groups: 26, next_cursor: 25,
  procurement_evidence_status: 'unavailable', key_attribution_available: false, coverage: 'durable_billing_attempts_only', generated_at: '2026-10-05T19:00:00Z',
}
const query = { startDate: '2026-10-01', endDate: '2026-10-05', groupBy: 'model' as const, model: '', providerHost: '', endpointId: '', userId: '', cursor: 0, limit: 25 }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }

afterEach(() => vi.unstubAllGlobals())

describe('API cost report adapter', () => {
  it('reads the generated endpoint with included credentials and exact filter/cursor values', async () => {
    const fetchMock = vi.fn(async (_request: Request) => json(rawReport))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await apiCostsApi.read({ ...query, model: 'model/a', providerHost: 'provider.example', endpointId: 'endpoint-1', userId: 'user-1', groupBy: 'provider_host', cursor: 25, limit: 50 }, controller.signal)
    const request = fetchMock.mock.calls[0][0]
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(request.credentials).toBe('include')
    expect(url.pathname).toBe('/api/admin/api-costs')
    expect(Object.fromEntries(url.searchParams)).toEqual({ start_date: '2026-10-01', end_date: '2026-10-05', model: 'model/a', provider_host: 'provider.example', endpoint_id: 'endpoint-1', user_id: 'user-1', group_by: 'provider_host', cursor: '25', limit: '50' })
    controller.abort()
    expect(request.signal.aborted).toBe(true)
    expect(result).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-05', totalGroups: 26, nextCursor: 25, generatedAt: '2026-10-05T19:00:00Z' })
    expect(result.summary).toMatchObject({ attemptCount: 7, confirmedUsageAttempts: 3, confirmedTokenAttempts: 2, unpricedAttempts: 1, unknownUsageAttempts: 3, notSentAttempts: 1, activeReservedAttempts: 1, pendingUnknownAttempts: 2, missingTokenAttempts: 1, unverifiedProcurementAttempts: 6, referenceCostPico: '9007199254740993123456789', actualProcurementCostPico: null, cacheWriteTokens: null, reasoningTokens: null, cacheReadReportedAttempts: 1 })
    expect(result.items[0].groupValue).toBeNull()
  })

  it('omits empty exact-match filters without inferring provider or user identities', async () => {
    const fetchMock = vi.fn(async (_request: Request) => json(rawReport))
    vi.stubGlobal('fetch', fetchMock)
    await apiCostsApi.read(query)
    const params = new URL(fetchMock.mock.calls[0][0].url).searchParams
    for (const key of ['model', 'provider_host', 'endpoint_id', 'user_id']) expect(params.has(key)).toBe(false)
  })

  it.each([401, 403, 422, 500])('preserves %i status for page recovery without exposing server payloads', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'internal traceback must not leak' }, status)))
    await expect(apiCostsApi.read(query)).rejects.toMatchObject({ name: 'ApiCostsRequestError', status })
    try { await apiCostsApi.read(query) } catch (error) {
      expect(error).toBeInstanceOf(ApiCostsRequestError)
      expect((error as Error).message).not.toContain('traceback')
    }
  })
})
