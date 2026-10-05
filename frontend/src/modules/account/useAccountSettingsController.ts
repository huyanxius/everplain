import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { readAppearancePreference, setAppearancePreference, type AppearancePreference } from '../../styles/appearancePreference'
import { accountManagementApi } from './accountManagementApi'
import { isAccountManagementRequestError, type AccountManagementApi, type AccountProfile, type AccountSession, type CreditSummary, type PersonalDataExport } from './accountManagementModels'
import { MutationIntentLedger } from './mutationIntent'
import { notifyAccountUsageChanged, watchAccountUsageChanges } from './accountUsageEvents'

export type SettingsSection = 'agent' | 'look' | 'channels' | 'profile' | 'credits' | 'preferences' | 'security' | 'privacy' | 'danger'
export type SettingsConfirmation =
  | { kind: 'session'; session: AccountSession }
  | { kind: 'model'; allowed: boolean }
  | { kind: 'deactivate' }
  | { kind: 'delete' }

type AccountState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; account: AccountProfile; sessions: AccountSession[]; credits: CreditSummary }

export type AccountSettingsOptions = {
  api?: AccountManagementApi
  initialSection?: SettingsSection
  onProfileUpdated?(account: AccountProfile): void
  onSessionExpired?(): void
  onAccountDeactivated?(): void
  onAccountDeleted?(): void
}

export const creditPageSize = 10

