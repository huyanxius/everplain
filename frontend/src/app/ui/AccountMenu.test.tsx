import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu } from './AccountMenu'
import { readAccountUsage, notifyAccountUsageChanged } from '../../modules/account'
import { subscription } from '../../modules/product-integrations'

vi.mock('./RoleIdentityPanel', () => ({ RoleIdentityPanel: ({ open, initialTab }: { open: boolean; initialTab: string }) => open ? <section role="dialog" aria-label="AI 伙伴">{initialTab}</section> : null }))
vi.mock('../../modules/account', async () => ({ ...(await vi.importActual('../../modules/account/accountUsageEvents')), readAccountUsage: vi.fn() }))
vi.mock('../../modules/product-integrations', () => ({ subscription: vi.fn() }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn() }))
const clients: QueryClient[] = []
beforeEach(() => {
  vi.mocked(subscription).mockResolvedValue({ available: false, unavailable_reason: '未配置支付', plans: [{ id: 'live-plan', name: 'Plus', description: '', price_cny_fen: 4900, weekly_points: 50, period_days: 28, period_points: 200 }], subscription: { plan_id: 'live-plan', status: 'active', current_period_end: null, cancel_at_period_end: false } })
  vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [] })
})
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.clearAllMocks() })
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}|{location.state?.settingsBackground?.pathname}</output>
}
function setup(onKeyDown = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  client.setQueryData(['agent-profile', 'owner'], { name: '小叶', avatar_id: 'nian', color: '#ec8a52' })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/library']}><div onKeyDown={onKeyDown}><AccountMenu userId="owner" accountName="林同学" /><button>其他入口</button></div><LocationProbe /></MemoryRouter></QueryClientProvider>)
  return { client, trigger: screen.getByRole('button', { name: '账户 林同学' }) }
}

