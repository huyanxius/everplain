import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { getConversationContextSummary } from '../../modules/research-agent'
import { saveMemorySettings } from '../../modules/research-memory'
import { ConversationContextSuggestions } from '../conversation-view/ConversationContextSuggestions'
import { ResearchMemoryPanel } from './ResearchMemoryPanel'

vi.mock('../../modules/account', () => ({ useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: 'owner' } } } }) }))
vi.mock('../../modules/research-agent', () => ({ getConversationContextSummary: vi.fn() }))
vi.mock('../../modules/research-memory', () => ({
  loadMemories: vi.fn(async () => ({ items: [], settings: { task_id: null, version: 0, use_memory: true, learn_memory: true }, limits: { max_entries: 100, max_content_bytes: 2000 } })),
  loadMemoryOverview: vi.fn(), loadMemoryHistory: vi.fn(), removeMemory: vi.fn(), saveMemory: vi.fn(),
  saveMemorySettings: vi.fn(async () => ({ task_id: null, version: 1, use_memory: false, learn_memory: true })),
  memoryPreviewLimits: { max_entries: 100, max_content_bytes: 2000 },
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('immediately clears mounted ready cards after a successful memory disable, before the next server response', async () => {
  const empty = { summary: '', cards: [], summary_sources: [], updated_at: null, scope: 'conversation_messages' as const, omitted_messages: 0 }
  let finishRead!: (value: typeof empty & { status: 'disabled' }) => void
  vi.mocked(getConversationContextSummary).mockResolvedValueOnce({ ...empty, status: 'ready', cards: [{ title: '核对杭州交通预算', description: '你在两次对话提到交通预算和行程。', prompt: '按五百元比较杭州交通。', sources: [{ role: 'user', sequence: 0, conversation_id: 'source', message_id: 'message', title: '杭州安排', quote: '预算五百元。' }] }] })
    .mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelect = vi.fn()
  render(<QueryClientProvider client={queryClient}><MemoryRouter>
    <ResearchMemoryPanel taskId={null} />
    <ConversationContextSuggestions userId="owner" onSelect={onSelect} />
  </MemoryRouter></QueryClientProvider>)
  await screen.findByRole('button', { name: /核对杭州交通预算/ })
  await waitFor(() => expect(screen.getByText('0 条记忆')).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: '记忆设置' }))
  fireEvent.click(screen.getByRole('switch', { name: '使用个人记忆' }))
  await waitFor(() => expect(saveMemorySettings).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryByRole('button', { name: /核对杭州交通预算/ })).not.toBeInTheDocument())
  expect(getConversationContextSummary).toHaveBeenCalledTimes(2)
  expect(onSelect).not.toHaveBeenCalled()
  await act(async () => finishRead({ ...empty, status: 'disabled' }))
  expect(await screen.findByText('对话建议暂未启用。你可以直接输入问题。')).toBeVisible()
  queryClient.clear()
})
