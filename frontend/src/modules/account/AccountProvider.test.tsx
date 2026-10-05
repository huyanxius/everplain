import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AccountProvider, useAccount } from './AccountProvider'

const SESSION_READ_TIMEOUT_MS = 15_000

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.forEach(client => client.clear())
  clients.length = 0
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('marks an established session as expired after a protected API returns 401', async () => {
  let sessionReads = 0
  const fetchMock = vi.fn(async () => {
    sessionReads += 1
    if (sessionReads === 1) {
      return new Response(JSON.stringify({
        session_id: '25b191bb-2d85-4a88-8863-2cabf506a7a8',
        status: 'active',
        version: 1,
        allowed_actions: ['logout'],
        user: { user_id: '95306bf9-194d-4677-be2d-eef4f6aa86d1', email: 'researcher@example.com', display_name: null },
        expires_at: '2026-08-14T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(
      JSON.stringify({ error: { code: 'unauthenticated', message: '请先登录。', trace_id: 'trace-2' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <AccountProvider><SessionProbe /></AccountProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('authenticated')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))

  await waitFor(() => expect(screen.getByText('expired')).toBeVisible())
})

function SessionProbe() {
  const { login, logout, retrySession, sessionState } = useAccount()
  return (
    <>
      <span>{sessionState.status}</span>
      {sessionState.status === 'authenticated' ? <span>{sessionState.session.sessionId}</span> : null}
      <button type="button" onClick={retrySession}>重新读取会话</button>
      <button type="button" onClick={() => void login('researcher@example.com', 'passphrase')}>登录</button>
      <button type="button" onClick={() => void logout()}>退出</button>
    </>
  )
}


const session = {
  session_id: 'established-session', status: 'active', version: 1, allowed_actions: ['logout'],
  user: { user_id: 'user-1', email: 'researcher@example.com', display_name: null },
  expires_at: '2026-11-14T00:00:00Z',
}

function sessionResponse(id = session.session_id) {
  return new Response(JSON.stringify({ ...session, session_id: id }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

function renderAccount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(queryClient)
  const rendered = render(<QueryClientProvider client={queryClient}>
    <AccountProvider><SessionProbe /></AccountProvider>
  </QueryClientProvider>)
  return { ...rendered, queryClient }
}

async function advance(milliseconds = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

it('leaves bootstrap loading at the deadline and manually recovers without becoming anonymous', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(() => undefined))
    .mockImplementationOnce(async () => sessionResponse())
  vi.stubGlobal('fetch', fetchMock)
  renderAccount()
  expect(screen.getByText('loading')).toBeVisible()
  await advance(SESSION_READ_TIMEOUT_MS + 1)
  expect(screen.getByText('error')).toBeVisible()
  expect(screen.queryByText('anonymous')).not.toBeInTheDocument()
  expect(screen.queryByText('expired')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await advance(1)
  expect(screen.getByText('authenticated')).toBeVisible()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('makes offline bootstrap a recoverable error instead of an indefinitely paused loading state', async () => {
  vi.useFakeTimers()
  onlineManager.setOnline(false)
  const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  vi.stubGlobal('fetch', fetchMock)
  renderAccount()
  await advance(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByText('error')).toBeVisible()
})

it('shows loading during a manual retry and does not duplicate a pending initial read', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(() => new Promise<Response>(() => undefined))
  vi.stubGlobal('fetch', fetchMock)
  renderAccount()
  await advance(1)
  expect(screen.getByText('error')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await advance(1)
  expect(screen.getByText('loading')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await advance(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('keeps the established session when a background read times out', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => sessionResponse())
    .mockImplementation(() => new Promise<Response>(() => undefined)))
  const { queryClient } = renderAccount()
  await advance(1)
  expect(screen.getByText('authenticated')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await advance(SESSION_READ_TIMEOUT_MS + 1)
  expect(screen.getByText('authenticated')).toBeVisible()
  expect(queryClient.getQueryData(['account', 'session'])).toMatchObject({ sessionId: 'established-session' })
})

it('aborts an unmounted bootstrap and ignores its later response', async () => {
  vi.useFakeTimers()
  let request: Request | undefined
  let finish: (response: Response) => void = () => undefined
  vi.stubGlobal('fetch', vi.fn((input: Request) => {
    request = input
    return new Promise<Response>(resolve => { finish = resolve })
  }))
  const { unmount, queryClient } = renderAccount()
  await advance()
  expect(request?.signal.aborted).toBe(false)
  unmount()
  expect(request?.signal.aborted).toBe(true)
  finish(sessionResponse('obsolete-session'))
  await advance(1)
  expect(queryClient.getQueryData(['account', 'session'])).toBeUndefined()
})

it('cancels an obsolete bootstrap before committing login and ignores its late 401', async () => {
  vi.useFakeTimers()
  let finish: (response: Response) => void = () => undefined
  let request: Request | undefined
  vi.stubGlobal('fetch', vi.fn((input: Request) => {
    if (input.method === 'POST') return Promise.resolve(sessionResponse('new-login-session'))
    request = input
    return new Promise<Response>(resolve => { finish = resolve })
  }))
  const { queryClient } = renderAccount()
  await advance()
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  await advance(1)
  expect(screen.getByText('new-login-session')).toBeVisible()
  expect(request?.signal.aborted).toBe(true)
  finish(new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }))
  await advance(1)
  expect(screen.getByText('authenticated')).toBeVisible()
  expect(queryClient.getQueryData(['account', 'session'])).toMatchObject({ sessionId: 'new-login-session' })
})

it('cancels a refresh before committing logout so a late success cannot restore the old session', async () => {
  vi.useFakeTimers()
  let finish: (response: Response) => void = () => undefined
  let reads = 0
  vi.stubGlobal('fetch', vi.fn((input: Request) => {
    if (input.method === 'POST') return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    reads += 1
    if (reads === 1) return Promise.resolve(sessionResponse())
    return new Promise<Response>(resolve => { finish = resolve })
  }))
  const { queryClient } = renderAccount()
  await advance(1)
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await advance()
  fireEvent.click(screen.getByRole('button', { name: '退出' }))
  await advance(1)
  expect(screen.getByText('anonymous')).toBeVisible()
  finish(sessionResponse('old-session'))
  await advance(1)
  expect(queryClient.getQueryData(['account', 'session'])).toBeNull()
  expect(screen.getByText('anonymous')).toBeVisible()
})

it('keeps the established session when a background read fails immediately', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => sessionResponse())
    .mockRejectedValueOnce(new TypeError('Failed to fetch')))
  const { queryClient } = renderAccount()
  expect(await screen.findByText('authenticated')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新读取会话' }))
  await waitFor(() => expect(queryClient.getQueryState(['account', 'session'])?.status).toBe('error'))
  expect(screen.getByText('authenticated')).toBeVisible()
  expect(screen.queryByText('expired')).not.toBeInTheDocument()
})
