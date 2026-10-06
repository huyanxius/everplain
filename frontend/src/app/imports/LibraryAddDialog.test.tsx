import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { importBilibili, importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
import { createCourse, getCourse, readKnowledgeStorage, uploadCourseDocument, type SharedCourse, type SharedDocument } from '../../modules/shared-knowledge'
import { LibraryAddDialog, type LibraryAddDialogProps } from './LibraryAddDialog'

vi.mock('../../modules/knowledge-import', async importOriginal => ({ ...await importOriginal<typeof import('../../modules/knowledge-import')>(), readImportBatches: vi.fn(), importFiles: vi.fn(), importBilibili: vi.fn(), retryImport: vi.fn() }))
vi.mock('../../modules/shared-knowledge', () => ({ COURSE_DOCUMENT_ACCEPT: '.pdf,.docx,.pptx,.txt,.md,.markdown', createCourse: vi.fn(), getCourse: vi.fn(), readKnowledgeStorage: vi.fn(), uploadCourseDocument: vi.fn() }))
vi.mock('../ui/AgentLoading', () => ({ AgentLoading: ({ message }: { message: string }) => <p>{message}</p> }))
const descriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
const library: SharedCourse = { id: 'owned', name: '研究资料', description: null, access: 'owner', sharingEnabled: false, shareToken: null, readyDocumentCount: 0, documents: [] }
const reader: SharedCourse = { ...library, id: 'reader', name: '共享资料', access: 'reader' }
const quota = { used_bytes: 0, max_bytes: 5 * 1024 ** 3, library_count: 1, max_libraries: 10, max_file_bytes: 20 * 1024 ** 2, max_documents_per_library: 100, max_document_characters: 300000 }
const document: SharedDocument = { id: 'doc', filename: 'notes.md', mediaType: 'text/markdown', sizeBytes: 4, parseId: 'parse', status: 'processing', knowledgeStatus: 'queued', indexStatus: 'queued', knowledge: null, knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '2026-10-03T00:00:00Z' }
const clients: QueryClient[] = []
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.mocked(readKnowledgeStorage).mockResolvedValue(quota)
  vi.mocked(readImportBatches).mockResolvedValue([])
  vi.mocked(getCourse).mockResolvedValue(library)
  vi.mocked(uploadCourseDocument).mockResolvedValue(document)
  vi.mocked(importFiles).mockResolvedValue({ id: 'batch', total: 1, finished: 0, imported: 0, updated: 0, duplicates: 0, failed: 0, status: 'processing', items: [] } as never)
  vi.mocked(importBilibili).mockResolvedValue({} as never)
})
afterEach(() => {
  cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.resetAllMocks()
  for (const key of ['showModal', 'close']) { if (descriptors[key]) Object.defineProperty(HTMLDialogElement.prototype, key, descriptors[key]); else Reflect.deleteProperty(HTMLDialogElement.prototype, key) }
})
function mount(overrides: Partial<LibraryAddDialogProps> = {}) {
  const props = { userId: 'owner', libraries: [library, reader], onClose: vi.fn(), onChanged: vi.fn(), ...overrides }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const view = (values: LibraryAddDialogProps) => <QueryClientProvider client={client}><MemoryRouter><LibraryAddDialog {...values} /></MemoryRouter></QueryClientProvider>
  const result = render(view(props))
  return { ...result, props, rerenderDialog: (values: Partial<LibraryAddDialogProps>) => result.rerender(view({ ...props, ...values })) }
}
async function filesInput() { const input = screen.getByLabelText('选择文件'); await waitFor(() => expect(input).not.toBeDisabled()); return input }
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

