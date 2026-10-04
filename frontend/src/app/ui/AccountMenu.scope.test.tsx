import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountMenu } from './AccountMenu'

vi.mock('../../modules/account', async () => ({ ...(await vi.importActual('../../modules/account')), readAccountUsage: async () => ({ isUnlimited: false, remainingPercent: null, buckets: [] }) }))
vi.mock('../../modules/product-integrations', () => ({ subscription: async () => ({ available: false, plans: [], subscription: null }) }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: async () => ({ name: 'Agent', avatar_id: 'qi' }) }))
vi.mock('./RoleIdentityPanel', () => ({ RoleIdentityPanel: ({ open }: { open: boolean }) => open ? <dialog open aria-label="AI 伙伴" /> : null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it.each(['open', 'closing', 'identity'])('discards the account %s surface immediately on same-position identity replacement', async phase => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const view = (userId: string) => <QueryClientProvider client={client}><MemoryRouter><AccountMenu userId={userId} accountName={userId} /></MemoryRouter></QueryClientProvider>
 const rendered = render(view('account-a'))
 await act(async () => {})
 fireEvent.click(screen.getByRole('button', { name: '账户 account-a' }))
 const menu = screen.getByRole('menu')
 menu.style.transitionProperty = 'opacity'; menu.style.transitionDuration = '.14s'; menu.style.transitionDelay = '0s'
 if (phase === 'closing') fireEvent.keyDown(menu, { key: 'Escape' })
 if (phase === 'identity') fireEvent.click(screen.getByRole('menuitem', { name: /Soul/ }))
 rendered.rerender(view('account-b'))
 expect(document.querySelector('[role="menu"]')).toBeNull()
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 expect(screen.getByRole('button', { name: '账户 account-b' })).toHaveAttribute('aria-expanded', 'false')
 rendered.unmount(); client.clear()
})
