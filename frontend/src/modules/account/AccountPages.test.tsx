import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loginViaApi } from './accountApi'
import { LoginPage, RegisterPage } from './AccountPages'

vi.mock('@paper-design/shaders-react', () => ({
  GrainGradient: ({ className }: { className?: string }) => <div className={className} />,
  PaperTexture: ({ className }: { className?: string }) => <div className={className} />,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('account pages', () => {
  it('keeps email login first and restores optional providers after going back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: ['google', 'github'] }), {
      headers: { 'Content-Type': 'application/json' },
    })))
    const login = vi.fn()
    render(<LoginPage onLogin={login} onAuthenticated={vi.fn()} registerHref="/register" />)

    const google = await screen.findByRole('button', { name: '使用 Google 继续' })
    const emailForm = screen.getByRole('form', { name: '登录到 Everplain' })
    expect(emailForm.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      '继续', '使用 Google 继续', '使用 GitHub 继续',
    ])
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByLabelText('密码')).toBeVisible()
    expect(screen.queryByRole('region', { name: '第三方登录' })).not.toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByRole('button', { name: '使用 GitHub 继续' })).toBeVisible()
    expect(screen.getByLabelText('邮箱')).toHaveValue('reader@example.com')
  })

  it('places optional registration providers below the email form only on its first step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: ['google', 'github'] }), {
      headers: { 'Content-Type': 'application/json' },
    })))
    const sendCode = vi.fn(async () => ({ resendAfterSeconds: 60 }))
    render(<RegisterPage onRegister={vi.fn()} onSendRegistrationCode={sendCode} onAuthenticated={vi.fn()} loginHref="/login" />)

    const google = await screen.findByRole('button', { name: '使用 Google 继续' })
    const emailForm = screen.getByRole('form', { name: '创建 Everplain 账号' })
    expect(emailForm.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      '发送验证码', '使用 Google 继续', '使用 GitHub 继续',
    ])
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByLabelText('验证码')).toBeVisible()
    expect(sendCode).toHaveBeenCalledWith('new@example.com')
    expect(screen.queryByRole('region', { name: '第三方登录' })).not.toBeInTheDocument()
  })

  it('reveals and hides the login password without changing its value or submitting', () => {
    const login = vi.fn(async () => undefined)
    render(
      <LoginPage
        onLogin={login}
        onAuthenticated={() => undefined}
        registerHref="/register"
      />,
    )

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    const password = screen.getByLabelText('密码')
    fireEvent.change(password, { target: { value: 'research-passphrase' } })

    const reveal = screen.getByRole('button', { name: '显示密码' })
    expect(password).toHaveAttribute('type', 'password')
    expect(reveal).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(reveal)

    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('research-passphrase')
    expect(screen.getByRole('button', { name: '隐藏密码' })).toHaveAttribute('aria-pressed', 'true')
    expect(login).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))

    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveValue('research-passphrase')
  })

  it('shows one neutral message for every rejected login', async () => {
    const login = vi.fn(async () => {
      throw new Error('account does not exist')
    })
    render(
      <LoginPage
        onLogin={login}
        onAuthenticated={() => undefined}
        registerHref="/register"
      />,
    )

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'unknown@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确')
    expect(screen.queryByText('account does not exist')).not.toBeInTheDocument()
  })

  it('distinguishes a login service failure from rejected credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'internal_server_error',
        message: 'login unavailable',
        trace_id: 'trace-login-503',
      },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    render(
      <LoginPage
        onLogin={loginViaApi}
        onAuthenticated={() => undefined}
        registerHref="/register"
      />,
    )

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'known@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '登录服务暂时不可用，请稍后重试',
    )
  })

  it('does not mislabel a disconnected API as rejected credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    render(
      <LoginPage
        onLogin={loginViaApi}
        onAuthenticated={() => undefined}
        registerHref="/register"
      />,
    )

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'known@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '登录服务暂时不可用，请稍后重试',
    )
  })

  it('does not submit registration while passwords differ', async () => {
    const register = vi.fn(async () => undefined)
    render(
      <RegisterPage
        onRegister={register}
        onSendRegistrationCode={vi.fn(async () => ({ resendAfterSeconds: 60 }))}
        onAuthenticated={() => undefined}
        loginHref="/login"
      />,
    )

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    fireEvent.change(await screen.findByLabelText('验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续设置密码' }))
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'different-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的密码不一致')
    await waitFor(() => expect(register).not.toHaveBeenCalled())
  })

  it('enforces the published registration length boundaries', async () => {
    const register = vi.fn(async () => undefined)
    render(
      <RegisterPage
        onRegister={register}
        onSendRegistrationCode={vi.fn(async () => ({ resendAfterSeconds: 60 }))}
        onAuthenticated={() => undefined}
        loginHref="/login"
      />,
    )

    expect(screen.getByLabelText('邮箱')).toHaveAttribute('maxlength', '320')
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    fireEvent.change(await screen.findByLabelText('验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续设置密码' }))
    expect(screen.getByText('8-128 个字符。')).toBeVisible()
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'p'.repeat(129) },
    })
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'p'.repeat(129) },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('密码需要 8-128 个字符')
    expect(register).not.toHaveBeenCalled()
  })

  it('moves registration through email, code, and password steps', async () => {
    const sendCode = vi.fn(async () => ({ resendAfterSeconds: 60 }))
    const register = vi.fn(async () => undefined)
    render(
      <RegisterPage
        onRegister={register}
        onSendRegistrationCode={sendCode}
        onAuthenticated={() => undefined}
        loginHref="/login"
      />,
    )

    expect(screen.getByText('第 1 步，共 3 步')).toBeVisible()
    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => expect(sendCode).toHaveBeenCalledWith('new@example.com'))
    expect(screen.getByText('第 2 步，共 3 步')).toBeVisible()
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续设置密码' }))

    expect(screen.getByText('第 3 步，共 3 步')).toBeVisible()
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'research-passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(
        'new@example.com',
        'research-passphrase',
        '123456',
      )
    })
  })
})

