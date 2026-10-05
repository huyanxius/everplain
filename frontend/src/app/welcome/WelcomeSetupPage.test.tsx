import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeSetupPage } from './WelcomeSetupPage'
import { readAgentProfile, saveAgentProfile } from '../../modules/agent-profile'
import { createCourse, getCourse, listCourses, readKnowledgeStorage, retryCourseDocument, uploadCourseDocument, type SharedCourse, type SharedDocument } from '../../modules/shared-knowledge'
import { importBilibili, importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(), saveAgentProfile: vi.fn() }))
vi.mock('../../modules/knowledge-import', () => ({ importFiles: vi.fn(), readImportBatches: vi.fn(), retryImport: vi.fn(), importBilibili: vi.fn() }))
vi.mock('../../modules/shared-knowledge', () => ({ COURSE_DOCUMENT_ACCEPT: '.pdf,.docx,.pptx,.txt,.md,.markdown', createCourse: vi.fn(), getCourse: vi.fn(), listCourses: vi.fn(), readKnowledgeStorage: vi.fn(), retryCourseDocument: vi.fn(), uploadCourseDocument: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
let profile: Awaited<ReturnType<typeof readAgentProfile>>
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/welcome/setup']}><Routes><Route path="/welcome/setup" element={<WelcomeSetupPage userId="owner" />} /><Route path="/my/graph" element={<p>个人图谱</p>} /></Routes></MemoryRouter></QueryClientProvider>)
  return { ...view, client }
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.mocked(listCourses).mockResolvedValue([])
  vi.mocked(createCourse).mockReset()
  vi.mocked(getCourse).mockReset()
  vi.mocked(uploadCourseDocument).mockReset()
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ used_bytes: 0, max_bytes: 100000000, max_file_bytes: 10000000, max_documents_per_library: 100, library_count: 0, max_libraries: 10 } as never)
  profile = { name: 'Everplain', avatar_id: 'cheng', color: '#b8bfa6', speaking_style: 'clear', setup_step: 0, setup_completed: false, questionnaire: { occupation: '', industry: '', goals: [], interests: [], additional: '' }, version: 0, greeting: '你好', user_avatar: null }
  vi.mocked(readAgentProfile).mockImplementation(async () => profile)
  vi.mocked(readImportBatches).mockResolvedValue([])
  vi.mocked(saveAgentProfile).mockImplementation(async body => {
    profile = { ...profile, ...body, version: profile.version + 1 } as typeof profile
    return profile
  })
})

function documentFixture(update: Partial<SharedDocument> = {}): SharedDocument {
  return { id: 'doc-1', filename: 'notes.pdf', mediaType: 'application/pdf', sizeBytes: 30, parseId: 'parse-1', status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledge: null, knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '', ...update }
}
function libraryFixture(documents: SharedDocument[] = [], access: SharedCourse['access'] = 'owner'): SharedCourse {
  return { id: 'library-file', name: '我的资料', description: '', access, sharingEnabled: false, shareToken: null, readyDocumentCount: documents.length, documents }
}

