import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeSetupPage } from './WelcomeSetupPage'
import { readAgentProfile, saveAgentProfile } from '../../modules/agent-profile'
import { importBilibili, importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
vi.mock('../../modules/knowledge-import', () => ({ importFiles: vi.fn(), readImportBatches: vi.fn(), retryImport: vi.fn(), importBilibili: vi.fn() }))
afterEach(cleanup)
let profile: Awaited<ReturnType<typeof readAgentProfile>>
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/welcome/setup']}><Routes><Route path="/welcome/setup" element={<WelcomeSetupPage userId="owner" />} /><Route path="/my/graph" element={<p>个人图谱</p>} /></Routes></MemoryRouter></QueryClientProvider>)
  return { ...view, client }
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
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    for (const title of ['给它起个名字', '说说你自己', '从一张空白的纸开始']) {
      fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }))
      await screen.findByRole('heading', { name: title })
    }
    expect(screen.getByText('还没有导入资料，随时都可以添加。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '看看我的知识图谱' }))
    await screen.findByText('个人图谱')
    expect(profile.setup_completed).toBe(true)
  })
  it('resumes the stored identity step, saves choices and restores them on remount', async () => {
    profile.setup_step = 1
    const first = show()
    await screen.findByRole('heading', { name: '给它起个名字' })
    fireEvent.change(screen.getByLabelText('你想叫它什么？'), { target: { value: '小叶' } })
    fireEvent.click(screen.getByRole('button', { name: /^温和自然/ }))
    fireEvent.click(screen.getByRole('button', { name: '就叫小叶' }))
    await screen.findByRole('heading', { name: '说说你自己' })
    expect(profile.name).toBe('小叶'); expect(profile.speaking_style).toBe('warm')
    first.unmount(); show()
    await screen.findByRole('heading', { name: '说说你自己' })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(screen.getByLabelText('你想叫它什么？')).toHaveValue('小叶'))
  })
  it('keeps upload failure visible and permits retry without moving the step', async () => {
    vi.mocked(importFiles).mockRejectedValue(new Error('文件内容无效'))
    show(); await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.change(screen.getByLabelText('导入 Chrome 书签'), { target: { files: [new File(['bad'], 'bookmarks.html')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('文件内容无效')
    expect(screen.getByRole('heading', { name: '先把你收藏过的东西带进来' })).toBeInTheDocument()
  })
})

describe('setup live imports and persistence', () => {
  it('submits all four mock source cards through supported import APIs', async () => {
    vi.mocked(importFiles).mockResolvedValue({} as never)
    vi.mocked(importBilibili).mockResolvedValue({} as never)
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    const bookmark = new File(['<html/>'], 'bookmarks.html')
    const note = new File(['# Note'], 'note.md')
    fireEvent.change(screen.getByLabelText('导入 Chrome 书签'), { target: { files: [bookmark] } })
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith('chrome', [bookmark]))
    await waitFor(() => expect(screen.getByLabelText('导入 Markdown 文件夹')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('导入 Markdown 文件夹'), { target: { files: [note] } })
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith('obsidian', [note]))
    await waitFor(() => expect(screen.getByLabelText('导入 Apple 备忘录')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('导入 Apple 备忘录'), { target: { files: [note] } })
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith('apple_notes', [note]))
    await waitFor(() => expect(screen.getByRole('button', { name: /B 站收藏夹/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /B 站收藏夹/ }))
    fireEvent.change(screen.getByLabelText('B 站 UID'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: '导入收藏夹' }))
    await waitFor(() => expect(importBilibili).toHaveBeenCalledWith('12345'))
    expect(screen.getByRole('heading', { name: '先把你收藏过的东西带进来' })).toBeVisible()
  })

  it('persists the complete questionnaire and restores the saved step', async () => {
    profile.setup_step = 2
    const first = show()
    await screen.findByRole('heading', { name: '说说你自己' })
    fireEvent.click(screen.getByRole('button', { name: '研究者' }))
    fireEvent.click(screen.getByRole('button', { name: '辅助写作' }))
    fireEvent.click(screen.getByRole('button', { name: '研究一个问题' }))
    fireEvent.change(screen.getByLabelText(/所在领域/), { target: { value: '设计' } })
    fireEvent.change(screen.getByLabelText('最近在关心什么？'), { target: { value: '城市、电影, 认知科学' } })
    fireEvent.change(screen.getByLabelText(/还有什么想告诉它的/), { target: { value: '每周读一本书' } })
    fireEvent.click(screen.getByRole('button', { name: '好了' }))
    await screen.findByRole('heading', { name: '从一张空白的纸开始' })
    expect(profile.questionnaire).toEqual({ occupation: '研究者', industry: '设计', goals: ['辅助写作', '研究一个问题'], interests: ['城市', '电影', '认知科学'], additional: '每周读一本书' })
    first.unmount()
    show()
    await screen.findByRole('heading', { name: '从一张空白的纸开始' })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(screen.getByLabelText(/所在领域/)).toHaveValue('设计'))
    expect(screen.getByRole('button', { name: '辅助写作' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not advance after a save error and retries the same step', async () => {
    vi.mocked(saveAgentProfile).mockRejectedValueOnce(new Error('保存失败'))
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByRole('heading', { name: '先把你收藏过的东西带进来' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('heading', { name: '给它起个名字' })
    expect(saveAgentProfile).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable batch data instead of inventing empty or complete progress', async () => {
    profile.setup_step = 3
    vi.mocked(readImportBatches).mockRejectedValueOnce(new Error('导入服务离线'))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('导入服务离线')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('整理好了')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await screen.findByRole('heading', { name: '从一张空白的纸开始' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('shows real failed imports and retries the exact batch item', async () => {
    profile.setup_step = 3
    const batch = { id: 'batch-1', created_at: '', library_id: 'library-1', source_type: 'chrome', status: 'partial' as const, total: 2, finished: 2, failed: 1, imported: 1, duplicates: 0,
      items: [{ id: 'item-1', title: 'Broken page', filename: '', relative_path: '', source_url: null, document_id: null, attempts: 1, status: 'failed' as const, error: '无法访问网页' }] }
    vi.mocked(readImportBatches).mockResolvedValue([batch])
    vi.mocked(retryImport).mockResolvedValue({} as never)
    show()
    await screen.findByRole('heading', { name: '还有几条资料需要重试' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByText('无法访问网页')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(retryImport).toHaveBeenCalledWith('batch-1', 'item-1'))
    await waitFor(() => expect(readImportBatches).toHaveBeenCalledTimes(2))
  })
})

describe('setup interruptions', () => {
  it('keeps an unsaved draft during profile refresh and saves against the new version', async () => {
    profile.setup_step = 1
    const { client } = show()
    await screen.findByRole('heading', { name: '给它起个名字' })
    fireEvent.change(screen.getByLabelText('你想叫它什么？'), { target: { value: '新伙伴' } })
    fireEvent.click(screen.getByRole('button', { name: '颜色 #ec8a52' }))
    fireEvent.click(screen.getByRole('button', { name: '好奇开放' }))
    act(() => { client.setQueryData(['agent-profile', 'owner'], { ...profile, version: 7 }) })
    expect(screen.getByLabelText('你想叫它什么？')).toHaveValue('新伙伴')
    fireEvent.click(screen.getByRole('button', { name: '就叫新伙伴' }))
    await screen.findByRole('heading', { name: '说说你自己' })
    expect(saveAgentProfile).toHaveBeenCalledWith(expect.objectContaining({ expected_version: 7, name: '新伙伴', color: '#ec8a52', speaking_style: 'curious' }))
  })

  it('locks repeated next clicks while a step is being saved', async () => {
    let finish!: () => void
    vi.mocked(saveAgentProfile).mockImplementation(body => new Promise(resolve => {
      finish = () => { profile = { ...profile, ...body, version: profile.version + 1 } as typeof profile; resolve(profile) }
    }))
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    const next = screen.getByRole('button', { name: '继续' })
    fireEvent.click(next)
    fireEvent.click(next)
    expect(saveAgentProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '暂时跳过' })).toBeDisabled()
    await act(async () => finish())
    await screen.findByRole('heading', { name: '给它起个名字' })
  })

  it('uses actual processing totals and permits entering while imports continue', async () => {
    profile.setup_step = 3
    vi.mocked(readImportBatches).mockResolvedValue([{ id: 'batch-2', created_at: '', library_id: 'library-1', source_type: 'obsidian', status: 'processing', total: 8, finished: 3, failed: 0, imported: 3, duplicates: 0, items: [] }])
    show()
    await screen.findByRole('heading', { name: 'Everplain正在读你的收藏' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '8')
    fireEvent.click(screen.getByRole('button', { name: '先进入，后台继续' }))
    await screen.findByText('个人图谱')
    expect(profile.setup_completed).toBe(true)
  })
})
