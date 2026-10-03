import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type PropsWithChildren } from 'react'
import { importBilibili, importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
import { ImportsPage } from './ImportsPage'

vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/knowledge-import', () => ({ readImportBatches: vi.fn(), importFiles: vi.fn(), importBilibili: vi.fn(), retryImport: vi.fn() }))
beforeEach(() => { vi.mocked(readImportBatches).mockResolvedValue([]); vi.mocked(importBilibili).mockResolvedValue({} as never) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ImportsPage userId="owner" /></MemoryRouter></QueryClientProvider>)
}

it('keeps all nine compact sources and puts upload before history', async () => {
  const { container } = mount()
  expect(within(container.querySelector('[aria-label="导入来源"]')!).getAllByRole('button')).toHaveLength(9)
  const upload = screen.getByLabelText('选择文件')
  const history = screen.getByRole('region', { name: '导入记录' })
  expect(upload.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('link', { name: '下载扩展' })).toHaveAttribute('href', '/downloads/everplain-clipper.zip')
  fireEvent.click(screen.getByRole('button', { name: 'Obsidian / Markdown' }))
  expect(screen.getByLabelText('或选择整个文件夹')).toHaveAttribute('webkitdirectory')
  expect(screen.getByLabelText('选择文件')).toHaveAttribute('accept', '.md,.markdown,.txt,.zip')
  await screen.findByText('还没有导入记录。')
})

it('uploads the selected source and retains Bilibili UID submission', async () => {
  vi.mocked(importFiles).mockResolvedValue({ total: 1 } as never)
  mount()
  fireEvent.click(screen.getByRole('button', { name: '图片与截图' }))
  const image = new File(['image'], 'scan.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [image] } })
  await waitFor(() => expect(importFiles).toHaveBeenCalledWith('image', [image]))
  await screen.findByText('已接收 1 条资料，正在后台导入')
  fireEvent.click(screen.getByRole('button', { name: 'B 站公开收藏' }))
  fireEvent.change(screen.getByLabelText('公开账户 UID'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '读取公开收藏' }))
  await waitFor(() => expect(importBilibili).toHaveBeenCalledWith('123456'))
})

it('retains failed-item retry and the destination library in history', async () => {
  vi.mocked(readImportBatches).mockResolvedValue([{ id: 'batch-1', library_id: 'kb-1', source_type: 'chrome', status: 'completed', total: 1, finished: 1, imported: 0, duplicates: 0, failed: 1, items: [{ id: 'item-1', title: '失效网页', status: 'failed', error: '需要登录' }] }] as never)
  vi.mocked(retryImport).mockResolvedValue({} as never)
  mount()
  fireEvent.click(await screen.findByText('查看条目'))
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(retryImport).toHaveBeenCalledWith('batch-1', 'item-1'))
  expect(screen.getByRole('link', { name: '打开资料库' })).toHaveAttribute('href', '/library?kb_id=kb-1')
})
