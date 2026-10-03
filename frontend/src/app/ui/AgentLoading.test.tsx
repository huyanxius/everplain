import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount } from '../../modules/account'
import { readAgentProfile, type PersonalAgentProfile } from '../../modules/agent-profile'
import { agentAvatarPresets } from '../../modules/agent-avatar'
import { M5GenerationState } from '../research-workspace/M5GenerationState'
import { AgentLoading, PersonaLoading } from './AgentLoading'

vi.mock('../../modules/account', () => ({ useAccount: vi.fn() }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn() }))

const profile = (avatar = 'nian', color = '#ec8a52'): PersonalAgentProfile => ({ name: '小叶', avatar_id: avatar, color, greeting: '', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1 })
function authenticate(userId: string) {
  vi.mocked(useAccount).mockReturnValue({ sessionState: { status: 'authenticated', session: { user: { userId } } } } as never)
}
function clientFor(userId: string, value: PersonalAgentProfile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['agent-profile', userId], value)
  return client
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useAccount).mockReturnValue({ sessionState: { status: 'anonymous' } } as never)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('selected persona loading', () => {
  it.each(agentAvatarPresets.map(preset => [preset.id, preset.color]))('reuses %s in both loading and working states', (avatar, color) => {
    const view = render(<PersonaLoading profile={profile(avatar, color)} message="正在读取资料" />)
    const pet = view.container.querySelector('svg')!
    expect(pet).toHaveAttribute('data-avatar', avatar)
    expect(pet).toHaveAttribute('data-state', 'think')
    expect(pet.style.getPropertyValue('--aa-color')).toBe(color)
    expect(pet).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('正在读取资料')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    view.rerender(<PersonaLoading compact state="work" profile={profile(avatar, color)} message="正在生成草稿" />)
    expect(pet).toHaveAttribute('data-state', 'work')
    expect(pet).toHaveAttribute('data-playing', 'true')
  })

  it('preserves static status text and stops animation when reduced motion changes', () => {
    let notify!: () => void
    const media = { matches: true, addEventListener: vi.fn((_event: string, listener: () => void) => { notify = listener }), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const view = render(<PersonaLoading profile={profile()} message="正在读取资料" />)
    const pet = view.container.querySelector('svg')!
    expect(pet).toHaveAttribute('data-playing', 'false')
    expect(screen.getByRole('status')).toHaveAttribute('data-reduced-motion', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('正在读取资料')
    act(() => { media.matches = false; notify() })
    expect(pet).toHaveAttribute('data-playing', 'true')
    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', notify)
  })

  it('uses the authenticated profile cache and tracks avatar/color changes without refetching', async () => {
    authenticate('owner')
    const client = clientFor('owner', profile())
    const view = render(<QueryClientProvider client={client}><AgentLoading message="正在打开资料" /></QueryClientProvider>)
    expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'nian')
    act(() => { client.setQueryData(['agent-profile', 'owner'], profile('you', '#3fae9c')) })
    await waitFor(() => expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'you'))
    expect(view.container.querySelector('svg')!.style.getPropertyValue('--aa-color')).toBe('#3fae9c')
    expect(readAgentProfile).not.toHaveBeenCalled()
  })

  it('shares one profile request between simultaneous loading indicators', async () => {
    authenticate('owner')
    vi.mocked(readAgentProfile).mockResolvedValue(profile('qi', '#3fae9c'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(<QueryClientProvider client={client}><AgentLoading message="正在打开研究" /><AgentLoading compact state="work" message="正在读取资料" /></QueryClientProvider>)
    await waitFor(() => expect(view.container.querySelectorAll('svg[data-avatar="qi"]')).toHaveLength(2))
    expect(readAgentProfile).toHaveBeenCalledTimes(1)
  })

  it('never displays another account persona while the new owner profile is pending', async () => {
    authenticate('owner-one')
    const client = clientFor('owner-one', profile('heng'))
    let finish!: (value: PersonalAgentProfile) => void
    vi.mocked(readAgentProfile).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = render(<QueryClientProvider client={client}><AgentLoading message="正在打开研究" /></QueryClientProvider>)
    expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'heng')
    authenticate('owner-two')
    view.rerender(<QueryClientProvider client={client}><AgentLoading message="正在打开研究" /></QueryClientProvider>)
    expect(view.container.querySelector('svg')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在打开研究')
    await act(async () => finish(profile('ruo', '#9a80e0')))
    await waitFor(() => expect(view.container.querySelector('svg')).toHaveAttribute('data-avatar', 'ruo'))
  })

  it('keeps unknown or unavailable identity text-only without a made-up fallback avatar', async () => {
    const first = render(<AgentLoading message="正在确认登录状态" />)
    expect(first.container.querySelector('svg')).not.toBeInTheDocument()
    expect(readAgentProfile).not.toHaveBeenCalled()
    first.unmount()
    authenticate('owner')
    vi.mocked(readAgentProfile).mockRejectedValue(new Error('profile unavailable'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const next = render(<QueryClientProvider client={client}><AgentLoading message="正在读取资料" /></QueryClientProvider>)
    await waitFor(() => expect(client.getQueryState(['agent-profile', 'owner'])?.status).toBe('error'))
    expect(next.container.querySelector('svg')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取资料')
  })

  it('only shows the selected working animation during a real generation promise', async () => {
    authenticate('owner')
    const client = clientFor('owner', profile('shi', '#e55f6f'))
    let finish!: () => void
    const generate = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const view = render(<QueryClientProvider client={client}><M5GenerationState theoryPlanLabel="已确认方案" createIdempotencyKey={() => 'generation-one'} onGenerate={generate} /></QueryClientProvider>)
    expect(view.container.querySelector('.agent-loading')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成研究框架草稿' }))
    expect(view.container.querySelector('svg[data-avatar="shi"]')).toHaveAttribute('data-state', 'work')
    expect(screen.getByText('正在根据已确认方案整理草稿…')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '正在生成草稿' }))
    expect(generate).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(view.container.querySelector('.agent-loading')).not.toBeInTheDocument()
    expect(screen.getByText('草稿已生成，等待你逐条审阅建议。')).toBeVisible()
  })
})
