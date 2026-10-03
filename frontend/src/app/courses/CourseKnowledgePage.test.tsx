import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import { getCourse, listCourses, type SharedCourse } from '../../modules/shared-knowledge'
import { CourseKnowledgePage } from './CourseKnowledgePage'

vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/shared-knowledge', () => ({ getCourse: vi.fn(), listCourses: vi.fn() }))
vi.mock('../../modules/knowledge-graph', () => ({ ObsidianKnowledgeGraph: ({ onSelectKnowledge, onSelectEdge }: { onSelectKnowledge: (id: string) => void; onSelectEdge: (id: string) => void }) => <div aria-label="知识图面"><button onClick={() => onSelectKnowledge('topic:交往')}>选择知识点</button><button onClick={() => onSelectEdge('relation:d1:0')}>选择关系</button></div> }))
const course: SharedCourse = { id: 'kb-1', name: '城市研究', description: '', access: 'owner', sharingEnabled: false, shareToken: null, readyDocumentCount: 1, documents: [{ id: 'd1', filename: '城市.txt', mediaType: 'text/plain', sizeBytes: 100, parseId: 'p1', status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '2026-10-02', knowledge: { summary: '城市研究摘要', topics: [{ title: '交往', summary: '日常互动', segmentIds: ['s1'] }, { title: '邻里', summary: '邻里关系', segmentIds: ['s2'] }], relations: [{ source: '交往', target: '邻里', label: '建立信任', segmentIds: ['s1'] }] } }] }
beforeEach(() => { vi.mocked(listCourses).mockResolvedValue([{ ...course, documents: [] }]); vi.mocked(getCourse).mockResolvedValue(course) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount() { return render(<MemoryRouter initialEntries={['/library/knowledge?kb_id=kb-1']}><CourseKnowledgePage /></MemoryRouter>) }

it('uses a standalone graph and opens real evidence only on selection', async () => {
  const { container } = mount()
  await screen.findByRole('button', { name: '选择知识点' })
  expect(container.querySelector('.knowledge-library')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '选择知识点' }))
  expect(screen.getByRole('complementary', { name: '知识点原文依据' })).toHaveTextContent('日常互动')
  expect(screen.getByRole('link', { name: '阅读原文 · 城市.txt' })).toHaveAttribute('href', '/library?kb_id=kb-1&document_id=d1&segment_id=s1')
  fireEvent.click(screen.getByRole('button', { name: '选择关系' }))
  expect(screen.getByRole('link', { name: '阅读关系依据 · 城市.txt · 1' })).toHaveAttribute('href', '/library?kb_id=kb-1&document_id=d1&segment_id=s1')
  fireEvent.click(screen.getByRole('button', { name: '关闭知识详情' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('retains knowledge search, card browsing and owner access checks', async () => {
  mount()
  await screen.findByRole('button', { name: '选择知识点' })
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索知识' }), { target: { value: '日常' } })
  expect(screen.getByRole('button', { name: '查看知识点 交往' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '查看知识点 邻里' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '收起知识导图' }))
  expect(screen.queryByLabelText('知识图面')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看知识点 交往' })).toBeInTheDocument()
  cleanup()
  vi.mocked(getCourse).mockResolvedValue({ ...course, access: 'reader' })
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('此知识库不可访问')
  expect(screen.queryByLabelText('知识图面')).not.toBeInTheDocument()
})
