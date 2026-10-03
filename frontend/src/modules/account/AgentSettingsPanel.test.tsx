import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSettingsPanel } from './AgentSettingsPanel'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile } from '../agent-profile'

vi.mock('../agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
const text = (zh: string) => zh
let profile: PersonalAgentProfile
const clients: QueryClient[] = []

beforeEach(() => {
  profile = {
    name: '小叶', avatar_id: 'cheng', color: '#5d8fe6', speaking_style: 'clear',
    setup_step: 4, setup_completed: true, version: 3, greeting: '你好',
    questionnaire: { occupation: '研究者', industry: '设计', goals: ['写作'], interests: ['城市'], additional: '保留这些资料' },
  }
  vi.mocked(readAgentProfile).mockImplementation(async () => profile)
  vi.mocked(saveAgentProfile).mockImplementation(async update => {
    profile = { ...profile, ...update, version: profile.version + 1 } as PersonalAgentProfile
    return profile
  })
})
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.clearAllMocks() })

function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['agent-profile', 'owner'], profile)
  clients.push(client)
  return client
}
function IdentityObserver() {
  const query = useQuery({ queryKey: ['agent-profile', 'owner'], queryFn: readAgentProfile, staleTime: 30_000 })
  return <span data-testid="shared-identity">{query.data?.name} · {query.data?.avatar_id} · {query.data?.color}</span>
}
function setup(client = makeClient()) {
  const result = render(<QueryClientProvider client={client}><AgentSettingsPanel userId="owner" active text={text} /><IdentityObserver /></QueryClientProvider>)
  return { client, ...result }
}

describe('in-place Agent settings', () => {
  it('renders all seven characters, eight colors, name and the four persisted speaking styles', async () => {
    setup()
    expect(await screen.findByLabelText('名字')).toHaveValue('小叶')
    expect(within(screen.getByRole('group', { name: '角色' })).getAllByRole('button')).toHaveLength(7)
    expect(within(screen.getByRole('group', { name: '颜色' })).getAllByRole('button')).toHaveLength(8)
    expect(within(screen.getByRole('group', { name: '说话方式' })).getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('img', { name: 'Agent 预览' })).toHaveAttribute('data-avatar', 'cheng')
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('qx-btn--primary'))).toHaveLength(1)
  })

  it('saves just editable fields at the latest version and updates the same-user shared identity', async () => {
    const { client } = setup()
    const invalidation = vi.spyOn(client, 'invalidateQueries')
    await screen.findByLabelText('名字')
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '  新伙伴  ' } })
    fireEvent.click(screen.getByRole('button', { name: '念' }))
    fireEvent.click(screen.getByRole('button', { name: '颜色 #3d3d3a' }))
    fireEvent.click(screen.getByRole('button', { name: '好奇开放' }))
    act(() => { profile = { ...profile, version: 7 }; client.setQueryData(['agent-profile', 'owner'], profile) })
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }))
    await waitFor(() => expect(saveAgentProfile).toHaveBeenCalledWith({ expected_version: 7, name: '新伙伴', avatar_id: 'nian', color: '#3d3d3a', speaking_style: 'curious' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已保存')
    expect(screen.getByTestId('shared-identity')).toHaveTextContent('新伙伴 · nian · #3d3d3a')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['agent-profile', 'owner'], exact: true })
    expect(profile.setup_completed).toBe(true)
    expect(profile.questionnaire.additional).toBe('保留这些资料')
  })

  it('retains every draft field on a failed save, including across a background refetch and tab hiding', async () => {
    const client = makeClient()
    const { rerender } = setup(client)
    vi.mocked(saveAgentProfile).mockRejectedValueOnce(new Error('版本冲突，请重试'))
    await screen.findByLabelText('名字')
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '保留草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '悠' }))
    fireEvent.click(screen.getByRole('button', { name: '颜色 #9a80e0' }))
    fireEvent.click(screen.getByRole('button', { name: '温和自然' }))
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突')
    await waitFor(() => expect(readAgentProfile).toHaveBeenCalled())
    act(() => { client.setQueryData(['agent-profile', 'owner'], { ...profile, version: 8 }) })
    rerender(<QueryClientProvider client={client}><AgentSettingsPanel userId="owner" active={false} text={text} /><IdentityObserver /></QueryClientProvider>)
    rerender(<QueryClientProvider client={client}><AgentSettingsPanel userId="owner" active text={text} /><IdentityObserver /></QueryClientProvider>)
    expect(screen.getByLabelText('名字')).toHaveValue('保留草稿')
    expect(screen.getByRole('button', { name: '悠' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '颜色 #9a80e0' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '温和自然' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }))
    await waitFor(() => expect(saveAgentProfile).toHaveBeenLastCalledWith(expect.objectContaining({ expected_version: 8, name: '保留草稿', avatar_id: 'you', color: '#9a80e0', speaking_style: 'warm' })))
  })

  it('blocks duplicate saves and disallows editing until the request completes', async () => {
    let finish!: (value: PersonalAgentProfile) => void
    vi.mocked(saveAgentProfile).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    setup()
    await screen.findByLabelText('名字')
    const save = screen.getByRole('button', { name: '保存 Agent' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(saveAgentProfile).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('名字')).toBeDisabled()
    expect(screen.getByRole('button', { name: '念' })).toBeDisabled()
    await act(async () => { finish({ ...profile, version: 4 }) })
    expect(screen.getByRole('button', { name: '保存 Agent' })).toBeEnabled()
  })

  it('validates an empty name locally and recovers an initial load failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    vi.mocked(readAgentProfile).mockRejectedValueOnce(new Error('offline'))
    render(<QueryClientProvider client={client}><AgentSettingsPanel userId="owner" active text={text} /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    fireEvent.change(await screen.findByLabelText('名字'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('名字需要')
    expect(saveAgentProfile).not.toHaveBeenCalled()
  })
})