describe('six-step additions', () => {
  it('uses the prototype blue for a new profile without changing saved companion colors', async () => {
    profile.color = '#b8bfa6'
    const first = show()
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    expect(screen.getByRole('button', { name: '伙伴 1' }).querySelector('svg')?.style.getPropertyValue('--aa-color')).toBe('#5d8fe6')
    first.unmount()
    profile.version = 5
    show()
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    expect(screen.getByRole('button', { name: '伙伴 1' }).querySelector('svg')?.style.getPropertyValue('--aa-color')).toBe('#b8bfa6')
  })

  it('shows unnamed partners and saves the clicked partner directly into the name step', async () => {
    show()
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    expect(screen.getByRole('list', { name: '第 1 步，共 6 步' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^伙伴 \d$/ })).toHaveLength(7)
    expect(screen.queryByText('澄')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '伙伴 2' }))
    await screen.findByRole('heading', { name: '给它起个名字' })
    expect(saveAgentProfile).toHaveBeenCalledWith(expect.objectContaining({ setup_step: 1, setup_completed: false, avatar_id: 'nian', color: '#ec8a52' }))
    expect(saveAgentProfile).not.toHaveBeenCalledWith(expect.objectContaining({ name: expect.anything() }))
  })

  it('saves and resumes the original flat user-avatar fields', async () => {
    profile.setup_step = 2
    profile.user_avatar = { id: 'mo', hair: '#112233', skin: '#e8c9ae', sleeve: '#445566', blush: false }
    const first = show()
    await screen.findByRole('heading', { name: '你在这里的样子' })
    expect(screen.getByRole('button', { name: '形象 2' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    expect(saveAgentProfile).toHaveBeenCalledWith(expect.objectContaining({ setup_step: 3, user_avatar: { id: 'mo', hair: '#112233', skin: '#e8c9ae', sleeve: '#445566', blush: false } }))
    first.unmount(); show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await screen.findByRole('heading', { name: '你在这里的样子' })
    expect(screen.getByRole('button', { name: '形象 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['暂时跳过', '取消选中'])('persists null when the avatar choice is skipped: %s', async mode => {
    profile.setup_step = 2
    profile.user_avatar = { id: 'xiaoping' }
    show()
    await screen.findByRole('heading', { name: '你在这里的样子' })
    if (mode === '取消选中') fireEvent.click(screen.getByRole('button', { name: '形象 1' }))
    fireEvent.click(screen.getByRole('button', { name: mode === '取消选中' ? '先不选' : '暂时跳过' }))
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    expect(profile.user_avatar).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await screen.findByRole('heading', { name: '你在这里的样子' })
    expect(screen.getByRole('button', { name: '形象 1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens the real customizer, keeps the four allowed overrides and closes before saving', async () => {
    profile.setup_step = 2
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    show()
    await screen.findByRole('heading', { name: '你在这里的样子' })
    fireEvent.click(screen.getByRole('button', { name: '形象 3' }))
    fireEvent.click(screen.getByRole('button', { name: '定制 TA 的外观' }))
    const customizer = await screen.findByRole('dialog', { name: '定制外观' })
    fireEvent.click(within(customizer).getByRole('button', { name: '#8a5a3c' }))
    fireEvent.click(within(customizer).getByRole('switch', { name: '腮红' }))
    fireEvent.keyDown(customizer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    expect(profile.user_avatar).toEqual({ id: 'silver', hair: '#8a5a3c', blush: false })
  })

  it('keeps unsaved name choices when moving back to the partner stage', async () => {
    profile.setup_step = 1
    show()
    await screen.findByRole('heading', { name: '给它起个名字' })
    fireEvent.change(screen.getByLabelText('你想叫它什么？'), { target: { value: '保留草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    fireEvent.click(screen.getByRole('button', { name: '伙伴 4' }))
    await screen.findByRole('heading', { name: '给它起个名字' })
    expect(screen.getByLabelText('你想叫它什么？')).toHaveValue('保留草稿')
  })

  it('uses the real APIs for all five newly added importer cards', async () => {
    profile.setup_step = 3
    vi.mocked(importFiles).mockResolvedValue({} as never)
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    for (const [source, title, filename] of [['image', '图片与截图', 'image.png'], ['enex', '印象笔记', 'notes.enex'], ['notion', 'Notion', 'notes.zip'], ['flomo', 'flomo', 'notes.html'], ['keep', 'Google Keep', 'notes.json']] as const) {
      const input = screen.getByLabelText(`导入${title}`)
      await waitFor(() => expect(input).not.toBeDisabled())
      const file = new File(['test'], filename)
      fireEvent.change(input, { target: { files: [file] } })
      await waitFor(() => expect(importFiles).toHaveBeenCalledWith(source, [file]))
    }
    expect(screen.getAllByText(/文件|图片与截图|浏览器收藏|Obsidian \/ Markdown|Apple 备忘录|印象笔记|Notion|flomo|Google Keep|B 站公开收藏/).length).toBeGreaterThanOrEqual(10)
  })
})

describe('ordinary file imports', () => {
  it('creates only the owner default library and uploads through the document API', async () => {
    profile.setup_step = 3
    const library = libraryFixture()
    vi.mocked(createCourse).mockResolvedValue(library)
    vi.mocked(getCourse).mockResolvedValue(library)
    vi.mocked(uploadCourseDocument).mockImplementation(async () => { vi.mocked(listCourses).mockResolvedValue([library]); return documentFixture() })
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    const file = new File(['test'], 'notes.pdf')
    fireEvent.change(screen.getByLabelText('导入文件'), { target: { files: [file] } })
    await waitFor(() => expect(uploadCourseDocument).toHaveBeenCalledWith('library-file', file))
    expect(createCourse).toHaveBeenCalledWith({ name: '我的资料', description: '' })
    expect(importFiles).not.toHaveBeenCalled()
  })

  it('does not create a library when its real listing cannot be read', async () => {
    profile.setup_step = 3
    vi.mocked(listCourses).mockRejectedValue(new Error('列表不可用'))
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.change(screen.getByLabelText('导入文件'), { target: { files: [new File(['test'], 'notes.pdf')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('列表不可用')
    expect(createCourse).not.toHaveBeenCalled()
    expect(uploadCourseDocument).not.toHaveBeenCalled()
  })

  it('blocks a changed read-only library before upload', async () => {
    profile.setup_step = 3
    vi.mocked(listCourses).mockResolvedValue([libraryFixture()])
    vi.mocked(getCourse).mockResolvedValue(libraryFixture([], 'reader'))
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.change(screen.getByLabelText('导入文件'), { target: { files: [new File(['test'], 'notes.pdf')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('只读')
    expect(uploadCourseDocument).not.toHaveBeenCalled()
  })

  it('retains per-file upload failures and retries that exact file', async () => {
    profile.setup_step = 3
    const library = libraryFixture()
    vi.mocked(listCourses).mockResolvedValue([library])
    vi.mocked(getCourse).mockResolvedValue(library)
    vi.mocked(uploadCourseDocument).mockRejectedValueOnce(new Error('上传中断')).mockResolvedValue(documentFixture())
    show()
    await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    const file = new File(['test'], 'notes.pdf')
    fireEvent.change(screen.getByLabelText('导入文件'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('上传中断')
    await waitFor(() => expect(screen.getByRole('button', { name: '重试上传' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '重试上传' }))
    await waitFor(() => expect(uploadCourseDocument).toHaveBeenNthCalledWith(2, 'library-file', file))
    await waitFor(() => expect(screen.queryByText('上传中断')).not.toBeInTheDocument())
  })

  it('reports actual file processing and retries the exact failed document', async () => {
    profile.setup_step = 5
    const failed = documentFixture({ knowledgeStatus: 'failed', knowledgeError: '整理失败' })
    vi.mocked(listCourses).mockResolvedValue([libraryFixture([failed])])
    vi.mocked(getCourse).mockResolvedValue(libraryFixture([failed]))
    vi.mocked(retryCourseDocument).mockResolvedValue(documentFixture())
    show()
    await screen.findByRole('heading', { name: '还有几条资料需要重试' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(retryCourseDocument).toHaveBeenCalledWith('library-file', 'doc-1'))
  })

  it('does not double count a document already represented by an import batch', async () => {
    profile.setup_step = 5
    vi.mocked(listCourses).mockResolvedValue([libraryFixture([documentFixture()])])
    vi.mocked(getCourse).mockResolvedValue(libraryFixture([documentFixture()]))
    vi.mocked(readImportBatches).mockResolvedValue([{ id: 'batch-counted', created_at: '', library_id: 'library-file', source_type: 'image', status: 'completed', total: 1, finished: 1, failed: 0, imported: 1, duplicates: 0, items: [{ id: 'item-counted', title: 'notes.pdf', filename: '', relative_path: '', source_url: null, document_id: 'doc-1', attempts: 1, status: 'imported', error: null }] }])
    show()
    await screen.findByRole('heading', { name: '整理好了' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1')
    expect(screen.queryByRole('region', { name: '文件' })).not.toBeInTheDocument()
  })
})
describe('personal welcome', () => {
  it('can skip every step and complete without invented import progress', async () => {
    show()
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    for (const title of ['给它起个名字', '你在这里的样子', '先把你收藏过的东西带进来', '说说你自己', '从一张空白的纸开始']) {
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
    await screen.findByRole('heading', { name: '你在这里的样子' })
    expect(profile.name).toBe('小叶'); expect(profile.speaking_style).toBe('warm')
    first.unmount(); show()
    await screen.findByRole('heading', { name: '你在这里的样子' })
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(screen.getByLabelText('你想叫它什么？')).toHaveValue('小叶'))
  })
  it('keeps upload failure visible and permits retry without moving the step', async () => {
    profile.setup_step = 3
    vi.mocked(importFiles).mockRejectedValue(new Error('文件内容无效'))
    show(); await screen.findByRole('heading', { name: '先把你收藏过的东西带进来' })
    fireEvent.change(screen.getByLabelText('导入 Chrome 书签'), { target: { files: [new File(['bad'], 'bookmarks.html')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('文件内容无效')
    expect(screen.getByRole('heading', { name: '先把你收藏过的东西带进来' })).toBeInTheDocument()
  })
})

describe('setup live imports and persistence', () => {
  it('submits the original four source cards through supported import APIs', async () => {
    profile.setup_step = 3
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
    await waitFor(() => expect(screen.getByRole('button', { name: /B 站公开收藏/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /B 站公开收藏/ }))
    fireEvent.change(screen.getByLabelText('B 站 UID'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: '导入收藏夹' }))
    await waitFor(() => expect(importBilibili).toHaveBeenCalledWith('12345'))
    expect(screen.getByRole('heading', { name: '先把你收藏过的东西带进来' })).toBeVisible()
  })

  it('persists the complete questionnaire and restores the saved step', async () => {
    profile.setup_step = 4
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
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    fireEvent.click(screen.getByRole('button', { name: '伙伴 2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByRole('heading', { name: '先选一位伙伴' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '伙伴 2' }))
    await screen.findByRole('heading', { name: '给它起个名字' })
    expect(saveAgentProfile).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable batch data instead of inventing empty or complete progress', async () => {
    profile.setup_step = 5
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
    profile.setup_step = 5
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
    await screen.findByRole('heading', { name: '你在这里的样子' })
    expect(saveAgentProfile).toHaveBeenCalledWith(expect.objectContaining({ expected_version: 7, name: '新伙伴', color: '#ec8a52', speaking_style: 'curious' }))
  })

  it('locks repeated next clicks while a step is being saved', async () => {
    let finish!: () => void
    vi.mocked(saveAgentProfile).mockImplementation(body => new Promise(resolve => {
      finish = () => { profile = { ...profile, ...body, version: profile.version + 1 } as typeof profile; resolve(profile) }
    }))
    show()
    await screen.findByRole('heading', { name: '先选一位伙伴' })
    const next = screen.getByRole('button', { name: '伙伴 3' })
    fireEvent.click(next)
    fireEvent.click(next)
    expect(saveAgentProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '暂时跳过' })).toBeDisabled()
    await act(async () => finish())
    await screen.findByRole('heading', { name: '给它起个名字' })
  })

  it('uses actual processing totals and permits entering while imports continue', async () => {
    profile.setup_step = 5
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
