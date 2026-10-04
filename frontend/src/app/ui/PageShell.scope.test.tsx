import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { PageShell } from './PageShell'
const identity = vi.hoisted(() => ({ userId: 'account-a' }))
vi.mock('../../modules/account', () => ({
 useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId, displayName: identity.userId } } } }),
 listMyResearchViaApi: async () => [], readAccountProfile: async () => ({ role: 'member' }),
}))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../modules/research-agent', () => ({ listAgentConversations: async () => ({ items: [] }) }))
afterEach(() => { cleanup(); identity.userId = 'account-a' })
it.each(['open','closing'])('discards %s notifications immediately on session replacement while preserving the page draft', phase => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const page = () => <QueryClientProvider client={client}><MemoryRouter><PageShell><input aria-label="页面草稿" defaultValue="unsent" /></PageShell></MemoryRouter></QueryClientProvider>
 const view = render(page())
 const input = screen.getByRole('textbox', { name: '页面草稿' })
 fireEvent.click(screen.getByRole('button', { name: '通知' }))
 const surface = document.querySelector<HTMLElement>('.application-notifications')!
 surface.style.transitionProperty = 'opacity'; surface.style.transitionDuration = '.14s'; surface.style.transitionDelay = '0s'
 if (phase === 'closing') fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))
 identity.userId = 'account-b'; view.rerender(page())
 expect(document.querySelector('.application-notifications')).toBeNull()
 expect(screen.getByRole('textbox', { name: '页面草稿' })).toBe(input)
 view.unmount(); client.clear()
})
