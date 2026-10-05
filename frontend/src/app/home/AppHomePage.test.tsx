import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { readPersonalGraph, type PersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { getConversationContextSummary, getAgentModelCatalog, listRecentConversationContext } from '../../modules/research-agent'
import { useAgentModelSelection } from '../model-selection'
import { readHomeSubmission } from '../conversation-view/homeSubmission'
import { AppHomePage } from './AppHomePage'

vi.mock('../../modules/account', () => ({ useAccount: vi.fn() }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn() }))
vi.mock('../../modules/personal-graph', () => ({ readPersonalGraph: vi.fn() }))
vi.mock('../agent/ResearchAgentConversationPage', () => ({ seedAgentDraft: vi.fn() }))
vi.mock('../../modules/research-agent', () => ({ getConversationContextSummary: vi.fn(), getAgentModelCatalog: vi.fn(), listRecentConversationContext: vi.fn() }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: ReactNode }) => children, PageContent: ({ children }: { children: ReactNode }) => children }))
vi.mock('../../modules/agent-avatar', () => ({ AgentAvatar: () => <span data-testid="home-agent" /> }))

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })
let graph: PersonalGraph
function conversation(id: string, title: string, updated: string) {
  return { conversation_id: id, title, updated_at: updated, kind: 'user_excerpt' as const, excerpt: `${title}的实际用户问题`, source_message_id: 'source-message', recent_excerpts: [] }
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output> }
function AgentDraft() {
  const location = useLocation()
  const intent = readHomeSubmission(location.state?.homeSubmitId, 'reader-1')
  const selection = useAgentModelSelection('reader-1')
  return <><p>Agent 草稿页</p><output data-testid="submit-intent">{JSON.stringify(intent)}</output><output data-testid="agent-selection">{JSON.stringify(selection.requestFields())}</output></>
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
  vi.mocked(listRecentConversationContext).mockResolvedValue([])
  vi.mocked(getConversationContextSummary).mockResolvedValue({ status: 'empty', summary: '', cards: [], updated_at: null, scope: 'conversation_messages', omitted_messages: 0, summary_sources: [] })
  vi.mocked(getAgentModelCatalog).mockResolvedValue({ runtimeMode: 'base', models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }] })
})

describe('personal home rebuilt from Home mock', () => {
  it('offers model controls directly and hands the choice and question to the new conversation', async () => {
    show()
    const composer = screen.getByRole('textbox', { name: /问/ }).closest('form')!
    fireEvent.click(await within(composer).findByRole('button', { name: /GPT 6 Luna · 中/ }))
    expect(within(composer).getByRole('radio', { name: 'GPT 6 Luna' })).toBeVisible()
    fireEvent.keyDown(within(composer).getByRole('slider', { name: '思考强度' }), { key: 'End' })
    const input = await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.change(input, { target: { value: '我的新问题' } })
    fireEvent.click(within(composer).getByRole('button', { name: '发送给 Everplain' }))
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '我的新问题')
    await waitFor(() => expect(screen.getByTestId('agent-selection')).toHaveTextContent('"reasoning_effort":"high"'))
    expect(screen.getByTestId('agent-selection')).toHaveTextContent('"model_id":"gpt-6-luna"')
  })

  it('shows one greeting and real conversation and source rows with exact navigation', async () => {
    const older = conversation('older', '城市研究', '2026-09-01T00:00:00Z')
    const newer = conversation('newer', '阅读研究', '2026-10-01T00:00:00Z')
    vi.mocked(listRecentConversationContext).mockResolvedValue([newer, older])
    graph = { ...graph, nodes: [{ id: 'n1', nodeType: 'document', label: '城市笔记', level: 2 }], sources: { n1: { title: '城市笔记', library_id: 'library one', document_id: 'document/one', source_url: null } }, document_count: 1, topic_count: 2, pending_count: 3 }
    show()
    const research = await screen.findByRole('region', { name: '接着聊' })
    await within(research).findByRole('button', { name: '展开对话' })
    fireEvent.click(within(research).getByRole('button', { name: '展开对话' }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByText('不应出现第二句自我介绍')).not.toBeInTheDocument()
    expect(within(research).getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['阅读研究', '城市研究'])
    const continueResearch = within(research).getByRole('link', { name: '继续对话：阅读研究' })
    expect(continueResearch).toHaveAttribute('href', '/agent?conversation_id=newer')
    expect(continueResearch).toHaveClass('qx-card', 'qx-card--interactive')
    expect(continueResearch).toContainElement(within(research).getByRole('heading', { name: '阅读研究' }))
    expect(within(research).getByText('阅读研究的实际用户问题')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '展开资料' }))
    expect(screen.getByRole('link', { name: /我的笔记.*城市笔记/ })).toHaveAttribute('href', '/library?kb_id=library%20one&document_id=document%2Fone')
    expect(screen.getByText((_, node) => node?.tagName === 'SPAN' && node.textContent === '1 份资料')).toBeInTheDocument()
    expect(screen.getByText('2 个主题')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '3 份待整理' })).toHaveAttribute('href', '/imports')
    expect(screen.queryByRole('textbox', { name: '搜索资料标题' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '知识空间视图' })).not.toBeInTheDocument()
  })

  it('hands off one explicit Send intent separately from its recoverable draft', async () => {
    show()
    const input = await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.change(input, { target: { value: '  比较这两份资料\n和我的笔记  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' }))
    expect(seedAgentDraft).toHaveBeenCalledExactlyOnceWith('reader-1', '比较这两份资料\n和我的笔记')
    expect(await screen.findByText('Agent 草稿页')).toBeVisible()
    expect(screen.getByTestId('submit-intent')).toHaveTextContent('比较这两份资料')
    expect(screen.getByTestId('submit-intent')).toHaveTextContent('reader-1')
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

  it('does not send an empty input and does not invent preset activity prompts', async () => {
    const first = show()
    await screen.findByRole('textbox', { name: '问小叶' })
    fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/app')
    expect(screen.getByRole('button', { name: '发送给 Everplain' })).toBeDisabled()
    expect(seedAgentDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '把资料串起来' })).not.toBeInTheDocument()
    first.unmount()
  })

  it('shows honest empty states and a working import destination', async () => {
    show()
    expect(await screen.findByText('还没有最近对话')).toBeVisible()
    expect(await screen.findByRole('heading', { name: '把第一份资料，放进来。' })).toBeVisible()
    expect(screen.getByRole('link', { name: /开始导入/ })).toHaveAttribute('href', '/imports')
    expect(screen.queryByText('0 份资料')).not.toBeInTheDocument()
  })

  it('keeps independent error states retryable without inventing zero totals', async () => {
    vi.mocked(readPersonalGraph).mockRejectedValueOnce(new Error('资料读取失败'))
    vi.mocked(listRecentConversationContext).mockRejectedValueOnce(new Error('对话读取失败'))
    show()
    await screen.findByText('资料读取失败')
    await screen.findByText('对话读取失败')
    expect(screen.queryByText('0 份资料')).not.toBeInTheDocument()
    expect(screen.queryByText('还没有最近对话')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('heading', { name: '把第一份资料，放进来。' })
    expect(screen.getByText('对话读取失败')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重新加载对话' }))
    await screen.findByText('还没有最近对话')
    await waitFor(() => expect(listRecentConversationContext).toHaveBeenCalledTimes(2))
  })
})


