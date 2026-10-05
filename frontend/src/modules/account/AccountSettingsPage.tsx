import { PageLoading } from '../../ui/PageLoading'
import { ChartBarIcon, ChatsCircleIcon, GearSixIcon, LockSimpleIcon, ShieldIcon, SignOutIcon, SmileyIcon, UserGearIcon, UserIcon } from '@phosphor-icons/react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { AccountConfirmationDialog } from './SettingsConfirmation'
import { AgentSettingsPanel } from './AgentSettingsPanel'
import { UserAvatarSettingsPanel } from './UserAvatarSettingsPanel'
import { OAuthActions, OAuthCallbackNotice } from './OAuthActions'
import { SettingRow } from './SettingRow'
import { ChannelBindingsPanel } from '../channel-gateway'
import { Select } from '../../ui/Select'
import { accountUsageFromCredits } from './accountUsage'
import { creditPageSize, useAccountSettingsController, type AccountSettingsOptions, type ReadySettingsController, type SettingsSection } from './useAccountSettingsController'
import { useSidebarLayoutPreference } from '../../styles/sidebarLayoutPreference'
import './account-settings.css'

export { AccountConfirmationDialog } from './SettingsConfirmation'

type SettingsProps = AccountSettingsOptions & { adminHref?: string; onLogout?(): void; onResetAgent?(): void; onOAuthNavigate?(url: string): void; oauthError?: string | null }
type PanelProps = { controller: ReadySettingsController }

const sections = [
  ['agent', '我的 Agent', 'My Agent', SmileyIcon],
  ['look', '我的形象', 'My avatar', UserIcon],
  ['channels', '聊天平台', 'Chat platforms', ChatsCircleIcon],
  ['profile', '个人资料', 'Profile', UserIcon],
  ['credits', '使用情况', 'Usage', ChartBarIcon],
  ['preferences', '使用偏好', 'Preferences', GearSixIcon],
  ['security', '安全', 'Security', LockSimpleIcon],
  ['privacy', '数据与隐私', 'Data & privacy', ShieldIcon],
  ['danger', '账户状态', 'Account status', UserGearIcon],
] as const

