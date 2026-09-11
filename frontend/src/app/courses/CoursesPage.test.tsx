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
vi.mock('./CourseShader', () => ({ CourseShader: () => null }))

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
