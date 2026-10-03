import { readPersonalGraph } from '../modules/personal-graph'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './App'
import { AccountProvider } from '../modules/account'

const cytoscapeMock = vi.hoisted(() => vi.fn(() => {
  const collection = {
    removeClass: vi.fn().mockReturnThis(), addClass: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(), map: vi.fn(() => []), forEach: vi.fn(),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0 })),
    empty: vi.fn(() => true), length: 0,
  }
  return { destroy: vi.fn(), elements: vi.fn(() => collection), nodes: vi.fn(() => collection),
    edges: vi.fn(() => collection), getElementById: vi.fn(() => collection),
    fit: vi.fn(), on: vi.fn(), one: vi.fn(), resize: vi.fn(), container: vi.fn(() => null),
    batch: vi.fn((callback: () => void) => callback()), layout: vi.fn(() => ({ run: vi.fn() })),
  }
}))

vi.mock('cytoscape', () => ({ default: cytoscapeMock }))
vi.mock('@paper-design/shaders-react', () => ({
  GrainGradient: () => null,
  MeshGradient: () => null,
  NeuroNoise: () => null,
  PaperTexture: () => null,
  ShaderMount: () => null,
  Warp: () => null,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderRoute(
  path: string,
  sessionState: { status: 'authenticated' | 'anonymous' | 'expired' | 'loading' } = {
    status: 'anonymous',
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  // Route overrides and account-scoped queries must see the same authenticated owner.
  // Seed only the session; real page API reads still run through each test's fixtures.
  if (sessionState.status === 'authenticated') {
    queryClient.setQueryDefaults(['account', 'session'], { staleTime: Infinity })
    queryClient.setQueryData(['account', 'session'], {
      sessionId: 'route-test-session', expiresAt: '2099-01-01T00:00:00Z',
      user: { userId: 'route-test-user', email: 'reader@example.com', displayName: null },
    })
  }
  const route = <><AppRoutes sessionState={sessionState} /><RouteLocation /></>
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        {sessionState.status === 'authenticated' ? <AccountProvider>{route}</AccountProvider> : route}
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function RouteLocation() {
  const location = useLocation()
  return <div data-testid="route-location">{`${location.pathname}${location.search}${location.hash}`}</div>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return new URL(input, 'http://localhost')
  if (input instanceof URL) return input
  return new URL(input.url)
}

function researchNavigationFixture(resumePath: string) {
  const stage = resumePath.endsWith('/phenomenon')
    ? 'phenomenon_confirmation'
    : resumePath.endsWith('/framework')
      ? 'framework_drafting'
      : 'theory_matching'
  return {
    adopted_theory_count: 0,
    allowed_actions: stage === 'phenomenon_confirmation'
      ? ['confirm_phenomenon']
      : stage === 'framework_drafting'
        ? ['review_framework']
        : ['review_theory_candidates'],
    blocker: null,
    conversation_id: 'conversation-1',
    created_at: '2026-08-21T08:00:00Z',
    current_framework_id: null,
    current_match_run_id: null,
    current_material_intake_run_id: null,
    current_phenomenon_candidate_id: null,
    current_stage: stage,
    current_theory_plan_id: null,
    entry_type: 'direct_input',
    knowledge_release_id: 'release-formal-1',
    next_action_label: stage === 'phenomenon_confirmation'
      ? '确认现象'
      : stage === 'framework_drafting'
        ? '审校研究框架'
        : '查看候选理论',
    phenomenon_summary: null,
    resume_path: resumePath,
    retry: null,
    seed_theory_id: null,
    seed_theory_name: null,
    source_run_id: 'run-1',
    source_turn_id: 'turn-1',
    stage_label: stage === 'phenomenon_confirmation'
      ? '现象待确认'
      : stage === 'framework_drafting'
        ? '框架草稿'
        : '匹配生成中',
    status: 'in_progress',
    task_id: 'task-1',
    updated_at: '2026-08-21T09:00:00Z',
    version: 3,
  }
}

function researchWorkspaceResponse(input: RequestInfo | URL, resumePath: string) {
  const request = requestUrl(input)
  if (request.pathname.endsWith('/navigation')) return json(researchNavigationFixture(resumePath))
  if (request.pathname === '/api/research-tasks/task-1') return json({
    task_id: 'task-1',
    entry_type: 'direct_input',
    entry_mode: 'from_scratch',
    lifecycle_status: 'in_progress',
    project_title: '社区互助研究',
    project_stage: '理论分析',
    method_orientation: null,
    last_central_tool: 'theory_matching',
    status: 'in_progress',
    version: 3,
    allowed_actions: [],
    seed_theory_id: null,
    seed_theory_name: null,
    created_at: '2026-08-21T08:00:00Z',
    updated_at: '2026-08-21T09:00:00Z',
  })
  if (request.pathname.endsWith('/research-documents')) return json({ items: [] })
  if (request.pathname.endsWith('/document-proposals')) return json({ items: [] })
  if (request.pathname.endsWith('/analysis')) return json({ annotations: [], codes: [], memos: [], comparisons: [] })
  return json({}, 404)
}

function agentConversationFixture(prompt = '为什么同一社区里的互助正在减少？') {
  return {
    conversation_id: 'agent-conversation-1',
    title: prompt,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:01Z',
    turn_count: 1,
    turns: [
      {
        turn_id: 'agent-turn-1',
        user: {
          message_id: 'agent-user-message-1',
          role: 'user',
          content: prompt,
          citations: [],
          sequence: 1,
          created_at: '2026-08-18T00:00:00Z',
        },
        assistant: {
          message_id: 'agent-assistant-message-1',
          role: 'assistant',
          content: '知识库回答：互助关系会受到资源压力、信任和互动机会的共同影响。',
          citations: [],
          sequence: 2,
          created_at: '2026-08-18T00:00:01Z',
        },
        tool_traces: [],
      },
    ],
  }
}

function agentStreamResponse(conversation: ReturnType<typeof agentConversationFixture>) {
  const events = [
    ['turn_started', { conversation_id: conversation.conversation_id, run_id: 'agent-run-1', replayed: false }],
    ['agent_status', { status: 'thinking' }],
    ['tool_started', { tool: 'search_knowledge', call_id: 'tool-call-1', input: { query: '社区互助减少' } }],
    ['tool_finished', { tool: 'search_knowledge', call_id: 'tool-call-1', output: { summary: '找到 1 条可引用证据' } }],
    ['agent_status', { status: 'answering' }],
    ['assistant_delta', { delta: conversation.turns[0].assistant.content }],
    ['turn_completed', { conversation, knowledge_release_id: 'release-a' }],
  ]
    .map(([name, payload]) => `event: ${name}\ndata: ${JSON.stringify(payload)}`)
    .join('\n\n')
  return new Response(`${events}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function failedToolStreamResponse(conversation: ReturnType<typeof agentConversationFixture>) {
  const events = [
    ['turn_started', { conversation_id: conversation.conversation_id, run_id: 'agent-run-2', replayed: false }],
    ['agent_status', { status: 'thinking' }],
    ['tool_started', { tool: 'search_knowledge', call_id: 'tool-call-2', input: { query: '青年孤独' } }],
    ['tool_failed', { tool: 'search_knowledge', call_id: 'tool-call-2', message: '知识库暂时不可用' }],
    ['assistant_delta', { delta: conversation.turns[0].assistant.content }],
    ['turn_completed', { conversation, knowledge_release_id: 'release-a' }],
  ]
    .map(([name, payload]) => `event: ${name}\ndata: ${JSON.stringify(payload)}`)
    .join('\n\n')
  return new Response(`${events}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function repeatedToolStreamResponse(conversation: ReturnType<typeof agentConversationFixture>) {
  const events = [
    ['turn_started', { conversation_id: conversation.conversation_id, run_id: 'agent-run-3', replayed: false }],
    ['agent_status', { status: 'thinking' }],
    ['tool_started', { tool: 'search_knowledge', call_id: 'tool-call-a', input: { query: '青年' } }],
    ['tool_started', { tool: 'search_knowledge', call_id: 'tool-call-a', input: { query: '青年' } }],
    ['tool_finished', { tool: 'search_knowledge', call_id: 'tool-call-a', detail: '找到 2 条证据' }],
    ['tool_started', { tool: 'search_knowledge', call_id: 'tool-call-b', input: { query: '孤独' } }],
    ['tool_finished', { tool: 'search_knowledge', call_id: 'tool-call-b', detail: '找到 1 条证据' }],
    ['assistant_delta', { delta: conversation.turns[0].assistant.content }],
    ['turn_completed', { conversation, knowledge_release_id: 'release-a' }],
  ]
    .map(([name, payload]) => `event: ${name}\ndata: ${JSON.stringify(payload)}`)
    .join('\n\n')
  return new Response(`${events}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('App routes', () => {
  it('hosts every route inside one shared motion surface', () => {
    renderRoute('/welcome')

    expect(screen.getByTestId('route-motion-surface')).toContainElement(
      screen.getByRole('main'),
    )
  })

  it('uses one task-oriented navigation model across desktop and mobile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], next_cursor: null })))
    renderRoute('/app', { status: 'authenticated' })

    const desktopNavigation = await screen.findByRole('navigation', { name: '桌面主导航' })
    const desktopRail = screen.getByRole('complementary', { name: 'Everplain 功能栏' })
    const mobileNavigation = screen.getByRole('navigation', { name: '移动主导航' })

    expect(desktopNavigation).toBeInTheDocument()
    expect(mobileNavigation).toBeInTheDocument()
    expect(within(desktopRail).getByRole('link', { name: 'Everplain 工作台' })).toHaveAttribute('href', '/app')
    expect(
      within(desktopNavigation).getAllByRole('link').every((link) => Boolean(link.querySelector('svg'))),
    ).toBe(true)
    expect(within(desktopNavigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      '工作台',
      '研究 Agent',
      '新建研究',
      '我的研究',
      '知识库',
    ])
    expect(within(mobileNavigation).getAllByRole('link')).toHaveLength(5)
    expect(within(mobileNavigation).getByRole('link', { name: '知识' })).toHaveAttribute(
      'href',
      '/library',
    )
    expect(within(desktopNavigation).getByRole('link', { name: '研究 Agent' })).toHaveAttribute(
      'href',
      '/agent',
    )
    expect(within(desktopNavigation).queryByRole('link', { name: '首页' })).not.toBeInTheDocument()
    fireEvent.click(within(mobileNavigation).getByRole('button', { name: '更多' }))

    const mobileMore = screen.getByRole('dialog', { name: '更多功能' })
    expect(within(mobileMore).queryByRole('link', { name: '研究工具' })).not.toBeInTheDocument()
    expect(within(mobileMore).getByRole('link', { name: '知识整理' })).toHaveAttribute(
      'href',
      '/library/knowledge',
    )
    fireEvent.click(within(mobileMore).getByRole('button', { name: '关闭更多功能' }))
    expect(screen.queryByRole('dialog', { name: '更多功能' })).not.toBeInTheDocument()
  })

  it('retires the sociology research tools route and navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], next_cursor: null })))
    renderRoute('/research/tools', { status: 'authenticated' })
    expect(await screen.findByRole('heading', { level: 1, name: /今天想弄清楚什么？/ })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/app')
    expect(screen.queryByRole('link', { name: '研究工具' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '研究工具列表' })).not.toBeInTheDocument()
  })

  it('keeps the sidebar stationary and preserves its user-selected width across routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], next_cursor: null })))
    renderRoute('/app', { status: 'authenticated' })

    fireEvent.click(await screen.findByRole('button', { name: '收起侧栏' }))
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeVisible()

    fireEvent.click(screen.getByRole('link', { name: '研究 Agent' }))

    expect(await screen.findByRole('button', { name: '展开侧栏' })).toBeVisible()
  })

  it('renders the personal home with source cards and private-library actions', async () => {
    renderRoute('/app', { status: 'authenticated' })
    expect(await screen.findByRole('heading', { level: 1, name: /今天想弄清楚什么？/ })).toBeVisible()
    expect(screen.getByRole('navigation', { name: '知识空间视图' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '把第一份资料，放进来。' })).toBeVisible()
    expect(within(screen.getByRole('navigation', { name: '知识空间视图' })).getByRole('link', { name: '新建研究' })).toHaveAttribute('href', '/research/new')
    expect(screen.getByText(/默认仅你可见/)).toBeVisible()
  })

  it('filters the personal library without leaving the home route', async () => {
    renderRoute('/app', { status: 'authenticated' })
    await screen.findByRole('heading', { name: '把第一份资料，放进来。' })
    fireEvent.change(screen.getByRole('textbox', { name: '搜索资料标题' }), { target: { value: '不存在' } })
    expect(await screen.findByRole('heading', { name: '还没找到这份资料。' })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/app')
  })

  it('links the personal home to its four-level knowledge graph', async () => {
    renderRoute('/app', { status: 'authenticated' })
    await screen.findByRole('heading', { level: 1, name: /今天想弄清楚什么？/ })
    expect(screen.getByRole('link', { name: '知识图谱' })).toHaveAttribute('href', '/my/graph')
    expect(screen.getByRole('link', { name: /管理知识库/ })).toHaveAttribute('href', '/library')
  })

  it('resumes a task-only research entry inside the unified project workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, '/research/task-1/match')
    }))

    renderRoute('/research/task-1', { status: 'authenticated' })

    expect(await screen.findByRole('region', { name: '研究论证地图' })).toBeVisible()
    expect(document.querySelector('main.research-document-workbench[data-stage="match"]')).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/research/task-1/workspace/theory')
    expect(screen.getAllByRole('complementary', { name: '研究 Agent 对话栏' })).toHaveLength(1)
  })

  it('restores the legacy M4 deep link inside the unified project workspace', async () => {
    const path = '/research/task-1/match'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, path)
    }))
    renderRoute(path, { status: 'authenticated' })

    expect(await screen.findByRole('region', { name: '研究论证地图' })).toBeVisible()
    expect(document.querySelector('main.research-document-workbench[data-stage="match"]')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '研究章节' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('complementary', { name: '研究 Agent 对话栏' })).toHaveLength(1)
    expect(screen.getByTestId('route-location')).toHaveTextContent('/research/task-1/workspace/theory')
  })

  it('restores the legacy M5 deep link inside the unified project workspace', async () => {
    const path = '/research/task-1/framework'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, path)
    }))
    renderRoute(path, { status: 'authenticated' })

    expect(await screen.findByRole('region', { name: '研究论证地图' })).toBeVisible()
    expect(document.querySelector('main.research-document-workbench[data-stage="framework"]')).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/research/task-1/workspace/writing')
  })

  it('opens a project folder in file management through the real app route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestUrl(input).pathname
      if (path === '/api/research-tasks') {
        const task = await researchWorkspaceResponse('http://localhost/api/research-tasks/task-1', '/research/task-1/match').json()
        return json({ items: [{ ...task, stage_label: '理论分析' }], next_cursor: null })
      }
      if (path.endsWith('/materials')) return json({ task_id: 'task-1', items: [] })
      return json({}, 404)
    }))
    renderRoute('/research/materials', { status: 'authenticated' })
    fireEvent.click(await screen.findByRole('link', { name: '打开研究 社区互助研究' }))
    expect(await screen.findByRole('heading', { name: '社区互助研究' })).toBeVisible()
    expect(screen.getByTestId('route-location').textContent).toBe('/research/materials?task_id=task-1')
    expect(screen.getByRole('button', { name: '添加材料' })).toBeVisible()
    expect(screen.queryByRole('region', { name: '研究论证地图' })).not.toBeInTheDocument()
  })

  it('preserves a material position while upgrading the legacy material deep link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, '/research/task-1/match')
    }))

    renderRoute('/research/materials?task_id=task-1&material_id=material-1&segment_id=segment-2', { status: 'authenticated' })

    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent(
      '/research/task-1/workspace/materials?material_id=material-1&segment_id=segment-2',
    ))
  })

  it('switches from materials to analysis without bouncing between workspace routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, '/research/task-1/match')
    }))

    renderRoute('/research/task-1/workspace/materials', { status: 'authenticated' })

    expect(await screen.findByRole('heading', { name: '社区互助研究' })).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '分析' }))

    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent(
      '/research/task-1/workspace/analysis',
    ))
    expect(screen.getAllByRole('complementary', { name: '研究 Agent 对话栏' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: '页面没有安全地完成渲染。' })).not.toBeInTheDocument()
  })

  it('preserves the legacy my redirect into the personal home', async () => {
    renderRoute('/my', { status: 'authenticated' })
    expect(await screen.findByRole('heading', { level: 1, name: /今天想弄清楚什么？/ })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/app?research=all')
  })

  it.each([
    ['/app', /今天想弄清楚什么？/],
    ['/agent', '你想研究什么？'],
    ['/research/new', '从一个问题开始'],
    ['/research/task-1/phenomenon', '理论判断文档'],
    ['/research/task-1/match', '理论判断文档'],
    ['/research/task-1/framework', '研究框架文档'],
  ])('renders %s from a direct entry for an authenticated visitor', async (path, title) => {
    if (path.startsWith('/research/task-1/')) {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        return researchWorkspaceResponse(input, path)
      }))
    }
    renderRoute(path, { status: 'authenticated' })

    expect(
      await screen.findByRole('heading', { name: title }),
    ).toBeVisible()
  })

  it('opens New Research as a conversation-led workspace with an honest empty canvas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })))
    renderRoute('/research/new', { status: 'authenticated' })

    const workspace = await screen.findByRole('region', { name: '新建研究工作区' })
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeVisible()
    expect(within(workspace).getByRole('heading', { name: '从一个问题开始' })).toBeVisible()
    expect(within(workspace).getByLabelText('空白研究画布')).toBeVisible()
    expect(within(workspace).queryByText('让问题在这里形成结构')).not.toBeInTheDocument()
    expect(within(workspace).getByRole('textbox', { name: '和 Agent 讨论你的研究' })).toBeVisible()
    expect(within(workspace).queryByText('研究工作区')).not.toBeInTheDocument()
    expect(within(workspace).queryByText('不是聊天摘要。这里仅保留 Agent 明确建立的问题、理论、主张、证据与缺口。')).not.toBeInTheDocument()
    expect(within(workspace).queryByText(/0 个节点/)).not.toBeInTheDocument()
  })

  it('projects a real Agent turn into research map nodes and traceable evidence', async () => {
    const conversation = {
      ...agentConversationFixture('为什么同一社区里的互助正在减少？'),
      turns: [{
        ...agentConversationFixture().turns[0],
        assistant: {
          ...agentConversationFixture().turns[0].assistant,
          citations: [{
            citation_id: 'knowledge:mutual-aid',
            label: '互惠规范与社区互助',
            kind: 'entry',
            excerpt: '互惠规范会影响持续互助的机会。',
            knowledge_id: 'D1:C009',
          }],
        },
      }],
      research_map: {
        schema_version: 1,
        nodes: [{
          id: 'synthesis-mutual-aid',
          kind: 'synthesis',
          title: '互助关系的结构性变化',
          summary: '把社区互助放回信任与互动机会的变化中理解。',
          status: 'grounded',
          citation_ids: ['knowledge:mutual-aid'],
        }],
        relations: [],
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/turns') return agentStreamResponse(conversation)
      return json({ items: [] })
    }))
    renderRoute('/research/new', { status: 'authenticated' })

    const workspace = await screen.findByRole('region', { name: '新建研究工作区' })
    const textbox = within(workspace).getByRole('textbox', { name: '和 Agent 讨论你的研究' })
    fireEvent.change(textbox, { target: { value: '为什么同一社区里的互助正在减少？' } })
    await act(async () => {
      fireEvent.submit(textbox.closest('form') as HTMLFormElement)
    })

    expect(await within(workspace).findByText('互惠规范与社区互助')).toBeVisible()
    expect(within(workspace).queryByText('研究论证地图')).not.toBeInTheDocument()
    await waitFor(() => expect(within(workspace).getByText('互助关系的结构性变化')).toBeInTheDocument())
    expect(within(workspace).getByRole('button', { name: /查看证据/ })).toBeVisible()
  })

  it('opens an independent Agent conversation page from the product rail', async () => {
    const conversation = agentConversationFixture()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/turns') return agentStreamResponse(conversation)
      if (request.pathname === '/api/agent/conversations') return json({ items: [] })
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const desktopNavigation = await screen.findByRole('navigation', { name: '桌面主导航' })
    expect(within(desktopNavigation).getByRole('link', { name: '研究 Agent' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeVisible()

    const agentConversation = screen.getByRole('region', { name: 'Everplain Agent 对话' })
    expect(within(agentConversation).queryByText('从知识库出发，和你的学科 Agent 直接聊。')).not.toBeInTheDocument()
    expect(within(agentConversation).getByRole('heading', { name: '你想研究什么？' })).toBeVisible()
    const textbox = within(agentConversation).getByRole('textbox', { name: '问 Everplain' })
    const sendButton = within(agentConversation).getByRole('button', {
      name: '发送给 Everplain',
    })

    expect(textbox).toBeVisible()
    expect(sendButton).toBeDisabled()
    expect(within(agentConversation).queryByText('交互预览 · 未连接模型')).not.toBeInTheDocument()
    expect(within(agentConversation).queryByText(/^Agent$/)).not.toBeInTheDocument()

    fireEvent.change(textbox, { target: { value: '为什么同一社区里的互助正在减少？' } })
    expect(textbox).toHaveValue('为什么同一社区里的互助正在减少？')
    expect(sendButton).toBeEnabled()

    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    const conversationPreview = within(agentConversation).getByRole('log', { name: '对话内容' })
    expect(within(conversationPreview).getByText('为什么同一社区里的互助正在减少？')).toBeInTheDocument()
    const toolSummary = await within(conversationPreview).findByRole('button', { name: /Agent 已完成工具调用/ })
    expect(toolSummary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toolSummary)
    expect(within(conversationPreview).getByText('检索知识库')).toBeVisible()
    expect(within(conversationPreview).getByText(/社区互助减少/)).toBeVisible()
    expect(within(conversationPreview).getByText(/找到 1 条可引用证据/)).toBeVisible()
    expect(within(conversationPreview).queryByText(/^Agent$/)).not.toBeInTheDocument()
    expect(textbox).toHaveValue('')
    expect(within(agentConversation).getByRole('button', { name: '发送给 Everplain' })).toBeVisible()
  })

  it('keeps the complete research conversation surface on the independent Agent page', async () => {
    const conversation = agentConversationFixture('平台算法如何改变年轻人的职业选择？')
    conversation.turns[0].assistant.content = [
      '可以先比较可见性与风险分配。',
      '',
      '| 机制 | 观察线索 |',
      '| --- | --- |',
      '| 推荐排序 | 职业可见性变化 |',
    ].join('\n')
    conversation.turns[0].assistant.citations = [{
      citation_id: 'citation-agent-surface',
      label: '平台劳动与职业选择',
      kind: 'entry',
      excerpt: '平台排序会改变青年看见职业机会与评估风险的方式。',
      knowledge_id: 'D1:C213',
      source_id: null,
    }]
    conversation.turns[0].tool_traces = [{
      tool: 'search_knowledge',
      phase: 'finished',
      call_id: 'tool-agent-surface',
      input: { query: '平台算法 青年 职业选择' },
      output: {
        items: [{
          knowledge_id: 'D1:C213',
          title: '平台劳动与职业选择',
          excerpt: '平台排序改变职业机会的可见性。',
        }],
      },
      detail: '找到 1 条知识库条目',
      error: null,
    }]
    Object.assign(conversation.turns[0], { knowledge_release_id: 'release-a' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/conversations') {
        return json({
          items: [{
            conversation_id: conversation.conversation_id,
            title: conversation.title,
            updated_at: conversation.updated_at,
            turn_count: conversation.turn_count,
          }],
        })
      }
      if (request.pathname === `/api/agent/conversations/${conversation.conversation_id}`) {
        return json(conversation)
      }
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const history = await screen.findByRole('region', { name: 'Agent 对话记录' })
    fireEvent.click(within(history).getAllByRole('button', { name: /平台算法如何改变年轻人的职业选择/ })[0])
    const agentConversation = await screen.findByRole('region', { name: 'Everplain Agent 对话' })
    expect(agentConversation.querySelector('[data-role="user-message"]')).toHaveTextContent(
      '平台算法如何改变年轻人的职业选择？',
    )
    expect(agentConversation.querySelector('[data-role="assistant-response"]')).toContainElement(
      within(agentConversation).getByRole('table'),
    )

    const activityButtons = within(agentConversation).getAllByRole('button', { name: '查看活动' })
    expect(activityButtons[0]).toBeVisible()
    // 独立 Agent 页右上角只留研究面板一个开关，来源、活动、研究记录都不再各占一个按钮。
    expect(within(agentConversation).getByRole('button', { name: '研究面板' })).toBeVisible()
    expect(within(agentConversation).queryByRole('button', { name: '查看来源' })).not.toBeInTheDocument()
    expect(within(agentConversation).getByRole('button', { name: '打开研究记录' })).toHaveClass('mobile-only')
    expect(await within(agentConversation).findByText('Agent 已完成工具调用')).toBeVisible()
    expect(within(agentConversation).getByRole('table')).toBeVisible()
    expect(within(agentConversation).getByRole('button', { name: '复制回答' })).toBeVisible()
    expect(within(agentConversation).getByRole('button', { name: '重新生成' })).toBeVisible()

    fireEvent.click(activityButtons[0])
    const activity = await screen.findByRole('region', { name: '研究面板' })
    expect(activity).toHaveTextContent('检索知识库')
    expect(activity).toHaveTextContent('找到 1 条知识库条目')

    fireEvent.click(within(agentConversation).getByRole('button', { name: /查看证据：平台劳动与职业选择/ }))
    const sources = await screen.findByRole('region', { name: '研究面板' })
    fireEvent.click(within(within(sources).getByRole('group', { name: '知识库' })).getByRole('button', { name: /平台劳动与职业选择/ }))
    const basis = await screen.findByRole('region', { name: '依据' })
    expect(basis).toHaveTextContent('平台排序会改变青年看见职业机会与评估风险的方式。')
    expect(within(basis).getByRole('link', { name: /打开知识条目/ })).toHaveAttribute(
      'href',
      '/knowledge/D1%3AC213?knowledge_release_id=release-a&return_to=%2Fagent%3Fconversation_id%3Dagent-conversation-1%26knowledge_release_id%3Drelease-a',
    )
  })

  it('keeps a failed tool call visible while the Agent continues with a useful answer', async () => {
    const conversation = agentConversationFixture('怎么理解年轻人越来越孤独？')
    conversation.turns[0].assistant.content = '知识库暂时不可用，我先基于通用社会学知识回答。'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/turns') return failedToolStreamResponse(conversation)
      if (request.pathname === '/api/agent/conversations') return json({ items: [] })
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const agentConversation = await screen.findByRole('region', { name: 'Everplain Agent 对话' })
    const textbox = within(agentConversation).getByRole('textbox', { name: '问 Everplain' })
    fireEvent.change(textbox, { target: { value: conversation.title } })
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    const failedToolSummary = await within(agentConversation).findByRole('button', { name: /工具调用未完成/ })
    expect(failedToolSummary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(failedToolSummary)
    // 研究面板同步列出这次失败调用，正文断言限定在对话内容里。
    const failedTranscript = within(agentConversation).getByRole('log', { name: '对话内容' })
    expect(within(failedTranscript).getByText('知识库暂时不可用')).toBeVisible()
    expect(within(agentConversation).getByText(conversation.turns[0].assistant.content)).toBeVisible()
  })

  it('keeps repeated tool calls separate while replayed events with the same call id stay idempotent', async () => {
    const conversation = agentConversationFixture('怎么理解青年孤独？')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/turns') return repeatedToolStreamResponse(conversation)
      if (request.pathname === '/api/agent/conversations') return json({ items: [] })
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const agentConversation = await screen.findByRole('region', { name: 'Everplain Agent 对话' })
    const textbox = within(agentConversation).getByRole('textbox', { name: '问 Everplain' })
    fireEvent.change(textbox, { target: { value: conversation.title } })
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    const repeatedToolSummary = await within(agentConversation).findByRole('button', { name: /Agent 已完成工具调用/ })
    expect(repeatedToolSummary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(repeatedToolSummary)
    const repeatedTranscript = within(agentConversation).getByRole('log', { name: '对话内容' })
    expect(within(repeatedTranscript).getAllByText('检索知识库')).toHaveLength(2)
    expect(within(repeatedTranscript).getByText(/query: 青年/)).toBeVisible()
    expect(within(repeatedTranscript).getByText(/query: 孤独/)).toBeVisible()
  })

  it('reveals citation context through Sources and Basis before opening a knowledge entry', async () => {
    const conversation = agentConversationFixture()
    conversation.turns[0].assistant.citations = [{
      citation_id: 'citation-1',
      label: '互惠规范',
      kind: 'entry',
      excerpt: '互惠规范描述了持续互动中信任与回报的关系。',
      knowledge_id: 'D1:C001',
    }]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/conversations') {
        return json({
          items: [{
            conversation_id: conversation.conversation_id,
            title: conversation.title,
            updated_at: conversation.updated_at,
            turn_count: conversation.turn_count,
          }],
        })
      }
      if (request.pathname === `/api/agent/conversations/${conversation.conversation_id}`) {
        return json(conversation)
      }
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const history = await screen.findByRole('region', { name: 'Agent 对话记录' })
    fireEvent.click(within(history).getByRole('button', { name: /为什么同一社区里的互助正在减少/ }))

    const citation = await screen.findByRole('button', { name: '查看证据：互惠规范' })
    expect(screen.queryByRole('region', { name: '依据' })).not.toBeInTheDocument()
    fireEvent.click(citation)

    const sources = await screen.findByRole('region', { name: '研究面板' })
    fireEvent.click(within(within(sources).getByRole('group', { name: '知识库' })).getByRole('button', { name: /互惠规范/ }))
    const basis = await screen.findByRole('region', { name: '依据' })
    expect(within(basis).getByText('互惠规范描述了持续互动中信任与回报的关系。')).toBeVisible()
  })

  it('hides internal citation ids from rendered Agent prose', async () => {
    const conversation = agentConversationFixture()
    conversation.turns[0].assistant.content = '回答依据 [knowledge:D1:C065]。'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/conversations') {
        return json({
          items: [{
            conversation_id: conversation.conversation_id,
            title: conversation.title,
            updated_at: conversation.updated_at,
            turn_count: conversation.turn_count,
          }],
        })
      }
      if (request.pathname === `/api/agent/conversations/${conversation.conversation_id}`) {
        return json(conversation)
      }
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const history = await screen.findByRole('region', { name: 'Agent 对话记录' })
    fireEvent.click(within(history).getByRole('button', { name: /为什么同一社区里的互助正在减少/ }))

    const transcript = await screen.findByRole('log', { name: '对话内容' })
    expect(transcript).toHaveTextContent('回答依据 。')
    expect(transcript).not.toHaveTextContent('knowledge:D1:C065')
  })

  it('keeps Agent conversation history after the page is reopened', async () => {
    const conversation = agentConversationFixture('县城青年为什么重新组织熟人关系？')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/turns') {
        return agentStreamResponse(conversation)
      }
      if (request.pathname === '/api/agent/conversations/agent-conversation-1') {
        return json(conversation)
      }
      if (request.pathname === '/api/agent/conversations') {
        return json({
          items: [{
            conversation_id: conversation.conversation_id,
            title: conversation.title,
            updated_at: conversation.updated_at,
            turn_count: conversation.turn_count,
          }],
        })
      }
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const history = await screen.findByRole('region', { name: 'Agent 对话记录' })
    await within(history).findByRole('button', {
      name: /县城青年为什么重新组织熟人关系？/,
    })
    cleanup()
    renderRoute('/agent', { status: 'authenticated' })

    const reopenedHistory = await screen.findByRole('region', { name: 'Agent 对话记录' })
    fireEvent.click(within(reopenedHistory).getByRole('button', {
      name: /县城青年为什么重新组织熟人关系？/,
    }))

    expect(
      await within(screen.getByRole('log', { name: '对话内容' })).findByText(
        '县城青年为什么重新组织熟人关系？',
      ),
    ).toBeVisible()
  })

  it('restores the real tool trace when a saved Agent conversation is reopened', async () => {
    const conversation = agentConversationFixture('请检索知识库解释社会行动四类型')
    conversation.turns[0].tool_traces = [
      {
        tool: 'search_knowledge',
        phase: 'started',
        call_id: 'tool-search-1',
        input: { query: '社会行动四类型' },
        output: null,
        detail: '正在检索知识库',
        error: null,
      },
      {
        tool: 'search_knowledge',
        phase: 'finished',
        call_id: 'tool-search-1',
        input: { query: '社会行动四类型' },
        output: {
          result_count: 1,
          items: [{
            knowledge_id: 'D1:C029',
            title: '社会行动四类型',
            excerpt: '韦伯将社会行动区分为目的理性、价值理性、情感和传统四类。',
          }],
        },
        detail: '找到 1 条知识库预览内容（未审核）：社会行动四类型：韦伯将社会行动区分为目的理性、价值理性、情感和传统四类。',
        error: null,
      },
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = requestUrl(input)
      if (request.pathname === '/api/agent/conversations') {
        return json({
          items: [{
            conversation_id: conversation.conversation_id,
            title: conversation.title,
            updated_at: conversation.updated_at,
            turn_count: conversation.turn_count,
          }],
        })
      }
      if (request.pathname === `/api/agent/conversations/${conversation.conversation_id}`) {
        return json(conversation)
      }
      return json({}, 404)
    }))
    renderRoute('/agent', { status: 'authenticated' })

    const history = await screen.findByRole('region', { name: 'Agent 对话记录' })
    fireEvent.click(within(history).getByRole('button', { name: /社会行动四类型/ }))
    const transcript = await screen.findByRole('log', { name: '对话内容' })
    const restoredToolSummary = await within(transcript).findByRole('button', { name: /Agent 已完成工具调用/ })
    expect(restoredToolSummary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(restoredToolSummary)
    expect(within(transcript).getByText(/韦伯将社会行动区分为目的理性/)).toBeVisible()
  })

  it('keeps Shift+Enter available for a new line on the Agent page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })))
    renderRoute('/agent', { status: 'authenticated' })

    const agentConversation = await screen.findByRole('region', { name: 'Everplain Agent 对话' })
    const textbox = within(agentConversation).getByRole('textbox', { name: '问 Everplain' })

    fireEvent.change(textbox, { target: { value: '第一行' } })
    expect(fireEvent.keyDown(textbox, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
    })).toBe(true)
    fireEvent.change(textbox, { target: { value: '第一行\n第二行' } })

    expect(textbox).toHaveValue('第一行\n第二行')
    expect(
      within(agentConversation).queryByText('当前只演示对话界面，尚未连接研究模型。'),
    ).not.toBeInTheDocument()
  })

  it('shows the public product home at root for an anonymous visitor', async () => {
    renderRoute('/')

    expect(
      await screen.findByRole('heading', {
        level: 1, name: /^Everplain，帮你/,
      }),
    ).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/')
  })

  it('sends an authenticated root visit straight to the work home', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], next_cursor: null })))
    renderRoute('/', { status: 'authenticated' })

    expect(await screen.findByRole('heading', { name: /今天想弄清楚什么？/ })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/app')
  })

  it('opens each personal document card at its original library source', async () => {
    vi.mocked(readPersonalGraph).mockResolvedValueOnce({ nodes: [{ id: 'n1', label: '读书笔记', nodeType: 'document' }], edges: [], sources: { n1: { library_id: 'kb-1', document_id: 'doc-1', source_url: null } }, document_count: 1, pending_count: 0, mode: 'mock' } as unknown as Awaited<ReturnType<typeof readPersonalGraph>>)
    renderRoute('/app', { status: 'authenticated' })
    const card = await screen.findByRole('link', { name: /我的笔记.*读书笔记/ })
    expect(card).toHaveAttribute('href', '/library?kb_id=kb-1&document_id=doc-1')
    expect(screen.getByText('1 份资料')).toBeVisible()
  })

  it('offers a real import path when the personal library is empty', async () => {
    renderRoute('/app', { status: 'authenticated' })
    expect(await screen.findByRole('heading', { name: '把第一份资料，放进来。' })).toBeVisible()
    expect(screen.getByRole('link', { name: /开始导入/ })).toHaveAttribute('href', '/imports')
    expect(screen.queryByRole('link', { name: /内置案例/ })).not.toBeInTheDocument()
  })

  it('lets the user retry a failed personal-library read', async () => {
    // The research row has its own query and error boundary; don't let an unstubbed
    // request race the library failure or use a page-wide alert selector.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestUrl(input).pathname
      if (path === '/api/research-tasks' || path === '/api/agent/conversations') {
        return json({ items: [], next_cursor: null })
      }
      return json({}, 404)
    }))
    const readsBefore = vi.mocked(readPersonalGraph).mock.calls.length
    vi.mocked(readPersonalGraph).mockRejectedValueOnce(new Error('资料读取暂时失败'))
    renderRoute('/app', { status: 'authenticated' })
    const materials = await screen.findByRole('region', { name: '我的资料' })
    expect(await within(materials).findByRole('alert')).toHaveTextContent('资料读取暂时失败')
    expect(readPersonalGraph).toHaveBeenCalledTimes(readsBefore + 1)
    fireEvent.click(within(materials).getByRole('button', { name: '重试' }))
    expect(await within(materials).findByRole('heading', { name: '把第一份资料，放进来。' })).toBeVisible()
    expect(readPersonalGraph).toHaveBeenCalledTimes(readsBefore + 2)
    expect(within(materials).queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['anonymous' as const, '登录'],
    ['authenticated' as const, '工作台'],
  ])('keeps /welcome public for a %s visitor', async (status, action) => {
    renderRoute('/welcome', { status })

    expect(
      await screen.findByRole('heading', {
        level: 1, name: /^Everplain，帮你/,
      }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: action })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/welcome')
  })

  it.each([
    ['/login', '登录 Everplain'],
    ['/register', '注册'],
    ['/password-reset/reset-token-value', '重设密码'],
  ])('renders the public account route %s for an anonymous visitor', async (path, title) => {
    renderRoute(path)

    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  })

  it.each([
    '/app',
    '/agent',
    '/research/new?source=home',
    '/research/task-1/phenomenon',
    '/research/task-1/match',
    '/research/task-1/framework',
    '/my',
    '/settings',
    '/admin/users',
  ])('sends anonymous visitors to login while preserving %s', async (path) => {
    renderRoute(path)

    expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent(
      `/login?redirect=${encodeURIComponent(path)}`,
    )
  })

  it('keeps an authenticated visitor on a protected route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return researchWorkspaceResponse(input, '/research/task-1/phenomenon')
    }))
    renderRoute('/research/task-1/phenomenon', { status: 'authenticated' })

    expect(
      await screen.findByRole('heading', { name: '理论判断文档' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '登录 Everplain' })).not.toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/research/task-1/workspace/map')
  })

  it('waits for the session boundary before deciding on a protected route', async () => {
    renderRoute('/my', { status: 'loading' })

    expect(await screen.findByRole('status')).toHaveTextContent('正在确认登录状态')
    expect(screen.queryByRole('heading', { name: '登录 Everplain' })).not.toBeInTheDocument()
  })

  it('uses a same-origin redirect after login', async () => {
    renderRoute('/login?redirect=%2Fresearch%2Ftask-1%2Fframework')

    expect(await screen.findByRole('button', { name: '继续' })).toBeVisible()
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute(
      'href',
      `/register?redirect=${encodeURIComponent('/research/task-1/framework')}`,
    )
  })

  it('rejects an external login redirect', async () => {
    renderRoute('/login?redirect=https%3A%2F%2Fevil.example%2Ftakeover')

    expect(await screen.findByRole('link', { name: '创建账号' })).toHaveAttribute(
      'href',
      `/register?redirect=${encodeURIComponent('/app')}`,
    )
  })

  it('rejects a malformed login redirect without crashing the page', async () => {
    renderRoute('/login?redirect=%2F%2F%5B')

    expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute(
      'href',
      `/register?redirect=${encodeURIComponent('/app')}`,
    )
  })

  it('preserves a protected route hash through login', async () => {
    const destination = '/research/task-1/phenomenon?source=home#evidence'
    renderRoute(destination)

    expect(await screen.findByRole('heading', { name: '登录 Everplain' })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent(
      `/login?redirect=${encodeURIComponent(destination)}`,
    )
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute(
      'href',
      `/register?redirect=${encodeURIComponent(destination)}`,
    )
  })

  it('returns to the protected deep link after a real login response', async () => {
    const destination = '/research/task-1/framework?from=my#methods'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input))
      const url = requestUrl(input)
      if (request.method === 'GET' && url.pathname === '/api/session') {
        return new Response(
          JSON.stringify({ error: { code: 'unauthenticated', message: '请先登录。', trace_id: 'trace-1' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (request.method === 'GET') {
        return researchWorkspaceResponse(input, '/research/task-1/framework')
      }
      return new Response(JSON.stringify({
        session_id: '25b191bb-2d85-4a88-8863-2cabf506a7a8',
        status: 'active',
        version: 1,
        allowed_actions: ['logout'],
        user: { user_id: '95306bf9-194d-4677-be2d-eef4f6aa86d1', email: 'researcher@example.com', display_name: null },
        expires_at: '2026-08-14T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={[`/login?redirect=${encodeURIComponent(destination)}`]}>
        <QueryClientProvider client={queryClient}>
          <AccountProvider>
            <AppRoutes />
            <RouteLocation />
          </AccountProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'researcher@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'research-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }))

    expect(await screen.findByRole('heading', { name: '研究框架文档' })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/research/task-1/workspace/writing?from=my#methods')
  })

  it('returns home after logging out from my research', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request
      if (request.method === 'GET' && request.url.endsWith('/api/session')) {
        return new Response(JSON.stringify({
          session_id: '25b191bb-2d85-4a88-8863-2cabf506a7a8',
          status: 'active',
          version: 1,
          allowed_actions: ['logout'],
          user: {
            user_id: '95306bf9-194d-4677-be2d-eef4f6aa86d1',
            email: 'researcher@example.com',
            display_name: null,
          },
          expires_at: '2026-08-14T00:00:00Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (request.method === 'GET') {
        return new Response(JSON.stringify({ items: [], next_cursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        status: 'logged_out',
        version: 1,
        allowed_actions: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/my']} useTransitions={false}>
        <QueryClientProvider client={queryClient}>
          <AccountProvider>
            <AppRoutes />
            <RouteLocation />
          </AccountProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '退出' }))

    expect(await screen.findByRole('heading', { level: 1, name: /^Everplain，帮你/ })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('/')
  })

})

it('opens private knowledge in the library and links each topic to its original segment', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = requestUrl(input)
    if (url.pathname === '/api/shared-knowledge-bases/kb-course') return json({
      id: 'kb-course', name: '访谈方法', viewer_access: 'owner', sharing_enabled: false,
      documents: [{ id: 'doc-course', filename: '访谈.pptx', status: 'ready', size_bytes: 100,
        media_type: 'text/plain', parse_id: 'parse-course', created_at: '2026-09-08',
        knowledge_status: 'ready', index_status: 'ready', knowledge: {
          summary: '访谈材料摘要', topics: [{ title: '追问', summary: '追问具体经历。', segment_ids: ['segment-course'] }], relations: [],
        } }],
    })
    if (url.pathname === '/api/shared-knowledge-bases') return json({ items: [{ id: 'kb-course', name: '访谈方法', viewer_access: 'owner', documents: [] }] })
    return json({ items: [] })
  })
  renderRoute('/library/knowledge?kb_id=kb-course', { status: 'authenticated' })
  fireEvent.click(await screen.findByRole('button', { name: '查看知识点 追问' }))
  expect(await screen.findByText('追问具体经历。')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /阅读原文.*访谈.pptx/ })).toHaveAttribute('href', '/library?kb_id=kb-course&document_id=doc-course&segment_id=segment-course')
})

vi.mock('../modules/agent-profile', () => ({ readAgentProfile: vi.fn(async () => ({ name: 'Everplain', avatar_id: 'cheng', color: '#b8c5b0', greeting: '你想研究什么？', speaking_style: 'clear', setup_step: 4, setup_completed: true, questionnaire: { occupation: '', industry: '', goals: [], interests: [], additional: '' }, version: 1 })) }))

vi.mock('../modules/personal-graph', () => ({ readPersonalGraph: vi.fn(async () => ({ nodes: [], edges: [], sources: {}, document_count: 0, pending_count: 0, mode: 'mock' })) }))
