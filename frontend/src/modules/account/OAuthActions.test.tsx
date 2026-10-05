import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthActions, OAuthCallbackNotice } from './OAuthActions'
import { startOAuth } from './accountApi'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('configured OAuth actions', () => {
  it('adds decorative official marks without changing provider button names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ providers: ['google', 'github'] })))
    render(<OAuthActions returnPath="/library" />)
    const google = await screen.findByRole('button', { name: '使用 Google 继续' })
    const github = screen.getByRole('button', { name: '使用 GitHub 继续' })
    expect(google.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/auth/google.png'))
    expect(github.querySelectorAll('img')).toHaveLength(2)
    expect(google.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(github.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(within(google).queryByRole('img')).not.toBeInTheDocument()
    expect(within(github).queryByRole('img')).not.toBeInTheDocument()
    const divider = screen.getByText('或使用以下方式')
    expect(divider.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('或使用邮箱')).not.toBeInTheDocument()
  })

  it('keeps providers hidden when configuration is empty or unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ providers: [] })))
    const { unmount } = render(<OAuthActions returnPath="/library" />)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    unmount()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<OAuthActions returnPath="/library" />)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('starts a real configured login with the requested return path once', async () => {
    let resolve!: (response: Response) => void
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      requests.push(request)
      if (request.url.endsWith('/providers')) return json({ providers: ['google'] })
      return new Promise<Response>(done => { resolve = done })
    }))
    const navigate = vi.fn()
    render(<OAuthActions returnPath="/agent?prompt=research" onNavigate={navigate} />)
    const button = await screen.findByRole('button', { name: '使用 Google 继续' })
    expect(screen.queryByRole('button', { name: /GitHub/ })).not.toBeInTheDocument()
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].url).toContain('/api/session/oauth/google/start')
    expect(await requests[1].json()).toEqual({ return_path: '/agent?prompt=research' })
    expect(navigate).not.toHaveBeenCalled()
    resolve(json({ authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=synthetic')
  })

  it('offers explicit binding only for configured unbound providers', async () => {
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      requests.push(request)
      if (request.url.endsWith('/providers')) return json({ providers: ['google', 'github'] })
      if (request.url.endsWith('/linked')) return json({ providers: ['google'] })
      return json({ authorization_url: 'https://github.com/login/oauth/authorize?state=synthetic' })
    }))
    const navigate = vi.fn()
    render(<OAuthActions returnPath="/settings?section=security" link onNavigate={navigate} />)
    expect(await screen.findByText('Google 已绑定')).toBeInTheDocument()
    expect(screen.queryByText('或使用以下方式')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '绑定 Google' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '绑定 GitHub' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(requests[2].url).toContain('/api/session/oauth/github/link')
    expect(await requests[2].json()).toEqual({ return_path: '/settings?section=security' })
  })

  it('shows a safe error for failed starts and never navigates to a fabricated provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => request.url.endsWith('/providers')
      ? json({ providers: ['google'] }) : json({ authorization_url: 'https://evil.example/token' })))
    const navigate = vi.fn()
    render(<OAuthActions returnPath="/library" onNavigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: '使用 Google 继续' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('requires sign-in before linking an existing account instead of merging it', () => {
    render(<OAuthCallbackNotice code="account_link_required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('先用现有方式登录')
    expect(screen.getByRole('alert')).toHaveTextContent('安全页绑定')
  })

  it.each(['http://accounts.google.com/auth', 'https://accounts.google.com.evil.example/auth', 'https://evil@accounts.google.com/auth'])('rejects an unsafe OAuth authorization URL %s', async url => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ authorization_url: url })))
    await expect(startOAuth('google', '/app')).rejects.toThrow()
  })
})
