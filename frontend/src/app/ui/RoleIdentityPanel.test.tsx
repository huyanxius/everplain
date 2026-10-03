import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleIdentityPanel, type RoleIdentityPanelProps } from './RoleIdentityPanel'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile } from '../../modules/agent-profile'
import { loadMemories, loadMemoryOverview, saveMemory, removeMemory } from '../../modules/research-memory'

vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
vi.mock('../../modules/research-memory', () => ({ loadMemories: vi.fn(), loadMemoryOverview: vi.fn(), saveMemory: vi.fn(), removeMemory: vi.fn(), saveMemorySettings: vi.fn(), loadMemoryHistory: vi.fn(), memoryPreviewLimits: { max_entries: 100, max_content_bytes: 2000 } }))
const descriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
const clients: QueryClient[] = []
let profile: PersonalAgentProfile
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } })
  profile = { name: '小叶', avatar_id: 'cheng', color: '#5d8fe6', speaking_style: 'clear', setup_step: 4, setup_completed: true, version: 3, greeting: '你好', questionnaire: { occupation: '', industry: '', goals: [], interests: [], additional: '' } }
  vi.mocked(readAgentProfile).mockImplementation(async () => profile)
  vi.mocked(saveAgentProfile).mockImplementation(async update => { profile = { ...profile, ...update, version: profile.version + 1 }; return profile })
  vi.mocked(loadMemories).mockResolvedValue({ items: [], settings: { task_id: null, version: 0, use_memory: true, learn_memory: true }, limits: { max_entries: 100, max_content_bytes: 2000 } })
  vi.mocked(loadMemoryOverview).mockResolvedValue('记忆概览')
})
afterEach(() => {
  cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.clearAllMocks()
  for (const name of ['showModal', 'close']) { if (descriptors[name]) Object.defineProperty(HTMLDialogElement.prototype, name, descriptors[name]); else Reflect.deleteProperty(HTMLDialogElement.prototype, name) }
})
function setup(initial: Partial<RoleIdentityPanelProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['agent-profile', 'owner'], profile)
  let props: RoleIdentityPanelProps = { open: true, onClose: vi.fn(), userId: 'owner', ...initial }
  const tree = () => <MemoryRouter><QueryClientProvider client={client}><RoleIdentityPanel {...props} /></QueryClientProvider></MemoryRouter>
  const view = render(tree())
  return { ...view, client, onClose: props.onClose, update(next: Partial<RoleIdentityPanelProps>) { props = { ...props, ...next }; view.rerender(tree()) } }
}
describe('RoleIdentityPanel', () => {
  it('loads only after opening, displays seven choices and saves into the shared account cache', async () => {
    const view = setup({ open: false })
    expect(readAgentProfile).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.update({ open: true })
    expect(await screen.findByLabelText('名字')).toHaveValue('小叶')
    expect(within(screen.getByRole('group', { name: '角色形象' })).getAllByRole('button')).toHaveLength(7)
    expect(loadMemories).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: ' 新伙伴 ' } })
    fireEvent.click(screen.getByRole('button', { name: '念' }))
    fireEvent.click(screen.getByRole('button', { name: '好奇开放' }))
    fireEvent.click(screen.getByRole('button', { name: '保存角色' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已保存')
    expect(saveAgentProfile).toHaveBeenCalledWith(expect.objectContaining({ expected_version: 3, name: '新伙伴', avatar_id: 'nian', speaking_style: 'curious' }))
    expect(view.client.getQueryData(['agent-profile', 'owner'])).toMatchObject({ name: '新伙伴', avatar_id: 'nian' })
  })
  it('retains failed edits through memory tab, background refresh and closing/reopening', async () => {
    const view = setup()
    fireEvent.change(await screen.findByLabelText('名字'), { target: { value: '保留修改' } })
    vi.mocked(saveAgentProfile).mockRejectedValueOnce(new Error('保存失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存角色' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    fireEvent.click(screen.getByRole('tab', { name: '记忆' }))
    await waitFor(() => expect(loadMemories).toHaveBeenCalledWith(null, expect.any(AbortSignal)))
    view.update({ open: false }); view.update({ open: true })
    expect(screen.getByLabelText('名字')).toHaveValue('保留修改')
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败')
    act(() => view.client.setQueryData(['agent-profile', 'owner'], { ...profile, version: 8 }))
    fireEvent.click(screen.getByRole('button', { name: '保存角色' }))
    await waitFor(() => expect(saveAgentProfile).toHaveBeenLastCalledWith(expect.objectContaining({ expected_version: 8, name: '保留修改' })))
  })
  it('opens directly into real personal memory, preserves memory drafts and requires deletion confirmation', async () => {
    const record = { memory_id: 'm1', task_id: null, key: 'note', content: '保留原文', origin: 'manual' as const, version: 1, created_at: '2026-10-01', updated_at: '2026-10-01', source_conversation_id: null, source_message_id: null, source_quote: '请保留原文' }
    vi.mocked(loadMemories).mockResolvedValue({ items: [record], settings: { task_id: null, version: 0, use_memory: true, learn_memory: true }, limits: { max_entries: 100, max_content_bytes: 2000 } })
    const view = setup({ initialTab: 'memory' })
    await screen.findByText('记忆概览')
    fireEvent.click(screen.getByRole('button', { name: '查看记忆明细' }))
    fireEvent.click(screen.getByRole('button', { name: '查看记忆：保留原文' }))
    expect(screen.getByText('请保留原文')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(removeMemory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('希望 Agent 记住什么？'), { target: { value: '保留我的记忆草稿' } })
    vi.mocked(saveMemory).mockRejectedValueOnce(new Error('记忆保存失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('记忆保存失败')
    fireEvent.click(screen.getByRole('tab', { name: '角色身份' }))
    view.update({ open: false }); view.update({ open: true })
    expect(screen.getByLabelText('希望 Agent 记住什么？')).toHaveValue('保留我的记忆草稿')
  })
  it('uses native modal dismissal, keyboard tabs, and restores focus and scroll', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    document.body.style.overflow = 'auto'
    const view = setup()
    const dialog = screen.getByRole('dialog', { name: 'AI 伙伴' })
    expect(dialog).toHaveFocus(); expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(screen.getByRole('tab', { name: '角色身份' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '记忆' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: '记忆' })).toHaveAttribute('aria-selected', 'true')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(view.onClose).toHaveBeenCalledOnce()
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 500, top: 10, bottom: 800 } as DOMRect)
    fireEvent.click(dialog, { clientX: 200, clientY: 100 }); expect(view.onClose).toHaveBeenCalledOnce()
    fireEvent.click(dialog, { clientX: 20, clientY: 100 }); expect(view.onClose).toHaveBeenCalledTimes(2)
    view.update({ open: false }); expect(trigger).toHaveFocus(); expect(document.body.style.overflow).toBe('auto')
    trigger.remove(); document.body.style.overflow = ''
  })
  it('refreshes pristine identity fields after another settings surface saves', async () => {
    const view = setup()
    await screen.findByLabelText('名字')
    view.update({ open: false })
    act(() => view.client.setQueryData(['agent-profile', 'owner'], { ...profile, name: '已同步伙伴', avatar_id: 'nian', version: 4 }))
    view.update({ open: true })
    await waitFor(() => expect(screen.getByLabelText('名字')).toHaveValue('已同步伙伴'))
    expect(screen.getByRole('button', { name: '念' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resets retained edits when the authenticated user changes', async () => {
    const view = setup()
    fireEvent.change(await screen.findByLabelText('名字'), { target: { value: '私有草稿' } })
    view.client.setQueryData(['agent-profile', 'other'], { ...profile, name: '另一位伙伴' })
    view.update({ userId: 'other' })
    expect(await screen.findByLabelText('名字')).toHaveValue('另一位伙伴')
    expect(screen.queryByDisplayValue('私有草稿')).not.toBeInTheDocument()
  })
})