it('defaults to extension with all nine imports plus files in three groups, and an accurate reusable ZIP guide', async () => {
  mount()
  const nav = screen.getByRole('navigation', { name: '资料来源' })
  expect(within(nav).getAllByRole('button')).toHaveLength(12)
  for (const title of ['随手收', '上传', '从其他应用导入']) expect(within(nav).getByText(title)).toBeVisible()
  expect(within(nav).getByRole('button', { name: '浏览器扩展推荐' })).toHaveAttribute('aria-current', 'true')
  expect(screen.getByRole('button', { name: '下载扩展' })).toHaveAttribute('aria-haspopup', 'dialog')
  expect(screen.queryByText('添加到 Chrome')).not.toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Apple 备忘录' }).querySelector('img')).toBeNull()
  const trigger = screen.getByRole('button', { name: '安装教程' }); fireEvent.click(trigger)
  const guide = screen.getByRole('region', { name: '安装 Everplain 收藏助手' })
  fireEvent.click(within(guide).getByText('手动安装、权限与常见问题'))
  expect(within(guide).getAllByText('chrome://extensions')[0]).toBeVisible()
  expect(within(guide).getByRole('link', { name: 'e.qunxue.xyz' })).toHaveAttribute('href', 'https://e.qunxue.xyz')
  expect(within(guide).getByText(/只收藏网页无需开启书签权限/)).toBeVisible()
  expect(within(guide).getByText(/已提交.*不代表全部入库/)).toBeVisible()
  fireEvent.click(within(guide).getByRole('button', { name: '收起教程' })); expect(trigger).toHaveFocus()
  expect(createCourse).not.toHaveBeenCalled()
  await waitFor(() => expect(readKnowledgeStorage).toHaveBeenCalled())
})

it('queues actual files, locks dismissal and repeated upload during a request, and uploads to the owner target', async () => {
  const first = pending<SharedDocument>(); vi.mocked(uploadCourseDocument).mockReturnValueOnce(first.promise)
  const { props } = mount({ initialSource: 'file', initialLibraryId: 'reader' })
  const select = screen.getByRole('combobox', { name: '放进哪个知识库' })
  expect(within(select).getAllByRole('option')).toHaveLength(1); expect(select).toHaveValue('owned')
  const file = new File(['one'], 'one.md', { type: 'text/markdown' }); const next = new File(['two'], 'two.pdf', { type: 'application/pdf' })
  fireEvent.change(await filesInput(), { target: { files: [file, next] } })
  await waitFor(() => expect(uploadCourseDocument).toHaveBeenCalledWith('owned', file))
  const queue = screen.getByRole('list', { name: '上传队列' }); expect(within(queue).getByText('two.pdf')).toBeVisible(); expect(within(queue).getByText('排队中')).toBeVisible()
  expect(screen.getByRole('progressbar', { name: 'one.md 上传中' })).not.toHaveAttribute('value')
  expect(screen.getByRole('button', { name: '关闭添加资料' })).toBeDisabled()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(props.onClose).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } }); expect(uploadCourseDocument).toHaveBeenCalledTimes(1)
  await act(async () => first.resolve(document))
  await screen.findByText('资料已上传，正在后台建立语义索引并整理知识。')
  expect(uploadCourseDocument).toHaveBeenCalledTimes(2); expect(props.onChanged).toHaveBeenCalledTimes(2)
  expect(within(queue).getAllByText('已上传')).toHaveLength(2)
  for (const link of within(queue).getAllByRole('link', { name: '查看处理状态' })) expect(link).toHaveAttribute('href', '/library?kb_id=owned')
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(props.onClose).toHaveBeenCalledOnce()
})

it('keeps per-file failures and retries only the failed file', async () => {
  vi.mocked(uploadCourseDocument).mockRejectedValueOnce(new Error('连接中断'))
  mount({ initialSource: 'file' })
  const failed = new File(['x'], 'failed.txt'); const good = new File(['y'], 'good.txt')
  fireEvent.change(await filesInput(), { target: { files: [failed, good] } })
  await screen.findByText(/1 份资料上传或解析失败/)
  expect(screen.getByText(/连接中断/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重试上传' }))
  await waitFor(() => expect(uploadCourseDocument).toHaveBeenCalledTimes(3))
  expect(vi.mocked(uploadCourseDocument).mock.calls[2]).toEqual(['owned', failed])
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument())
})

it('uses live limits and validates each file rather than inventing success or progress', async () => {
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ ...quota, max_file_bytes: 2, max_documents_per_library: 4 })
  mount({ initialSource: 'file' })
  await waitFor(() => expect(screen.getByText(/单份不超过 2 B，每个知识库最多 4 份/)).toBeVisible())
  fireEvent.change(await filesInput(), { target: { files: [new File(['large'], 'too-large.txt'), new File(['x'], 'good.txt')] } })
  await screen.findByText(/1 份资料上传或解析失败/)
  expect(screen.getByText(/单份资料不能超过 2 B/)).toBeVisible()
  expect(uploadCourseDocument).toHaveBeenCalledTimes(1)
})

