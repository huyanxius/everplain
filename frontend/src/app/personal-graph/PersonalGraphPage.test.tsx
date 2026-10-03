import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type PropsWithChildren } from 'react'
import { readPersonalGraph, rebuildPersonalGraph } from '../../modules/personal-graph'
import { readCourseDocument } from '../../modules/shared-knowledge'
import { PersonalGraphPage } from './PersonalGraphPage'

vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/agent-avatar', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../modules/agent-avatar')>(),
  AgentAvatar: () => <svg />,
}))
vi.mock('../../modules/knowledge-graph', () => ({ ObsidianKnowledgeGraph: ({ onSelectKnowledge }: { onSelectKnowledge: (id: string) => void }) => <div aria-label="图面"><button onClick={() => onSelectKnowledge('doc-1')}>选择文档节点</button><button onClick={() => onSelectKnowledge('topic-1')}>选择主题节点</button></div> }))
vi.mock('../../modules/personal-graph', () => ({ readPersonalGraph: vi.fn(), rebuildPersonalGraph: vi.fn() }))
vi.mock('../../modules/shared-knowledge', () => ({ readCourseDocument: vi.fn() }))
const graph = {
  name: 'Everplain', avatar_id: 'pebble', color: '#333333', releaseId: 'test', document_count: 1, topic_count: 1, pending_count: 0, mode: 'semantic',
  nodes: [{ id: 'self', label: 'Everplain', nodeType: 'self', level: 0 }, { id: 'topic-1', label: '城市', nodeType: 'topic', level: 1 }, { id: 'doc-1', label: '城市笔记', nodeType: 'document', level: 2 }],
  edges: [{ id: 'edge', source: 'topic-1', target: 'doc-1', direction: 'directed', layer: 'structure', relationType: 'contains' }],
  sources: { 'doc-1': { library_id: 'kb-1', document_id: 'd1', title: '城市笔记', segment_id: 's1', source_url: 'https://example.com/source', asset_url: null } },
} as Awaited<ReturnType<typeof readPersonalGraph>>
beforeEach(() => {
  vi.mocked(readPersonalGraph).mockResolvedValue(graph)
  vi.mocked(rebuildPersonalGraph).mockResolvedValue(graph)
  vi.mocked(readCourseDocument).mockResolvedValue({ segments: [{ id: 's1', text: '有出处的原文' }] } as never)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PersonalGraphPage userId="owner" /></MemoryRouter></QueryClientProvider>) }

it('shows the full graph without an empty sidebar and opens/closes search results', async () => {
  mount()
  await screen.findByRole('heading', { name: '图谱' })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索我的图谱' }), { target: { value: '城市' } })
  expect(screen.getByRole('complementary', { name: '搜索结果' })).toBeInTheDocument()
  expect(screen.getByText('找到 2 个结果')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭节点面板' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '搜索我的图谱' })).toHaveValue('')
})

it('opens real original source for selected documents and only related nodes for topics', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '选择主题节点' }))
  expect(screen.getByRole('complementary', { name: '节点详情' })).toHaveTextContent('城市笔记')
  fireEvent.click(screen.getByRole('button', { name: '选择文档节点' }))
  expect(await screen.findByText('有出处的原文')).toBeInTheDocument()
  expect(readCourseDocument).toHaveBeenCalledWith('kb-1', 'd1', 's1')
  expect(screen.getByRole('link', { name: '在资料库中打开' })).toHaveAttribute('href', '/library?kb_id=kb-1&document_id=d1&segment_id=s1')
  expect(screen.getByRole('link', { name: '访问来源网页' })).toHaveAttribute('href', 'https://example.com/source')
  fireEvent.click(screen.getByRole('button', { name: '关闭原文' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('retains graph rebuild, import and card navigation', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '更新图谱' }))
  await waitFor(() => expect(rebuildPersonalGraph).toHaveBeenCalledOnce())
  expect(screen.getByRole('link', { name: '继续导入' })).toHaveAttribute('href', '/imports')
  expect(screen.getByRole('link', { name: '资料卡片' })).toHaveAttribute('href', '/library')
})
