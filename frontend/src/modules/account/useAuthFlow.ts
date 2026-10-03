import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isLoginServiceFailure, registrationCodeFailureMessage, registrationFailureMessage } from './accountApi'

export type LoginPageProps = {
  onLogin(email: string, password: string): Promise<unknown>
  onAuthenticated(): void
  registerHref: string
  sessionExpired?: boolean
}

export type RegisterPageProps = {
  onRegister(email: string, password: string, verificationCode: string): Promise<unknown>
  onSendRegistrationCode(email: string): Promise<{ resendAfterSeconds: number }>
  onAuthenticated(): void
  loginHref: string
}

const validEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 320

function useSubmission() {
  const lock = useRef(false)
  const active = useRef(true)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  function begin() {
    if (lock.current) return false
    lock.current = true
    setSubmitting(true)
    return true
  }
  function end() {
    lock.current = false
    if (active.current) setSubmitting(false)
  }
  return { lock, active, submitting, begin, end }
}

export function useLoginFlow({ onLogin, onAuthenticated }: LoginPageProps) {
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useSubmission()

  function continueToPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validEmail(email.trim())) {
      setError('请输入有效的邮箱地址。')
      return
    }
    setEmail(email.trim())
    setError(null)
    setStep('password')
  }
  function back() {
    if (request.lock.current) return
    setStep('email')
    setError(null)
    setPasswordVisible(false)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.lock.current) return
    if (!validEmail(email) || password.length < 8 || password.length > 128) {
      setError('请检查邮箱格式，密码需要 8-128 个字符。')
      return
    }
    if (!request.begin()) return
    setError(null)
    try {
      await onLogin(email, password)
      if (request.active.current) onAuthenticated()
    } catch (failure) {
      if (request.active.current) setError(isLoginServiceFailure(failure)
        ? '登录服务暂时不可用，请稍后重试。'
        : '邮箱或密码不正确，请重新输入。')
    } finally { request.end() }
  }
  function changeEmail(value: string) {
    setEmail(value)
    setPassword('')
  }
  return { step, email, password, setPassword, passwordVisible, setPasswordVisible, error,
    submitting: request.submitting, continueToPassword, submit, back, changeEmail }
}

export function useRegisterFlow({ onRegister, onSendRegistrationCode, onAuthenticated }: RegisterPageProps) {
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [resendAfter, setResendAfter] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const request = useSubmission()

  useEffect(() => {
    if (resendAfter <= 0) return
    const timer = window.setTimeout(() => setResendAfter(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendAfter])

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (request.lock.current || (step === 'code' && resendAfter > 0)) return
    const normalizedEmail = email.trim()
    if (!validEmail(normalizedEmail)) {
      setError('请输入有效的邮箱地址。')
      return
    }
    if (!request.begin()) return
    setError(null)
    try {
      const result = await onSendRegistrationCode(normalizedEmail)
      if (!request.active.current) return
      setEmail(normalizedEmail)
      setResendAfter(Math.max(0, result.resendAfterSeconds))
      setStep('code')
    } catch (failure) {
      if (request.active.current) setError(registrationCodeFailureMessage(failure))
    } finally { request.end() }
  }
  function continueToPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.lock.current) return
    if (!/^\d{6}$/.test(verificationCode)) {
      setError('请输入邮件中的 6 位验证码。')
      return
    }
    setError(null)
    setStep('password')
  }
  function back() {
    if (request.lock.current) return
    if (step === 'password') setStep('code')
    else { setStep('email'); setVerificationCode('') }
    setError(null)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.lock.current) return
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    if (password.length < 8 || password.length > 128) {
      setError('密码需要 8-128 个字符。')
      return
    }
    if (password !== String(data.get('confirmation') ?? '')) {
      setError('两次输入的密码不一致。')
      return
    }
    if (!request.begin()) return
    setError(null)
    try {
      await onRegister(email, password, verificationCode)
      if (request.active.current) onAuthenticated()
    } catch (failure) {
      if (request.active.current) setError(registrationFailureMessage(failure))
    } finally { request.end() }
  }
  return { step, email, setEmail, verificationCode, setVerificationCode, resendAfter, error,
    submitting: request.submitting, sendCode, continueToPassword, submit, back }
}