it('keeps one conversation as a whole clickable card without extra action buttons', async () => {
  vi.mocked(listRecentConversationContext).mockResolvedValue([conversation('single', '无资料研究', '2026-10-03T00:00:00Z')])
  show()
  const research = await screen.findByRole('region', { name: '接着聊' })
  fireEvent.click(await within(research).findByRole('button', { name: '展开对话' }))
  const action = within(research).getByRole('link', { name: '继续对话：无资料研究' })
  expect(action).toHaveTextContent('无资料研究')
  expect(action.querySelector('button, a')).toBeNull()
  expect(action.querySelector('.qx-card__meta time')).toHaveAttribute('dateTime', '2026-10-03T00:00:00Z')
  expect(action).toHaveAttribute('href', '/agent?conversation_id=single')
  expect(action).toHaveClass('qx-card', 'qx-card--interactive')
  expect(research.querySelector('.hm-pile')).toHaveAttribute('data-open', 'true')
  expect(within(research).getByRole('link', { name: '全部对话' })).toHaveClass('qx-btn', 'qx-btn--ghost')
  const materials = screen.getByRole('region', { name: '我的资料' })
  expect(within(materials).getByRole('link', { name: '打开知识库' })).toHaveClass('qx-btn', 'qx-btn--ghost')
  expect(await within(materials).findByRole('link', { name: /开始导入/ })).toHaveClass('qx-card', 'qx-card--interactive')
})

it('opens piles without navigating, collapses on Escape and retains the source excerpt', async () => {
  vi.mocked(listRecentConversationContext).mockResolvedValue([conversation('p', '正在研究', '2026-10-03T00:00:00Z')])
  show()
  fireEvent.click(await screen.findByRole('button', { name: '展开对话' }))
  expect(screen.getByRole('link', { name: '继续对话：正在研究' })).toHaveTextContent('正在研究的实际用户问题')
  expect(screen.getByTestId('location')).toHaveTextContent('/app')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '展开对话' })).toBeVisible()
})

it('shows loading placeholders rather than new-user invitations while reads are pending', () => {
  vi.mocked(readPersonalGraph).mockReturnValue(new Promise(() => {}))
  vi.mocked(listRecentConversationContext).mockReturnValue(new Promise(() => {}))
  show()
  expect(screen.getByText('正在读取最近对话')).toBeVisible()
  expect(screen.getByText('正在读取资料')).toBeVisible()
  expect(screen.queryByText('还没有最近对话')).not.toBeInTheDocument()
})
