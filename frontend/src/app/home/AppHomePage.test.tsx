import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listMyResearchViaApi, useAccount, type MyResearchItem } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { readPersonalGraph, type PersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { getAgentModelCatalog } from '../../modules/research-agent'
import { useAgentModelSelection } from '../model-selection'
import { AppHomePage } from './AppHomePage'

vi.mock('../../modules/account', () => ({ listMyResearchViaApi: vi.fn(), useAccount: vi.fn() }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn() }))
vi.mock('../../modules/personal-graph', () => ({ readPersonalGraph: vi.fn() }))
vi.mock('../agent/ResearchAgentConversationPage', () => ({ seedAgentDraft: vi.fn() }))
vi.mock('../../modules/research-agent', () => ({ getAgentModelCatalog: vi.fn() }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: ReactNode }) => children, PageContent: ({ children }: { children: ReactNode }) => children }))
vi.mock('../../modules/agent-avatar', () => ({ AgentAvatar: () => <span data-testid="home-agent" /> }))

afterEach(() => { cleanup(); localStorage.clear() })
let graph: PersonalGraph
function project(id: string, title: string, updated: string): MyResearchItem {
  return { taskId: id, projectTitle: title, stageLabel: '研究方案', nextActionLabel: '继续完善问题', entryPath: `/research/${id}`, blocker: null, retry: null, phenomenonSummary: `${title}的问题`, adoptedTheoryCount: 0, createdAt: updated, updatedAt: updated }
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output> }
function AgentDraft() {
  const selection = useAgentModelSelection('reader-1')
  return <><p>Agent 草稿页</p><output data-testid="agent-selection">{JSON.stringify(selection.requestFields())}</output></>
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app']}><Routes><Route path="/app" element={<AppHomePage />} /><Route path="/agent" element={<AgentDraft />} /></Routes><Location /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useAccount).mockReturnValue({ sessionState: { status: 'authenticated', session: { user: { userId: 'reader-1' } } } } as never)
  vi.mocked(readAgentProfile).mockResolvedValue({ name: '小叶', avatar_id: 'cheng', color: '#5d8fe6', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1, greeting: '不应出现第二句自我介绍' })
  graph = { name: '小叶', avatar_id: 'cheng', color: '#5d8fe6', releaseId: 'r1', nodes: [], edges: [], sources: {}, document_count: 0, topic_count: 0, pending_count: 0, mode: 'mock' }
  vi.mocked(readPersonalGraph).mockImplementation(async () => graph)
  vi.mocked(listMyResearchViaApi).mockResolvedValue([])
  vi.mocked(getAgentModelCatalog).mockResolvedValue({ runtimeMode: 'base', models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }] })
})

