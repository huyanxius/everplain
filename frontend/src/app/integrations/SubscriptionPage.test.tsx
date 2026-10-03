import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionPage } from './SubscriptionPage'
import * as api from '../../modules/product-integrations'
import { readAccountUsage } from '../../modules/account'

const identity = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('../../modules/account', () => ({
  useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId } } } }),
  readAccountUsage: vi.fn(),
}))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: ReactNode }) => <>{children}</>, PageContent: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('../../modules/product-integrations', () => ({ models: vi.fn(), subscription: vi.fn(), checkout: vi.fn(), portal: vi.fn() }))

type Overview = Awaited<ReturnType<typeof api.subscription>>
const unavailable: Overview = { available: false, unavailable_reason: '支付服务尚未配置', plans: [], subscription: null }
const available: Overview = {
  available: true, unavailable_reason: null, subscription: null,
  plans: [{ id: 'configured-plus-id', name: 'Plus', description: '由服务端配置的套餐说明。' }, { id: 'pro', name: 'Pro', description: '' }, { id: 'max', name: 'Max', description: '' }],
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = () => <QueryClientProvider client={client}><MemoryRouter><SubscriptionPage /></MemoryRouter></QueryClientProvider>
  const view = render(wrap())
  return { ...view, client, rerenderPage: () => view.rerender(wrap()) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function plan(name: string) { return screen.getByRole('article', { name: `${name} 套餐` }) }

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks(); identity.userId = 'owner'
  vi.mocked(api.subscription).mockResolvedValue(unavailable)
  vi.mocked(api.models).mockResolvedValue([])
  vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [] })
})