it('imports image and folder files without forwarding the file library target', async () => {
  mount({ initialSource: 'image', initialLibraryId: 'owned' })
  const file = new File(['image'], 'scan.png', { type: 'image/png' })
  fireEvent.change(await filesInput(), { target: { files: [file] } })
  await screen.findByText('已接收 1 条资料，正在后台导入')
  expect(importFiles).toHaveBeenCalledWith('image', [file])
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Obsidian / Markdown' }))
  const input = screen.getByLabelText('选择整个文件夹'); expect(input).toHaveAttribute('webkitdirectory')
  const note = new File(['note'], 'notes.md'); Object.defineProperty(note, 'webkitRelativePath', { value: 'vault/notes.md' })
  fireEvent.change(input, { target: { files: [note] } })
  await waitFor(() => expect(importFiles).toHaveBeenCalledWith('obsidian', [note], undefined, expect.objectContaining({ requestKey: expect.any(String), onProgress: expect.any(Function) })))
})

it('enforces actual import limits before submitting oversized files', async () => {
  mount({ initialSource: 'chrome' })
  const file = new File(['bookmarks'], 'bookmarks.html'); Object.defineProperty(file, 'size', { value: 16 * 1024 ** 2 + 1 })
  fireEvent.change(await filesInput(), { target: { files: [file] } })
  await screen.findByText('单个导入文件最多 16 MB，请缩小文件后重试。')
  expect(importFiles).not.toHaveBeenCalled()
})

it('submits only the entered public UID to Bilibili and preserves background acceptance copy', async () => {
  mount({ initialSource: 'bilibili', initialLibraryId: 'owned' })
  const submit = screen.getByRole('button', { name: '读取公开收藏' }); await waitFor(() => expect(submit).not.toBeDisabled())
  fireEvent.change(screen.getByRole('textbox', { name: '公开账户 UID' }), { target: { value: '123456' } }); fireEvent.click(submit)
  await screen.findByText('已开始读取公开收藏，标题与简介会在后台整理')
  expect(importBilibili).toHaveBeenCalledWith('123456')
})

it('shows real batch progress, counts, destination, refresh and item retry', async () => {
  vi.mocked(readImportBatches).mockResolvedValue([{ id: 'batch', library_id: 'my-materials', source_type: 'chrome', status: 'partial', total: 3, finished: 3, imported: 1, duplicates: 1, failed: 1, items: [{ id: 'failed', title: '网页标题', status: 'failed', error: '需要登录' }] }] as never)
  vi.mocked(retryImport).mockResolvedValue({} as never)
  mount({ initialSource: 'records' })
  expect(await screen.findByText('1 条已入库 · 1 条重复 · 1 条待重试')).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '导入进度' })).toHaveAttribute('value', '3')
  expect(screen.getByRole('link', { name: '打开资料库' })).toHaveAttribute('href', '/library?kb_id=my-materials')
  fireEvent.click(screen.getByText('查看条目')); fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(retryImport).toHaveBeenCalledWith('batch', 'failed'))
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).not.toBeDisabled())
  const calls = vi.mocked(readImportBatches).mock.calls.length; fireEvent.click(screen.getByRole('button', { name: '刷新' })); await waitFor(() => expect(readImportBatches).toHaveBeenCalledTimes(calls + 1))
})

it('shows changed-note results and preserved attachments in the focused receipt', async () => {
  vi.mocked(readImportBatches).mockResolvedValue([{ id: 'changed', library_id: 'my-materials', source_type: 'obsidian', status: 'completed', total: 1, finished: 1, imported: 0, updated: 1, duplicates: 0, failed: 0, attachment_count: 1, items: [{ id: 'note', title: 'Updated note', status: 'updated', attachments: [{ id: 'asset', filename: 'photo.png', relative_path: 'Vault/photo.png', media_type: 'image/png', size_bytes: 1024, references: ['photo.png'], url: '/api/imports/assets/doc/attachments/asset' }] }] }] as never)
  mount({ initialSource: 'records', initialBatchId: 'changed' })
  expect(await screen.findByText('0 条已入库 · 0 条重复 · 1 条已更新 · 1 个附件')).toBeVisible()
  fireEvent.click(screen.getByText('查看条目'))
  expect(screen.getByText('已更新')).toBeVisible()
  expect(screen.getByRole('link', { name: 'photo.png' })).toHaveAttribute('href', '/api/imports/assets/doc/attachments/asset')
  expect(globalThis.document.getElementById('library-import-changed')?.firstElementChild).toHaveAttribute('data-current', 'true')
})

