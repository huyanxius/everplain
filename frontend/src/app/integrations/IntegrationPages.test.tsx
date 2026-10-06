import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsPage, PublicDirectoryPage, SharedReaderPage, SharingPage, SubscriptionPage } from './IntegrationPages'
import * as api from '../../modules/product-integrations'
import { readAccountUsage, redeemAccountCode } from '../../modules/account'

const identity = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('../../modules/account', async importOriginal => ({
  ...await importOriginal<typeof import('../../modules/account')>(),
  readAccountUsage: vi.fn(),
  redeemAccountCode: vi.fn(),
  useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId } } } }),
}))
vi.mock('../ui/PageShell', () => ({ PageShell: ({children}: {children: ReactNode}) => <>{children}</>, PageContent: ({children}: {children: ReactNode}) => <>{children}</> }))
vi.mock('../../modules/product-integrations', () => Object.fromEntries(['directory','libraries','sharing','join','leave','publish','unpublish','connections','createConnection','revokeConnection','models','productCatalog','subscription','checkout','portal','publicLibrary','publicSource','library','privateSource'].map(name => [name, vi.fn()])))

const productCatalog: Awaited<ReturnType<typeof api.productCatalog>> = {
  plans: [
    { id: 'plus', name: 'Plus', description: '轻量使用', price_cny_fen: 5900, weekly_points: 200, period_days: 28, period_points: 800 },
    { id: 'pro', name: 'PRO', description: '日常使用', price_cny_fen: 11900, weekly_points: 400, period_days: 28, period_points: 1600 },
    { id: 'max', name: 'Max', description: '高频使用', price_cny_fen: 29900, weekly_points: 1000, period_days: 28, period_points: 4000 },
  ],
  free_weekly_points: 30, reset_days: 7, top_up_points: 200, top_up_price_cny_fen: 1900,
  payments_enabled: false, agent_models: [], runtime_mode: 'base',
}
const library = { id: 'kb', name: '自己的资料', description: '', viewer_access: 'owner', ready_document_count: 2, sharing_enabled: false, publication: null }
function setup(element: ReactNode, initial = '/sharing') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>{node}</MemoryRouter></QueryClientProvider>
  const result = render(wrap(element))
  return { ...result, rerenderPage: (node: ReactNode) => result.rerender(wrap(node)) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  vi.resetAllMocks(); identity.userId = 'owner'
  vi.mocked(api.libraries).mockResolvedValue([library] as Awaited<ReturnType<typeof api.libraries>>)
  vi.mocked(api.connections).mockResolvedValue({ connections: [], mcp_endpoint: '/api/mcp' } as Awaited<ReturnType<typeof api.connections>>)
  vi.mocked(api.models).mockResolvedValue([])
  vi.mocked(api.productCatalog).mockResolvedValue(productCatalog)
  vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [] })
  vi.mocked(redeemAccountCode).mockResolvedValue({ action: 'bank_reset', redeemedPoints: 30, balance: 30, quotaPeriodExpiresAt: '2099-01-08T12:00:00Z' })
  vi.mocked(api.directory).mockResolvedValue([])
  vi.mocked(api.subscription).mockResolvedValue({ available: false, unavailable_reason: '支付服务尚未配置', plans: productCatalog.plans, subscription: null })
})

