import { PageLoading } from '../../ui/PageLoading'
import {
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Select } from '../../ui/Select'
import { accountManagementApi } from './accountManagementApi'
import {
  AccountManagementRequestError,
  type AccountAuditEvent,
  type AccountManagementApi,
  type AccountRole,
  type AccountStatus,
  type AdminUser,
  type CreditRedemptionCodeBatch,
  type PasswordResetLink,
} from './accountManagementModels'
import { AccountConfirmationDialog } from './AccountSettingsPage'
import { MutationIntentLedger } from './mutationIntent'
import './admin-users.css'

type AdminUsersPageProps = {
  api?: AccountManagementApi
  settingsHref?: string
  onForbidden?(): void
  onSessionExpired?(): void
}

type DirectoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; users: AdminUser[]; total: number; nextCursor: string | null }

type StatusDialog = {
  user: AdminUser
  nextStatus: Extract<AccountStatus, 'active' | 'disabled'>
}

type RoleDialog = {
  user: AdminUser
  nextRole: AccountRole
}

function formatDate(value: string | null) {
  if (!value) return '尚未登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const auditLabels: Record<string, string> = {
  'admin.access': '管理员权限校验',
  'admin.provisioned': '部署管理员初始化',
  'profile.updated': '更新个人资料',
  'preferences.updated': '更新使用偏好',
  'model_secondary_use.granted': '开启模型改进授权',
  'model_secondary_use.withdrawn': '撤回模型改进授权',
  'session.revoked': '撤销登录会话',
  'password.changed': '更新账户密码',
  'user.disabled': '禁用用户',
  'user.enabled': '启用用户',
  'user.role_changed': '变更角色',
  'password_reset.issued': '创建密码重置',
  'password_reset.consumed': '完成密码重置',
  'data_export.created': '生成个人数据副本',
  'account.deactivated': '停用账户',
  'account.deleted': '永久删除账户',
}

