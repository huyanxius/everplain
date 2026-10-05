import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile } from '../agent-profile'
import { UserAvatarSettingsPanel } from './UserAvatarSettingsPanel'
vi.mock('../agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
vi.mock('../user-avatar', () => ({ PEOPLE: [{ id: 'xiaoping' }, { id: 'mo' }, { id: 'silver' }, { id: 'sand' }, { id: 'cat' }, { id: 'hime' }], UserAvatar: ({ id }: { id: string }) => <span>{id}</span>, AvatarPalette: ({ onChange }: { onChange(value: { hair: string }): void }) => <button type="button" onClick={() => onChange({ hair: '#123456' })}>改发色</button> }))
let profile: PersonalAgentProfile
const clients: QueryClient[] = []
beforeEach(() => {
  vi.clearAllMocks()
  profile = { name: '小叶', avatar_id: 'cheng', color: '#5d8fe6', speaking_style: 'clear', setup_step: 6, setup_completed: true, questionnaire: {}, version: 3, greeting: '你好', user_avatar: null }
  vi.mocked(readAgentProfile).mockImplementation(async () => profile)
  vi.mocked(saveAgentProfile).mockImplementation(async body => { profile = { ...profile, ...body, version: profile.version + 1 } as PersonalAgentProfile; return profile })
})
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.length = 0 })
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['agent-profile', 'owner'], profile)
  clients.push(client)
  render(<QueryClientProvider client={client}><UserAvatarSettingsPanel userId="owner" active text={zh => zh} /></QueryClientProvider>)
  return client
}
it('keeps null off, enables six choices and saves explicit null on disable', async () => {
  show()
  expect(screen.getByRole('switch', { name: '在右下角显示' })).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('button', { name: '形象 1' })).toBeDisabled()
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(profile.user_avatar).toEqual({ id: 'xiaoping' }))
  fireEvent.click(screen.getByRole('button', { name: '形象 5' }))
  await waitFor(() => expect(profile.user_avatar).toEqual({ id: 'cat' }))
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(saveAgentProfile).toHaveBeenLastCalledWith({ expected_version: 5, user_avatar: null }))
})
it('updates the shared cache immediately and serializes changes against returned versions', async () => {
  profile.user_avatar = { id: 'xiaoping' }
  let resolve!: (value: PersonalAgentProfile) => void
  vi.mocked(saveAgentProfile).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const client = show()
  fireEvent.click(screen.getByRole('button', { name: '形象 2' }))
  fireEvent.click(screen.getByRole('button', { name: '改发色' }))
  expect(client.getQueryData<PersonalAgentProfile>(['agent-profile', 'owner'])?.user_avatar).toEqual({ id: 'mo', hair: '#123456' })
  expect(saveAgentProfile).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ ...profile, user_avatar: { id: 'mo' }, version: 4 }) })
  await waitFor(() => expect(saveAgentProfile).toHaveBeenLastCalledWith({ expected_version: 4, user_avatar: { id: 'mo', hair: '#123456' } }))
})
it('retains a failed selection with an explicit retry against the refreshed version', async () => {
  profile.user_avatar = { id: 'xiaoping' }
  vi.mocked(saveAgentProfile).mockRejectedValueOnce(new Error('档案已更新'))
  vi.mocked(readAgentProfile).mockResolvedValue({ ...profile, version: 8 })
  const client = show()
  fireEvent.click(screen.getByRole('button', { name: '形象 2' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('档案已更新')
  await waitFor(() => expect(client.getQueryData<PersonalAgentProfile>(['agent-profile', 'owner'])?.version).toBe(8))
  expect(screen.getByRole('button', { name: '形象 2' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
  await waitFor(() => expect(saveAgentProfile).toHaveBeenLastCalledWith({ expected_version: 8, user_avatar: { id: 'mo' } }))
})