it('only creates a missing personal library when files are chosen', async () => {
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ ...quota, library_count: 0 })
  const personal = { ...library, id: 'new', name: '我的资料' }; vi.mocked(createCourse).mockResolvedValue(personal); vi.mocked(getCourse).mockResolvedValue(personal)
  mount({ initialSource: 'file', libraries: [] })
  expect(screen.getByText('上传时将创建「我的资料」知识库')).toBeVisible(); expect(createCourse).not.toHaveBeenCalled()
  const file = new File(['note'], 'note.md'); fireEvent.change(await filesInput(), { target: { files: [file] } })
  await screen.findByText('资料已上传，正在后台建立语义索引并整理知识。')
  expect(createCourse).toHaveBeenCalledWith({ name: '我的资料', description: '' }); expect(uploadCourseDocument).toHaveBeenCalledWith('new', file)
})

it('blocks a full library and handles unavailable quota with a retry', async () => {
  vi.mocked(readKnowledgeStorage).mockRejectedValue(new Error('offline'))
  mount({ initialSource: 'file' })
  expect(await screen.findByRole('button', { name: '重试读取用量' })).toBeVisible(); expect(screen.getByLabelText('选择文件')).toBeDisabled()
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ ...quota, max_documents_per_library: 0 })
  fireEvent.click(screen.getByRole('button', { name: '重试读取用量' }))
  await screen.findByText('当前知识库已满，请选择其他知识库。'); expect(screen.getByLabelText('选择文件')).toBeDisabled()
})

it('stops subsequent uploads after an account change and discards the prior account queue', async () => {
  const first = pending<SharedDocument>(); vi.mocked(uploadCourseDocument).mockReturnValueOnce(first.promise)
  const { rerenderDialog } = mount({ initialSource: 'file' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['a'], 'private-a.md'), new File(['b'], 'private-b.md')] } })
  await waitFor(() => expect(uploadCourseDocument).toHaveBeenCalledOnce())
  rerenderDialog({ userId: 'another', libraries: [], initialSource: 'extension' })
  expect(screen.queryByText('private-a.md')).not.toBeInTheDocument()
  await act(async () => first.resolve(document)); expect(uploadCourseDocument).toHaveBeenCalledOnce()
})

it('restores focus and scroll after dismissal and permits keyboard file picking', async () => {
  const trigger = globalThis.document.createElement('button'); globalThis.document.body.append(trigger); trigger.focus(); globalThis.document.body.style.overflow = 'auto'
  const { unmount } = mount({ initialSource: 'file' })
  const input = await filesInput(); const click = vi.spyOn(input, 'click')
  fireEvent.keyDown(screen.getByRole('button', { name: /选择PDF/ }), { key: 'Enter' }); expect(click).toHaveBeenCalledOnce()
  expect(globalThis.document.body.style.overflow).toBe('hidden'); unmount(); expect(trigger).toHaveFocus(); expect(globalThis.document.body.style.overflow).toBe('auto'); trigger.remove()
})

it('reads dropped Obsidian folders in batches, keeps paths and attachments, and locks dismissal while reading', async () => {
  mount({ initialSource: 'obsidian' })
  await filesInput()
  const file = new File(['note'], 'note.md'); const attachment = new File(['image'], 'scan.png')
  const first = pending<FileSystemEntry[]>()
  const readEntries = vi.fn().mockImplementationOnce((resolve: (entries: FileSystemEntry[]) => void) => { void first.promise.then(resolve) }).mockImplementationOnce((resolve: (entries: FileSystemEntry[]) => void) => resolve([]))
  const directory = { name: 'vault', isDirectory: true, isFile: false, createReader: () => ({ readEntries }) }
  const ferry = screen.getByRole('button', { name: /选择Markdown/ })
  fireEvent.drop(ferry, { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => directory }] } })
  expect(screen.getByRole('button', { name: '关闭添加资料' })).toBeDisabled()
  await act(async () => first.resolve([{ isFile: true, name: 'note.md', file: (resolve: (file: File) => void) => resolve(file) }, { isFile: true, name: 'scan.png', file: (resolve: (file: File) => void) => resolve(attachment) }] as unknown as FileSystemEntry[]))
  await waitFor(() => expect(importFiles).toHaveBeenCalledWith('obsidian', [file, attachment], undefined, expect.objectContaining({ requestKey: expect.any(String), onProgress: expect.any(Function) })))
  expect(file.webkitRelativePath).toBe('vault/note.md'); expect(attachment.webkitRelativePath).toBe('vault/scan.png')
})

