import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionPage } from './SubscriptionPage'
import * as api from '../../modules/product-integrations'
import { redeemAccountCode, readAccountUsage } from '../../modules/account'

const identity = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('../../modules/account', async importOriginal => ({
  ...await importOriginal<typeof import('../../modules/account')>(),
  useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId } } } }),
  readAccountUsage: vi.fn(), redeemAccountCode: vi.fn(),
}))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: ReactNode }) => <>{children}</>, PageContent: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('../../modules/product-integrations', () => ({ productCatalog: vi.fn(), models: vi.fn(), subscription: vi.fn(), checkout: vi.fn(), portal: vi.fn() }))

type Overview = Awaited<ReturnType<typeof api.subscription>>
type Catalog = Awaited<ReturnType<typeof api.productCatalog>>
const catalog: Catalog = {
  plans: [
    { id: 'plus', name: 'Plus', description: '轻量使用', price_cny_fen: 4900, weekly_points: 50, period_days: 28, period_points: 200 },
    { id: 'pro', name: 'PRO', description: '日常使用', price_cny_fen: 9900, weekly_points: 100, period_days: 28, period_points: 400 },
    { id: 'max', name: 'Max', description: '高频使用', price_cny_fen: 24900, weekly_points: 250, period_days: 28, period_points: 1000 },
  ],
  free_weekly_points: 30, reset_days: 7, top_up_points: 50, top_up_price_cny_fen: 1500, payments_enabled: false, agent_models: [], runtime_mode: 'base',
}
const overview: Overview = { available: false, unavailable_reason: '支付服务尚未开放', plans: catalog.plans, subscription: null }
const allowance = { isUnlimited: false, remainingPercent: null, buckets: [{ id: 'week', kind: 'subscription' as const, remainingPercent: 63, expiresAt: '2026-11-01T12:00:00Z' }] }
const membership = { action: 'membership' as const, planId: 'plus', redeemedPoints: 50, balance: 50, membershipStartsAt: '2026-01-01T12:00:00Z', membershipExpiresAt: '2026-01-29T12:00:00Z' }
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
function enterCode() {
  fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'QX-MEMBERSHIP-PLUS' } })
  fireEvent.click(screen.getByRole('button', { name: '兑换' }))
}
afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks(); identity.userId = 'owner'
  vi.mocked(api.productCatalog).mockResolvedValue(catalog)
  vi.mocked(api.subscription).mockResolvedValue(overview)
  vi.mocked(api.models).mockResolvedValue([])
  vi.mocked(readAccountUsage).mockResolvedValue(allowance)
  vi.mocked(redeemAccountCode).mockResolvedValue(membership)
})

