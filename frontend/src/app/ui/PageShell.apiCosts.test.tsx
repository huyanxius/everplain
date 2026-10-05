import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageShell } from './PageShell'

const profile = vi.hoisted(() => ({ read: vi.fn<() => Promise<{ role: string }>>() }))
vi.mock('../../modules/account', () => ({
  useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: 'synthetic-user', displayName: 'Test' } } } }),
  listMyResearchViaApi: async () => [],
  readAccountProfile: profile.read,
}))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../modules/research-agent', () => ({ listAgentConversations: async () => [] }))

afterEach(() => { cleanup(); vi.resetAllMocks() })
function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><PageShell><h1>Test page</h1></PageShell></MemoryRouter></QueryClientProvider>)
}

describe('API costs administration navigation', () => {
  it('links admins to the new cost report', async () => {
    profile.read.mockResolvedValue({ role: 'admin' })
    renderShell()
    expect(await screen.findByRole('link', { name: 'API 成本统计' })).toHaveAttribute('href', '/admin/api-costs')
  })

  it('does not show the admin destination to members', async () => {
    profile.read.mockResolvedValue({ role: 'member' })
    renderShell()
    await waitFor(() => expect(profile.read).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'API 成本统计' })).not.toBeInTheDocument()
  })

  it('does not infer admin access when the profile is unavailable', async () => {
    profile.read.mockRejectedValue(new Error('unavailable'))
    renderShell()
    await waitFor(() => expect(profile.read).toHaveBeenCalled())
    expect(screen.queryByRole('navigation', { name: '管理导航' })).not.toBeInTheDocument()
  })
})