export function AdminUsersPage({
  api = accountManagementApi,
  settingsHref = '/settings',
  onForbidden,
  onSessionExpired,
}: AdminUsersPageProps) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatus | ''>('')
  const [reloadToken, setReloadToken] = useState(0)
  const [auditReloadToken, setAuditReloadToken] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState>({ status: 'loading' })
  const [auditEvents, setAuditEvents] = useState<AccountAuditEvent[]>([])
  const [roleSelections, setRoleSelections] = useState<Record<string, AccountRole>>({})
  const [roleDialog, setRoleDialog] = useState<RoleDialog | null>(null)
  const [roleReason, setRoleReason] = useState('')
  const [statusDialog, setStatusDialog] = useState<StatusDialog | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [resetLinks, setResetLinks] = useState<Record<string, PasswordResetLink>>({})
  const [creditCodeCount, setCreditCodeCount] = useState(20)
  const [creditCodeExpiresInDays, setCreditCodeExpiresInDays] = useState(30)
  const [generatedCreditCodes, setGeneratedCreditCodes] = useState<CreditRedemptionCodeBatch | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const mutationIntents = useRef(new MutationIntentLedger())
  const rowTriggerRef = useRef<HTMLElement | null>(null)

  const handleBoundaryFailure = useCallback((failure: unknown) => {
    if (!(failure instanceof AccountManagementRequestError)) return
    if (failure.status === 401) onSessionExpired?.()
    if (failure.status === 403) onForbidden?.()
  }, [onSessionExpired, onForbidden])

  useEffect(() => {
    let active = true
    setDirectory({ status: 'loading' })
    const input = {
      ...(submittedQuery ? { query: submittedQuery } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    }
    api.listAdminUsers(input)
      .then((page) => {
        if (!active) return
        setDirectory({
          status: 'ready',
          users: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
        })
        setRoleSelections(Object.fromEntries(
          page.items.map((user) => [user.userId, user.role]),
        ))
      })
      .catch((failure: unknown) => {
        if (!active) return
        handleBoundaryFailure(failure)
        setDirectory({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [api, submittedQuery, statusFilter, reloadToken, handleBoundaryFailure])

  useEffect(() => {
    let active = true
    api.listAuditEvents({ limit: 8 })
      .then((page) => {
        if (active) setAuditEvents(page.items)
      })
      .catch(() => {
        if (active) setAuditEvents([])
      })
    return () => {
      active = false
    }
  }, [api, auditReloadToken])

  function actionFailureMessage(failure: unknown) {
    handleBoundaryFailure(failure)
    if (failure instanceof AccountManagementRequestError) {
      if (failure.status === 409) {
        return failure.message
      }
      if (failure.status === 401) return '登录已过期，请重新登录。'
      if (failure.status === 403) return '当前账户没有管理员权限。'
    }
    return '操作未完成。当前目录没有改变，请检查网络后重试。'
  }

  function replaceUser(updated: AdminUser) {
    setDirectory((state) => state.status === 'ready'
      ? {
          ...state,
          users: state.users.map((user) => user.userId === updated.userId ? updated : user),
        }
      : state)
    setRoleSelections((values) => ({ ...values, [updated.userId]: updated.role }))
  }

  async function perform<T>(
    action: string,
    operation: () => Promise<T>,
    onSuccess: (result: T) => void,
    message: string,
  ) {
    if (pendingRef.current) return
    pendingRef.current = action
    setPendingAction(action)
    setFeedback(null)
    setActionError(null)
    try {
      const result = await operation()
      mutationIntents.current.complete(action)
      onSuccess(result)
      setAuditReloadToken((token) => token + 1)
      setFeedback(message)
    } catch (failure) {
      setActionError(actionFailureMessage(failure))
    } finally {
      pendingRef.current = null
      setPendingAction(null)
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmittedQuery(query.trim())
  }

  function submitCreditCodeBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const intent = {
      count: creditCodeCount,
      expiresInDays: creditCodeExpiresInDays,
    }
    void perform(
      'credit-code-batch',
      () => api.createCreditRedemptionCodes({
        ...intent,
        idempotencyKey: mutationIntents.current.keyFor('credit-code-batch', intent),
      }),
      setGeneratedCreditCodes,
      `已生成 ${creditCodeCount} 个积分兑换码。`,
    )
  }

  if (directory.status === 'loading') {
    return <PageLoading message="正在读取用户目录" />
  }

  if (directory.status === 'error') {
    return <section className="ep-admin-load" role="alert">
      <WarningIcon size={24} aria-hidden="true" />
      <h2 className="qx-heading">暂时无法读取用户目录</h2>
      <p className="qx-meta">没有任何角色或账户状态被改变。</p>
      <button className="qx-btn qx-btn--secondary" type="button" onClick={() => setReloadToken(value => value + 1)}>重试</button>
    </section>
  }

  const pending = pendingAction !== null

  return (
    <article className="ep-admin-users">
      <div className="ep-admin-users__content" inert={Boolean(roleDialog || statusDialog || resetUser)}>
        <header className="ep-admin-users__head">
          <div><h1 className="qx-section-title">用户管理</h1><p className="qx-meta">管理用户资格、角色与账户恢复。操作记录保存在服务端。</p></div>
          <nav className="ep-admin-actions" aria-label="管理页面"><a className="qx-btn qx-btn--ghost" href={settingsHref}>返回账户设置</a><a className="qx-btn qx-btn--secondary" href="/admin/operations">打开模型配置</a></nav>
        </header>
        {feedback ? <p className="qx-notice" role="status">{feedback}</p> : null}
        {actionError ? <p className="qx-notice qx-notice--danger" role="alert">{actionError}</p> : null}
        <section className="ep-admin-directory" aria-labelledby="account-directory-title">
          <form className="ep-admin-search" role="search" onSubmit={submitSearch}>
            <label className="qx-search"><MagnifyingGlassIcon size={18} aria-hidden="true" /><input type="search" aria-label="搜索用户" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" /></label>
            <Select aria-label="筛选账户状态" value={statusFilter} onChange={value => setStatusFilter(value as AccountStatus | '')} options={[{ value: '', label: '全部状态' }, { value: 'active', label: '活跃' }, { value: 'disabled', label: '已禁用' }, { value: 'deactivated', label: '已停用' }]} />
            <button className="qx-btn qx-btn--secondary" type="submit">搜索</button>
          </form>
          <header className="ep-admin-section-head"><h2 className="qx-heading" id="account-directory-title">用户目录</h2><span className="qx-meta">{directory.total} 位用户</span></header>
          {directory.users.length === 0 ? <div className="ep-admin-empty"><UsersThreeIcon size={28} aria-hidden="true" /><h3 className="qx-heading">还没有匹配的用户</h3><p className="qx-meta">调整搜索条件，或等待新的内测用户完成注册。</p></div> : <div className="ep-admin-table-scroll">
            <table className="ep-admin-table"><thead><tr><th scope="col">用户</th><th scope="col">角色</th><th scope="col">状态</th><th scope="col">最近活动</th><th scope="col">账户操作</th></tr></thead><tbody>
              {directory.users.map(user => {
                const selectedRole = roleSelections[user.userId] ?? user.role
                const resetLink = resetLinks[user.userId]
                return <tr key={user.userId}>
                  <td><div className="ep-admin-user"><strong>{user.displayName ?? '未设置名称'}</strong><span className="qx-meta">{user.email}</span>{user.isCurrentUser || user.isProtectedAdmin ? <div className="ep-admin-user__labels">{user.isCurrentUser ? <span className="qx-tag">当前账户</span> : null}{user.isProtectedAdmin ? <span className="qx-tag">部署管理员</span> : null}</div> : null}</div></td>
                  <td><div className="ep-admin-role"><Select aria-label={`${user.email} 的角色`} value={selectedRole} disabled={pending || user.isProtectedAdmin} onChange={value => setRoleSelections(values => ({ ...values, [user.userId]: value as AccountRole }))} options={[{ value: 'member', label: '内测用户' }, { value: 'admin', label: '管理员' }]} /><button className="qx-btn qx-btn--ghost" type="button" aria-label={`保存 ${user.email} 的角色`} disabled={pending || user.isProtectedAdmin || selectedRole === user.role} onClick={event => { rowTriggerRef.current = event.currentTarget; setRoleReason(''); setRoleDialog({ user, nextRole: selectedRole }) }}>保存</button></div></td>
                  <td><span className={`qx-tag ep-admin-status ep-admin-status--${user.status}`}>{user.status === 'active' ? '活跃' : user.status === 'disabled' ? '已禁用' : '已停用'}</span></td>
                  <td><time className="qx-meta" dateTime={user.lastActiveAt ?? undefined}>{formatDate(user.lastActiveAt)}</time></td>
                  <td><div className="ep-admin-row-actions">
                    {!user.isProtectedAdmin && user.status === 'active' ? <button className="qx-btn qx-btn--ghost" type="button" aria-label={`禁用 ${user.email}`} disabled={pending || user.isCurrentUser} onClick={event => { rowTriggerRef.current = event.currentTarget; setStatusReason(''); setStatusDialog({ user, nextStatus: 'disabled' }) }}>禁用</button> : !user.isProtectedAdmin ? <button className="qx-btn qx-btn--ghost" type="button" aria-label={`启用 ${user.email}`} disabled={pending} onClick={event => { rowTriggerRef.current = event.currentTarget; setStatusReason('恢复内测资格'); setStatusDialog({ user, nextStatus: 'active' }) }}>启用</button> : null}
                    <button className="qx-btn qx-btn--ghost" type="button" aria-label={`为 ${user.email} 创建密码重置链接`} disabled={pending || user.status !== 'active'} onClick={event => { rowTriggerRef.current = event.currentTarget; setResetUser(user) }}>重置密码</button>
                  </div>{resetLink?.resetUrl ? <a className="ep-admin-reset-link" href={resetLink.resetUrl}>{user.email} 的密码重置链接</a> : null}</td>
                </tr>
              })}
            </tbody></table>
          </div>}
        </section>
        <div className="ep-admin-support">
          <section aria-labelledby="credit-code-generator-title">
            <header className="ep-admin-section-head"><h2 className="qx-heading" id="credit-code-generator-title">bank RESET 兑换码</h2></header>
            <div className="qx-card ep-admin-credit-panel">
              <p className="qx-meta">批量生成一次性 bank RESET 兑换码，将用量恢复至当前套餐的 100%，并重新开始 7 天周期。</p>
              <form className="ep-admin-credit-form" onSubmit={submitCreditCodeBatch}>
                <label className="ep-admin-field">生成数量<input className="qx-input" type="number" min={1} max={100} value={creditCodeCount} onChange={event => setCreditCodeCount(Number(event.target.value))} /></label>
                <label className="ep-admin-field">有效天数<input className="qx-input" type="number" min={1} max={365} value={creditCodeExpiresInDays} onChange={event => setCreditCodeExpiresInDays(Number(event.target.value))} /></label>
                <button className="qx-btn qx-btn--primary" type="submit" disabled={pending || creditCodeCount < 1 || creditCodeExpiresInDays < 1}>{pendingAction === 'credit-code-batch' ? '正在生成…' : '生成兑换码'}</button>
              </form>
              {generatedCreditCodes ? <div className="ep-admin-credit-result"><p>完整兑换码只显示在这里，请立即复制保存。</p><p className="qx-meta">兑换后恢复当前套餐满额（Free：30） · 兑换码有效至 {formatDate(generatedCreditCodes.expiresAt)}</p><ol>{generatedCreditCodes.codes.map(code => <li key={code}><code>{code}</code></li>)}</ol></div> : null}
            </div>
          </section>
          <section className="ep-admin-audit" aria-labelledby="account-audit-title">
            <header className="ep-admin-section-head"><h2 className="qx-heading" id="account-audit-title">最近审计记录</h2><ClockCounterClockwiseIcon size={20} aria-hidden="true" /></header>
            {auditEvents.length ? <ol>{auditEvents.map(event => <li key={event.eventId}>
              <div className="ep-admin-audit__event"><strong>{auditLabels[event.action] ?? event.action}</strong>{event.outcome ? <span className={`qx-tag ep-admin-audit__outcome ep-admin-audit__outcome--${event.outcome}`}>{event.outcome === 'succeeded' ? '成功' : event.outcome === 'denied' ? '已拒绝' : '失败'}</span> : null}</div>
              <p className="qx-meta">{event.actorEmail ?? '系统'} → {event.targetEmail ?? '账户域'}</p>
              <p className="qx-meta">{event.reason ?? '未填写原因'} · <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time></p>
            </li>)}</ol> : <p className="qx-meta">还没有可显示的审计记录。</p>}
          </section>
        </div>
      </div>

      {roleDialog ? (
        <AccountConfirmationDialog
          title={`将角色更改为${roleDialog.nextRole === 'admin' ? '管理员' : '内测用户'}？`}
          description={roleDialog.nextRole === 'admin'
            ? '管理员可以禁用和更改其他用户。请只授予可信的内测负责人。'
            : '移除管理员权限后，该用户将只能管理自己的账户与研究数据。'}
          confirmLabel="确认更改角色"
          pending={pendingAction === 'role'}
          confirmDisabled={roleReason.trim().length < 3}
          error={actionError}
          triggerRef={rowTriggerRef}
          onCancel={() => setRoleDialog(null)}
          onConfirm={() => {
            const intent = {
              role: roleDialog.nextRole,
              expectedVersion: roleDialog.user.version,
              reason: roleReason.trim(),
            }
            void perform(
              'role',
              () => api.updateUserRole(roleDialog.user.userId, {
                ...intent,
                idempotencyKey: mutationIntents.current.keyFor(
                  `role:${roleDialog.user.userId}`,
                  intent,
                ),
              }),
              (updated) => {
                mutationIntents.current.complete(`role:${roleDialog.user.userId}`)
                replaceUser(updated)
                setRoleDialog(null)
              },
              '角色已更新。',
            )
          }}
        >
          <label className="ep-admin-field">
            <span>变更原因</span>
            <textarea className="qx-textarea" value={roleReason} onChange={(event) => setRoleReason(event.target.value)} maxLength={240} rows={3} />
          </label>
        </AccountConfirmationDialog>
      ) : null}

      {statusDialog ? (
        <AccountConfirmationDialog
          title={statusDialog.nextStatus === 'active' ? '启用这位用户？' : '禁用这位用户？'}
          description={statusDialog.nextStatus === 'active'
            ? '用户可以重新登录；已撤销的旧会话不会恢复。'
            : '禁用会立即终止其所有活跃会话，但保留研究数据以便恢复。'}
          confirmLabel={statusDialog.nextStatus === 'active' ? '确认启用' : '确认禁用'}
          pending={pendingAction === 'status'}
          confirmDisabled={statusReason.trim().length < 3}
          error={actionError}
          tone={statusDialog.nextStatus === 'disabled' ? 'danger' : 'default'}
          triggerRef={rowTriggerRef}
          onCancel={() => setStatusDialog(null)}
          onConfirm={() => {
            const intent = {
              expectedVersion: statusDialog.user.version,
              reason: statusReason.trim(),
            }
            const method = statusDialog.nextStatus === 'active'
              ? api.enableUser
              : api.disableUser
            const keyName = `${statusDialog.nextStatus}:${statusDialog.user.userId}`
            void perform(
              'status',
              () => method(statusDialog.user.userId, {
                ...intent,
                idempotencyKey: mutationIntents.current.keyFor(keyName, intent),
              }),
              (updated) => {
                mutationIntents.current.complete(keyName)
                replaceUser(updated)
                setStatusDialog(null)
              },
              statusDialog.nextStatus === 'active' ? '用户已启用。' : '用户已禁用。',
            )
          }}
        >
          <label className="ep-admin-field">
            <span>原因</span>
            <textarea className="qx-textarea" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={240} rows={3} />
          </label>
        </AccountConfirmationDialog>
      ) : null}

      {resetUser ? (
        <AccountConfirmationDialog
          title="创建密码重置链接？"
          description="新链接一小时内有效且只能使用一次。创建新链接会使此前未使用的链接失效。"
          confirmLabel="确认创建"
          pending={pendingAction === 'reset'}
          error={actionError}
          triggerRef={rowTriggerRef}
          onCancel={() => setResetUser(null)}
          onConfirm={() => {
            const keyName = `reset:${resetUser.userId}`
            void perform(
              'reset',
              () => api.createPasswordReset(resetUser.userId, {
                idempotencyKey: mutationIntents.current.keyFor(keyName, { userId: resetUser.userId }),
              }),
              (link) => {
                mutationIntents.current.complete(keyName)
                setResetLinks((links) => ({ ...links, [resetUser.userId]: link }))
                setResetUser(null)
              },
              '密码重置链接已创建，只显示这一次。',
            )
          }}
        />
      ) : null}
    </article>
  )
}
