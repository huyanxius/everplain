import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AccountSettingsPage } from './AccountSettingsPage'
import { AppLocaleProvider } from '../../i18n/AppLocaleProvider'
import { sidebarLayoutPreferenceStorageKey } from '../../styles/sidebarLayoutPreference'
import { appearancePreferenceStorageKey } from '../../styles/appearancePreference'
import type {
  AccountManagementApi,
  AccountProfile,
  AccountSession,
} from './accountManagementModels'

afterEach(() => {
  cleanup()
  window.localStorage.removeItem(sidebarLayoutPreferenceStorageKey)
  window.localStorage.removeItem(appearancePreferenceStorageKey)
  document.documentElement.style.removeProperty('color-scheme')
  delete document.documentElement.dataset.colorScheme
})

const account: AccountProfile = {
  userId: 'user-1',
  email: 'lin@example.com',
  displayName: '林同学',
  role: 'member',
  status: 'active',
  version: 3,
  createdAt: '2026-08-01T08:00:00Z',
  isProtectedAdmin: false,
  preferences: {
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    researchUpdatesEnabled: true,
    modelImprovementAllowed: false,
    consentPolicyVersion: '2026-08-secondary-use-v1',
    consentUpdatedAt: null,
    version: 2,
  },
}

const sessions: AccountSession[] = [
  {
    sessionId: 'session-current',
    current: true,
    createdAt: '2026-08-22T02:00:00Z',
    lastSeenAt: '2026-08-22T05:30:00Z',
    expiresAt: '2026-08-29T02:00:00Z',
    deviceLabel: 'Safari · macOS',
    ipAddress: '127.0.0.1',
  },
  {
    sessionId: 'session-other',
    current: false,
    createdAt: '2026-08-21T02:00:00Z',
    lastSeenAt: '2026-08-21T09:30:00Z',
    expiresAt: '2026-08-28T02:00:00Z',
    deviceLabel: 'Chrome · Windows',
    ipAddress: '192.0.2.10',
  },
]

