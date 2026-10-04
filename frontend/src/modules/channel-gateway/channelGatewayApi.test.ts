import { afterEach, describe, expect, it, vi } from 'vitest'
import { channelGatewayApi, isSessionFailure } from './channelGatewayApi'

afterEach(() => vi.unstubAllGlobals())
function respond(data: unknown, status = 200) {
  const calls: Request[] = []
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    calls.push(request)
    return new Response(status === 204 ? null : JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    })
  }))
  return calls
}
describe('channelGatewayApi', () => {
  it('uses the generated owner contract, cookies and exact consent without a service credential', async () => {
    const calls = respond({ code: 'fixture-only', gateway_id: 'telegram:123', expires_at: 1800000000 })
    await channelGatewayApi.createCode('telegram:123')
    expect(new URL(calls[0].url).pathname).toBe('/api/channels/link-codes')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].credentials).toBe('include')
    expect(calls[0].headers.get('Authorization')).toBeNull()
    expect(await calls[0].json()).toEqual({ gateway_id: 'telegram:123', acknowledge_private_data_and_usage: true })
  })
  it('reads only public gateway data through its owner route', async () => {
    const calls = respond([])
    expect(await channelGatewayApi.gateways()).toEqual([])
    expect(new URL(calls[0].url).pathname).toBe('/api/channels/gateways')
    expect(calls[0].method).toBe('GET')
  })
  it('cancels by gateway identity without putting a one-time secret in a URL', async () => {
    const calls = respond(null, 204)
    await channelGatewayApi.cancelCode('feishu:cli_example:tenant')
    const url = new URL(calls[0].url)
    expect(calls[0].method).toBe('DELETE')
    expect(url.pathname).toBe('/api/channels/link-codes')
    expect([...url.searchParams]).toEqual([['gateway_id', 'feishu:cli_example:tenant']])
  })
  it('revoke targets a specific binding and treats 204 as success', async () => {
    const calls = respond(null, 204)
    await channelGatewayApi.revoke('fixture-binding')
    expect(new URL(calls[0].url).pathname).toBe('/api/channels/bindings/fixture-binding')
    expect(calls[0].method).toBe('DELETE')
  })
  it('propagates authentication failure without displaying upstream details', async () => {
    respond({ detail: 'must-not-display-server-secret' }, 401)
    try { await channelGatewayApi.bindings(); throw new Error('expected rejection') }
    catch (failure) {
      expect(isSessionFailure(failure)).toBe(true)
      expect(String(failure)).not.toContain('must-not-display-server-secret')
    }
  })
})
