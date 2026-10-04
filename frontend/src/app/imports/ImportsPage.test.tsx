import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type PropsWithChildren } from 'react'
import { importBilibili, importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
import { ImportsPage } from './ImportsPage'

vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/knowledge-import', () => ({ readImportBatches: vi.fn(), importFiles: vi.fn(), importBilibili: vi.fn(), retryImport: vi.fn() }))
const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
const closeDialog = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
beforeEach(() => {
  vi.mocked(readImportBatches).mockResolvedValue([])
  vi.mocked(importBilibili).mockResolvedValue({} as never)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: closeDialog })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  for (const key of ['showModal', 'close']) {
    if (dialogMethods[key]) Object.defineProperty(HTMLDialogElement.prototype, key, dialogMethods[key])
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
})
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ImportsPage userId="owner" /></MemoryRouter></QueryClientProvider>)
}

it('keeps all nine compact sources and puts upload before history', async () => {
  const { container } = mount()
  expect(within(container.querySelector('[aria-label="导入来源"]')!).getAllByRole('button')).toHaveLength(9)
  const upload = screen.getByLabelText('选择文件')
  const history = screen.getByRole('region', { name: '导入记录' })
  expect(upload.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('button', { name: '下载扩展' })).toHaveAttribute('aria-haspopup', 'dialog')
  expect(screen.queryByRole('link', { name: /下载/ })).not.toBeInTheDocument()
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


it('keeps the main guide to four steps and permission help collapsed', async () => {
  mount()
  const trigger = screen.getByRole('button', { name: '安装教程' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('region', { name: '安装 Everplain 收藏助手' })).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const guide = screen.getByRole('region', { name: '安装 Everplain 收藏助手' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(trigger).toHaveAttribute('aria-controls', guide.id)
  expect(within(guide).getAllByRole('listitem')).toHaveLength(4)
  expect(within(guide).getByRole('link', { name: 'e.qunxue.xyz' })).toHaveAttribute('href', 'https://e.qunxue.xyz')
  expect(within(guide).getByText(/尚未上架商店/)).toBeVisible()
  const details = within(guide).getByText('手动安装、权限与常见问题').closest('details')!
  expect(details).not.toHaveAttribute('open')
  expect(within(details).getByText(/只收藏网页无需开启书签权限/)).not.toBeVisible()
  fireEvent.click(within(guide).getByText('手动安装、权限与常见问题'))
  expect(details).toHaveAttribute('open')
  expect(within(details).getByText('chrome://extensions')).toBeVisible()
  expect(within(details).getByText('edge://extensions')).toBeVisible()
  expect(within(details).getByText(/只收藏网页无需开启书签权限/)).toBeVisible()
  expect(within(details).getByText(/不代表全部入库/)).toBeVisible()
  expect(within(details).getByRole('link', { name: '查看 Chrome 官方加载说明' })).toHaveAttribute('rel', 'noreferrer')
  expect(within(guide).getByRole('link', { name: '下载扩展 ZIP' })).toHaveAttribute('href', '/downloads/everplain-clipper.zip')
  fireEvent.click(within(guide).getByRole('button', { name: '收起教程' }))
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  fireEvent.click(trigger)
  expect(screen.queryByRole('region', { name: '安装 Everplain 收藏助手' })).not.toBeInTheDocument()
  expect(importFiles).not.toHaveBeenCalled()
  expect(importBilibili).not.toHaveBeenCalled()
  await screen.findByText('还没有导入记录。')
})

it.each(['macOS', 'Windows'])('shows %s directory guidance without gating the ZIP download', async label => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: '下载扩展' }))
  const dialog = screen.getByRole('dialog', { name: '下载 Everplain 收藏助手' })
  expect(dialog).toHaveFocus()
  expect(within(dialog).getByRole('link', { name: '下载扩展 ZIP' })).toHaveAttribute('href', '/downloads/everplain-clipper.zip')
  fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(label) }))
  expect(within(dialog).getByText(label === 'macOS' ? /Option\+Command\+C/ : /Ctrl\+L、Ctrl\+C/)).toBeVisible()
  expect(within(dialog).queryByRole('link', { name: /准备工具/ })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: '下载扩展 ZIP' })).toHaveAttribute('download')
  await screen.findByText('还没有导入记录。')
})

it.each([
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macOS', 'Windows'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows', 'macOS'],
])('uses %s only as a recommendation and permits the other system', async (userAgent, recommended, other) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  mount()
  fireEvent.click(screen.getByRole('button', { name: '下载扩展' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: new RegExp(`${recommended}\\s*可能适合此设备`) })).toHaveAttribute('aria-pressed', 'false')
  expect(within(dialog).getByRole('button', { name: other })).toHaveAttribute('aria-pressed', 'false')
  expect(within(dialog).queryByRole('link', { name: /准备工具/ })).not.toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: other }))
  expect(within(dialog).getByRole('link', { name: '下载扩展 ZIP' })).toBeVisible()
  expect(download).not.toHaveBeenCalled()
  await screen.findByText('还没有导入记录。')
})

it('restores trigger focus on cancel and asks for a fresh selection when reopened', async () => {
  mount()
  const trigger = screen.getByRole('button', { name: '下载扩展' })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: /macOS/ }))
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(document.body.style.overflow).not.toBe('hidden')
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toHaveFocus()
  expect(screen.getByRole('link', { name: '下载扩展 ZIP' })).toBeVisible()
  expect(screen.getByRole('button', { name: /macOS/ })).toHaveAttribute('aria-pressed', 'false')
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(screen.getByRole('dialog'), cancel)
  expect(cancel.defaultPrevented).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(closeDialog).toHaveBeenCalledTimes(2)
  await screen.findByText('还没有导入记录。')
})

it('keeps the native Escape dismissal mounted and inert through its exit motion', async () => {
  const originalStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = originalStyle(element)
    if (element.tagName === 'DIALOG') {
      style.transitionProperty = 'opacity, transform'
      style.transitionDuration = '0.14s, 0.14s'
      style.transitionDelay = '0s'
    }
    return style
  })
  mount()
  const trigger = screen.getByRole('button', { name: '下载扩展' })
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(dialog, cancel)
  expect(cancel.defaultPrevented).toBe(true)
  expect(dialog).toHaveAttribute('open')
  expect(dialog).toHaveAttribute('inert')
  expect(dialog).toHaveAttribute('data-presence', 'closing')
  expect(closeDialog).not.toHaveBeenCalled()
  const transition = new Event('transitionend', { bubbles: true })
  Object.assign(transition, { propertyName: 'opacity', pseudoElement: '' })
  fireEvent(dialog, transition)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  await screen.findByText('还没有导入记录。')
})

it('offers a manual ZIP without selecting a system and keeps security guidance', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)')
  mount()
  fireEvent.click(screen.getByRole('button', { name: '下载扩展' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByText('可能适合此设备')).not.toBeInTheDocument()
  const fallback = within(dialog).getByRole('link', { name: '下载扩展 ZIP' })
  expect(fallback).toHaveAttribute('href', '/downloads/everplain-clipper.zip')
  expect(fallback).toHaveAttribute('download')
  expect(within(dialog).getByText(/受管理的浏览器/)).toBeVisible()
  expect(within(dialog).getByText(/在浏览器地址栏输入/)).toHaveTextContent('开发者模式')
  await screen.findByText('还没有导入记录。')
})
