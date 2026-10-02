import { useState } from 'react'
import { ArrowLeftIcon, GoogleLogoIcon } from '@phosphor-icons/react'

import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { go } from '../state'

/* 登录：Muse 那种单列居中。先邮箱，再密码，两步各占一屏，不同时摆三个输入框。 */
export function LoginPage() {
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [email, setEmail] = useState('')

  return (
    <main className="mk-auth">
      {step === 'password' ? (
        <button className="qx-btn qx-btn--secondary qx-btn--icon qx-btn--lg mk-auth__back" aria-label="返回" onClick={() => setStep('email')}>
          <ArrowLeftIcon />
        </button>
      ) : null}

      <div className="mk-auth__crowd" aria-hidden="true">
        {agentAvatarPresets.map((p, i) => (
          <AgentAvatar key={p.id} avatar={p.id} size={i === 3 ? 72 : 48} offset={i * 0.7} state={i === 3 ? 'greet' : 'idle'} />
        ))}
      </div>

      {step === 'email' ? (
        <>
          <h1 className="qx-display">把你读过的，都留下来</h1>
          <form
            className="mk-auth__form"
            onSubmit={(e) => {
              e.preventDefault()
              if (email.trim()) setStep('password')
            }}
          >
            <input className="qx-input" type="email" placeholder="邮箱地址" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <button className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block" type="submit">
              继续
            </button>
            <div className="mk-or">或</div>
            <button className="qx-btn qx-btn--secondary qx-btn--lg qx-btn--block" type="button">
              <GoogleLogoIcon /> 用 Google 账号继续
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="qx-section-title">输入密码</h1>
          <p className="mk-auth__email">{email}</p>
          <form
            className="mk-auth__form"
            onSubmit={(e) => {
              e.preventDefault()
              go('/setup/1')
            }}
          >
            <input className="qx-input" type="password" placeholder="密码" autoFocus />
            <button className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block" type="submit">
              登录
            </button>
            <button className="qx-btn qx-btn--ghost" type="button">
              忘记密码
            </button>
          </form>
        </>
      )}

      <footer className="mk-auth__foot qx-meta">
        <a href="#/login">隐私政策</a>
        <a href="#/login">条款</a>
      </footer>
    </main>
  )
}
