import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelBindingsPanel } from './ChannelBindingsPanel'
import { channelGatewayApi } from './channelGatewayApi'
import type { ChannelBinding, ChannelGatewayApi, ChannelGrant } from './channelGatewayApi'

const text = (zh: string) => zh
const gateways = [
  { gateway_id: 'telegram:123', platform: 'telegram' as const, name: 'Telegram 测试机器人', bot_url: 'https://t.me/FixtureBot' },
  { gateway_id: 'feishu:cli_test:tenant', platform: 'feishu' as const, name: '飞书测试机器人', bot_url: null },
]
const binding: ChannelBinding = { binding_id: 'binding-a', gateway_id: 'telegram:123', subject_id: '77', created_at: 1791010000 }
function api(overrides: Partial<ChannelGatewayApi> = {}): ChannelGatewayApi {
  return { gateways: vi.fn(async () => gateways), bindings: vi.fn(async () => []),
    createCode: vi.fn(async gateway_id => ({ gateway_id, code: 'fixture-private-code', expires_at: Math.floor(Date.now() / 1000) + 600 })),
    cancelCode: vi.fn(async () => {}), revoke: vi.fn(async () => {}), ...overrides }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function ready(service = api()) {
  const view = render(<ChannelBindingsPanel userId="owner-a" text={text} api={service} />)
  await screen.findByRole('button', { name: '生成一次性绑定码' })
  return view
}
function consent() { fireEvent.click(screen.getByRole('checkbox')) }
async function generate() {
  consent()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '生成一次性绑定码' })) })
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ChannelBindingsPanel', () => {
  it('shows a truthful disabled state when no platform is configured', async () => {
    const service = api({ gateways: vi.fn(async () => []) })
    render(<ChannelBindingsPanel userId="owner-a" text={text} api={service} />)
    await screen.findByText(/聊天平台尚未启用/)
    expect(screen.queryByRole('button', { name: '生成一次性绑定码' })).toBeNull()
    expect(service.createCode).not.toHaveBeenCalled()
  })
  it('requires informed consent and de-duplicates repeated generation', async () => {
    const pending = deferred<ChannelGrant>()
    const service = api({ createCode: vi.fn(() => pending.promise) })
    await ready(service)
    const button = screen.getByRole('button', { name: '生成一次性绑定码' })
    expect(button).toBeDisabled()
    consent()
    fireEvent.click(button); fireEvent.click(button)
    expect(service.createCode).toHaveBeenCalledTimes(1)
    expect(service.createCode).toHaveBeenCalledWith('telegram:123', expect.any(AbortSignal))
    await act(async () => pending.resolve({ gateway_id: 'telegram:123', code: 'secret-once', expires_at: Math.floor(Date.now() / 1000) + 600 }))
    expect(screen.getByLabelText('一次性绑定命令')).toHaveValue('/bind secret-once')
    const link = screen.getByRole('link', { name: '打开机器人私聊' })
    expect(link).toHaveAttribute('href', gateways[0].bot_url)
    expect(link.getAttribute('href')).not.toContain('secret-once')
  })
  it('copies only by explicit action and never persists a code in browser storage', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    await ready(); await generate()
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制命令' })))
    expect(writeText).toHaveBeenCalledWith('/bind fixture-private-code')
    expect(storage).not.toHaveBeenCalled()
  })
  it('hides a code when switching platforms and requires new consent', async () => {
    await ready(); await generate()
    fireEvent.click(screen.getByRole('combobox', { name: '选择机器人' }))
    fireEvent.click(screen.getByRole('option', { name: '飞书测试机器人' }))
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '生成一次性绑定码' })).toBeDisabled()
  })
  it('cancels an outstanding code on the server before claiming it is invalid', async () => {
    const pending = deferred<void>()
    const service = api({ cancelCode: vi.fn(() => pending.promise) })
    await ready(service); await generate()
    fireEvent.click(screen.getByRole('button', { name: '作废绑定码' }))
    expect(screen.getByLabelText('一次性绑定命令')).toBeInTheDocument()
    expect(service.cancelCode).toHaveBeenCalledWith('telegram:123', expect.any(AbortSignal))
    await act(async () => pending.resolve())
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('绑定码已作废')
  })
  it('expires and removes the displayed capability rather than copying a stale code', async () => {
    await ready(api({ createCode: vi.fn(async gateway_id => ({ gateway_id, code: 'short-lived', expires_at: Math.floor(Date.now() / 1000) + 2 })) }))
    vi.useFakeTimers()
    await generate()
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('绑定码已过期')
  })
  it('polls owner binding receipts and clears the code only after a new matching binding', async () => {
    const bindings = vi.fn<ChannelGatewayApi['bindings']>().mockResolvedValueOnce([]).mockResolvedValue([binding])
    await ready(api({ bindings }))
    vi.useFakeTimers()
    await generate()
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('已确认绑定成功')
    expect(screen.getByRole('region', { name: '已绑定账号' })).toHaveTextContent('77')
  })
  it('requires separate unlink confirmation and sends one mutation while pending', async () => {
    const pending = deferred<void>()
    const service = api({ bindings: vi.fn(async () => [binding]), revoke: vi.fn(() => pending.promise) })
    await ready(service)
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    expect(service.revoke).not.toHaveBeenCalled()
    const group = screen.getByRole('group', { name: '确认解除绑定' })
    fireEvent.click(within(group).getByRole('button', { name: '确认解除' }))
    fireEvent.click(within(group).getByRole('button', { name: '正在解除…' }))
    expect(service.revoke).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('已解除绑定')
  })
  it('keeps the original binding on an uncertain failed revoke and offers refresh', async () => {
    const service = api({ bindings: vi.fn(async () => [binding]), revoke: vi.fn(async () => { throw new Error('network') }) })
    await ready(service)
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认解除' })))
    expect(screen.getByRole('alert')).toHaveTextContent('操作结果尚未确认')
    expect(screen.getByRole('region', { name: '已绑定账号' })).toHaveTextContent('77')
    expect(service.revoke).toHaveBeenCalledTimes(1)
  })
  it('ignores a delayed grant after close and never shows it for a newly signed-in owner', async () => {
    const pending = deferred<ChannelGrant>()
    const service = api({ createCode: vi.fn(() => pending.promise) })
    const view = await ready(service)
    consent(); fireEvent.click(screen.getByRole('button', { name: '生成一次性绑定码' }))
    const signal = vi.mocked(service.createCode).mock.calls[0][1]!
    view.rerender(<ChannelBindingsPanel userId="owner-b" text={text} api={service} />)
    await screen.findByRole('button', { name: '生成一次性绑定码' })
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ gateway_id: 'telegram:123', code: 'owner-a-secret', expires_at: Math.floor(Date.now() / 1000) + 600 }))
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
  it('stops exposing a grant if polling reports that the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'expired' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })))
    const bindings = vi.fn<ChannelGatewayApi['bindings']>().mockResolvedValueOnce([])
      .mockImplementation(() => channelGatewayApi.bindings())
    await ready(api({ bindings })); vi.useFakeTimers(); await generate()
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.queryByLabelText('一次性绑定命令')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('登录已过期')
    expect(screen.getByRole('button', { name: '生成一次性绑定码' })).toBeDisabled()
  })
})
