import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getCourse, listCourses, readKnowledgeStorage, type SharedCourse } from '../../modules/shared-knowledge'
import { KnowledgePage, KnowledgePageHead } from './KnowledgeLayout'
import { LegacyLibraryKnowledgeRoute, LibraryGraphPage } from './LibraryGraphPage'
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/shared-knowledge', () => ({ getCourse: vi.fn(), listCourses: vi.fn(), readKnowledgeStorage: vi.fn() }))
vi.mock('../personal-graph/PersonalGraphPage', () => ({ PersonalGraphPage: () => <KnowledgePage><KnowledgePageHead title="图谱"><input aria-label="搜索我的图谱" /></KnowledgePageHead><p>真实个人图谱组件</p></KnowledgePage> }))
vi.mock('./CourseKnowledgePage', () => ({ CourseKnowledgePage: () => <KnowledgePage><KnowledgePageHead title="知识与关系" /><p>真实库内图谱组件</p></KnowledgePage> }))
const course: SharedCourse = { id: 'kb1', name: '我的研究', description: '', access: 'owner', sharingEnabled: false, shareToken: null, readyDocumentCount: 2, documents: [1, 2].map(index => ({ id: `d${index}`, filename: `${index}.txt`, mediaType: 'text/plain', sizeBytes: 12, parseId: `p${index}`, status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '2026-10-03', knowledge: { summary: '摘要', topics: [{ title: index === 1 ? 'Ａ' : 'A', summary: `原文说法${index}`, segmentIds: [`s${index}`] }], relations: [] } })) }
beforeEach(() => { vi.mocked(listCourses).mockResolvedValue([course]); vi.mocked(getCourse).mockResolvedValue(course); vi.mocked(readKnowledgeStorage).mockRejectedValue(new Error('offline')) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount(path = '/my/graph') { return render(<MemoryRouter initialEntries={[path]}><LibraryGraphPage userId="u1" /></MemoryRouter>) }
it('keeps the original personal graph and search while adding shared scope and subviews', async () => {
  mount(); expect(screen.getByText('真实个人图谱组件')).toBeVisible(); expect(screen.getByLabelText('搜索我的图谱')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '切换知识库：全部资料' }))
  expect(await screen.findByRole('link', { name: '我的研究2' })).toHaveAttribute('href', '/my/graph?kb_id=kb1')
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByLabelText('知识库目录')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '知识点' }))
  expect(await screen.findByText('原文说法1')).toBeVisible()
})
it('groups normalized topic names but preserves each document explanation and exact segment link', async () => {
  mount('/my/graph?view=points')
  expect(await screen.findByText('原文说法1')).toBeVisible(); expect(screen.getByText('原文说法2')).toBeVisible()
  expect(screen.getByText('1 个知识点 · 2 份资料')).toBeVisible()
  expect(screen.getAllByRole('link', { name: '阅读原文' }).map(link => link.getAttribute('href'))).toEqual(['/library?kb_id=kb1&document_id=d1&segment_id=s1', '/library?kb_id=kb1&document_id=d2&segment_id=s2'])
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索知识' }), { target: { value: '无结果' } })
  expect(screen.getByText('没有找到相关知识点')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: '清除搜索' })); expect(screen.getByText('原文说法2')).toBeVisible()
})
it('keeps scoped graph routing and never shows foreign topic details', async () => {
  mount('/my/graph?kb_id=kb1')
  expect(screen.getByText('真实库内图谱组件')).toBeVisible()
  expect(screen.getByRole('link', { name: '资料卡片' })).toHaveAttribute('href', '/library?kb_id=kb1')
  vi.mocked(getCourse).mockResolvedValue({ ...course, access: 'reader' })
  fireEvent.click(screen.getByRole('button', { name: '知识点' }))
  expect(await screen.findByText('此知识库不可访问。')).toBeVisible(); expect(screen.queryByText('原文说法1')).not.toBeInTheDocument()
})
it('redirects the legacy knowledge URL with its library and source parameters intact', async () => {
  function Address() { const value = useLocation(); return <output>{value.pathname}{value.search}</output> }
  render(<MemoryRouter initialEntries={['/library/knowledge?kb_id=kb1&segment_id=s1']}><Routes><Route path="/library/knowledge" element={<LegacyLibraryKnowledgeRoute />} /><Route path="/my/graph" element={<Address />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('/my/graph?kb_id=kb1&segment_id=s1&view=points')).toBeVisible()
})
