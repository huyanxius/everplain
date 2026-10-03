import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest'
import { CoursesPage } from './CoursesPage'

const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterAll(() => {
  for (const key of ['showModal', 'close']) {
    if (dialogMethods[key]) Object.defineProperty(HTMLDialogElement.prototype, key, dialogMethods[key])
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
})

vi.mock('../../modules/account', () => ({ useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { displayName: '研究者' } } } }) }))
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const course = { id: 'kb-1', name: 'Product research', description: 'My sources', viewer_access: 'owner', sharing_enabled: false, documents: [], ready_document_count: 0 }

it('creates a private library without role selection or sharing', async () => {
  let saved = false
  vi.stubGlobal('fetch', async (input: Request) => {
    if (input.method === 'POST') { saved = true; return json(course) }
    if (input.url.endsWith('/kb-1')) return json(course)
    return json({ items: saved ? [course] : [] })
  })
  render(<MemoryRouter initialEntries={['/library']}><CoursesPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '新建知识库' }))
  fireEvent.change(screen.getByLabelText('知识库名称'), { target: { value: 'Product research' } })
  fireEvent.click(screen.getByRole('button', { name: '保存知识库' }))
  expect(await screen.findByRole('heading', { name: 'Product research' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '上传资料' })).toBeInTheDocument()
  expect(screen.queryByText('我是教师')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '开启分享' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '基于本库研究' })).toHaveAttribute('href', '/agent?reference_knowledge_base_id=kb-1')
})

it('hides foreign libraries even when returned by an old service', async () => {
  vi.stubGlobal('fetch', async () => json({ items: [{ ...course, viewer_access: 'reader' }] }))
  render(<MemoryRouter initialEntries={['/library']}><CoursesPage /></MemoryRouter>)
  expect(await screen.findByText('创建你的第一个知识库')).toBeInTheDocument()
  expect(screen.queryByText('Product research')).not.toBeInTheDocument()
})

it('shows independent processing stages and the personal knowledge graph', async () => {
  vi.stubGlobal('fetch', async (input: Request) => {
    if (input.url.endsWith('/course-profile')) return json({ role: 'teacher' })
    if (input.url.endsWith('/kb-1')) return json({ ...course, documents: [{
      id: 'd1', filename: '课件.pptx', media_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size_bytes: 100, parse_id: 'p1', status: 'ready', created_at: '2026-09-08',
      knowledge_status: 'running', index_status: 'failed', index_error: '语义索引暂不可用',
    }] })
    return json({ items: [course] })
  })
  render(<MemoryRouter initialEntries={['/library?kb_id=kb-1']}><CoursesPage /></MemoryRouter>)
  expect(await screen.findByText('知识整理中')).toBeInTheDocument()
  expect(screen.getByText('语义索引失败')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '浏览知识与关系' })).toHaveAttribute('href', '/library/knowledge?kb_id=kb-1')
  expect(screen.getByRole('button', { name: '重试处理 课件.pptx' })).toBeInTheDocument()
})

it('requires explicit library deletion and lets the owner cancel', async () => {
  const deleted = vi.fn()
  vi.stubGlobal('fetch', async (input: Request) => {
    if (input.url.endsWith('/course-profile')) return json({ role: 'owner', guide_dismissed: true })
    if (input.method === 'DELETE') { deleted(); return new Response(null, { status: 204 }) }
    return json(input.url.endsWith('/kb-1') ? course : { items: [course] })
  })
  render(<MemoryRouter initialEntries={['/library?kb_id=kb-1']}><CoursesPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '删除知识库' }))
  expect(await screen.findByRole('dialog', { name: '删除知识库？' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保留知识库' }))
  expect(deleted).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1))
})

it('finishes the remaining uploads and reports a failed file without losing the batch', async () => {
  let uploads = 0
  vi.stubGlobal('fetch', async (input: Request) => {
    if (input.url.endsWith('/course-profile')) return json({ role: 'owner', guide_dismissed: true })
    if (input.method === 'POST') {
      uploads++
      if (uploads === 1) throw new TypeError('network unavailable')
      return json({ id: 'doc-2', filename: 'second.txt', status: 'ready', size_bytes: 6 })
    }
    return json(input.url.endsWith('/kb-1') ? course : { items: [course] })
  })
  const { container } = render(<MemoryRouter initialEntries={['/library?kb_id=kb-1']}><CoursesPage /></MemoryRouter>)
  await screen.findByRole('button', { name: '上传资料' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')] } })
  await waitFor(() => expect(uploads).toBe(2))
  expect(await screen.findByRole('status')).toHaveTextContent('1 份资料上传或解析失败')
})

it('uses real document cards as the primary view and retains secondary library management', async () => {
  const doc = { id: 'd1', filename: '城市空间.pdf', media_type: 'application/pdf', size_bytes: 100, parse_id: 'p1', status: 'ready', created_at: '2026-09-08', knowledge_status: 'ready', index_status: 'ready', knowledge: { summary: '可追溯的研究摘要', topics: [{ title: '邻里关系', summary: '交往', segment_ids: ['s1'] }], relations: [] } }
  vi.stubGlobal('fetch', async (input: Request) => json(input.url.endsWith('/kb-1') ? { ...course, documents: [doc] } : { items: [{ ...course, ready_document_count: 1 }] }))
  render(<MemoryRouter initialEntries={['/library']}><CoursesPage /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: '城市空间.pdf' })).toHaveAttribute('href', '/library?kb_id=kb-1&document_id=d1')
  expect(screen.getByText('可追溯的研究摘要')).toBeInTheDocument()
  expect(screen.getByText(/1 个知识点/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '打开知识库 Product research' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索资料' }), { target: { value: '邻里关系' } })
  expect(screen.getByRole('link', { name: '城市空间.pdf' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索资料' }), { target: { value: '无结果' } })
  expect(screen.getByText('没有找到相关资料')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '管理知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '打开知识库 Product research' }))
  expect(await screen.findByRole('button', { name: '上传资料' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '编辑知识库' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '删除 城市空间.pdf' })).toBeInTheDocument()
})

it('does not expose documents if a library detail loses owner access', async () => {
  vi.stubGlobal('fetch', async (input: Request) => json(input.url.endsWith('/kb-1') ? { ...course, viewer_access: 'reader', documents: [{ id: 'foreign', filename: '不可访问.pdf', status: 'ready' }] } : { items: [course] }))
  render(<MemoryRouter initialEntries={['/library']}><CoursesPage /></MemoryRouter>)
  expect(await screen.findByText(/部分资料暂时无法读取/)).toBeInTheDocument()
  expect(screen.queryByText('不可访问.pdf')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重试读取资料' })).toBeInTheDocument()
})