/** Account contracts and mutation state, deliberately independent of the settings view. */
export function useAccountSettingsController({
  api = accountManagementApi,
  initialSection = 'profile',
  onProfileUpdated,
  onSessionExpired,
  onAccountDeactivated,
  onAccountDeleted,
}: AccountSettingsOptions) {
  const { locale: appLocale, setLocale: setAppLocale } = useAppLocale()
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [displayName, setDisplayName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [locale, setLocale] = useState(appLocale)
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [appearance, setAppearance] = useState(readAppearancePreference)
  const [researchUpdatesEnabled, setResearchUpdatesEnabled] = useState(true)
  const [password, setPassword] = useState({ current: '', next: '', confirmation: '', revokeOtherSessions: true })
  const [redemptionCode, setRedemptionCode] = useState('')
  const [creditPage, setCreditPage] = useState(1)
  const [confirmation, setConfirmation] = useState<SettingsConfirmation | null>(null)
  const [deactivation, setDeactivation] = useState({ password: '', reason: '' })
  const [deletion, setDeletion] = useState({ password: '', email: '' })
  const [dataExport, setDataExport] = useState<PersonalDataExport | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const intents = useRef(new MutationIntentLedger())
  const confirmationTrigger = useRef<HTMLElement | null>(null)
  const creditReadVersion = useRef(0)
  const creditAbort = useRef<AbortController | null>(null)
  const creditCursor = useRef<string | undefined>(undefined)
  const creditTargetPage = useRef(1)
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    Promise.all([api.getAccount(), api.listSessions(), api.getCreditSummary({ limit: creditPageSize })])
      .then(([account, sessions, credits]) => {
        if (!active) return
        setState({ status: 'ready', account, sessions, credits })
        setDisplayName(account.displayName ?? '')
        const preferredLocale = account.preferences.locale === 'en-US' ? 'en-US' : 'zh-CN'
        setLocale(preferredLocale)
        setAppLocale(preferredLocale)
        setTimezone(account.preferences.timezone)
        setResearchUpdatesEnabled(account.preferences.researchUpdatesEnabled)
      })
      .catch((failure: unknown) => {
        if (!active) return
        if (isAccountManagementRequestError(failure) && failure.status === 401) onSessionExpired?.()
        setState({ status: 'error' })
      })
    return () => { active = false }
  }, [api, onSessionExpired, reload, setAppLocale])

  useEffect(() => {
    if (state.status !== 'ready') return watchAccountUsageChanges(() => setReload(value => value + 1))
    const refresh = () => {
      const version = ++creditReadVersion.current
      creditAbort.current?.abort()
      const controller = new AbortController()
      creditAbort.current = controller
      void api.getCreditSummary({ cursor: creditCursor.current, limit: creditPageSize, signal: controller.signal })
        .then(credits => {
          if (version !== creditReadVersion.current || controller.signal.aborted) return
          setState(current => current.status === 'ready' ? { ...current, credits } : current)
          setCreditPage(creditTargetPage.current)
        }).catch(() => { /* Keep the last verified ledger on a failed refresh. */ })
    }
    const unwatch = watchAccountUsageChanges(refresh)
    // Cancel the latest request, including one started after the effect mounted.
    const cancelLatestRead = () => { creditAbort.current?.abort(); ++creditReadVersion.current }
    return () => { unwatch(); cancelLatestRead() }
  }, [api, state.status])

  function updateAccount(account: AccountProfile) {
    setState(current => current.status === 'ready' ? { ...current, account } : current)
  }

  function failureMessage(failure: unknown) {
    if (isAccountManagementRequestError(failure)) {
      if (failure.status === 401) {
        onSessionExpired?.()
        return text('登录已过期，请重新登录后继续。', 'Your session expired. Sign in again to continue.')
      }
      if (failure.status === 409) return failure.message
    }
    return text('操作未完成，已保留当前数据。请检查网络后重试。', 'The change was not completed. Your current data is unchanged. Check your connection and try again.')
  }

  async function perform<T>(action: string, operation: () => Promise<T>, apply: (value: T) => void, message: string | ((value: T) => string)) {
    if (pendingRef.current) return
    pendingRef.current = action
    setPendingAction(action)
    setError(null)
    setFeedback(null)
    try {
      const value = await operation()
      intents.current.complete(action)
      apply(value)
      setFeedback(typeof message === 'function' ? message(value) : message)
    } catch (failure) {
      setError(failureMessage(failure))
    } finally {
      pendingRef.current = null
      setPendingAction(null)
    }
  }

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.status !== 'ready') return
    const name = displayName.trim()
    if (!name || name.length > 80) {
      setError(text('显示名称需要 1-80 个字符。', 'Display name must be between 1 and 80 characters.'))
      return
    }
    const intent = { displayName: name, expectedVersion: state.account.version }
    void perform('profile', () => api.updateProfile({ ...intent, idempotencyKey: intents.current.keyFor('profile', intent) }), updated => {
      updateAccount(updated)
      setDisplayName(updated.displayName ?? '')
      setEditingName(false)
      onProfileUpdated?.(updated)
    }, text('资料已保存。', 'Profile saved.'))
  }

  function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.status !== 'ready') return
    const intent = { locale, timezone, researchUpdatesEnabled, expectedVersion: state.account.preferences.version }
    void perform('preferences', () => api.updatePreferences({ ...intent, idempotencyKey: intents.current.keyFor('preferences', intent) }), preferences => {
      updateAccount({ ...state.account, preferences })
    }, text('偏好已保存。', 'Preferences saved.'))
  }

  function redeemCredits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.status !== 'ready') return
    const code = redemptionCode.trim()
    if (!code) {
      setError(text('请输入兑换码。', 'Enter a redemption code.'))
      return
    }
    void perform('credit-redemption', async () => {
      const redemption = await api.redeemCredits({ code, idempotencyKey: intents.current.keyFor('credit-redemption', { code }) })
      // A failed read after successful redemption must never turn it into a second redemption attempt.
      const credits = await api.getCreditSummary({ limit: creditPageSize }).catch(() => null)
      return { redemption, credits }
    }, ({ redemption, credits }) => {
      setState(current => current.status === 'ready' ? { ...current, credits: credits ?? { ...current.credits, balance: redemption.balance, activeUsageBuckets: null } } : current)
      if (credits) { setCreditPage(1); creditCursor.current = undefined; creditTargetPage.current = 1 }
      notifyAccountUsageChanged()
      setRedemptionCode('')
    }, text('兑换成功。', 'Code redeemed.'))
  }

  async function loadCreditPage(page: number, cursor?: string) {
    if (pendingRef.current) return
    pendingRef.current = 'credit-page'
    setPendingAction('credit-page')
    setError(null)
    const version = ++creditReadVersion.current
    creditAbort.current?.abort()
    const controller = new AbortController()
    creditAbort.current = controller
    creditCursor.current = cursor
    creditTargetPage.current = page
    try {
      const credits = await api.getCreditSummary({ ...(cursor ? { cursor } : {}), limit: creditPageSize, signal: controller.signal })
      if (version !== creditReadVersion.current || controller.signal.aborted) return
      setState(current => current.status === 'ready' ? { ...current, credits } : current)
      setCreditPage(page)
    } catch (failure) {
      if (version !== creditReadVersion.current || controller.signal.aborted) return
      setError(failureMessage(failure))
    } finally {
      pendingRef.current = null
      setPendingAction(null)
    }
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.next.length < 12 || password.next.length > 128) {
      setError(text('新密码需要 12-128 个字符。', 'New password must be between 12 and 128 characters.'))
      return
    }
    if (password.next !== password.confirmation) {
      setError(text('两次输入的新密码不一致。', 'The new passwords do not match.'))
      return
    }
    const intent = { currentPassword: password.current, newPassword: password.next, revokeOtherSessions: password.revokeOtherSessions }
    void perform('password', () => api.changePassword({ ...intent, idempotencyKey: intents.current.keyFor('password', intent) }), () => {
      setPassword(current => ({ ...current, current: '', next: '', confirmation: '' }))
      if (password.revokeOtherSessions) setState(current => current.status === 'ready' ? { ...current, sessions: current.sessions.filter(session => session.current) } : current)
    }, ({ revokedSessionCount }) => text(`密码已更新，已撤销 ${revokedSessionCount} 个其他会话。`, `Password updated. ${revokedSessionCount} other session${revokedSessionCount === 1 ? '' : 's'} revoked.`))
  }

  function exportData() {
    void perform('export', () => api.requestDataExport({ idempotencyKey: intents.current.keyFor('export', { format: 'json' }) }), setDataExport, text('数据副本已准备。', 'Your data copy is ready.'))
  }

  function confirmAction() {
    if (!confirmation || state.status !== 'ready') return
    if (confirmation.kind === 'session') {
      const sessionId = confirmation.session.sessionId
      void perform('revoke-session', () => api.revokeSession(sessionId, { idempotencyKey: intents.current.keyFor('revoke-session', { sessionId }) }), () => {
        setState(current => current.status === 'ready' ? { ...current, sessions: current.sessions.filter(session => session.sessionId !== sessionId) } : current)
        setConfirmation(null)
      }, text('会话已撤销。', 'Session revoked.'))
    } else if (confirmation.kind === 'model') {
      const { allowed } = confirmation
      const intent = { allowed, policyVersion: state.account.preferences.consentPolicyVersion, expectedVersion: state.account.preferences.version }
      void perform('model-authorization', () => api.updateModelDataAuthorization({ ...intent, idempotencyKey: intents.current.keyFor('model-authorization', intent) }), preferences => {
        updateAccount({ ...state.account, preferences })
        setConfirmation(null)
      }, allowed ? text('模型数据授权已开启。', 'Model improvement consent enabled.') : text('模型数据授权已关闭。', 'Model improvement consent disabled.'))
    } else if (confirmation.kind === 'deactivate') {
      if (!deactivation.password || !deactivation.reason.trim()) return
      const intent = { currentPassword: deactivation.password, reason: deactivation.reason.trim() }
      void perform('deactivate', () => api.deactivateAccount({ ...intent, idempotencyKey: intents.current.keyFor('deactivate', intent) }), () => {
        setConfirmation(null)
        onAccountDeactivated?.()
      }, text('账户已停用。', 'Account deactivated.'))
    } else {
      if (!state.account.email || !deletion.password || deletion.email.trim().toLowerCase() !== state.account.email.toLowerCase()) return
      const intent = { currentPassword: deletion.password, confirmationEmail: deletion.email.trim() }
      void perform('delete', () => api.deleteAccount({ ...intent, idempotencyKey: intents.current.keyFor('delete', intent) }), () => {
        setConfirmation(null)
        onAccountDeleted?.()
      }, text('账户已永久删除。', 'Account permanently deleted.'))
    }
  }

  return {
    state, text, section, displayName, setDisplayName, editingName, setEditingName,
    locale, timezone, setTimezone, appearance, password, setPassword,
    redemptionCode, setRedemptionCode, creditPage, dataExport, feedback, error,
    pending: pendingAction !== null, pendingAction, confirmation, confirmationTrigger,
    deactivation, setDeactivation, deletion, setDeletion,
    retry: () => setReload(value => value + 1),
    selectSection(next: SettingsSection) { setSection(next); setFeedback(null); setError(null) },
    cancelName() { setEditingName(false); setDisplayName(state.status === 'ready' ? state.account.displayName ?? '' : ''); setError(null) },
    selectLocale(next: 'zh-CN' | 'en-US') { setLocale(next); setAppLocale(next) },
    selectAppearance(next: AppearancePreference) { setAppearancePreference(next); setAppearance(next) },
    openConfirmation(next: SettingsConfirmation, trigger: HTMLElement) { confirmationTrigger.current = trigger; setError(null); setConfirmation(next) },
    cancelConfirmation() { if (!pendingRef.current) setConfirmation(null) },
    saveName, savePreferences, redeemCredits, loadCreditPage, changePassword, exportData, confirmAction,
  }
}

export type AccountSettingsController = ReturnType<typeof useAccountSettingsController>
export type ReadySettingsController = AccountSettingsController & { state: Extract<AccountState, { status: 'ready' }> }
