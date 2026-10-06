import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { AppHomePage } from './AppHomePage'

vi.mock('../../modules/account', () => ({
  useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: 'reader-shared' } } } }),
  notifyAccountUsageChanged: vi.fn(),
}))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: async () => ({ name: '小叶', avatar_id: 'cheng', color: '#b8c5b0', greeting: '来啦。', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: {}, version: 1 }) }))
vi.mock('../../modules/personal-graph', () => ({ readPersonalGraph: async () => ({ nodes: [], edges: [], sources: {}, document_count: 0, topic_count: 0, pending_count: 0 }) }))
vi.mock('../../modules/research-projects', () => ({ listResearchProjects: async () => [], deleteResearchProject: vi.fn() }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: ReactNode }) => children, PageContent: ({ children }: { children: ReactNode }) => children }))

const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })
const summary = {
  status: 'ready', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], updated_at: '2026-10-05T00:00:00Z', summary: '你在两次对话里讨论了读书会展示的案例与时长。',
  cards: [{ card_id: 'presentation-card', version: 'summary-version-1', title: '把对照案例放进五分钟展示', description: '保留你选的案例，先核对展示的重点。', sources: [
    { role: 'user', sequence: 0, conversation_id: 'case-discussion', message_id: 'case-1', title: '对照案例', quote: '我想保留那个对照案例。' },
    { role: 'user', sequence: 0, conversation_id: 'presentation', message_id: 'presentation-1', title: '展示准备', quote: '读书会展示只有五分钟。' },
  ] }],
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const pathFor = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }

it('uses one server-cached, content-specific result on Home and a new standard Chat, preserving history and draft-only selection', async () => {
  const reads: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = pathFor(input)
    reads.push(path)
    if (path === '/api/agent/context-summary') return json(summary)
    if (path === '/api/agent/models') return json({ runtime_mode: 'base', items: [{ model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['medium'], default_reasoning_effort: 'medium' }] })
    if (path === '/api/agent/recent-context') return json({ items: [{ conversation_id: 'history', title: '旧对话', updated_at: '2026-10-04T00:00:00Z', kind: 'user_excerpt', excerpt: '真实历史问题', source_message_id: 'old-1', recent_excerpts: [] }] })
    return json({ items: [] })
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(queryClient)
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app']}><Routes>
    <Route path="/app" element={<AppHomePage />} />
    <Route path="/agent" element={<ResearchAgentConversationPage userId="reader-shared" />} />
  </Routes><Location /></MemoryRouter></QueryClientProvider>)
  const homeCards = await screen.findByRole('region', { name: '建议' })
  await within(homeCards).findByRole('button', { name: /把对照案例放进五分钟展示/ })
  expect(homeCards.querySelectorAll('.cv-suggestions__card')).toHaveLength(3)
  expect(within(homeCards).getAllByRole('button', { name: '查看依据原文' })).toHaveLength(1)
  const content = homeCards.textContent
  expect(await screen.findByRole('region', { name: '接着聊' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '展开对话' }))
  expect(screen.getByRole('link', { name: '继续对话：旧对话' })).toHaveAttribute('href', '/agent?conversation_id=history')
  fireEvent.change(screen.getByRole('textbox', { name: '问小叶' }), { target: { value: '保留首页补充。' } })
  for (const generic of [...homeCards.querySelectorAll<HTMLButtonElement>('.cv-suggestions__card')].slice(1)) {
    expect(generic).toBeDisabled()
    fireEvent.click(generic)
  }
  fireEvent.click(within(homeCards).getByRole('button', { name: /把对照案例放进五分钟展示/ }))
  expect(await screen.findByRole('textbox', { name: '问小叶' })).toHaveValue('保留首页补充。')
  const homeSelection = screen.getByRole('region', { name: '已选对话卡片' })
  expect(homeSelection).toHaveTextContent(summary.cards[0].title)
  expect(homeSelection).toHaveTextContent(summary.cards[0].description)
  expect(screen.getByTestId('location')).toHaveTextContent('/app')
  expect(reads).not.toContain('/api/agent/turns')
  fireEvent.click(screen.getByRole('link', { name: '全部对话' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/agent'))
  const chatCards = await screen.findByRole('region', { name: '建议' })
  expect(chatCards.textContent).toBe(content)
  expect(chatCards.querySelectorAll('.cv-suggestions__card')).toHaveLength(3)
  expect(within(chatCards).getAllByRole('button', { name: '查看依据原文' })).toHaveLength(1)
  expect(reads.filter(path => path === '/api/agent/context-summary')).toHaveLength(1)
  expect(screen.queryByRole('region', { name: '已选对话卡片' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '问 Everplain' }), { target: { value: '保留新对话补充。' } })
  for (const generic of [...chatCards.querySelectorAll<HTMLButtonElement>('.cv-suggestions__card')].slice(1)) {
    expect(generic).toBeDisabled()
    fireEvent.click(generic)
  }
  fireEvent.click(within(chatCards).getByRole('button', { name: /把对照案例放进五分钟展示/ }))
  expect(screen.getByRole('textbox', { name: '问 Everplain' })).toHaveValue('保留新对话补充。')
  const chatSelection = screen.getByRole('region', { name: '已选对话卡片' })
  expect(chatSelection).toHaveTextContent(summary.cards[0].title)
  expect(chatSelection).toHaveTextContent(summary.cards[0].description)
  expect(reads).not.toContain('/api/agent/turns')
  expect(reads.filter(path => path === '/api/agent/context-summary')).toHaveLength(1)
})