function createApi(overrides: Partial<AccountManagementApi> = {}): AccountManagementApi {
  return {
    getAccount: async () => account,
    getCreditSummary: async () => ({
      balance: 1200,
      creditLimit: 3000,
      grantAmount: 3000,
      isUnlimited: false,
      inputTokensPerCredit: 100,
      outputTokensPerCredit: 25,
      entries: [],
      totalEntries: 0,
      nextCursor: null,
    }),
    redeemCredits: async () => ({ redeemedPoints: 3000, balance: 3000 }),
    createCreditRedemptionCodes: async () => ({
      codes: [],
      points: 3000,
      expiresAt: '2026-09-22T23:59:59Z',
    }),
    updateProfile: async ({ displayName }) => ({ ...account, displayName, version: 4 }),
    updatePreferences: async (input) => ({
      ...account.preferences,
      locale: input.locale,
      timezone: input.timezone,
      researchUpdatesEnabled: input.researchUpdatesEnabled,
      version: 3,
    }),
    updateModelDataAuthorization: async ({ allowed, policyVersion }) => ({
      ...account.preferences,
      modelImprovementAllowed: allowed,
      consentPolicyVersion: policyVersion,
      consentUpdatedAt: '2026-08-22T06:00:00Z',
      version: 3,
    }),
    changePassword: async () => ({ revokedSessionCount: 1 }),
    listSessions: async () => sessions,
    revokeSession: async () => undefined,
    requestDataExport: async () => ({
      exportId: 'export-1',
      status: 'ready',
      createdAt: '2026-08-22T06:00:00Z',
      expiresAt: '2026-08-29T06:00:00Z',
      downloadHref: '/api/account/data-exports/export-1/download',
    }),
    deactivateAccount: async () => ({ recoverable: true }),
    deleteAccount: async () => ({ recoverable: false }),
    listAdminUsers: async () => ({ items: [], total: 0, nextCursor: null }),
    updateUserRole: async () => { throw new Error('not used') },
    disableUser: async () => { throw new Error('not used') },
    enableUser: async () => { throw new Error('not used') },
    createPasswordReset: async () => { throw new Error('not used') },
    listAuditEvents: async () => ({ items: [], nextCursor: null }),
    consumePasswordReset: async () => undefined,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function openPartition(name: string) {
  const navigation = screen.getByRole('navigation', { name: '账户设置分区' })
  fireEvent.click(within(navigation).getByRole('button', { name }))
}

describe('AccountSettingsPage', () => {
  it('uses the shared liquid Bot while the settings page is pending, then removes it', async () => {
    const result = deferred<AccountProfile>()
    const { container } = render(<AccountSettingsPage api={createApi({ getAccount: () => result.promise })} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在读取账户设置')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('svg.aa-liquid')).toBeInTheDocument()
    result.resolve(account)
    await screen.findByRole('region', { name: '个人资料' })
    expect(container.querySelector('.agent-loading')).not.toBeInTheDocument()
  })

  it('renders new Mock-style label/control rows without legacy settings markup', async () => {
    const { container } = render(<AccountSettingsPage api={createApi()} />)
    const panel = await screen.findByRole('region', { name: '个人资料' })
    expect(container.querySelector('[class*="qs-"]')).toBeNull()
    expect(container.querySelector('aside')).toBeNull()
    expect(panel.querySelectorAll('.ep-setting-row')).toHaveLength(2)
    expect(panel.querySelector('.ep-settings-profile__metadata')).toHaveTextContent('账户类型')
    expect(panel.querySelector('.ep-settings-profile__metadata')).toHaveTextContent('加入时间')
    expect(container.querySelector('.ep-settings-rail')).toContainElement(screen.getByRole('navigation', { name: '账户设置分区' }))
    const row = panel.querySelector('.ep-setting-row')!
    expect(row.children[0]).toHaveClass('ep-setting-row__label')
    expect(row.children[1]).toHaveClass('ep-setting-row__control')
    expect(row.children[1]).toHaveTextContent('林同学')
  })

  it('validates deactivation, keeps its confirmation pending, and submits the original contract once', async () => {
    const result = deferred<{ recoverable: true }>()
    const deactivateAccount = vi.fn(() => result.promise)
    const onAccountDeactivated = vi.fn()
    render(<AccountSettingsPage api={createApi({ deactivateAccount })} onAccountDeactivated={onAccountDeactivated} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('账户状态')
    fireEvent.click(screen.getByRole('button', { name: '停用账户' }))
    const dialog = screen.getByRole('dialog', { name: '停用账户？' })
    const confirm = within(dialog).getByRole('button', { name: '确认停用' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('当前密码'), { target: { value: 'current-passphrase' } })
    fireEvent.change(within(dialog).getByLabelText('停用原因'), { target: { value: '  暂停使用  ' } })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled()
    expect(deactivateAccount).toHaveBeenCalledOnce()
    expect(deactivateAccount).toHaveBeenCalledWith({ currentPassword: 'current-passphrase', reason: '暂停使用', idempotencyKey: expect.any(String) })
    result.resolve({ recoverable: true })
    await waitFor(() => expect(onAccountDeactivated).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cycles confirmation focus while keeping the underlying settings inert', async () => {
    render(<AccountSettingsPage api={createApi()} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('安全')
    fireEvent.click(screen.getByRole('button', { name: '撤销 Chrome · Windows 会话' }))
    const dialog = screen.getByRole('dialog', { name: '撤销这个会话？' })
    const cancel = within(dialog).getByRole('button', { name: '取消' })
    const confirm = within(dialog).getByRole('button', { name: '确认撤销' })
    expect(document.querySelector('.ep-settings-workspace')).toHaveAttribute('inert')
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(cancel).toHaveFocus()
  })

  it('switches the browser-local sidebar layout immediately and restores it on remount', async () => {
    const updatePreferences = vi.fn(async () => account.preferences)
    const first = render(<AccountSettingsPage api={createApi({ updatePreferences })} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('使用偏好')
    const toggle = screen.getByRole('switch', { name: '新侧栏布局' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem(sidebarLayoutPreferenceStorageKey)).toBe('split')
    expect(updatePreferences).not.toHaveBeenCalled()
    first.unmount()

    render(<AccountSettingsPage api={createApi({ updatePreferences })} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('使用偏好')
    expect(screen.getByRole('switch', { name: '新侧栏布局' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('switch', { name: '新侧栏布局' }))
    expect(window.localStorage.getItem(sidebarLayoutPreferenceStorageKey)).toBe('classic')
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  it('switches browser appearance immediately without submitting account preferences', async () => {
    const updatePreferences = vi.fn(async () => account.preferences)
    render(<AccountSettingsPage api={createApi({ updatePreferences })} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('使用偏好')
    const appearance = screen.getByRole('group', { name: '外观' })
    expect(within(appearance).getByRole('button', { name: '跟随系统' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(appearance).getByRole('button', { name: '深色' }))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.documentElement.dataset.colorScheme).toBe('dark')
    expect(window.localStorage.getItem(appearancePreferenceStorageKey)).toBe('dark')
    expect(within(appearance).getByRole('button', { name: '深色' })).toHaveAttribute('aria-pressed', 'true')
    expect(updatePreferences).not.toHaveBeenCalled()

    fireEvent.click(within(appearance).getByRole('button', { name: '浅色' }))
    expect(document.documentElement.style.colorScheme).toBe('light')
    fireEvent.click(within(appearance).getByRole('button', { name: '跟随系统' }))
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.documentElement.dataset.colorScheme).toBe('system')
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  it('reaches all nine categories through the compact picker and retains the Agent editor', async () => {
    const onResetAgent = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['agent-profile', account.userId], {
      name: 'Everplain', avatar_id: 'cheng', color: '#5d8fe6', speaking_style: 'clear',
      setup_step: 4, setup_completed: true, version: 1, questionnaire: {}, greeting: '你好',
    })
    render(<QueryClientProvider client={queryClient}><AccountSettingsPage api={createApi()} onResetAgent={onResetAgent} /></QueryClientProvider>)

    const navigation = await screen.findByRole('navigation', { name: '账户设置分区' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '我的 Agent', '我的形象', '聊天平台', '个人资料', '使用情况', '使用偏好', '安全', '数据与隐私', '账户状态',
    ])
    expect(screen.queryByRole('button', { name: '重新设置我的 AI 伙伴' })).not.toBeInTheDocument()
    expect(screen.getAllByText('林同学')).toHaveLength(1)

    const picker = screen.getByRole('combobox', { name: '设置分类', hidden: true })
    expect(picker).toHaveTextContent('个人资料')
    fireEvent.click(picker)
    const categoryOptions = within(screen.getByRole('listbox', { hidden: true })).getAllByRole('option', { hidden: true })
    expect(categoryOptions.map(option => option.textContent)).toEqual([
      '我的 Agent', '我的形象', '聊天平台', '个人资料', '使用情况', '使用偏好', '安全', '数据与隐私', '账户状态',
    ])
    const content = screen.getByRole('region', { name: '个人资料' })
    content.scrollTop = 240
    fireEvent.click(categoryOptions[0])
    expect(content.scrollTop).toBe(0)
    expect(picker).toHaveTextContent('我的 Agent')
    expect(within(navigation).getByRole('button', { name: '我的 Agent' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(await screen.findByRole('button', { name: '重新设置我的 AI 伙伴' }))
    expect(onResetAgent).toHaveBeenCalledOnce()
  })

  it('uses the shared navigation component and resets the content scroll on section changes', async () => {
    render(<AccountSettingsPage api={createApi()} />)

    const content = await screen.findByRole('region', { name: '个人资料' })
    content.scrollTop = 320
    const navigation = screen.getByRole('navigation', { name: '账户设置分区' })
    const security = within(navigation).getByRole('button', { name: '安全' })
    expect(security).toHaveClass('qx-item')
    fireEvent.click(security)
    expect(content.scrollTop).toBe(0)
    expect(screen.getByRole('region', { name: '安全' })).toContainElement(screen.getByLabelText('当前密码'))
    expect(screen.getByRole('button', { name: '退出登录' })).toBeVisible()
  })

  it('keeps admin navigation and sign-out together below the category navigation', async () => {
    render(<AccountSettingsPage api={createApi({ getAccount: async () => ({ ...account, role: 'admin' }) })} />)

    const navigation = await screen.findByRole('navigation', { name: '账户设置分区' })
    const admin = screen.getByRole('link', { name: '打开用户管理' })
    const signOut = screen.getByRole('button', { name: '退出登录' })
    expect(admin).toHaveAttribute('href', '/admin/users')
    expect(admin.parentElement).toBe(signOut.parentElement)
    expect(navigation).not.toContainElement(signOut)
    expect(screen.getAllByText('管理员')).toHaveLength(1)
  })

  it('omits notification controls without a delivery service while preserving the stored preference', async () => {
    const updatePreferences = vi.fn(async () => account.preferences)
    render(<AccountSettingsPage api={createApi({ updatePreferences })} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('使用偏好')
    expect(screen.queryByRole('checkbox', { name: /研究进度与内测通知/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }))
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ researchUpdatesEnabled: true })))
  })

  it('shows the sign-out action below the settings navigation', async () => {
    const onLogout = vi.fn()
    render(<AccountSettingsPage api={createApi()} onLogout={onLogout} />)

    await screen.findByRole('navigation', { name: '账户设置分区' })
    const button = screen.getByRole('button', { name: '退出登录' })
    expect(button).toBeVisible()

    fireEvent.click(button)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('shows one settings partition at a time and switches it from the left navigation', async () => {
    render(<AccountSettingsPage api={createApi()} />)

    expect(await screen.findByRole('heading', { name: '个人资料' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '使用偏好' })).not.toBeInTheDocument()

    const navigation = screen.getByRole('navigation', { name: '账户设置分区' })
    fireEvent.click(within(navigation).getByRole('button', { name: '使用偏好' }))

    expect(screen.getByRole('heading', { name: '使用偏好' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '个人资料' })).not.toBeInTheDocument()
  })

  it('previews English immediately and persists the locale preference', async () => {
    const updatePreferences = vi.fn(async (input) => ({
      ...account.preferences,
      locale: input.locale,
      timezone: input.timezone,
      researchUpdatesEnabled: input.researchUpdatesEnabled,
      version: 3,
    }))
    render(
      <AppLocaleProvider>
        <AccountSettingsPage api={createApi({ updatePreferences })} />
      </AppLocaleProvider>,
    )

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('使用偏好')
    fireEvent.click(screen.getByRole('combobox', { name: '界面语言' }))
    fireEvent.click(screen.getByRole('option', { name: 'English' }))

    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Usage' })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    const timezone = screen.getByRole('combobox', { name: 'Time zone' })
    expect(timezone.tagName).not.toBe('SELECT')
    fireEvent.click(timezone)
    fireEvent.click(screen.getByRole('option', { name: 'Coordinated Universal Time' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en-US', timezone: 'UTC' }),
    ))
  })

  it('shows usage history without inventing a percentage from the legacy credit limit', async () => {
    const getCreditSummary = vi.fn(async () => ({
      balance: 1162,
      creditLimit: 3000,
      grantAmount: 3000,
      isUnlimited: false,
      inputTokensPerCredit: 100,
      outputTokensPerCredit: 25,
      entries: [{
        entryId: 'entry-1',
        kind: 'usage' as const,
        points: -38,
        balanceAfter: 1162,
        inputTokens: 600,
        outputTokens: 800,
        status: 'refunded' as const,
        chargedCny: 0.38,
        refundedCny: 0.38,
        model: 'deepseek-v4-flash',
        createdAt: '2026-08-22T06:00:00Z',
      }],
      totalEntries: 1,
      nextCursor: null,
    }))
    const api = { ...createApi(), getCreditSummary } as AccountManagementApi

    render(<AccountSettingsPage api={api} />)

    const navigation = await screen.findByRole('navigation', { name: '账户设置分区' })
    fireEvent.click(within(navigation).getByRole('button', { name: '使用情况' }))

    expect(getCreditSummary).toHaveBeenCalledOnce()
    expect(screen.getByText('额度信息暂不可用')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/1,162|3,000|39%|积分/)).not.toBeInTheDocument()
    expect(screen.getByText('600 输入 · 800 输出 token')).toBeVisible()
    expect(screen.queryByText('-38')).not.toBeInTheDocument()
    expect(screen.getByText('已退款')).toBeVisible()
    expect(screen.getByText(/费用.*0.38/)).toBeVisible()
    expect(screen.getByText(/退款.*0.38/)).toBeVisible()
    expect(screen.queryByText(/deepseek-v4-flash/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '个人资料' })).not.toBeInTheDocument()
  })

  it('pages the credit consumption ledger without appending one long list', async () => {
    const firstEntry = {
      entryId: 'entry-new',
      kind: 'usage' as const,
      points: -20,
      balanceAfter: 1100,
      inputTokens: 100,
      outputTokens: 25,
      createdAt: '2026-08-23T06:00:00Z',
    }
    const olderEntry = {
      ...firstEntry,
      entryId: 'entry-old',
      points: -12,
      balanceAfter: 1120,
      createdAt: '2026-08-01T06:00:00Z',
    }
    const getCreditSummary = vi.fn(async (input?: { cursor?: string; limit?: number }) => (
      input?.cursor === '10'
        ? {
            balance: 1100,
            creditLimit: 3000,
            grantAmount: 3000,
            isUnlimited: false,
            inputTokensPerCredit: 100,
            outputTokensPerCredit: 25,
            entries: [olderEntry],
            totalEntries: 11,
            nextCursor: null,
          }
        : {
            balance: 1100,
            creditLimit: 3000,
            grantAmount: 3000,
            isUnlimited: false,
            inputTokensPerCredit: 100,
            outputTokensPerCredit: 25,
            entries: [firstEntry],
            totalEntries: 11,
            nextCursor: '10',
          }
    ))
    render(<AccountSettingsPage api={createApi({ getCreditSummary })} />)

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('使用情况')
    expect(document.querySelector('time[datetime="2026-08-23T06:00:00Z"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页用量记录' }))

    await waitFor(() => expect(getCreditSummary).toHaveBeenLastCalledWith({
      cursor: '10',
      limit: 10,
      signal: expect.any(AbortSignal),
    }))
    await waitFor(() => expect(document.querySelector('time[datetime="2026-08-01T06:00:00Z"]')).toBeInTheDocument())
    expect(document.querySelector('time[datetime="2026-08-23T06:00:00Z"]')).not.toBeInTheDocument()
    expect(screen.getByText('第 2 页')).toBeVisible()
  })

  it('redeems one code and refreshes the visible credit balance', async () => {
    const getCreditSummary = vi.fn()
      .mockResolvedValueOnce({
        balance: 1200,
        activeUsageBuckets: [{ id: 'welcome', kind: 'welcome', availablePoints: 900, limitPoints: 3000, expiresAt: null }],
        creditLimit: 3000,
        grantAmount: 3000,
        isUnlimited: false,
        inputTokensPerCredit: 100,
        outputTokensPerCredit: 25,
        entries: [],
        totalEntries: 0,
        nextCursor: null,
      })
      .mockResolvedValue({
        balance: 3000,
        activeUsageBuckets: [{ id: 'top-up', kind: 'top_up', availablePoints: 3000, limitPoints: 6000, expiresAt: null }],
        creditLimit: 3000,
        grantAmount: 3000,
        isUnlimited: false,
        inputTokensPerCredit: 100,
        outputTokensPerCredit: 25,
        entries: [],
        totalEntries: 0,
        nextCursor: null,
      })
    const redeemCredits = vi.fn(async () => ({ redeemedPoints: 3000, balance: 3000 }))
    render(<AccountSettingsPage api={createApi({ getCreditSummary, redeemCredits })} />)

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('使用情况')
    fireEvent.change(screen.getByLabelText('兑换码'), {
      target: { value: 'QX-7KDM-4XJP-9TWR-P6AC' },
    })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))

    await waitFor(() => expect(redeemCredits).toHaveBeenCalledWith({
      code: 'QX-7KDM-4XJP-9TWR-P6AC',
      idempotencyKey: expect.any(String),
    }))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: '额外购买额度' })).toHaveAttribute('aria-valuenow', '50'))
    expect(screen.getByRole('status')).toHaveTextContent('兑换成功')
    await waitFor(() => expect(getCreditSummary).toHaveBeenCalledTimes(3))
    expect(screen.getByText(/3,000.*6,000.*3,000/)).toBeInTheDocument()
  })

  it('shows an unlimited balance for the provisioned administrator', async () => {
    const api = createApi({
      getCreditSummary: async () => ({
        balance: 3000,
        creditLimit: 3000,
        grantAmount: 3000,
        isUnlimited: true,
        inputTokensPerCredit: 100,
        outputTokensPerCredit: 25,
        entries: [],
        totalEntries: 0,
        nextCursor: null,
      }),
    })

    render(<AccountSettingsPage api={api} />)

    const navigation = await screen.findByRole('navigation', { name: '账户设置分区' })
    fireEvent.click(within(navigation).getByRole('button', { name: '使用情况' }))

    expect(screen.getByText('不限量')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('keeps a successful redemption successful when its follow-up usage read fails', async () => {
    const initial = await createApi().getCreditSummary()
    const getCreditSummary = vi.fn().mockResolvedValueOnce(initial).mockRejectedValue(new Error('read failed'))
    const redeemCredits = vi.fn(async () => ({ redeemedPoints: 3000, balance: 4200 }))
    render(<AccountSettingsPage api={createApi({ getCreditSummary, redeemCredits })} />)
    await screen.findByRole('heading', { name: '个人资料' })
    openPartition('使用情况')
    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'QX-ONE-CODE' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    expect(await screen.findByRole('status')).toHaveTextContent('兑换成功')
    expect(screen.getByText('额度信息暂不可用')).toBeVisible()
    expect(screen.getByLabelText('兑换码')).toHaveValue('')
    expect(redeemCredits).toHaveBeenCalledOnce()
    await waitFor(() => expect(getCreditSummary).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('recovers from a failed load and explains an empty session list', async () => {
    let attempt = 0
    const api = createApi({
      getAccount: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('network unavailable')
        return account
      },
      listSessions: async () => [],
    })

    render(<AccountSettingsPage api={api} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在读取账户设置')
    const loadError = await screen.findByRole('alert')
    expect(loadError).toHaveTextContent('暂时无法读取账户设置')
    fireEvent.click(within(loadError).getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('heading', { name: '账户设置' })).toBeVisible()
    expect(within(screen.getByRole('region', { name: '个人资料' })).getByText('lin@example.com')).toBeVisible()
    openPartition('安全')
    expect(screen.getByText('没有其他活跃会话')).toBeVisible()
  })

  it('saves a profile once while the request is pending and keeps versioned input', async () => {
    const update = deferred<AccountProfile>()
    const updateProfile = vi.fn(() => update.promise)
    const onProfileUpdated = vi.fn()
    const api = createApi({ updateProfile })
    render(<AccountSettingsPage api={api} onProfileUpdated={onProfileUpdated} />)

    fireEvent.click(await screen.findByRole('button', { name: '修改显示名称' }))
    const displayName = await screen.findByLabelText('显示名称')
    fireEvent.change(displayName, { target: { value: '林研究员' } })
    const save = screen.getByRole('button', { name: '保存资料' })
    fireEvent.click(save)
    fireEvent.click(save)

    expect(updateProfile).toHaveBeenCalledOnce()
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      displayName: '林研究员',
      expectedVersion: 3,
      idempotencyKey: expect.any(String),
    }))
    expect(save).toBeDisabled()

    update.resolve({ ...account, displayName: '林研究员', version: 4 })
    expect(await screen.findByRole('status')).toHaveTextContent('资料已保存')
    expect(screen.queryByRole('button', { name: '保存资料' })).not.toBeInTheDocument()
    expect(screen.getAllByText('林研究员').length).toBeGreaterThan(0)
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({
      displayName: '林研究员',
      version: 4,
    }))
  })

  it('reuses one mutation key after a network failure for the same user intent', async () => {
    const updateProfile = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce({ ...account, displayName: '林研究员', version: 4 })
    render(<AccountSettingsPage api={createApi({ updateProfile })} />)

    fireEvent.click(await screen.findByRole('button', { name: '修改显示名称' }))
    const displayName = await screen.findByLabelText('显示名称')
    fireEvent.change(displayName, { target: { value: '林研究员' } })
    const save = screen.getByRole('button', { name: '保存资料' })
    fireEvent.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成')
    fireEvent.click(save)

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(2))
    expect(updateProfile.mock.calls[1][0].idempotencyKey).toBe(
      updateProfile.mock.calls[0][0].idempotencyKey,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('资料已保存')
  })

  it('traps focus in a session confirmation and restores the trigger after Escape', async () => {
    const revokeSession = vi.fn(async () => undefined)
    render(<AccountSettingsPage api={createApi({ revokeSession })} />)

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('安全')
    const trigger = await screen.findByRole('button', { name: '撤销 Chrome · Windows 会话' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '撤销这个会话？' })
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认撤销' }))
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith(
      'session-other',
      { idempotencyKey: expect.any(String) },
    ))
    expect(screen.queryByText('Chrome · Windows')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('会话已撤销')
  })

  it('changes the password and removes revoked sessions from the visible ledger', async () => {
    const changePassword = vi.fn(async () => ({ revokedSessionCount: 1 }))
    render(<AccountSettingsPage api={createApi({ changePassword })} />)

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('安全')
    await screen.findByRole('heading', { name: '安全' })
    fireEvent.change(screen.getByLabelText('当前密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'new-research-passphrase' },
    })
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'new-research-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新密码' }))

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'research-passphrase',
      newPassword: 'new-research-passphrase',
      revokeOtherSessions: true,
      idempotencyKey: expect.any(String),
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('密码已更新，已撤销 1 个其他会话')
    expect(screen.queryByText('Chrome · Windows')).not.toBeInTheDocument()
  })

  it('makes model authorization explicit, exposes a real export, and requires typed deletion proof', async () => {
    const updateAuthorization = vi.fn(async () => ({
      ...account.preferences,
      modelImprovementAllowed: true,
      consentUpdatedAt: '2026-08-22T06:00:00Z',
      version: 3,
    }))
    const deleteAccount = vi.fn(async () => ({ recoverable: false as const }))
    const onAccountDeleted = vi.fn()
    render(
      <AccountSettingsPage
        api={createApi({
          updateModelDataAuthorization: updateAuthorization,
          deleteAccount,
        })}
        onAccountDeleted={onAccountDeleted}
      />,
    )

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('数据与隐私')
    const modelSwitch = await screen.findByRole('switch', { name: '允许用于改进模型' })
    expect(modelSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(modelSwitch)
    const consentDialog = screen.getByRole('dialog', { name: '允许用于改进模型？' })
    expect(consentDialog).toHaveTextContent('当前不使用你的数据训练模型')
    fireEvent.click(within(consentDialog).getByRole('button', { name: '确认允许' }))
    await waitFor(() => expect(updateAuthorization).toHaveBeenCalledWith({
      allowed: true,
      policyVersion: '2026-08-secondary-use-v1',
      expectedVersion: 2,
      idempotencyKey: expect.any(String),
    }))
    expect(modelSwitch).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: '导出我的数据' }))
    expect(await screen.findByRole('link', { name: '下载数据副本' })).toHaveAttribute(
      'href',
      '/api/account/data-exports/export-1/download',
    )

    openPartition('账户状态')
    const deleteTrigger = screen.getByRole('button', { name: '永久删除账户' })
    fireEvent.click(deleteTrigger)
    const deleteDialog = screen.getByRole('dialog', { name: '永久删除账户？' })
    expect(deleteDialog).toHaveTextContent('删除后无法恢复')
    const confirm = within(deleteDialog).getByRole('button', { name: '确认永久删除' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(deleteDialog).getByLabelText('账户邮箱'), {
      target: { value: 'lin@example.com' },
    })
    fireEvent.change(within(deleteDialog).getByLabelText('当前密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.click(confirm)

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith({
      currentPassword: 'research-passphrase',
      confirmationEmail: 'lin@example.com',
      idempotencyKey: expect.any(String),
    }))
    expect(onAccountDeleted).toHaveBeenCalledOnce()
  })

  it('explains the fixed deployment administrator boundary without offering deletion', async () => {
    render(<AccountSettingsPage api={createApi({
      getAccount: async () => ({ ...account, role: 'admin', isProtectedAdmin: true }),
    })} />)

    await screen.findByRole('heading', { name: '账户设置' })
    openPartition('账户状态')
    expect(await screen.findByRole('heading', { name: '部署管理员保护' })).toBeVisible()
    expect(screen.getByText(/不能被降级、停用或删除/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '停用账户' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '永久删除账户' })).not.toBeInTheDocument()
  })
})