describe('integration surfaces', () => {
  it('requires explicit confirmation to publish and allows closing without publishing', async () => {
    setup(<SharingPage />)
    fireEvent.click(await screen.findByRole('button', {name: /发布到公共主题/}))
    expect(screen.getByRole('button', {name: '确认公开当前资料'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: '关闭发布'}))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.publish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: /发布到公共主题/}))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', {name: '确认公开当前资料'}))
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('kb', expect.objectContaining({confirm_public_content: true})))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('restores focus after cancelling publication with Escape', async () => {
    setup(<SharingPage />)
    const trigger = await screen.findByRole('button', { name: /发布到公共主题/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: '关闭发布' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(api.publish).not.toHaveBeenCalled()
  })
  it('keeps invited libraries read-only while allowing the member to leave', async () => {
    vi.mocked(api.libraries).mockResolvedValue([{ ...library, viewer_access: 'reader' }] as Awaited<ReturnType<typeof api.libraries>>)
    setup(<SharingPage />)
    expect(await screen.findByText('加入的只读知识库')).toBeVisible()
    expect(screen.queryByRole('button', { name: /发布到公共主题/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开启只读邀请' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出知识库' }))
    await waitFor(() => expect(api.leave).toHaveBeenCalledWith('kb'))
  })
  it('searches the live public directory and distinguishes no matching result', async () => {
    vi.mocked(api.directory).mockResolvedValue([{ knowledge_base_id: 'public-1', title: '社会记忆', description: '公开阅读', document_count: 3, topics: ['记忆'] }] as Awaited<ReturnType<typeof api.directory>>)
    setup(<PublicDirectoryPage />, '/discover')
    expect(await screen.findByRole('link', { name: /社会记忆/ })).toHaveAttribute('href', '/discover/public-1')
    vi.mocked(api.directory).mockResolvedValue([])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索公共主题' }), { target: { value: '无结果' } })
    await waitFor(() => expect(api.directory).toHaveBeenLastCalledWith('无结果'))
    expect(await screen.findByRole('heading', { name: '没有找到“无结果”' })).toBeVisible()
  })
  it('keeps a rejected invitation visible for correction', async () => {
    vi.mocked(api.join).mockRejectedValue(new Error('邀请已失效'))
    setup(<SharingPage />)
    fireEvent.change(screen.getByLabelText('邀请链接或口令'), {target: {value: 'https://example.test/sharing?invite=expired'}})
    fireEvent.click(screen.getByRole('button', {name: '加入'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请已失效')
    expect(api.join).toHaveBeenCalledWith('expired')
    expect(screen.getByLabelText('邀请链接或口令')).toHaveValue('https://example.test/sharing?invite=expired')
  })
  it('does not create connections until a library is selected and clears secrets on identity change', async () => {
    vi.mocked(api.createConnection).mockResolvedValue({ secret: 'test-one-time-value' } as Awaited<ReturnType<typeof api.createConnection>>)
    const view = setup(<ConnectionsPage />, '/connections')
    expect(screen.getByRole('button', {name: '创建只读连接'})).toBeDisabled()
    fireEvent.change(screen.getByLabelText('连接名称'), {target: {value: '我的工具'}})
    fireEvent.click(await screen.findByRole('checkbox', {name: '自己的资料'}))
    fireEvent.click(screen.getByRole('button', {name: '创建只读连接'}))
    expect(await screen.findByLabelText('一次性连接密钥')).toHaveValue('test-one-time-value')
    expect(api.createConnection).toHaveBeenCalledTimes(1)
    identity.userId = 'another-owner'
    view.rerenderPage(<ConnectionsPage />)
    expect(screen.queryByLabelText('一次性连接密钥')).not.toBeInTheDocument()
  })
  it('clears selected source when navigating to another public library', async () => {
    vi.mocked(api.publicLibrary).mockImplementation(async id => ({ documents: [{ id: `${id}-doc`, filename: `${id}文章` }], publication: {title: id} }) as Awaited<ReturnType<typeof api.publicLibrary>>)
    vi.mocked(api.publicSource).mockResolvedValue({ document: {filename: 'a文章'}, segments: [{segment_id: 's', text: '第一份原文'}] } as Awaited<ReturnType<typeof api.publicSource>>)
    setup(<><Link to="/discover/b">换主题</Link><Routes><Route path="/discover/:libraryId" element={<SharedReaderPage publicView />} /></Routes></>, '/discover/a')
    fireEvent.click(await screen.findByRole('button', {name: 'a文章'}))
    await screen.findByText('第一份原文')
    fireEvent.click(screen.getByRole('link', {name: '换主题'}))
    await screen.findByRole('button', {name: 'b文章'})
    expect(screen.queryByText('第一份原文')).not.toBeInTheDocument()
    expect(screen.getByText('选择一份资料开始阅读。')).toBeInTheDocument()
    expect(api.publicSource).toHaveBeenCalledTimes(1)
  })
  it('does not fall back to public APIs when a shared source refuses access', async () => {
    vi.mocked(api.library).mockResolvedValue({ name: '受限资料', documents: [{ id: 'private-doc', filename: '私有文章' }] } as Awaited<ReturnType<typeof api.library>>)
    vi.mocked(api.privateSource).mockRejectedValue(new Error('访问已撤销'))
    setup(<Routes><Route path="/shared/:libraryId" element={<SharedReaderPage />} /></Routes>, '/shared/private-kb')
    fireEvent.click(await screen.findByRole('button', { name: '私有文章' }))
    expect(await screen.findByText('访问已撤销')).toBeVisible()
    expect(api.privateSource).toHaveBeenCalledWith('private-kb', 'private-doc')
    expect(api.publicSource).not.toHaveBeenCalled()
    expect(api.publicLibrary).not.toHaveBeenCalled()
  })
  it('uses the selected connection duration and hides a dismissed one-time secret', async () => {
    vi.mocked(api.createConnection).mockResolvedValue({ secret: 'one-time' } as Awaited<ReturnType<typeof api.createConnection>>)
    const started = Date.now()
    setup(<ConnectionsPage />, '/connections')
    fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '限定工具' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: '自己的资料' }))
    fireEvent.click(screen.getByRole('combobox', { name: '有效期' }))
    fireEvent.click(screen.getByRole('option', { name: '7 天' }))
    fireEvent.click(screen.getByRole('button', { name: '创建只读连接' }))
    await screen.findByLabelText('一次性连接密钥')
    const input = vi.mocked(api.createConnection).mock.calls[0][0]
    expect(input.library_ids).toEqual(['kb'])
    expect(new Date(input.expires_at).getTime()).toBeGreaterThanOrEqual(started + 7 * 86400000)
    expect(new Date(input.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400000)
    fireEvent.click(screen.getByRole('button', { name: '我已保存，关闭密钥' }))
    expect(screen.queryByLabelText('一次性连接密钥')).not.toBeInTheDocument()
  })
  it.each([false, true])('keeps redemption usable without payment requests or unsafe navigation when payments are configured (active membership: %s)', async activeMembership => {
    vi.mocked(api.productCatalog).mockResolvedValue({ ...productCatalog, payments_enabled: true })
    vi.mocked(api.subscription).mockResolvedValue({
      available: true, unavailable_reason: null, plans: productCatalog.plans,
      subscription: activeMembership ? { plan_id: 'plus', status: 'active', current_period_start: '2026-10-01T12:00:00Z', current_period_end: '2099-01-29T12:00:00Z', cancel_at_period_end: false } : null,
    })
    vi.mocked(redeemAccountCode).mockResolvedValue({ action: 'bank_reset', redeemedPoints: activeMembership ? 200 : 30, balance: activeMembership ? 200 : 30, quotaPeriodExpiresAt: '2099-01-08T12:00:00Z' })
    // Neither an unsafe checkout nor a management destination may be requested by this surface.
    vi.mocked(api.checkout).mockResolvedValue({ checkout_url: 'http://unsafe.example/checkout', session_id: 'session' })
    vi.mocked(api.portal).mockResolvedValue({ portal_url: 'javascript:alert(1)' })
    const originalLocation = window.location.href
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null)
    setup(<SubscriptionPage />, '/subscription')
    await screen.findByRole('heading', { name: '会员套餐' })
    const plan = await screen.findByRole('article', { name: 'Plus 套餐' })
    expect(plan).toHaveTextContent('¥59 / 28 天')
    expect(screen.queryByRole('button', { name: /结算|支付|购买|管理订阅|更换套餐/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /结算|支付|购买|管理订阅|更换套餐/ })).not.toBeInTheDocument()
    fireEvent.click(within(plan).getByRole('button', { name: '使用兑换码' }))
    expect(screen.getByLabelText('兑换码')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'QX-INTEGRATION-RESET' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    expect(await screen.findByRole('status')).toHaveTextContent(`兑换已确认。当前余额：${activeMembership ? 200 : 30} 积分。`)
    expect(redeemAccountCode).toHaveBeenCalledWith({ code: 'QX-INTEGRATION-RESET', idempotencyKey: expect.any(String) })
    expect(screen.getByLabelText('兑换码')).toHaveValue('')
    expect(api.checkout).not.toHaveBeenCalled()
    expect(api.portal).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
    expect(window.location.href).toBe(originalLocation)
  })
  it.each([11, 0])('shows the returned %i-point balance after redeeming the same RESET code again on subscriptions', async balance => {
    const receipt = { action: 'bank_reset' as const, redeemedPoints: 30, balance: 30, quotaPeriodExpiresAt: '2026-01-03T12:00:00Z' }
    vi.mocked(redeemAccountCode).mockResolvedValueOnce(receipt).mockResolvedValue({ ...receipt, balance })
    setup(<SubscriptionPage />, '/subscription')
    await screen.findByRole('heading', { name: '会员套餐' })
    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'QX-RESET-REPLAY' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    expect(await screen.findByRole('status')).toHaveTextContent('当前余额：30 积分')
    expect(screen.getByLabelText('兑换码')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'QX-RESET-REPLAY' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`兑换已确认。当前余额：${balance} 积分。`))
    expect(screen.getByRole('status')).toHaveTextContent('该兑换记录的额度截止时间：2026/01/03')
    expect(screen.getByRole('status')).not.toHaveTextContent('100%')
    expect(redeemAccountCode).toHaveBeenCalledTimes(2)
    for (const [request] of vi.mocked(redeemAccountCode).mock.calls) {
      expect(request).toEqual({ code: 'QX-RESET-REPLAY', idempotencyKey: expect.any(String) })
    }
    expect(screen.getByLabelText('兑换码')).toHaveValue('')
    expect(api.checkout).not.toHaveBeenCalled()
    expect(api.portal).not.toHaveBeenCalled()
  })
  it('renders server catalog prices and keeps redemption available when payments are unconfigured', async () => {
    setup(<SubscriptionPage />, '/subscription')
    for (const [name, price, weekly, total] of [['Plus', 59, 200, 800], ['PRO', 119, 400, 1600], ['Max', 299, 1000, 4000]]) {
      const plan = await screen.findByRole('article', { name: `${name} 套餐` })
      expect(plan).toHaveTextContent(`¥${price} / 28 天`)
      expect(plan).toHaveTextContent(`每 7 天 ${weekly} 点额度`)
      expect(plan).toHaveTextContent(`28 天共 ${total} 点，分 4 周发放`)
      expect(within(plan).getByRole('button', { name: '使用兑换码' })).toBeEnabled()
    }
    expect(screen.getByText(/支付尚未开放，目前仅支持兑换码/)).toBeVisible()
    expect(screen.getByText('200 点 / ¥19')).toBeVisible()
    expect(screen.getByLabelText('兑换码')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /结算|支付|购买|管理订阅|更换套餐/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /结算|支付|购买|管理订阅|更换套餐/ })).not.toBeInTheDocument()
    expect(api.productCatalog).toHaveBeenCalledTimes(1)
    expect(readAccountUsage).toHaveBeenCalledTimes(1)
    expect(api.checkout).not.toHaveBeenCalled()
    expect(api.portal).not.toHaveBeenCalled()
  })
})