describe('subscription and usage', () => {
  it('reads real tier prices and four weekly allowances with no payment action', async () => {
    setup(); await screen.findByRole('heading', { name: 'Free' })
    for (const [name, price, weekly, total] of [['Plus', '49', 50, 200], ['PRO', '99', 100, 400], ['Max', '249', 250, 1000]]) {
      expect(plan(String(name))).toHaveTextContent(`¥${price} / 28 天`)
      expect(plan(String(name))).toHaveTextContent(`每 7 天 ${weekly} 点额度`)
      expect(plan(String(name))).toHaveTextContent(`28 天共 ${total} 点，分 4 周发放`)
      expect(within(plan(String(name))).getByText('全部模型均可使用')).toBeVisible()
    }
    expect(screen.getByText(/Free 每 7 天 30 点/)).toHaveTextContent('未用完的周额度不结转')
    expect(screen.getByText('50 点 / ¥15')).toBeVisible()
    expect(screen.queryByRole('button', { name: /支付|购买|结算|管理订阅/ })).not.toBeInTheDocument()
    fireEvent.click(within(plan('Plus')).getByRole('button', { name: '使用兑换码' }))
    expect(screen.getByLabelText('兑换码')).toHaveFocus()
    expect(api.checkout).not.toHaveBeenCalled(); expect(api.portal).not.toHaveBeenCalled(); expect(api.models).not.toHaveBeenCalled()
  })
  it('uses changed server values even if payment availability changes', async () => {
    vi.mocked(api.productCatalog).mockResolvedValue({ ...catalog, payments_enabled: true, top_up_price_cny_fen: 1750, plans: [{ ...catalog.plans[0], price_cny_fen: 5750, weekly_points: 60, period_points: 240 }] })
    vi.mocked(api.subscription).mockResolvedValue({ ...overview, available: true })
    setup(); expect(await screen.findByText('¥57.5')).toBeVisible()
    expect(plan('Plus')).toHaveTextContent('每 7 天 60 点额度'); expect(plan('Plus')).toHaveTextContent('28 天共 240 点')
    expect(screen.getByText('50 点 / ¥17.5')).toBeVisible()
    expect(screen.queryByRole('button', { name: /支付|购买|结算|管理订阅/ })).not.toBeInTheDocument()
  })
  it.each([['active', '会员生效中'], ['scheduled', '待生效'], ['expired', '已到期']])('shows %s membership with start and expiry dates', async (status, label) => {
    vi.mocked(api.subscription).mockResolvedValue({ ...overview, subscription: { plan_id: 'plus', status, current_period_start: '2026-10-01T12:00:00Z', current_period_end: '2026-10-29T12:00:00Z', cancel_at_period_end: false } })
    setup(); expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByText(/生效时间：2026\/10\/01/)).toBeVisible(); expect(screen.getByText(/到期时间：2026\/10\/29/)).toBeVisible()
    expect(within(plan('Plus')).queryByText('当前套餐') !== null).toBe(status === 'active')
    expect(screen.getByRole('progressbar', { name: '套餐额度剩余' })).toHaveAttribute('value', '63')
  })
  it('retries a failed subscription read without confusing failure with a Free account', async () => {
    vi.mocked(api.subscription).mockRejectedValueOnce(new Error('订阅连接失败')).mockResolvedValue(overview)
    setup(); expect(await screen.findByRole('alert')).toHaveTextContent('订阅连接失败')
    expect(screen.queryByRole('heading', { name: 'Free' })).not.toBeInTheDocument(); expect(screen.getByRole('progressbar')).toHaveAttribute('value', '63')
    fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByRole('heading', { name: 'Free' })).toBeVisible()
  })
  it('keeps usage and redemption usable while retrying a failed product catalog', async () => {
    vi.mocked(api.productCatalog).mockRejectedValueOnce(new Error('套餐连接失败')).mockResolvedValue(catalog)
    setup(); expect(await screen.findByRole('alert')).toHaveTextContent('套餐连接失败')
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '63'); expect(screen.getByLabelText('兑换码')).toBeEnabled()
    expect(screen.queryByText('¥49')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByText('¥49')).toBeVisible()
  })
  it('shows each allowance pool separately without inventing missing percentages', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [...allowance.buckets, { id: 'purchase', kind: 'top_up', remainingPercent: 0, expiresAt: null }, { id: 'welcome', kind: 'welcome', remainingPercent: null, expiresAt: null }] })
    setup(); await screen.findByRole('heading', { name: 'Free' })
    expect(screen.getByRole('progressbar', { name: '套餐额度剩余' })).toHaveAttribute('value', '63'); expect(screen.getByRole('progressbar', { name: '额外购买额度剩余' })).toHaveAttribute('value', '0')
    expect(screen.queryByRole('progressbar', { name: '赠送额度剩余' })).not.toBeInTheDocument(); expect(screen.getByText('暂不可用')).toBeVisible(); expect(screen.getByText('11月1日到期')).toBeVisible()
  })
  it('retries a failed usage read independently of subscription data', async () => {
    vi.mocked(readAccountUsage).mockRejectedValueOnce(new Error('usage failed')).mockResolvedValue({ isUnlimited: true, remainingPercent: null, buckets: [] })
    setup(); fireEvent.click(await screen.findByRole('button', { name: '重试用量' })); expect(await screen.findByText('不限量')).toBeVisible(); expect(api.subscription).toHaveBeenCalledTimes(1)
  })
  it('redeems once during repeated submissions and refreshes both projections', async () => {
    const request = deferred<typeof membership>(); vi.mocked(redeemAccountCode).mockReturnValueOnce(request.promise)
    setup(); await screen.findByRole('heading', { name: 'Free' }); enterCode(); fireEvent.submit(screen.getByLabelText('兑换码').closest('form')!)
    expect(redeemAccountCode).toHaveBeenCalledTimes(1); request.resolve(membership)
    expect(await screen.findByRole('status')).toHaveTextContent('Plus 会员已生效'); expect(screen.getByRole('status')).toHaveTextContent('生效时间：2026/01/01'); expect(screen.getByRole('status')).toHaveTextContent('到期时间：2026/01/29')
    expect(screen.getByLabelText('兑换码')).toHaveValue(''); await waitFor(() => expect(api.subscription).toHaveBeenCalledTimes(2)); expect(readAccountUsage).toHaveBeenCalledTimes(2)
  })
  it('describes a queued plan without claiming the current allowance was upgraded', async () => {
    vi.mocked(redeemAccountCode).mockResolvedValue({ ...membership, planId: 'max', membershipStartsAt: '2099-10-29T12:00:00Z', membershipExpiresAt: '2099-11-26T12:00:00Z' })
    setup(); await screen.findByRole('heading', { name: 'Free' }); enterCode()
    expect(await screen.findByRole('status')).toHaveTextContent('Max 会员已安排在当前会员到期后生效，当前额度保持不变'); expect(screen.getByRole('status')).toHaveTextContent('到期时间：2099/11/26'); expect(screen.getByRole('progressbar')).toHaveAttribute('value', '63')
  })
  it('keeps the code and idempotency key for a failed redemption retry', async () => {
    vi.mocked(redeemAccountCode).mockRejectedValueOnce(new Error('兑换服务暂不可用'))
    setup(); await screen.findByRole('heading', { name: 'Free' }); enterCode(); expect(await screen.findByRole('alert')).toHaveTextContent('兑换服务暂不可用'); expect(screen.getByLabelText('兑换码')).toHaveValue('QX-MEMBERSHIP-PLUS')
    fireEvent.click(screen.getByRole('button', { name: '兑换' })); await screen.findByRole('status')
    const calls = vi.mocked(redeemAccountCode).mock.calls; expect(calls[1][0]).toEqual(calls[0][0])
  })
  it('retains verified projections if reads fail after successful redemption', async () => {
    vi.mocked(api.subscription).mockResolvedValueOnce(overview).mockRejectedValue(new Error('订阅刷新失败')); vi.mocked(readAccountUsage).mockResolvedValueOnce(allowance).mockRejectedValue(new Error('用量刷新失败'))
    setup(); await screen.findByRole('heading', { name: 'Free' }); enterCode(); expect(await screen.findByRole('status')).toHaveTextContent('兑换成功'); await screen.findByText('用量刷新失败，显示上次读取的额度。')
    expect(screen.getByRole('heading', { name: 'Free' })).toBeVisible(); expect(screen.getByRole('progressbar')).toHaveAttribute('value', '63'); expect(screen.getByLabelText('兑换码')).toHaveValue(''); expect(redeemAccountCode).toHaveBeenCalledTimes(1)
  })
  it('ignores an old account redemption response after switching accounts', async () => {
    const request = deferred<typeof membership>(); vi.mocked(redeemAccountCode).mockReturnValueOnce(request.promise)
    const view = setup(); await screen.findByRole('heading', { name: 'Free' }); enterCode(); identity.userId = 'another-owner'; view.rerenderPage()
    await waitFor(() => expect(api.subscription).toHaveBeenCalledTimes(2)); request.resolve(membership); await waitFor(() => expect(screen.getByLabelText('兑换码')).toBeEnabled())
    expect(screen.queryByText(/Plus 会员已生效/)).not.toBeInTheDocument(); expect(readAccountUsage).toHaveBeenCalledTimes(2)
  })
  it('loads the model directory only when expanded and supports retry', async () => {
    vi.mocked(api.models).mockRejectedValueOnce(new Error('模型目录连接失败')).mockResolvedValue([])
    setup(); await screen.findByRole('heading', { name: 'Free' }); fireEvent.click(screen.getByText('当前模型目录').closest('summary')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('模型目录连接失败'); fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByText('当前没有可显示的模型配置。')).toBeVisible(); expect(api.models).toHaveBeenCalledTimes(2)
  })
})