it('polls a processing import until the server reports completion', async () => {
  const batch = { id: 'progress', library_id: 'owned', source_type: 'chrome', status: 'processing', total: 2, finished: 0, imported: 0, duplicates: 0, failed: 0, items: [] }
  vi.mocked(readImportBatches).mockResolvedValueOnce([batch] as never).mockResolvedValue([{ ...batch, status: 'completed', finished: 2, imported: 2 }] as never)
  const { props } = mount({ initialSource: 'records' })
  await screen.findByText('正在整理导入的资料…')
  await screen.findByText('2 条已入库 · 0 条重复', {}, { timeout: 2500 })
  expect(screen.queryByText('正在整理导入的资料…')).not.toBeInTheDocument(); expect(props.onChanged).toHaveBeenCalled()
})

it('does not read account data while signed out or create a library when the quota is full', async () => {
  const { rerenderDialog } = mount({ userId: null, initialSource: 'file', libraries: [] })
  expect(screen.getByText('请先登录，再添加资料。')).toBeVisible(); expect(readKnowledgeStorage).not.toHaveBeenCalled(); expect(readImportBatches).not.toHaveBeenCalled()
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ ...quota, library_count: 10 })
  rerenderDialog({ userId: 'owner', libraries: [], initialSource: 'file' })
  await screen.findByText('知识库数量已达上限，请先整理已有知识库。'); expect(screen.getByLabelText('选择文件')).toBeDisabled(); expect(createCourse).not.toHaveBeenCalled()
})

it.each(['ready', 'failed'] as const)('routes a %s upload to an available view', async status => {
  vi.mocked(uploadCourseDocument).mockResolvedValue({ ...document, status, errorMessage: status === 'failed' ? '无法解析' : null })
  mount({ initialSource: 'file' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['note'], 'note.md')] } })
  const label = status === 'ready' ? '打开' : '查看处理状态'
  const link = await screen.findByRole('link', { name: label })
  expect(link).toHaveAttribute('href', status === 'ready' ? '/library?kb_id=owned&document_id=doc' : '/library?kb_id=owned')
  if (status === 'failed') expect(screen.getByRole('button', { name: '重新上传' })).toBeVisible()
})

it('restores focus to the stable scope switcher when the empty-state trigger disappeared after upload', async () => {
  const scope = globalThis.document.createElement('span'); scope.className = 'ep-library-scope'
  const scopeButton = globalThis.document.createElement('button'); scopeButton.setAttribute('aria-controls', 'library-scope-menu'); scopeButton.textContent = '全部资料'; scope.append(scopeButton)
  const trigger = globalThis.document.createElement('button'); trigger.textContent = '上传第一份资料'
  globalThis.document.body.append(scope, trigger); trigger.focus()
  const { unmount } = mount({ initialSource: 'file' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['note'], 'note.md')] } })
  await screen.findByText('资料已上传，正在后台建立语义索引并整理知识。')
  trigger.remove(); unmount(); expect(scopeButton).toHaveFocus(); scope.remove()
})

