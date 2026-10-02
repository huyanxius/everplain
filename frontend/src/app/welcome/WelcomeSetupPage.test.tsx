import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeSetupPage } from './WelcomeSetupPage'
import { readAgentProfile, saveAgentProfile } from '../../modules/agent-profile'
import { importFiles, readImportBatches } from '../../modules/knowledge-import'
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
vi.mock('../../modules/knowledge-import', () => ({ importFiles: vi.fn(), readImportBatches: vi.fn(), retryImport: vi.fn() }))
afterEach(cleanup)
let profile: Awaited<ReturnType<typeof readAgentProfile>>
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/welcome/setup']}><Routes><Route path="/welcome/setup" element={<WelcomeSetupPage userId="owner" />} /><Route path="/my/graph" element={<p>个人图谱</p>} /></Routes></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  profile = { name: 'Everplain', avatar_id: 'cheng', color: '#b8bfa6', speaking_style: 'clear', setup_step: 0, setup_completed: false, questionnaire: { occupation: '', industry: '', goals: [], interests: [], additional: '' }, version: 0, greeting: '你好' }
  vi.mocked(readAgentProfile).mockImplementation(async () => profile)
  vi.mocked(readImportBatches).mockResolvedValue([])
  vi.mocked(saveAgentProfile).mockImplementation(async body => {
    profile = { ...profile, ...body, version: profile.version + 1 } as typeof profile
    return profile
  })
})
describe('personal welcome', () => {
  it('can skip every step and complete without invented import progress', async () => {
    show()
    await screen.findByRole('heading', { name: '把散落的想法，带到一起。' })
    for (const title of ['给你的伙伴一点个性。', '从了解你开始。', '你的空间，正在生长。']) {
      fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }))
      await screen.findByRole('heading', { name: title })
    }
    expect(screen.getByText('从一张空白的纸开始，也很好')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '看看我的知识图谱' }))
    await screen.findByText('个人图谱')
    expect(profile.setup_completed).toBe(true)
  })
  it('resumes the stored identity step, saves choices and restores them on remount', async () => {
    profile.setup_step = 1
    const first = show()
    await screen.findByRole('heading', { name: '给你的伙伴一点个性。' })
    fireEvent.change(screen.getByLabelText('你想叫它什么？'), { target: { value: '小叶' } })
    fireEvent.click(screen.getByRole('button', { name: /^温和自然/ }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('heading', { name: '从了解你开始。' })
    expect(profile.name).toBe('小叶'); expect(profile.speaking_style).toBe('warm')
    first.unmount(); show()
    await screen.findByRole('heading', { name: '从了解你开始。' })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(screen.getByLabelText('你想叫它什么？')).toHaveValue('小叶'))
  })
  it('keeps upload failure visible and permits retry without moving the step', async () => {
    vi.mocked(importFiles).mockRejectedValue(new Error('文件内容无效'))
    show(); await screen.findByRole('heading', { name: '把散落的想法，带到一起。' })
    fireEvent.change(screen.getByLabelText('导入 Chrome 书签'), { target: { files: [new File(['bad'], 'bookmarks.html')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('文件内容无效')
    expect(screen.getByRole('heading', { name: '把散落的想法，带到一起。' })).toBeInTheDocument()
  })
})