describe('personal home rebuilt from Home mock', () => {
  it('offers model controls directly and hands the choice and question to the new conversation', async () => {
    show()
    const composer = screen.getByRole('form', { name: '开始 Agent 对话' })
    expect(await within(composer).findByRole('combobox', { name: '模型' })).toBeVisible()
    fireEvent.change(within(composer).getByRole('slider', { name: '思考强度' }), { target: { value: '2' } })
    const input = await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.change(input, { target: { value: '我的新问题' } })
    fireEvent.click(within(composer).getByRole('button', { name: '开始对话' }))
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '我的新问题')
    await waitFor(() => expect(screen.getByTestId('agent-selection')).toHaveTextContent('"reasoning_effort":"high"'))
    expect(screen.getByTestId('agent-selection')).toHaveTextContent('"model_id":"gpt-6-luna"')
  })

  it('shows one greeting and real project and source rows with exact navigation', async () => {
    const older = project('older', '城市研究', '2026-09-01T00:00:00Z')
    const newer = project('newer', '阅读研究', '2026-10-01T00:00:00Z')
    newer.blocker = { action: 'retry', code: 'temporarily_unavailable', message: '请补充资料', recoverable: true }
    newer.retry = { action: 'resume', method: 'GET', href: '/research/newer/workspace/materials', label: '继续' }
    vi.mocked(listMyResearchViaApi).mockResolvedValue([older, newer])
    graph = { ...graph, nodes: [{ id: 'n1', nodeType: 'document', label: '城市笔记', level: 2 }], sources: { n1: { title: '城市笔记', library_id: 'library one', document_id: 'document/one', source_url: null } }, document_count: 1, topic_count: 2, pending_count: 3 }
    show()
    const research = await screen.findByRole('region', { name: '接着研究' })
    await within(research).findByRole('heading', { name: '阅读研究' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByText('不应出现第二句自我介绍')).not.toBeInTheDocument()
    expect(within(research).getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['阅读研究', '城市研究'])
    const continueResearch = within(research).getByRole('link', { name: '继续完善问题：阅读研究' })
    expect(continueResearch).toHaveAttribute('href', '/research/newer/workspace/materials')
    expect(continueResearch).toHaveClass('qx-card', 'qx-card--interactive')
    expect(continueResearch).toContainElement(within(research).getByRole('heading', { name: '阅读研究' }))
    expect(within(research).getByText('请补充资料')).toBeVisible()
    expect(screen.getByRole('link', { name: /我的笔记.*城市笔记/ })).toHaveAttribute('href', '/library?kb_id=library%20one&document_id=document%2Fone')
    expect(screen.getByText('1 份资料')).toBeVisible()
    expect(screen.getByText('2 个主题')).toBeVisible()
    expect(screen.getByRole('link', { name: '3 份待整理' })).toHaveAttribute('href', '/imports')
    const navigation = screen.getByRole('navigation', { name: '知识空间视图' })
    for (const [name, path] of [['导入资料', '/imports'], ['知识图谱', '/my/graph'], ['管理知识库', '/library'], ['共享与连接', '/sharing'], ['发现主题', '/discover'], ['新建研究', '/research/new']]) {
      const entry = within(navigation).getByRole('link', { name })
      expect(entry).toHaveAttribute('href', path)
      expect(entry).toHaveClass('qx-btn', 'qx-btn--secondary')
      expect(entry.querySelector('svg')).toBeInTheDocument()
    }
    expect(within(navigation).getByRole('group', { name: '资料与研究' })).toContainElement(within(navigation).getByRole('link', { name: '新建研究' }))
    expect(within(navigation).getByRole('group', { name: '共享与发现' })).toContainElement(within(navigation).getByRole('link', { name: '共享与连接' }))
    expect(screen.getByRole('link', { name: '偏好与账户设置' })).toHaveClass('qx-btn', 'qx-btn--secondary')
  })

  it('keeps the user-scoped draft handoff to Agent instead of sending a turn', async () => {
    show()
    const input = await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.change(input, { target: { value: '  比较这两份资料\n和我的笔记  ' } })
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }))
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '比较这两份资料\n和我的笔记')
    expect(await screen.findByText('Agent 草稿页')).toBeVisible()
  })

  it('keeps Shift+Enter and IME composition in the composer, then handles Enter', async () => {
    show()
    const input = await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.change(input, { target: { value: '第一行' } })
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true)
    expect(seedAgentDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/app')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '第一行')
    expect(await screen.findByText('Agent 草稿页')).toBeVisible()
  })

  it('keeps an empty-start path and makes prompt chips use the same draft handoff', async () => {
    const first = show()
    await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }))
    expect(await screen.findByText('Agent 草稿页')).toBeVisible()
    expect(seedAgentDraft).not.toHaveBeenCalled()
    first.unmount()
    show()
    fireEvent.click(screen.getByRole('button', { name: '把资料串起来' }))
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '帮我把资料之间的联系整理一下')
  })

  it('searches beyond the three preview cards and excludes missing source links', async () => {
    graph = { ...graph, nodes: [1, 2, 3, 4, 5].map(id => ({ id: `n${id}`, nodeType: 'document' as const, label: `笔记 ${id}`, level: 2 })),
      sources: Object.fromEntries([1, 2, 3, 4].map(id => [`n${id}`, { title: `笔记 ${id}`, library_id: 'kb', document_id: `doc-${id}`, source_url: null }])), document_count: 5 }
    show()
    await screen.findByRole('link', { name: /我的笔记.*笔记 1/ })
    expect(screen.queryByRole('link', { name: /我的笔记.*笔记 4/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索资料标题' }), { target: { value: '笔记 4' } })
    expect(screen.getByRole('link', { name: /我的笔记.*笔记 4/ })).toHaveAttribute('href', '/library?kb_id=kb&document_id=doc-4')
    expect(screen.getByTestId('location')).toHaveTextContent('/app')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索资料标题' }), { target: { value: '笔记 5' } })
    expect(screen.getByRole('heading', { name: '还没找到这份资料。' })).toBeVisible()
  })

  it('shows honest empty states and a working import destination', async () => {
    show()
    expect(await screen.findByText('还没有研究项目')).toBeVisible()
    expect(await screen.findByRole('heading', { name: '把第一份资料，放进来。' })).toBeVisible()
    expect(screen.getByRole('link', { name: /开始导入/ })).toHaveAttribute('href', '/imports')
    expect(screen.getByText('0 份资料')).toBeVisible()
  })

  it('keeps independent error states retryable without inventing zero totals', async () => {
    vi.mocked(readPersonalGraph).mockRejectedValueOnce(new Error('资料读取失败'))
    vi.mocked(listMyResearchViaApi).mockRejectedValueOnce(new Error('研究读取失败'))
    show()
    await screen.findByText('资料读取失败')
    await screen.findByText('研究读取失败')
    expect(screen.queryByText('0 份资料')).not.toBeInTheDocument()
    expect(screen.queryByText('还没有研究项目')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('heading', { name: '把第一份资料，放进来。' })
    expect(screen.getByText('研究读取失败')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重新加载研究' }))
    await screen.findByText('还没有研究项目')
    await waitFor(() => expect(listMyResearchViaApi).toHaveBeenCalledTimes(2))
  })
})


it('keeps one project as a mock-style whole clickable card without extra action buttons', async () => {
  vi.mocked(listMyResearchViaApi).mockResolvedValue([{ ...project('single', '无资料研究', '2026-10-03T00:00:00Z'), stageLabel: '现象输入', nextActionLabel: '补充研究现象', phenomenonSummary: '尚未确认现象' }])
  show()
  const research = await screen.findByRole('region', { name: '接着研究' })
  const action = await within(research).findByRole('link', { name: '补充研究现象：无资料研究' })
  expect(action).toHaveTextContent('无资料研究')
  expect(action.querySelector('button, a')).toBeNull()
  expect(action.querySelector('.qx-card__meta time')).toHaveAttribute('dateTime', '2026-10-03T00:00:00Z')
  expect(action).toHaveAttribute('href', '/research/single')
  expect(action).toHaveClass('qx-card', 'qx-card--interactive')
  expect(research.querySelector('.personal-start__projects')).toHaveAttribute('data-count', '1')
  expect(within(research).getByRole('link', { name: '全部研究' })).toHaveClass('qx-btn', 'qx-btn--ghost')
  const materials = screen.getByRole('region', { name: '我的资料' })
  expect(within(materials).getByRole('link', { name: '打开知识库' })).toHaveClass('qx-btn', 'qx-btn--ghost')
  expect(await within(materials).findByRole('link', { name: /开始导入/ })).toHaveClass('qx-btn', 'qx-btn--secondary')
})
