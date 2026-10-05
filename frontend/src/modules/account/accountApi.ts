import { apiClient, fetchActiveSession } from '../../api/client'
import { ApiRequestError } from '../../api/error'
import { subscribeToSessionRejected } from '../../api/sessionEvents'
import {
  getCurrentSession,
  getLinkedOauthProviders,
  getOauthProviders,
  startOauthLink,
  startOauthLogin,
  deleteResearchTask,
  listResearchTasks,
  loginSession,
  logoutSession,
  registerSession,
  sendRegistrationCode,
  type SessionResponse,
} from '../../api/generated'
import type { AccountSession, MyResearchItem } from './types'
import { readSessionWithDeadline } from '../../api/sessionRead'

export function watchSessionRejection(listener: () => void) {
  return subscribeToSessionRejected(listener)
}

function idempotencyKey() {
  return globalThis.crypto.randomUUID()
}

function toAccountSession(response: SessionResponse): AccountSession {
  return {
    sessionId: response.session_id,
    user: {
      userId: response.user.user_id,
      email: response.user.email,
      loginMode: response.user.login_mode,
      displayName: response.user.display_name,
    },
    expiresAt: response.expires_at,
  }
}

export function getCurrentSessionViaApi(
  { signal }: { signal?: AbortSignal } = {},
): Promise<AccountSession | null> {
  return readSessionWithDeadline(async (readSignal) => {
    const { data, response } = await getCurrentSession({
      client: apiClient,
      signal: readSignal,
      fetch: fetchActiveSession,
    })
    readSignal.throwIfAborted()
    if (data) return toAccountSession(data)
    if (response?.status === 401) return null
    throw new ApiRequestError('登录状态读取失败。', response?.status)
  }, signal)
}

export async function loginViaApi(
  email: string,
  password: string,
): Promise<AccountSession> {
  const { data, response } = await loginSession({
    client: apiClient,
    headers: { 'Idempotency-Key': idempotencyKey() },
    body: { email, password },
  })
  if (!data) throw new ApiRequestError('邮箱或密码不正确。', response?.status)
  return toAccountSession(data)
}

export function isLoginServiceFailure(failure: unknown): boolean {
  return (
    failure instanceof ApiRequestError
    && failure.status !== 401
  )
}

export async function registerViaApi(
  email: string,
  password: string,
  verificationCode: string,
): Promise<AccountSession> {
  const { data, response } = await registerSession({
    client: apiClient,
    headers: { 'Idempotency-Key': idempotencyKey() },
    body: { email, password, display_name: null, verification_code: verificationCode },
  })
  if (!data) throw new ApiRequestError('账号创建失败，请稍后重试。', response?.status)
  return toAccountSession(data)
}

export async function sendRegistrationCodeViaApi(
  email: string,
): Promise<{ resendAfterSeconds: number }> {
  const { data, response } = await sendRegistrationCode({
    client: apiClient,
    headers: { 'Idempotency-Key': idempotencyKey() },
    body: { email },
  })
  if (!data) throw new ApiRequestError('验证码发送失败，请稍后重试。', response?.status)
  return { resendAfterSeconds: data.resend_after_seconds ?? 60 }
}

export function registrationFailureMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 422) {
    return '验证码无效或已过期，请重新获取。'
  }
  if (failure instanceof ApiRequestError && failure.status === 409) {
    return '该邮箱无法用于注册。'
  }
  return '账号创建失败，请稍后重试。'
}

export function registrationCodeFailureMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 429) {
    return '验证码发送过于频繁，请稍后再试。'
  }
  return '验证码暂时无法发送，请稍后再试。'
}

export async function logoutViaApi(): Promise<void> {
  const { data, response } = await logoutSession({
    client: apiClient,
    headers: { 'Idempotency-Key': idempotencyKey() },
  })
  if (!data) throw new ApiRequestError('退出失败，请稍后重试。', response?.status)
}

export async function listMyResearchViaApi(): Promise<MyResearchItem[]> {
  const { data, response } = await listResearchTasks({
    client: apiClient,
    query: { limit: 100 },
  })
  if (!data) throw new ApiRequestError('研究列表读取失败。', response?.status)
  return data.items.map((item) => {
    return {
      taskId: item.task_id,
      ...(item.project_title?.trim() ? { projectTitle: item.project_title.trim() } : {}),
      stageLabel: item.stage_label,
      nextActionLabel: item.next_action_label,
      entryPath: item.resume_path,
      blocker: item.blocker
        ? {
            action: item.blocker.action ?? null,
            code: item.blocker.code,
            message: item.blocker.message,
            recoverable: item.blocker.recoverable,
          }
        : null,
      retry: item.retry
        ? {
            action: item.retry.action,
            method: item.retry.method,
            href: item.retry.href,
            label: item.retry.label,
          }
        : null,
      phenomenonSummary: item.phenomenon_summary?.phenomenon ?? '尚未确认现象',
      adoptedTheoryCount: item.adopted_theory_count,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }
  })
}

export async function deleteMyResearchViaApi(taskId: string): Promise<void> {
  const { data, response } = await deleteResearchTask({
    client: apiClient,
    path: { task_id: taskId },
    headers: { 'Idempotency-Key': idempotencyKey() },
  })
  if (!data) throw new ApiRequestError('研究删除失败。', response?.status)
}

export type OAuthProvider = 'google' | 'github'

export async function availableOAuthProviders(): Promise<OAuthProvider[]> {
  const { data } = await getOauthProviders({ client: apiClient })
  return Array.isArray(data?.providers) ? [...new Set(data.providers.filter(value => value === 'google' || value === 'github'))] : []
}

export async function linkedOAuthProviders(): Promise<OAuthProvider[]> {
  const { data, response } = await getLinkedOauthProviders({ client: apiClient })
  if (!Array.isArray(data?.providers)) {
    throw new ApiRequestError('第三方登录绑定暂时无法读取。', response?.status)
  }
  return data.providers
}

export async function startOAuth(provider: OAuthProvider, returnPath: string, link = false): Promise<string> {
  const start = link ? startOauthLink : startOauthLogin
  const { data, response } = await start({
    client: apiClient,
    path: { provider },
    body: { return_path: returnPath },
  })
  if (!data?.authorization_url) {
    throw new ApiRequestError('第三方登录暂时不可用，请稍后重试。', response?.status)
  }
  const target = new URL(data.authorization_url)
  const expectedHost = provider === 'google' ? 'accounts.google.com' : 'github.com'
  if (target.protocol !== 'https:' || target.hostname !== expectedHost || target.username || target.password) {
    throw new ApiRequestError('第三方登录地址无效。')
  }
  return target.href
}

export function oauthFailureMessage(code: string | null | undefined): string | null {
  if (!code) return null
  if (code === 'account_link_required') return '请先用现有方式登录，再前往账户设置的安全页绑定 Google 或 GitHub。'
  if (code === 'cancelled') return '已取消第三方登录。你可以重试或继续使用邮箱登录。'
  if (code === 'service_unavailable') return '登录服务暂时不可用，请稍后重试。'
  return '第三方登录未完成或已过期，请重新开始。'
}
