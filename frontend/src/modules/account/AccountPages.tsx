import { ArrowLeftIcon, EyeIcon, EyeSlashIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { AgentAvatar, agentAvatarPresets } from '../agent-avatar'
import { useLoginFlow, useRegisterFlow, type LoginPageProps, type RegisterPageProps } from './useAuthFlow'
import { OAuthActions, OAuthCallbackNotice } from './OAuthActions'
import './auth-flow.css'

/** Mock Login's single-column composition, with only real authentication actions. */
function AuthStage({ title, onBack, busy, children, footer }: {
  title: string
  onBack?: () => void
  busy: boolean
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="auth-stage" aria-labelledby="auth-title">
      {onBack && <button className="qx-btn qx-btn--secondary qx-btn--icon qx-btn--lg auth-stage__back" type="button" aria-label="返回" onClick={onBack} disabled={busy}><ArrowLeftIcon /></button>}
      <div className="auth-stage__crowd" aria-hidden="true">
        {agentAvatarPresets.map((preset, index) => (
          <AgentAvatar key={preset.id} avatar={preset.id} size={index === 3 ? 72 : 48} offset={index * 0.7} state={index === 3 ? 'greet' : 'idle'} />
        ))}
      </div>
      <h1 id="auth-title" className="qx-display">{title}</h1>
      {children}
      <footer className="auth-stage__footer qx-meta">{footer}<a href="/">Everplain 首页</a></footer>
    </main>
  )
}

function FormError({ message }: { message: string | null }) {
  return message ? <p className="qx-notice qx-notice--danger" role="alert">{message}</p> : null
}

export function LoginPage(props: LoginPageProps) {
  const flow = useLoginFlow(props)
  return (
    <AuthStage title={flow.step === 'email' ? '登录 Everplain' : '输入密码'} busy={flow.submitting}
      onBack={flow.step === 'password' ? flow.back : undefined}
      footer={<span>还没有账号？ <a href={props.registerHref}>创建账号</a></span>}>
      <OAuthCallbackNotice code={props.oauthError} />
      {flow.step === 'email' && <OAuthActions returnPath={props.returnPath ?? '/app'} busy={flow.submitting} onNavigate={props.onOAuthNavigate} />}
      {flow.step === 'password' && <p className="auth-stage__email">{flow.email}</p>}
      <form className="auth-stage__form" aria-label="登录到 Everplain" onSubmit={flow.step === 'email' ? flow.continueToPassword : flow.submit} noValidate>
        {props.sessionExpired && <p className="qx-notice" role="status">登录已过期，请重新登录后继续。</p>}
        {flow.step === 'email' ? (
          <input key="email" className="qx-input" aria-label="邮箱" name="email" type="email" placeholder="邮箱地址" autoComplete="email" maxLength={320} required autoFocus value={flow.email} onChange={event => flow.changeEmail(event.target.value)} />
        ) : (
          <>
            <input type="hidden" name="email" autoComplete="username" value={flow.email} />
            <div className="auth-stage__password">
              <input key="password" className="qx-input" aria-label="密码" name="password" type={flow.passwordVisible ? 'text' : 'password'} placeholder="密码" autoComplete="current-password" minLength={8} maxLength={128} required autoFocus value={flow.password} onChange={event => flow.setPassword(event.target.value)} />
              <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={flow.passwordVisible ? '隐藏密码' : '显示密码'} aria-pressed={flow.passwordVisible} onClick={() => flow.setPasswordVisible(value => !value)}>{flow.passwordVisible ? <EyeSlashIcon /> : <EyeIcon />}</button>
            </div>
          </>
        )}
        <FormError message={flow.error} />
        <button className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block" type="submit" disabled={flow.submitting}>
          {flow.step === 'email' ? '继续' : flow.submitting ? '正在登录…' : '登录并继续'}
        </button>
      </form>
    </AuthStage>
  )
}

export function RegisterPage(props: RegisterPageProps) {
  const flow = useRegisterFlow(props)
  const stepNumber = flow.step === 'email' ? 1 : flow.step === 'code' ? 2 : 3
  return (
    <AuthStage title={flow.step === 'email' ? '注册' : flow.step === 'code' ? '查看你的邮箱' : '设置密码'} busy={flow.submitting}
      onBack={flow.step !== 'email' ? flow.back : undefined}
      footer={<span>已有账号？ <a href={props.loginHref}>返回登录</a></span>}>
      <OAuthCallbackNotice code={props.oauthError} />
      {flow.step === 'email' && <OAuthActions returnPath={props.returnPath ?? '/app'} busy={flow.submitting} onNavigate={props.onOAuthNavigate} />}
      <ol className="auth-stage__steps" aria-label={`第 ${stepNumber} 步，共 3 步`}>
        {[1, 2, 3].map(step => <li key={step} data-current={step === stepNumber} data-done={step < stepNumber} />)}
      </ol>
      <span className="auth-stage__step-label qx-meta">第 {stepNumber} 步，共 3 步</span>
      {flow.step !== 'email' && <div className="auth-stage__recipient">
        <p className="auth-stage__email">{flow.email}</p>
        <button className="qx-btn qx-btn--ghost" type="button" onClick={flow.back} disabled={flow.submitting}>{flow.step === 'code' ? '修改邮箱' : '返回验证码'}</button>
      </div>}
      <form className="auth-stage__form" aria-label="创建 Everplain 账号" onSubmit={flow.step === 'email' ? flow.sendCode : flow.step === 'code' ? flow.continueToPassword : flow.submit} noValidate>
        {flow.step === 'email' && <input key="email" className="qx-input" aria-label="邮箱" placeholder="邮箱地址" value={flow.email} onChange={event => flow.setEmail(event.target.value)} name="email" type="email" autoComplete="email" maxLength={320} required autoFocus />}
        {flow.step === 'code' && <input key="code" className="qx-input auth-stage__code" aria-label="验证码" placeholder="6 位验证码" value={flow.verificationCode} onChange={event => flow.setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} name="verification-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />}
        {flow.step === 'password' && <>
          <input key="password" className="qx-input" aria-label="密码" placeholder="密码" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="password-help" required autoFocus />
          <input className="qx-input" aria-label="确认密码" placeholder="再输入一次密码" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <small id="password-help" className="qx-meta">8-128 个字符。</small>
        </>}
        <FormError message={flow.error} />
        <button className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block" type="submit" disabled={flow.submitting}>
          {flow.step === 'email' ? (flow.submitting ? '正在发送…' : '发送验证码') : flow.step === 'code' ? '继续设置密码' : flow.submitting ? '正在创建…' : '创建账号'}
        </button>
        {flow.step === 'code' && <button className="qx-btn qx-btn--ghost" type="button" disabled={flow.submitting || flow.resendAfter > 0} onClick={() => void flow.sendCode()}>{flow.resendAfter > 0 ? `${flow.resendAfter} 秒后可重新发送` : '重新发送验证码'}</button>}
      </form>
    </AuthStage>
  )
}