describe('AccountMenu', () => {
  it('opens the account menu first and only opens settings after selecting its menu item', async () => {
    const { trigger } = setup()
    expect(subscription).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    expect(screen.getByTestId('location')).toHaveTextContent('/library|')
    const menu = screen.getByRole('menu', { name: '账户菜单' })
    expect(await within(menu).findByText('Plus')).toBeVisible()
    expect(await within(menu).findByText('额度信息暂不可用')).toBeVisible()
    expect(menu).not.toHaveTextContent(/Pro|积分|3000|%|退出/)
    expect(within(menu).getByRole('menuitem', { name: '升级套餐' })).toHaveAttribute('href', '/subscription')
    fireEvent.click(within(menu).getByRole('menuitem', { name: '设置' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings|/library')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
  it('supports keyboard navigation and consumes Escape before a mobile drawer sees it', async () => {
    const parentKey = vi.fn()
    const { trigger } = setup(parentKey)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByText('Plus')
    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(items[0], { key: 'End' })
    expect(items[items.length - 1]).toHaveFocus()
    parentKey.mockClear()
    fireEvent.keyDown(items[items.length - 1], { key: 'Escape' })
    expect(parentKey).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it('closes on outside interaction and reads fresh usage when reopened', async () => {
    vi.mocked(readAccountUsage).mockResolvedValueOnce({ isUnlimited: false, remainingPercent: 42, buckets: [{ id: 'period-current', kind: 'subscription', remainingPercent: 42, expiresAt: null }] }).mockResolvedValueOnce({ isUnlimited: true, remainingPercent: null, buckets: [] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(await screen.findByText('剩余 42%')).toBeVisible()
    fireEvent.pointerDown(screen.getByRole('button', { name: '其他入口' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect((await screen.findAllByText('不限量'))[0]).toBeVisible()
    expect(readAccountUsage).toHaveBeenCalledTimes(2)
  })
  it('shows each real allowance once with its own progress bar', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'current', kind: 'subscription', remainingPercent: 42, expiresAt: null },
      { id: 'gift', kind: 'welcome', remainingPercent: 100, expiresAt: null },
      { id: 'purchase', kind: 'top_up', remainingPercent: 80, expiresAt: null },
    ] })
    const { trigger } = setup()
    expect(readAccountUsage).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    const meter = await screen.findByRole('progressbar', { name: '套餐额度剩余' })
    expect(meter).toHaveAttribute('aria-valuenow', '42')
    expect(meter.firstElementChild).toHaveStyle({ width: '42%' })
    expect(screen.getByRole('menu').firstElementChild).toHaveClass('account-menu__identity')
    expect(screen.getByRole('menu').children[1]).toHaveTextContent('套餐额度剩余 42%')
    expect(screen.getAllByRole('progressbar')).toHaveLength(3)
    expect(screen.getByRole('menuitem', { name: '使用情况' })).toHaveAttribute('href', '/subscription')
    expect(screen.getAllByText('赠送额度')).toHaveLength(1)
    expect(screen.getAllByText('额外购买额度')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: '使用情况' })).not.toHaveTextContent('%')
  })
  it.each([0, 99, 100])('renders a welcome allowance of %s%% without calling it monthly usage', async percent => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: percent, buckets: [
      { id: 'gift', kind: 'welcome', remainingPercent: percent, expiresAt: null },
    ] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    const meter = await screen.findByRole('progressbar', { name: '赠送额度剩余' })
    expect(meter).toHaveAttribute('aria-valuenow', String(percent))
    expect(meter.firstElementChild).toHaveStyle({ width: `${percent}%` })
    expect(screen.getAllByText('赠送额度')).toHaveLength(1)
    expect(screen.getAllByText(`剩余 ${percent}%`)).toHaveLength(1)
    expect(screen.getByRole('menu')).not.toHaveTextContent('月度')
  })
  it('does not draw an empty meter for unknown allowance', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'gift', kind: 'welcome', remainingPercent: null, expiresAt: null },
    ] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(await screen.findByText('赠送额度')).toBeVisible()
    expect(screen.getByText('暂不可用')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('menu').querySelector('.account-menu__meter')).toBeNull()
  })
  it('renders exhausted subscription usage as zero rather than missing data', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: 0, buckets: [
      { id: 'current', kind: 'subscription', remainingPercent: 0, expiresAt: null },
    ] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('剩余 0%')).toBeVisible()
  })
  it('keeps overlapping subscription buckets separate without combining them', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'one', kind: 'subscription', remainingPercent: 20, expiresAt: null },
      { id: 'two', kind: 'subscription', remainingPercent: 90, expiresAt: null },
    ] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    const meters = await screen.findAllByRole('progressbar')
    expect(meters.map(meter => meter.getAttribute('aria-valuenow'))).toEqual(['20', '90'])
  })
  it('shows loading and failures without fabricated usage', async () => {
    let rejectUsage!: (reason: Error) => void
    vi.mocked(readAccountUsage).mockReturnValue(new Promise((_resolve, reject) => { rejectUsage = reject }))
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('menu').children[1]).toHaveTextContent('正在读取…')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await act(async () => rejectUsage(new Error('offline')))
    expect(await screen.findByText('额度信息暂不可用')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
  it('keeps missing plans honest and updates the selected pet from the shared profile cache', async () => {
    vi.mocked(subscription).mockResolvedValue({ available: false, unavailable_reason: null, plans: [], subscription: null })
    const { trigger, client } = setup()
    fireEvent.click(trigger)
    expect(await screen.findByText('未订阅')).toBeVisible()
    act(() => client.setQueryData(['agent-profile', 'owner'], { name: '新伙伴', avatar_id: 'you', color: '#5d8fe6' }))
    await waitFor(() => expect(trigger).toHaveTextContent('新伙伴'))
    expect(trigger.querySelector('.agent-avatar')).toHaveAttribute('data-avatar', 'you')
  })
  it('lists current subscription and purchased allowances separately', async () => {
    vi.mocked(readAccountUsage).mockResolvedValue({ isUnlimited: false, remainingPercent: null, buckets: [
      { id: 'current-cycle', kind: 'subscription', remainingPercent: 40, expiresAt: null },
      { id: 'purchase-1', kind: 'top_up', remainingPercent: 100, expiresAt: null },
    ] })
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(await screen.findByText('套餐额度')).toBeVisible()
    expect(screen.getByText('额外购买额度')).toBeVisible()
    expect(screen.getByText('剩余 40%')).toBeVisible()
    expect(screen.getByText('剩余 100%')).toBeVisible()
    expect(screen.queryByText('额度信息暂不可用')).not.toBeInTheDocument()
  })
})

it.each([['Soul · 人格', 'identity'], ['Memory · 记忆', 'memory']])('opens %s directly from the lower-left avatar without navigating', async (label, tab) => {
  const { trigger } = setup()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
  expect(screen.getByRole('dialog', { name: 'AI 伙伴' })).toHaveTextContent(tab)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('/library|')
})


it('refreshes on settled usage and ignores an older pending response', async () => {
  const value = (remainingPercent: number) => ({ isUnlimited: false, remainingPercent, buckets: [{ id: 'gift', kind: 'welcome' as const, remainingPercent, expiresAt: null }] })
  let resolveOld!: (resolved: ReturnType<typeof value>) => void
  vi.mocked(readAccountUsage).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce(value(99.98))
  const { trigger } = setup()
  fireEvent.click(trigger)
  await waitFor(() => expect(readAccountUsage).toHaveBeenCalledTimes(1))
  act(() => notifyAccountUsageChanged())
  expect(await screen.findByText('剩余 99.98%')).toBeVisible()
  await act(async () => resolveOld(value(90)))
  expect(screen.getByText('剩余 99.98%')).toBeVisible()
  expect(screen.queryByText('剩余 90%')).not.toBeInTheDocument()
})