function dateLabel(value: string | null, locale: string) {
  if (!value) return locale === 'en-US' ? 'No record' : '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return locale === 'en-US' ? 'Unknown time' : '时间未知'
  return date.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function AccountSettingsPage({ adminHref = '/admin/users', onLogout, onResetAgent, onOAuthNavigate, oauthError, ...options }: SettingsProps) {
  const controller = useAccountSettingsController(options)
  const { text, state } = controller
  const titleId = useId()
  const content = useRef<HTMLElement>(null)
  const [agentOpened, setAgentOpened] = useState(false)
  const [avatarOpened, setAvatarOpened] = useState(false)

  if (state.status !== 'ready') return (
    <div className="ep-settings-load" role={state.status === 'loading' ? undefined : 'alert'}>
      {state.status === 'loading' ? <PageLoading message={text('正在读取账户设置', 'Loading account settings')} /> : <>
        <h2 className="qx-heading">{text('暂时无法读取账户设置', 'Account settings are unavailable')}</h2>
        <p className="qx-meta">{text('你的账户与研究数据没有改变。请检查网络后重试。', 'Your account and research data are unchanged. Check your connection and try again.')}</p>
        <button className="qx-btn qx-btn--secondary" type="button" onClick={controller.retry}>{text('重试', 'Try again')}</button>
      </>}
    </div>
  )

  const ready = { ...controller, state }
  const active = sections.find(([id]) => id === controller.section)!
  const select = (id: SettingsSection) => {
    if (id === 'agent') setAgentOpened(true)
    if (id === 'look') setAvatarOpened(true)
    controller.selectSection(id)
    if (content.current) content.current.scrollTop = 0
  }

  return (
    <div className="ep-settings-page">
      <h1 className="ep-settings-visually-hidden">{text('账户设置', 'Account settings')}</h1>
      <div className="ep-settings-workspace" inert={Boolean(controller.confirmation)}>
        <div className="ep-settings-rail">
          <div className="ep-settings-category-picker">
            <Select aria-label={text('设置分类', 'Settings category')} value={controller.section}
              options={sections.map(([value, zh, en]) => ({ value, label: text(zh, en) }))}
              onChange={value => { const section = sections.find(([id]) => id === value); if (section) select(section[0]) }} />
          </div>
          <nav className="ep-settings-categories" aria-label={text('账户设置分区', 'Account settings sections')}>
            {sections.map(([id, zh, en, Icon]) => (
              <button className="qx-item" key={id} type="button" aria-current={controller.section === id ? 'page' : undefined} onClick={() => select(id)}><Icon aria-hidden="true" />{text(zh, en)}</button>
            ))}
          </nav>
          <footer className="ep-settings-account-actions">
            {state.account.role === 'admin' ? <a className="qx-item" href={adminHref}><UserGearIcon aria-hidden="true" />{text('打开用户管理', 'Open user management')}</a> : null}
            <button className="qx-item" type="button" onClick={onLogout}><SignOutIcon aria-hidden="true" />{text('退出登录', 'Sign out')}</button>
          </footer>
        </div>
        <section className="ep-settings-panel" ref={content} aria-labelledby={titleId}>
          <h2 className="qx-heading ep-settings-panel__title" id={titleId}>{text(active[1], active[2])}</h2>
          {controller.feedback ? <p className="qx-notice" role="status" aria-live="polite">{controller.feedback}</p> : null}
          {controller.error && !controller.confirmation ? <p className="qx-notice qx-notice--danger" role="alert">{controller.error}</p> : null}
          {agentOpened ? <AgentSettingsPanel key={state.account.userId} userId={state.account.userId} active={controller.section === 'agent'} text={text} onResetAgent={onResetAgent} /> : null}
          {avatarOpened ? <UserAvatarSettingsPanel key={state.account.userId} userId={state.account.userId} active={controller.section === 'look'} text={text} /> : null}
          {controller.section === 'channels' ? <ChannelBindingsPanel key={state.account.userId} userId={state.account.userId} text={text} /> : null}
          {controller.section === 'profile' ? <ProfilePanel controller={ready} /> : null}
          {controller.section === 'credits' ? <CreditsPanel controller={ready} /> : null}
          {controller.section === 'preferences' ? <PreferencesPanel controller={ready} /> : null}
          {controller.section === 'security' ? <SecurityPanel controller={ready} onOAuthNavigate={onOAuthNavigate} oauthError={oauthError} /> : null}
          {controller.section === 'privacy' ? <PrivacyPanel controller={ready} /> : null}
          {controller.section === 'danger' ? <AccountStatusPanel controller={ready} /> : null}
        </section>
      </div>
      <SettingsConfirmation controller={ready} />
    </div>
  )
}

function ProfilePanel({ controller: c }: PanelProps) {
  const { account } = c.state
  const name = account.displayName ?? c.text('研究者', 'Researcher')
  return <div className="ep-settings-profile">
    <div className="qx-card ep-settings-profile__details">
      <SettingRow label={c.text('显示名称', 'Display name')}>
        {c.editingName ? <form className="ep-settings-edit" onSubmit={c.saveName} noValidate>
          <input className="qx-input" aria-label={c.text('显示名称', 'Display name')} value={c.displayName} onChange={event => c.setDisplayName(event.target.value)} maxLength={80} autoComplete="name" autoFocus required />
          <div className="ep-settings-actions">
            <button className="qx-btn qx-btn--secondary" type="button" disabled={c.pending} onClick={c.cancelName}>{c.text('取消', 'Cancel')}</button>
            <button className="qx-btn qx-btn--primary" disabled={c.pending}>{c.pendingAction === 'profile' ? c.text('正在保存…', 'Saving…') : c.text('保存资料', 'Save profile')}</button>
          </div>
        </form> : <div className="ep-settings-inline"><span>{name}</span><button className="qx-btn qx-btn--secondary" type="button" aria-label={c.text('修改显示名称', 'Edit display name')} onClick={() => c.setEditingName(true)}>{c.text('修改', 'Edit')}</button></div>}
      </SettingRow>
      <SettingRow label={c.text('邮箱', 'Email')}><span>{account.email}</span><small className="qx-meta">{c.text('变更请联系管理员', 'Contact an administrator to change')}</small></SettingRow>
    </div>
    <dl className="ep-settings-profile__metadata">
      <div><dt>{c.text('账户类型', 'Account type')}</dt><dd>{account.role === 'admin' ? c.text('管理员', 'Administrator') : c.text('个人账户', 'Personal account')}</dd></div>
      <div><dt>{c.text('加入时间', 'Joined')}</dt><dd>{dateLabel(account.createdAt, c.locale)}</dd></div>
    </dl>
  </div>
}

function PreferencesPanel({ controller: c }: PanelProps) {
  const [splitSidebar, setSplitSidebar] = useSidebarLayoutPreference()
  return <form className="ep-settings-fields" onSubmit={c.savePreferences}>
    <SettingRow label={c.text('外观', 'Appearance')}>
      <div className="qx-segmented ep-settings-appearance" role="group" aria-label={c.text('外观', 'Appearance')}>
        {(['system', 'light', 'dark'] as const).map(preference => <button key={preference} type="button" aria-pressed={c.appearance === preference} onClick={() => c.selectAppearance(preference)}>{preference === 'system' ? c.text('跟随系统', 'System') : preference === 'light' ? c.text('浅色', 'Light') : c.text('深色', 'Dark')}</button>)}
      </div>
    </SettingRow>
    <SettingRow label={c.text('新侧栏布局', 'New sidebar layout')}>
      <button className="qx-switch" type="button" role="switch" aria-label={c.text('新侧栏布局', 'New sidebar layout')} aria-checked={splitSidebar} onClick={() => setSplitSidebar(!splitSidebar)} />
    </SettingRow>
    <SettingRow label={c.text('界面语言', 'Interface language')}>
      <Select aria-label={c.text('界面语言', 'Interface language')} value={c.locale} onChange={value => c.selectLocale(value === 'en-US' ? 'en-US' : 'zh-CN')} options={[{ value: 'zh-CN', label: c.text('简体中文', 'Chinese (Simplified)') }, { value: 'en-US', label: 'English' }]} />
    </SettingRow>
    <SettingRow label={c.text('时区', 'Time zone')}>
      <Select aria-label={c.text('时区', 'Time zone')} value={c.timezone} onChange={c.setTimezone} options={[{ value: 'Asia/Shanghai', label: c.text('中国标准时间', 'China Standard Time') }, { value: 'UTC', label: c.text('协调世界时', 'Coordinated Universal Time') }]} />
    </SettingRow>
    <div className="ep-settings-actions"><button className="qx-btn qx-btn--primary" disabled={c.pending}>{c.pendingAction === 'preferences' ? c.text('正在保存…', 'Saving…') : c.text('保存偏好', 'Save preferences')}</button></div>
  </form>
}

function CreditsPanel({ controller: c }: PanelProps) {
  const { credits } = c.state
  const usage = accountUsageFromCredits(credits)
  const statusLabels = { pending: c.text('处理中', 'Pending'), settled: c.text('已结算', 'Settled'), failed: c.text('调用失败', 'Failed'), refunded: c.text('已退款', 'Refunded'), released: c.text('预留额度已释放', 'Reserved allowance released') }
  const money = (amount: number) => amount.toLocaleString(c.locale, { style: 'currency', currency: 'CNY' })
  return <div className="ep-settings-fields">
    <SettingRow label={c.text('剩余使用额度', 'Remaining allowance')}>
      {credits.isUnlimited ? <strong className="qx-heading">{c.text('不限量', 'Unlimited')}</strong> : !usage.buckets.length ? <p className="qx-meta">{c.text('额度信息暂不可用', 'Usage information is unavailable')}</p> : <div className="ep-settings-usage-buckets">{usage.buckets.map(bucket => {
        const label = bucket.kind === 'subscription' ? c.text('套餐额度', 'Plan allowance') : bucket.kind === 'top_up' ? c.text('额外购买额度', 'Purchased allowance') : c.text('赠送额度', 'Welcome allowance')
        return <div key={bucket.id}>
          <p className="ep-settings-inline"><span>{label}</span><strong>{bucket.remainingPercent === null ? c.text('暂不可用', 'Unavailable') : `${bucket.remainingPercent}%`}</strong></p>
          {bucket.remainingPercent !== null ? <div className="ep-settings-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bucket.remainingPercent}><span style={{ width: `${bucket.remainingPercent}%` }} /></div> : null}
          {bucket.remainingPoints != null && bucket.usedPoints != null && bucket.limitPoints != null ? <small className="qx-meta">{c.text('剩余', 'Remaining')} {bucket.remainingPoints.toLocaleString(c.locale, { maximumFractionDigits: 4 })} / {bucket.limitPoints.toLocaleString(c.locale)} · {c.text('已用', 'Used')} {bucket.usedPoints.toLocaleString(c.locale, { maximumFractionDigits: 4 })}</small> : null}
          {bucket.expiresAt ? <small className="qx-meta">{c.text('下次重置', 'Next reset')} {dateLabel(bucket.expiresAt, c.locale)}</small> : null}
        </div>
      })}</div>}
    </SettingRow>
    {!credits.isUnlimited ? <p className="qx-meta">{c.text('7 天额度从首次有效消息请求开始，每满 168 小时恢复套餐满额。Free 每 7 天 30 积分。', 'Your 7-day allowance starts with your first valid message and resets every 168 hours. Free includes 30 points every 7 days.')}</p> : null}
    {!credits.isUnlimited ? <SettingRow label={c.text('兑换码', 'Redemption code')}>
      <form className="ep-settings-redeem" onSubmit={c.redeemCredits}><input className="qx-input" aria-label={c.text('兑换码', 'Redemption code')} autoComplete="off" maxLength={64} placeholder="QX-XXXX-XXXX" value={c.redemptionCode} onChange={event => c.setRedemptionCode(event.target.value)} /><button className="qx-btn qx-btn--secondary" disabled={c.pending || !c.redemptionCode.trim()}>{c.pendingAction === 'credit-redemption' ? c.text('正在兑换…', 'Redeeming…') : c.text('兑换', 'Redeem')}</button></form>
      <small className="qx-meta">{c.text('bank RESET：恢复当前套餐的 100%，并从现在重新计算 7 天。每个兑换码仅可使用一次。', 'bank RESET restores 100% of your current plan and starts a new 7-day period. Each code can be used once.')}</small>
    </SettingRow> : null}
    <section className="ep-settings-history" aria-label={c.text('用量记录', 'Usage history')}>
      <header className="ep-settings-inline"><h3 className="qx-heading">{c.text('用量记录', 'Usage history')}</h3><span className="qx-meta">{c.text(`共 ${credits.totalEntries} 笔`, `${credits.totalEntries} total`)}</span></header>
      {credits.entries.length ? <ol className="ep-settings-list">{credits.entries.map(entry => <li key={entry.entryId}>
        <div><strong>{entry.kind === 'usage' ? c.text('Agent 对话', 'Agent conversation') : entry.kind === 'redemption' ? c.text('bank RESET', 'bank RESET') : c.text('新用户赠送', 'Welcome allowance')}</strong><time className="qx-meta" dateTime={entry.createdAt}>{dateLabel(entry.createdAt, c.locale)}</time>{entry.kind === 'usage' ? <small className="qx-meta">{entry.inputTokens.toLocaleString(c.locale)} {c.text('输入', 'input')} · {entry.outputTokens.toLocaleString(c.locale)} {c.text('输出', 'output')} token</small> : null}</div>
        <div className="ep-settings-usage-status">
          {entry.status ? <small className="qx-meta">{statusLabels[entry.status]}</small> : null}
          {typeof entry.chargedCny === 'number' && Number.isFinite(entry.chargedCny) && entry.chargedCny >= 0 ? <small className="qx-meta">{c.text('费用', 'Cost')} {money(entry.chargedCny)}</small> : null}
          {typeof entry.refundedCny === 'number' && Number.isFinite(entry.refundedCny) && entry.refundedCny > 0 ? <small className="qx-meta">{c.text('退款', 'Refund')} {money(entry.refundedCny)}</small> : null}
        </div>
      </li>)}</ol> : <p className="qx-meta">{c.text('完成首轮对话后，用量流水会出现在这里。', 'Usage will appear here after your first conversation.')}</p>}
      {credits.totalEntries > creditPageSize ? <nav className="ep-settings-pagination" aria-label={c.text('用量记录分页', 'Usage history pages')}>
        <button className="qx-btn qx-btn--secondary" type="button" aria-label={c.text('上一页用量记录', 'Previous usage page')} disabled={c.pending || c.creditPage === 1} onClick={() => void c.loadCreditPage(c.creditPage - 1, c.creditPage > 2 ? String((c.creditPage - 2) * creditPageSize) : undefined)}>{c.text('上一页', 'Previous')}</button>
        <span className="qx-meta">{c.text(`第 ${c.creditPage} 页`, `Page ${c.creditPage}`)}</span>
        <button className="qx-btn qx-btn--secondary" type="button" aria-label={c.text('下一页用量记录', 'Next usage page')} disabled={c.pending || !credits.nextCursor} onClick={() => void c.loadCreditPage(c.creditPage + 1, credits.nextCursor ?? undefined)}>{c.text('下一页', 'Next')}</button>
      </nav> : null}
      <p className="qx-meta">{c.text('按实际调用计算用量，失败或中止的回答不消耗额度。', 'Based on actual usage. Failed or interrupted responses do not consume your allowance.')}</p>
    </section>
  </div>
}

function SecurityPanel({ controller: c, onOAuthNavigate, oauthError }: PanelProps & { onOAuthNavigate?(url: string): void; oauthError?: string | null }) {
  const fields = [['current', '当前密码', 'Current password'], ['next', '新密码', 'New password'], ['confirmation', '确认新密码', 'Confirm new password']] as const
  return <div className="ep-settings-fields">
    <form onSubmit={c.changePassword} noValidate>
      <fieldset className="ep-settings-password"><legend className="qx-heading">{c.text('登录密码', 'Sign-in password')}</legend>
        {fields.map(([key, zh, en]) => <SettingRow key={key} label={c.text(zh, en)}><input className="qx-input" type="password" aria-label={c.text(zh, en)} value={c.password[key]} onChange={event => c.setPassword(current => ({ ...current, [key]: event.target.value }))} autoComplete={key === 'current' ? 'current-password' : 'new-password'} minLength={key === 'current' ? undefined : 12} maxLength={128} required /></SettingRow>)}
      </fieldset>
      <label className="ep-settings-check"><input type="checkbox" checked={c.password.revokeOtherSessions} onChange={event => c.setPassword(current => ({ ...current, revokeOtherSessions: event.target.checked }))} /><span>{c.text('撤销其他设备的会话', 'Sign out other devices')}<small className="qx-meta">{c.text('当前设备不会退出。', 'Your current device stays signed in.')}</small></span></label>
      <div className="ep-settings-actions"><button className="qx-btn qx-btn--primary" disabled={c.pending || !c.password.current}>{c.pendingAction === 'password' ? c.text('正在更新…', 'Updating…') : c.text('更新密码', 'Update password')}</button></div>
    </form>
    <OAuthCallbackNotice code={oauthError} />
    <OAuthActions returnPath="/settings?section=security" link onNavigate={onOAuthNavigate} />
    <section className="ep-settings-history" aria-label={c.text('活跃会话', 'Active sessions')}>
      <h3 className="qx-heading">{c.text('活跃会话', 'Active sessions')}</h3>
      <ul className="ep-settings-list">{c.state.sessions.map(session => <li key={session.sessionId}>
        <div><strong>{session.deviceLabel}</strong><small className="qx-meta">{c.text('最近活动', 'Last active')} · {dateLabel(session.lastSeenAt, c.locale)}</small></div>
        {session.current ? <span className="qx-tag">{c.text('当前会话', 'Current session')}</span> : <button className="qx-btn qx-btn--secondary" type="button" aria-label={c.text(`撤销 ${session.deviceLabel} 会话`, `Revoke ${session.deviceLabel} session`)} disabled={c.pending} onClick={event => c.openConfirmation({ kind: 'session', session }, event.currentTarget)}>{c.text('撤销', 'Revoke')}</button>}
      </li>)}</ul>
      {!c.state.sessions.some(session => !session.current) ? <p className="qx-meta">{c.text('没有其他活跃会话', 'No other active sessions')}</p> : null}
    </section>
  </div>
}

function PrivacyPanel({ controller: c }: PanelProps) {
  return <div className="ep-settings-fields">
    <SettingRow label={c.text('模型改进', 'Model improvement')}>
      <div className="ep-settings-inline"><span>{c.text('允许用于改进模型', 'Allow model improvement')}</span><button className="qx-switch" type="button" role="switch" aria-label={c.text('允许用于改进模型', 'Allow model improvement')} aria-checked={c.state.account.preferences.modelImprovementAllowed} disabled={c.pending} onClick={event => c.openConfirmation({ kind: 'model', allowed: !c.state.account.preferences.modelImprovementAllowed }, event.currentTarget)} /></div>
      <p className="qx-meta">{c.text('目前不使用研究数据训练模型。此项仅记录未来可选改进计划的授权，可随时撤回。', 'Your data is not currently used for training. This records revocable consent for a future optional program.')}</p>
    </SettingRow>
    <SettingRow label={c.text('导出', 'Export')}>
      <button className="qx-btn qx-btn--secondary" type="button" disabled={c.pending} onClick={c.exportData}>{c.pendingAction === 'export' ? c.text('正在准备…', 'Preparing…') : c.text('导出我的数据', 'Export my data')}</button>
      <p className="qx-meta">{c.text('包含账户资料、研究任务与模型交互记录，不包含密码或会话凭据。', 'Includes your profile, research tasks, and model interactions. Excludes passwords and session credentials.')}</p>
      {c.dataExport ? <div role="status">{c.dataExport.status === 'ready' && c.dataExport.downloadHref ? <a className="qx-btn qx-btn--secondary" href={c.dataExport.downloadHref} download>{c.text('下载数据副本', 'Download data copy')}</a> : <p className="qx-meta">{c.text('数据副本正在准备，请稍后重新查看。', 'Your data copy is being prepared. Check again later.')}</p>}</div> : null}
    </SettingRow>
  </div>
}

function AccountStatusPanel({ controller: c }: PanelProps) {
  if (c.state.account.isProtectedAdmin) return <div className="ep-settings-protection"><h3 className="qx-heading">{c.text('部署管理员保护', 'Deployment admin protection')}</h3><p className="qx-meta">{c.text('此账户不能被降级、停用或删除。仍可更新密码与撤销其他会话。', 'This account cannot be demoted, deactivated, or deleted. You can still update its password and revoke sessions.')}</p></div>
  return <div className="ep-settings-fields">
    <SettingRow label={c.text('停用', 'Deactivate')}><button className="qx-btn qx-btn--secondary" type="button" disabled={c.pending} onClick={event => c.openConfirmation({ kind: 'deactivate' }, event.currentTarget)}>{c.text('停用账户', 'Deactivate account')}</button><p className="qx-meta">{c.text('退出所有设备并暂停访问。研究数据保留，管理员可在核验后恢复账户。', 'Sign out all devices and pause access. Your data is retained; an administrator can restore access.')}</p></SettingRow>
    <SettingRow label={c.text('注销', 'Delete')}><button className="qx-btn qx-btn--danger" type="button" disabled={c.pending} onClick={event => c.openConfirmation({ kind: 'delete' }, event.currentTarget)}>{c.text('永久删除账户', 'Permanently delete account')}</button><p className="qx-meta">{c.text('永久删除账户、研究任务与个人模型交互记录。此操作无法恢复。', 'Permanently delete your account, research tasks, and personal model interactions. This cannot be undone.')}</p></SettingRow>
  </div>
}

function SettingsConfirmation({ controller: c }: PanelProps) {
  const action = c.confirmation
  if (!action) return null
  let title: string
  let description: string
  let confirmLabel: string
  let pendingLabel: string
  let disabled = false
  let children: ReactNode
  if (action.kind === 'session') {
    title = c.text('撤销这个会话？', 'Revoke this session?')
    description = c.text(`${action.session.deviceLabel} 将立即退出，未保存的操作可能丢失。`, `${action.session.deviceLabel} will be signed out immediately. Unsaved work may be lost.`)
    confirmLabel = c.text('确认撤销', 'Revoke session')
    pendingLabel = c.text('正在撤销…', 'Revoking…')
  } else if (action.kind === 'model') {
    title = action.allowed ? c.text('允许用于改进模型？', 'Allow model improvement?') : c.text('停止用于改进模型？', 'Stop model improvement access?')
    description = action.allowed ? c.text('Everplain 当前不使用你的数据训练模型。开启仅记录未来可选改进计划的授权；任何实际启用仍会另行告知。', 'Everplain does not currently train on your data. Enabling this only records consent for a future optional improvement program; you will be notified before any actual use.') : c.text('停止后，未来可选改进计划不再取得你的授权；研究功能所需推理不受影响。', 'Future optional improvement programs will no longer have your consent. Inference required for research features is unaffected.')
    confirmLabel = action.allowed ? c.text('确认允许', 'Allow') : c.text('确认停止', 'Stop allowing')
    pendingLabel = c.text('正在处理…', 'Updating…')
  } else if (action.kind === 'deactivate') {
    title = c.text('停用账户？', 'Deactivate account?')
    description = c.text('停用后你会立即退出所有设备。数据会保留，管理员可在核验后恢复访问。', 'You will be signed out on every device. Your data is retained, and an administrator can restore access after verification.')
    confirmLabel = c.text('确认停用', 'Deactivate')
    pendingLabel = c.text('正在停用…', 'Deactivating…')
    disabled = !c.deactivation.password || !c.deactivation.reason.trim()
    children = <div className="ep-settings-confirm-fields"><label className="qx-field"><span>{c.text('当前密码', 'Current password')}</span><input className="qx-input" type="password" autoComplete="current-password" value={c.deactivation.password} onChange={event => c.setDeactivation(current => ({ ...current, password: event.target.value }))} /></label><label className="qx-field"><span>{c.text('停用原因', 'Reason for deactivation')}</span><textarea className="qx-textarea" rows={3} maxLength={240} value={c.deactivation.reason} onChange={event => c.setDeactivation(current => ({ ...current, reason: event.target.value }))} /></label></div>
  } else {
    title = c.text('永久删除账户？', 'Permanently delete account?')
    description = c.text('账户、研究任务、派生文档与个人模型交互记录将被永久删除。删除后无法恢复。', 'Your account, research tasks, derived documents, and personal model interaction records will be permanently deleted. This cannot be undone.')
    confirmLabel = c.text('确认永久删除', 'Permanently delete')
    pendingLabel = c.text('正在删除…', 'Deleting…')
    disabled = !c.deletion.password || c.deletion.email.trim().toLowerCase() !== c.state.account.email.toLowerCase()
    children = <div className="ep-settings-confirm-fields"><label className="qx-field"><span>{c.text('账户邮箱', 'Account email')}</span><input className="qx-input" autoComplete="email" placeholder={c.state.account.email} value={c.deletion.email} onChange={event => c.setDeletion(current => ({ ...current, email: event.target.value }))} /></label><label className="qx-field"><span>{c.text('当前密码', 'Current password')}</span><input className="qx-input" type="password" autoComplete="current-password" value={c.deletion.password} onChange={event => c.setDeletion(current => ({ ...current, password: event.target.value }))} /></label></div>
  }
  return <AccountConfirmationDialog title={title} description={description} confirmLabel={confirmLabel} pendingLabel={pendingLabel} cancelLabel={c.text('取消', 'Cancel')} pending={c.pending} confirmDisabled={disabled} tone={action.kind === 'delete' || action.kind === 'deactivate' ? 'danger' : 'default'} error={c.error} triggerRef={c.confirmationTrigger} onCancel={c.cancelConfirmation} onConfirm={c.confirmAction}>{children}</AccountConfirmationDialog>
}