describe('auth flow interruption and repeat handling', () => {
  it('keeps expiry and redirect links while allowing email changes from the password step', () => {
    render(<LoginPage onLogin={vi.fn()} onAuthenticated={vi.fn()} registerHref="/register?redirect=%2Flibrary" sessionExpired />)
    expect(screen.getByRole('status')).toHaveTextContent('登录已过期')
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute('href', '/register?redirect=%2Flibrary')
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'old@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'old-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByLabelText('邮箱')).toHaveValue('old@example.com')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByLabelText('密码')).toHaveValue('')
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password')
  })

  it('locks repeated login submits and calls the existing redirect callback once', async () => {
    let finish!: () => void
    const login = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const authenticated = vi.fn()
    render(<LoginPage onLogin={login} onAuthenticated={authenticated} registerHref="/register" />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: ' reader@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'research-passphrase' } })
    const form = screen.getByRole('form', { name: '登录到 Everplain' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith('reader@example.com', 'research-passphrase')
    expect(screen.getByRole('button', { name: '返回' })).toBeDisabled()
    await act(async () => finish())
    expect(authenticated).toHaveBeenCalledTimes(1)
  })

  it('ignores a login completion after the view has been dismissed', async () => {
    let finish!: () => void
    const authenticated = vi.fn()
    const view = render(<LoginPage onLogin={() => new Promise<void>(resolve => { finish = resolve })} onAuthenticated={authenticated} registerHref="/register" />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'research-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }))
    view.unmount()
    await act(async () => finish())
    expect(authenticated).not.toHaveBeenCalled()
  })

  it('counts down resend availability and clears the code when changing email', async () => {
    vi.useFakeTimers()
    const sendCode = vi.fn(async () => ({ resendAfterSeconds: 2 }))
    render(<RegisterPage onRegister={vi.fn()} onSendRegistrationCode={sendCode} onAuthenticated={vi.fn()} loginHref="/login?redirect=%2Flibrary" />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送验证码' })) })
    expect(screen.getByRole('button', { name: '2 秒后可重新发送' })).toBeDisabled()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', { name: '1 秒后可重新发送' })).toBeDisabled()
    act(() => { vi.advanceTimersByTime(1000) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' })) })
    expect(sendCode).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '修改邮箱' }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'other@example.com' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送验证码' })) })
    expect(screen.getByLabelText('验证码')).toHaveValue('')
    expect(sendCode).toHaveBeenLastCalledWith('other@example.com')
    expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute('href', '/login?redirect=%2Flibrary')
  })

  it('locks repeated registration requests without losing the email and code', async () => {
    let finish!: () => void
    const register = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const authenticated = vi.fn()
    render(<RegisterPage onRegister={register} onSendRegistrationCode={vi.fn(async () => ({ resendAfterSeconds: 0 }))} onAuthenticated={authenticated} loginHref="/login" />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '继续设置密码' }))
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'research-passphrase' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'research-passphrase' } })
    const form = screen.getByRole('form', { name: '创建 Everplain 账号' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('new@example.com', 'research-passphrase', '123456')
    await act(async () => finish())
    expect(authenticated).toHaveBeenCalledTimes(1)
  })
})