describe('subscription and usage', () => {
  it('shows all three unconfigured tiers without fabricated prices, benefits or payment actions', async () => {
    setup()
    await screen.findByRole('heading', { name: '尚未订阅' })
    for (const name of ['Plus', 'Pro', 'Max']) {
      expect(within(plan(name)).getByRole('button', { name: '暂未开放' })).toBeDisabled()
      expect(within(plan(name)).getByText('价格待公布')).toBeVisible()
    }
    expect(screen.getByRole('button', { name: '购买额外额度' })).toBeDisabled()
    expect(screen.getByText('支付服务尚未配置')).toBeVisible()
    expect(screen.getByText('暂不可用')).toBeVisible()
    expect(document.body).not.toHaveTextContent(/积分|100%|¥|￥/)
    expect(api.checkout).not.toHaveBeenCalled()
    expect(api.models).not.toHaveBeenCalled()
  })

  it('disables configured plans and current subscription management when unavailable', async () => {
    vi.mocked(api.subscription).mockResolvedValue({ ...available, available: false, subscription: { plan_id: 'configured-plus-id', status: 'active', current_period_end: null, cancel_at_period_end: false } })
    setup()
    await screen.findByRole('heading', { name: 'Plus', level: 2 })
    expect(within(plan('Plus')).getByRole('button', { name: '当前套餐' })).toBeDisabled()
    expect(within(plan('Pro')).getByRole('button', { name: '暂未开放' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '管理订阅' })).toBeDisabled()
    expect(api.checkout).not.toHaveBeenCalled()
    expect(api.portal).not.toHaveBeenCalled()
  })

  it.each(['http://unsafe.example/checkout', 'javascript:alert(1)', 'https://user:password@pay.example/checkout', '/relative', 'invalid-url'])('rejects an unsafe or invalid payment destination: %s', async url => {
    vi.mocked(api.subscription).mockResolvedValue(available)
    vi.mocked(api.checkout).mockResolvedValue({ checkout_url: url, session_id: 'session' })
    setup()
    await screen.findByRole('heading', { name: 'Plus', level: 3 })
    const button = within(plan('Plus')).getByRole('button', { name: '查看正式结算' })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('支付服务返回了无效地址')
    expect(button).toBeEnabled()
    expect(api.checkout).toHaveBeenCalledWith('configured-plus-id')
  })

  it('retains the failed checkout target for retry and prevents repeated submissions', async () => {
    vi.mocked(api.subscription).mockResolvedValue(available)
    const request = deferred<Awaited<ReturnType<typeof api.checkout>>>()
    vi.mocked(api.checkout).mockReturnValueOnce(request.promise).mockRejectedValue(new Error('支付服务繁忙'))
    setup()
    await screen.findByRole('heading', { name: 'Plus', level: 3 })
    const button = within(plan('Plus')).getByRole('button', { name: '查看正式结算' })
    fireEvent.click(button); fireEvent.click(button)
    expect(api.checkout).toHaveBeenCalledTimes(1)
    expect(within(plan('Pro')).getByRole('button')).toBeDisabled()
    request.resolve({ checkout_url: 'http://unsafe.example', session_id: 'session' })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重试打开' }))
    await waitFor(() => expect(api.checkout).toHaveBeenCalledTimes(2))
    expect(api.checkout).toHaveBeenLastCalledWith('configured-plus-id')
    expect(await screen.findByText('支付服务繁忙')).toBeVisible()
  })

  it('shows actual subscription state and routes plan changes through management', async () => {
    vi.mocked(api.subscription).mockResolvedValue({ ...available, subscription: { plan_id: 'configured-plus-id', status: 'active', current_period_end: '2026-11-01T12:00:00Z', cancel_at_period_end: true } })
    vi.mocked(api.portal).mockRejectedValue(new Error('暂时无法打开管理页面'))
    setup()
    expect(await screen.findByText('订阅中 · 本期结束后取消')).toBeVisible()
    expect(screen.getByText('结束日期：2026年11月1日')).toBeVisible()
    expect(within(plan('Plus')).getByRole('button', { name: '当前套餐' })).toBeDisabled()
    fireEvent.click(within(plan('Pro')).getByRole('button', { name: '更换套餐' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法打开管理页面')
    expect(api.portal).toHaveBeenCalledTimes(1)
    expect(api.checkout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '管理订阅' }))
    await waitFor(() => expect(api.portal).toHaveBeenCalledTimes(2))
  })

  it('keeps canceled subscription history without marking it as the current paid plan', async () => {
    vi.mocked(api.subscription).mockResolvedValue({ ...available, subscription: { plan_id: 'configured-plus-id', status: 'canceled', current_period_end: null, cancel_at_period_end: false } })
    setup()
    expect(await screen.findByText('最近的订阅')).toBeVisible()
    expect(screen.getByText('已取消')).toBeVisible()
    expect(within(plan('Plus')).getByRole('button', { name: '查看正式结算' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '当前套餐' })).not.toBeInTheDocument()
  })

  it('keeps existing catalog plans reachable without silently renaming them as a tier', async () => {
    vi.mocked(api.subscription).mockResolvedValue({ ...available, plans: [{ id: 'legacy-plan', name: '已有研究方案', description: '现有服务端说明' }] })
    setup()
    expect(await screen.findByRole('heading', { name: '已有研究方案' })).toBeVisible()
    expect(within(plan('已有研究方案')).getByRole('button', { name: '查看正式结算' })).toBeEnabled()
    expect(within(plan('Plus')).getByRole('button')).toBeDisabled()
  })

  it('retries a failed subscription read without presenting the failure as no subscription', async () => {
    vi.mocked(api.subscription).mockRejectedValueOnce(new Error('订阅连接失败')).mockResolvedValue(unavailable)
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('订阅连接失败')
    expect(screen.queryByText('尚未订阅')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '尚未订阅' })).toBeVisible()
    expect(api.subscription).toHaveBeenCalledTimes(2)
  })

  it('shows each valid allowance pool separately and never combines their percentages', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'subscription', kind: 'subscription', remainingPercent: 63, expiresAt: '2026-11-01T12:00:00Z' },
      { id: 'purchase', kind: 'top_up', remainingPercent: 0, expiresAt: null },
      { id: 'welcome', kind: 'welcome', remainingPercent: 25, expiresAt: null },
    ] })
    setup()
    await screen.findByRole('heading', { name: '尚未订阅' })
    expect(screen.getByRole('progressbar', { name: '套餐额度剩余' })).toHaveAttribute('value', '63')
    expect(screen.getByRole('progressbar', { name: '额外购买额度剩余' })).toHaveAttribute('value', '0')
    expect(screen.getByRole('progressbar', { name: '赠送额度剩余' })).toHaveAttribute('value', '25')
    expect(screen.getByText('11月1日到期')).toBeVisible()
    expect(document.body).not.toHaveTextContent(/积分|速率限制/)
  })

  it('does not invent a percentage when a pool is missing its quota projection', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'subscription', kind: 'subscription', remainingPercent: null, expiresAt: null },
    ] })
    setup()
    await screen.findByText('套餐额度')
    expect(screen.getByText('暂不可用')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/0%|100%/)
  })

  it('retries a failed usage read independently of subscription data', async () => {
    vi.mocked(readAccountUsage).mockRejectedValueOnce(new Error('usage failed')).mockResolvedValue({ isUnlimited: true, remainingPercent: null, buckets: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '重试用量' }))
    expect(await screen.findByText('不限量')).toBeVisible()
    expect(api.subscription).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('clears payment errors and ignores a stale checkout response after the account changes', async () => {
    vi.mocked(api.subscription).mockResolvedValue(available)
    const request = deferred<Awaited<ReturnType<typeof api.checkout>>>()
    vi.mocked(api.checkout).mockReturnValue(request.promise)
    const view = setup()
    await screen.findByRole('heading', { name: 'Plus', level: 3 })
    fireEvent.click(within(plan('Plus')).getByRole('button', { name: '查看正式结算' }))
    identity.userId = 'another-owner'; view.rerenderPage()
    await waitFor(() => expect(api.subscription).toHaveBeenCalledTimes(2))
    request.resolve({ checkout_url: 'invalid-url', session_id: 'stale' })
    await waitFor(() => expect(within(plan('Plus')).getByRole('button', { name: '查看正式结算' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readAccountUsage).toHaveBeenCalledTimes(2)
  })

  it('loads the model directory only when expanded and supports retry', async () => {
    vi.mocked(api.models).mockRejectedValueOnce(new Error('模型目录连接失败')).mockResolvedValue([])
    setup()
    await screen.findByText('尚未订阅')
    fireEvent.click(screen.getByText('当前模型目录').closest('summary')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('模型目录连接失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('当前没有可显示的模型配置。')).toBeVisible()
    expect(api.models).toHaveBeenCalledTimes(2)
  })
})
