import { useEffect, useRef, useState } from 'react'
import googleLogo from '../../assets/auth/google.png'
import githubLogo from '../../assets/auth/github.svg'
import githubLogoWhite from '../../assets/auth/github-white.svg'
import { availableOAuthProviders, linkedOAuthProviders, oauthFailureMessage, startOAuth, type OAuthProvider } from './accountApi'

const label = (provider: OAuthProvider) => provider === 'google' ? 'Google' : 'GitHub'
const navigateToProvider = (_url: string) => { throw new Error('OAuth navigation is unavailable') }

function ProviderLogo({ provider }: { provider: OAuthProvider }) {
  return provider === 'google'
    ? <img className="auth-stage__oauth-logo" src={googleLogo} alt="" aria-hidden="true" width={20} height={20} />
    : <span className="auth-stage__oauth-logo" aria-hidden="true">
        <img className="auth-stage__oauth-logo--light" src={githubLogo} alt="" width={20} height={20} />
        <img className="auth-stage__oauth-logo--dark" src={githubLogoWhite} alt="" width={20} height={20} />
      </span>
}

type OAuthActionsProps = {
  returnPath: string
  link?: boolean
  busy?: boolean
  onNavigate?(url: string): void
}

export function OAuthActions({ returnPath, link = false, busy = false, onNavigate = navigateToProvider }: OAuthActionsProps) {
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [linked, setLinked] = useState<OAuthProvider[]>([])
  const [pending, setPending] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    void (async () => {
      try {
        const configured = await availableOAuthProviders()
        const bound = link && configured.length ? await linkedOAuthProviders() : []
        if (active.current) { setProviders(configured); setLinked(bound) }
      } catch {
        // Provider discovery failing must never advertise a usable fake action.
        if (active.current && link) setError('第三方登录绑定暂时无法读取，请稍后重试。')
      }
    })()
    return () => { active.current = false }
  }, [link])

  async function start(provider: OAuthProvider) {
    if (busy || lock.current) return
    lock.current = true
    setPending(provider)
    setError(null)
    try {
      const url = await startOAuth(provider, returnPath, link)
      if (active.current) onNavigate(url)
    } catch {
      if (active.current) setError('第三方登录暂时不可用，请稍后重试。')
    } finally {
      lock.current = false
      if (active.current) setPending(null)
    }
  }

  if (!providers.length) return error ? <p className="qx-notice" role="status">{error}</p> : null
  return <section className="auth-stage__oauth" aria-label={link ? '第三方登录绑定' : '第三方登录'}>
    {!link && <span className="auth-stage__oauth-divider qx-meta">或使用以下方式</span>}
    {link && <p className="qx-meta">绑定后，可用这个第三方账号登录当前 Everplain 账户。</p>}
    {providers.map(provider => linked.includes(provider)
      ? <p className="qx-meta" key={provider}>{label(provider)} 已绑定</p>
      : <button className="qx-btn qx-btn--secondary qx-btn--lg qx-btn--block" key={provider} type="button"
          disabled={busy || pending !== null} onClick={() => void start(provider)}>
          <ProviderLogo provider={provider} />
          <span>{pending === provider ? '正在连接…' : link ? `绑定 ${label(provider)}` : `使用 ${label(provider)} 继续`}</span>
        </button>)}
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}
  </section>
}

export function OAuthCallbackNotice({ code }: { code?: string | null }) {
  const message = oauthFailureMessage(code)
  return message ? <p className="qx-notice qx-notice--danger" role="alert">{message}</p> : null
}