it('shows real upload bytes, names the failure stage and retries the same idempotent batch', async () => {
  let reject!: (reason: Error) => void
  vi.mocked(importFiles).mockImplementationOnce(async (_source, _files, _library, options) => {
    options?.onProgress?.({ stage: 'uploading', loaded: 256, total: 1024 })
    return new Promise((_resolve, fail) => { reject = fail })
  })
  mount({ initialSource: 'obsidian' })
  const files = [new File(['# A'], 'A.md'), new File(['# B'], 'B.md'), new File(['# C'], 'C.md')]
  fireEvent.change(await filesInput(), { target: { files } })
  await screen.findByText('上传中：256 B / 1 KB')
  expect(screen.getByRole('progressbar', { name: '上传字节进度' })).toHaveAttribute('value', '256')
  const firstOptions = vi.mocked(importFiles).mock.calls[0][3]
  await act(async () => reject(new Error('服务器未能完成导入请求（HTTP 500）。')))
  expect(await screen.findByRole('alert')).toHaveTextContent('上传阶段失败')
  expect(screen.getByText(/3 项接收结果待确认/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重试本批上传' }))
  await waitFor(() => expect(importFiles).toHaveBeenCalledTimes(2))
  expect(vi.mocked(importFiles).mock.calls[1][3]?.requestKey).toBe(firstOptions?.requestKey)
  expect(vi.mocked(importFiles).mock.calls[1][1]).toEqual(files)
})

it('shows server success and failure counts and retries only failed items', async () => {
  const batch = { id: 'tracked', total: 3, finished: 3, imported: 1, updated: 0, duplicates: 1, failed: 1, status: 'partial', items: [{ id: 'good', title: 'A', status: 'imported' }, { id: 'old', title: 'B', status: 'duplicate' }, { id: 'bad', title: 'C', status: 'failed', error: '合成解析错误' }] } as never
  vi.mocked(importFiles).mockResolvedValue(batch)
  vi.mocked(readImportBatches).mockResolvedValue([batch])
  vi.mocked(retryImport).mockResolvedValue({ ...batch as object, status: 'processing', failed: 0, finished: 2 } as never)
  mount({ initialSource: 'obsidian' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['# A'], 'A.md')] } })
  const region = await screen.findByRole('region', { name: '本次导入处理进度' })
  expect(within(region).getByText(/成功 2 篇/)).toHaveTextContent('失败 1 篇')
  expect(within(region).getByText('C：合成解析错误')).toBeVisible()
  fireEvent.click(within(region).getByRole('button', { name: '仅重试失败的 1 篇' }))
  await waitFor(() => expect(retryImport).toHaveBeenCalledWith('tracked', 'bad'))
  expect(retryImport).toHaveBeenCalledOnce(); expect(importFiles).toHaveBeenCalledOnce()
})

it('aborts an in-flight Vault upload on account change and drops its retained files', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(importFiles).mockImplementationOnce(async (_source, _files, _library, options) => {
    signal = options?.signal
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))))
  })
  const { rerenderDialog } = mount({ initialSource: 'obsidian' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['# A'], 'private-local-name.md')] } })
  await waitFor(() => expect(importFiles).toHaveBeenCalledOnce())
  await act(async () => rerenderDialog({ userId: 'another-owner' }))
  expect(signal?.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: '重试本批上传' })).not.toBeInTheDocument()
  expect(screen.queryByText(/private-local-name/)).not.toBeInTheDocument()
})

it('keeps the confirmed requeued progress when the following status refresh fails', async () => {
  const batch = { id: 'requeued', total: 3, finished: 3, imported: 2, updated: 0, duplicates: 0, failed: 1, status: 'partial', items: [{ id: 'bad', title: 'C', status: 'failed', error: 'temporary' }] } as never
  vi.mocked(importFiles).mockResolvedValue(batch)
  vi.mocked(readImportBatches).mockResolvedValue([batch])
  vi.mocked(retryImport).mockImplementation(async () => {
    vi.mocked(readImportBatches).mockRejectedValue(new Error('synthetic refresh unavailable'))
    return { ...batch as object, finished: 2, failed: 0, status: 'processing', items: [{ id: 'bad', title: 'C', status: 'queued' }] } as never
  })
  mount({ initialSource: 'obsidian' })
  fireEvent.change(await filesInput(), { target: { files: [new File(['# C'], 'C.md')] } })
  fireEvent.click(await screen.findByRole('button', { name: '仅重试失败的 1 篇' }))
  await screen.findByText('服务器处理：2 / 3 篇')
  expect(await screen.findByText(/暂时无法读取最新处理状态/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '仅重试失败的 1 篇' })).not.toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: '服务器处理进度' })).toHaveAttribute('value', '2')
})

it('replays a previously uncertain batch even when its accepted contents may have filled storage', async () => {
  vi.mocked(importFiles).mockRejectedValueOnce(new Error('synthetic response lost'))
  mount({ initialSource: 'obsidian' })
  const files = [new File(['# A'], 'A.md')]
  fireEvent.change(await filesInput(), { target: { files } })
  const retry = await screen.findByRole('button', { name: '重试本批上传' })
  const key = vi.mocked(importFiles).mock.calls[0][3]?.requestKey
  vi.mocked(readKnowledgeStorage).mockResolvedValue({ ...quota, used_bytes: quota.max_bytes })
  fireEvent.click(retry)
  await waitFor(() => expect(importFiles).toHaveBeenCalledTimes(2))
  expect(vi.mocked(importFiles).mock.calls[1][3]?.requestKey).toBe(key)
})
