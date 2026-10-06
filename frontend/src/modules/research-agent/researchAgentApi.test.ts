import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildUrl = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())

vi.mock('../../api/client', () => ({ apiClient: { buildUrl, get } }))

import {
  confirmResearchStartProposal,
  deleteAgentConversation,
  getAgentConversation,
  getConversationContextSummary,
  getResearchStartJourney,
  listAgentConversations,
  parseAgentEventStream,
  stopAgentRun,
  streamAgentTurn,
} from './researchAgentApi'

beforeEach(() => {
  buildUrl.mockReset()
  get.mockReset()
  buildUrl.mockImplementation(({ path, url, query }: {
    path?: Record<string, unknown>
    url: string
    query?: Record<string, unknown>
  }) => {
    const resolvedPath = Object.entries(path ?? {}).reduce(
      (current, [key, value]) => current.replace(`{${key}}`, encodeURIComponent(String(value))),
      url,
    )
    const suffix = query ? `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}` : ''
    return `https://api.qunxue.test${resolvedPath}${suffix}`
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server-owned conversation context adapter', () => {
  const summary = { status: 'ready', scope: 'conversation_messages', omitted_messages: 0, summary_sources: [], summary: '跨对话里你提到周五迁移与旧入口回退。', updated_at: '2026-10-05T00:00:00Z', cards: [{ title: '核对迁移回退入口', description: '根据两次迁移讨论整理。', card_id: 'migration-card', version: 'v1', sources: [{ role: 'user', sequence: 0, conversation_id: 'one', message_id: 'one-user-1', quote: '周五迁移', title: '迁移讨论' }] }] }
  it('reads the authenticated server cache without generating a turn', async () => {
    get.mockResolvedValue({ data: summary })
    const controller = new AbortController()
    expect(await getConversationContextSummary(controller.signal)).toEqual(summary)
    expect(get).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: '/api/agent/context-summary', credentials: 'include', signal: controller.signal, cache: 'no-store' }))
  })
  it.each([
    { status: 'pending', is_stale: true, usage_status: 'pending' },
    { status: 'failed', status_reason: 'daily_budget', is_stale: true, usage_status: 'known' },
    { status: 'ready', is_stale: false, usage_status: 'pending' },
    { status: 'ready', usage_status: null },
  ])('accepts actual cached content independently of freshness and usage metadata: %o', async metadata => {
    const payload = { ...summary, ...metadata }
    get.mockResolvedValue({ data: payload })
    expect(await getConversationContextSummary()).toEqual(payload)
  })
  it.each([{ items: [] }, { ...summary, scope: 'assistant_messages' }, { ...summary, cards: [{ ...summary.cards[0], sources: [] }] }, { ...summary, cards: [{ ...summary.cards[0], card_id: undefined, version: undefined, prompt: 'INTERNAL_PROMPT must never become a draft' }] }])('does not invent cards for an invalid cached response', async payload => {
    get.mockResolvedValue({ data: payload })
    await expect(getConversationContextSummary()).rejects.toThrow('最近对话建议暂时不可用')
  })
  it('exposes an honest read failure instead of falling back to a template', async () => {
    get.mockResolvedValue({ error: { detail: 'unavailable' }, response: new Response(null, { status: 503 }) })
    await expect(getConversationContextSummary()).rejects.toThrow('无法读取最近对话建议')
  })
  it.each([{ is_stale: 'true' }, { is_stale: null }, { usage_status: 'unknown' }, { usage_status: 1 }])('rejects malformed freshness/usage metadata: %o', async metadata => {
    get.mockResolvedValue({ data: { ...summary, ...metadata } })
    await expect(getConversationContextSummary()).rejects.toThrow('最近对话建议暂时不可用')
  })
})

describe('research agent SSE adapter', () => {
  it('stops one server run explicitly instead of relying on stream disconnection', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await stopAgentRun('run-mobile')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.qunxue.test/api/agent/runs/run-mobile/stop',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    )
  })

  it('still sends an idempotent stop request when random UUIDs are unavailable', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('crypto', {})

    await stopAgentRun('run-without-random-uuid')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.qunxue.test/api/agent/runs/run-without-random-uuid/stop',
      expect.objectContaining({
        headers: { 'Idempotency-Key': 'stop-agent-run:run-without-random-uuid' },
      }),
    )
  })

  it('sends the required idempotency key when deleting a conversation', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await deleteAgentConversation('conversation-1')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.qunxue.test/api/agent/conversations/conversation-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'Idempotency-Key': 'delete-agent-conversation:conversation-1' },
      }),
    )
  })

  it('preserves the Agent runtime mode reported by the independent runner', () => {
    expect(parseAgentEventStream(
      'event: turn_started\ndata: {"conversation_id":"conversation-1","run_id":"run-1","replayed":false,"runtime_mode":"base"}\n',
    )).toEqual([{
      type: 'turn_started',
      conversation_id: 'conversation-1',
      run_id: 'run-1',
      replayed: false,
      runtime_mode: 'base',
    }])
  })

  it('parses streamed deltas and citation events without exposing framework messages', () => {
    const events = parseAgentEventStream([
      'event: agent_status',
      'data: {"status":"thinking"}',
      '',
      'event: assistant_delta',
      'data: {"delta":"知识"}',
      '',
      'event: citation_added',
      'data: {"citation_id":"knowledge:C1","label":"符号互动论","kind":"entry"}',
      '',
    ].join('\n'))

    expect(events).toEqual([
      { type: 'agent_status', status: 'thinking' },
      { type: 'assistant_delta', delta: '知识' },
      {
        type: 'citation_added',
        citation: { citation_id: 'knowledge:C1', label: '符号互动论', kind: 'entry' },
      },
    ])
  })

  it('ignores retired Agent statuses outside the frozen stream contract', () => {
    expect(parseAgentEventStream(
      'event: agent_status\ndata: {"status":"retrieving"}\n',
    )).toEqual([])
  })

  it('parses tool progress events for the visible Agent work trace', () => {
    const events = parseAgentEventStream([
      'event: tool_started',
      'data: {"tool":"search_knowledge","call_id":"tool-call-1","input":{"query":"青年孤独"}}',
      '',
      'event: tool_finished',
      'data: {"tool":"search_knowledge","call_id":"tool-call-1","output":{"summary":"找到 3 条可引用证据"}}',
      '',
    ].join('\n'))

    expect(events).toEqual([
      {
        type: 'tool_started',
        tool: 'search_knowledge',
        call_id: 'tool-call-1',
        input: { query: '青年孤独' },
        detail: null,
      },
      {
        type: 'tool_finished',
        tool: 'search_knowledge',
        call_id: 'tool-call-1',
        output: { summary: '找到 3 条可引用证据' },
        detail: null,
      },
    ])
  })

  it('parses a typed research canvas patch independently from tool activity', () => {
    const patch = {
      schema_version: 1 as const,
      nodes: [{
        id: 'claim-time-poverty',
        kind: 'claim' as const,
        title: '时间贫困压缩稳定关系的维护空间',
        summary: '高强度劳动与通勤使重复互动更难持续。',
        status: 'grounded' as const,
        citation_ids: [],
      }],
      relations: [],
      remove_node_ids: [],
      remove_relation_ids: [],
    }

    expect(parseAgentEventStream(
      `event: canvas_patch\ndata: ${JSON.stringify(patch)}\n`,
    )).toEqual([{ type: 'canvas_patch', patch }])
  })

  it('rejects canvas patches whose nested nodes or relations violate the contract', () => {
    const invalidPatches = [
      {
        schema_version: 1,
        nodes: [{
          id: 'tool-step',
          kind: 'tool',
          title: '检索知识库',
          status: 'running',
          citation_ids: [],
        }],
        relations: [],
        remove_node_ids: [],
        remove_relation_ids: [],
      },
      {
        schema_version: 1,
        nodes: [],
        relations: [{
          id: 'relation-invalid',
          source: 'claim-a',
          relation: 'supports',
        }],
        remove_node_ids: [],
        remove_relation_ids: [],
      },
    ]

    for (const patch of invalidPatches) {
      expect(parseAgentEventStream(
        `event: canvas_patch\ndata: ${JSON.stringify(patch)}\n`,
      )).toEqual([])
    }
  })

  it('parses a failed tool call without turning it into a completed step', () => {
    expect(parseAgentEventStream([
      'event: tool_failed',
      'data: {"tool":"search_knowledge","call_id":"tool-call-2","input":{"query":"青年孤独"},"message":"知识库暂时不可用","error_code":"knowledge_unavailable","detail":"请稍后重试"}',
      '',
    ].join('\n'))).toEqual([
      {
        type: 'tool_failed',
        tool: 'search_knowledge',
        call_id: 'tool-call-2',
        input: { query: '青年孤独' },
        message: '知识库暂时不可用',
        error_code: 'knowledge_unavailable',
        detail: '请稍后重试',
      },
    ])
  })

  it('parses an explicit interruption event', () => {
    expect(parseAgentEventStream(
      'event: turn_interrupted\ndata: {"code":"interrupted","message":"已停止生成"}\n',
    )).toEqual([
      { type: 'turn_interrupted', code: 'interrupted', message: '已停止生成' },
    ])
  })

  it('builds every Agent request through the shared API client base URL', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/api/agent/conversations')) {
        return new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/agent/conversations/')) {
        return new Response('{"conversation_id":"conversation/1"}', {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        'event: turn_failed\ndata: {"code":"agent_unavailable","message":"暂不可用"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    })
    vi.stubGlobal('fetch', fetch)

    await listAgentConversations()
    await getAgentConversation('conversation/1')
    await streamAgentTurn(
      { conversation_id: null, message: '你好', idempotencyKey: 'turn-1' },
      () => undefined,
    )

    expect(buildUrl.mock.calls.map(([options]) => options)).toEqual([
      { url: '/api/agent/conversations' },
      {
        url: '/api/agent/conversations/{conversation_id}',
        path: { conversation_id: 'conversation/1' },
      },
      { url: '/api/agent/turns' },
    ])
    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      'https://api.qunxue.test/api/agent/conversations',
      'https://api.qunxue.test/api/agent/conversations/conversation%2F1',
      'https://api.qunxue.test/api/agent/turns',
    ])
  })

  it('reconnects a truncated mobile stream with the same idempotency key', async () => {
    const events: string[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(
        'event: turn_started\ndata: {"conversation_id":"conversation-1","run_id":"run-1","replayed":false}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'event: turn_started\ndata: {"conversation_id":"conversation-1","run_id":"run-1","replayed":true}\n\n'
          + 'event: turn_completed\ndata: {"conversation":{"conversation_id":"conversation-1","turns":[]},"knowledge_release_id":"release-1"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ))
    vi.stubGlobal('fetch', fetch)

    await streamAgentTurn(
      { conversation_id: null, message: '问题', idempotencyKey: 'truncated-1' },
      (event) => events.push(event.type),
    )

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(events).toContain('turn_completed')
  })

  it('surfaces a validation response as an actionable input error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 422 })))

    await expect(streamAgentTurn(
      { conversation_id: null, message: '超长问题', idempotencyKey: 'invalid-1' },
      () => undefined,
    )).rejects.toThrow('问题长度或格式不符合要求')
  })

  it('loads and confirms the conversation-owned research start through the shared client', async () => {
    const journey = {
      conversation_id: 'conversation/1',
      status: 'proposal_pending',
      proposal: {
        proposal_id: 'proposal-1',
        version: 3,
        status: 'pending_confirmation',
        phenomenon: '社区互助正在减少',
        research_intent: '理解互助衰退的机制',
        context: '大城市老旧小区',
        knowledge_release_id: 'release-formal-1',
        source_turn_id: 'turn-1',
        source_run_id: 'run-1',
      },
      task_id: null,
      navigation: null,
    }
    const confirmed = {
      ...journey,
      status: 'task_bound',
      proposal: { ...journey.proposal, status: 'confirmed' },
      task_id: 'task-1',
      navigation: {
        task_id: 'task-1',
        status: 'in_progress',
        current_stage: 'theory_matching',
        phenomenon_summary: '社区互助正在减少',
        current_framework_id: null,
        allowed_actions: ['start_matching'],
        resume_path: '/research/task-1/match',
        blocker: null,
        retry: null,
      },
    }
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      return new Response(JSON.stringify(init?.method === 'POST' ? confirmed : journey), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(getResearchStartJourney('conversation/1')).resolves.toEqual({
      conversationId: 'conversation/1',
      status: 'proposal_pending',
      taskId: null,
      proposal: {
        proposalId: 'proposal-1',
        phenomenon: '社区互助正在减少',
        researchIntent: '理解互助衰退的机制',
        context: '大城市老旧小区',
        version: 3,
        status: 'pending_confirmation',
      },
      knowledgeReleaseId: 'release-formal-1',
      phenomenonConfirmed: false,
      resumePath: null,
    })
    await expect(confirmResearchStartProposal({
      proposalId: 'proposal-1',
      expectedVersion: 3,
      phenomenon: '社区互助正在减少',
      researchIntent: '理解互助衰退的机制',
      context: '大城市老旧小区',
      idempotencyKey: 'research-start:proposal-1',
    })).resolves.toEqual({
      conversationId: 'conversation/1',
      status: 'task_bound',
      taskId: 'task-1',
      proposal: {
        proposalId: 'proposal-1',
        phenomenon: '社区互助正在减少',
        researchIntent: '理解互助衰退的机制',
        context: '大城市老旧小区',
        version: 3,
        status: 'confirmed',
      },
      knowledgeReleaseId: 'release-formal-1',
      phenomenonConfirmed: true,
      resumePath: '/research/task-1/match',
    })

    expect(buildUrl.mock.calls.map(([options]) => options)).toEqual([
      {
        url: '/api/agent/conversations/{conversation_id}/journey',
        path: { conversation_id: 'conversation/1' },
      },
      {
        url: '/api/agent/research-start-proposals/{proposal_id}/confirm',
        path: { proposal_id: 'proposal-1' },
      },
    ])
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.qunxue.test/api/agent/conversations/conversation%2F1/journey', {
      credentials: 'include',
      signal: undefined,
    })
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.qunxue.test/api/agent/research-start-proposals/proposal-1/confirm', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'research-start:proposal-1',
      },
      body: JSON.stringify({
        expected_version: 3,
        phenomenon: '社区互助正在减少',
        research_intent: '理解互助衰退的机制',
        context: '大城市老旧小区',
      }),
      signal: undefined,
    })
  })
})

it('ends repeated connection failures so the user can recover explicitly', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn(async () => { throw new TypeError('offline') })
  vi.stubGlobal('fetch', fetch)
  const result = expect(streamAgentTurn({ conversation_id: 'a', message: '保留问题', idempotencyKey: 'same-run' }, () => undefined)).rejects.toThrow(/连接|offline|中断/)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(4)
  await result
  vi.useRealTimers()
})

it('sends the selected course through the actual streaming request', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('event: turn_failed\ndata: {"code":"agent_unavailable","message":"暂不可用"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  await streamAgentTurn({ message: '按课件回答', reference_knowledge_base_id: 'course-1', idempotencyKey: 'course-turn' }, () => undefined)
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ reference_knowledge_base_id: 'course-1' })
})

describe('knowledge readiness SSE decisions', () => {
  const status = { state: 'missing_index', embedding_model: 'embedding', total_count: 2, ready_count: 1, missing_count: 1, processing_count: 0, failed_count: 1,
    ready_document_ids: ['ready'], ready_documents: [], missing_documents: [{ knowledge_base_id: 'kb', document_id: 'doc', parse_id: 'parse', filename: 'failed.pdf', index_status: 'failed', index_error: 'provider unavailable' }] }
  it('parses a structured readiness decision and treats it as terminal without reconnecting', async () => {
    const fetch = vi.fn(async () => new Response(`event: knowledge_index_choice_required\ndata: ${JSON.stringify({ status })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const events = vi.fn()
    await streamAgentTurn({ message: '检索资料', idempotencyKey: 'first' }, events)
    expect(events).toHaveBeenCalledWith({ type: 'knowledge_index_choice_required', status })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('sends only an explicit ready-only choice, never a repair command in a model turn', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('event: turn_interrupted\ndata: {"code":"stop","message":"stop"}\n\n'))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: '检索资料', idempotencyKey: 'skip', knowledge_index_action: 'skip_missing' }, vi.fn())
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ knowledge_index_action: 'skip_missing' })
  })
  it('rejects malformed status payloads rather than inventing counts', () => {
    expect(parseAgentEventStream('event: knowledge_index_choice_required\ndata: {"status":{"state":"missing_index"}}\n\n')).toEqual([])
  })
})


describe('cursor subscription recovery', () => {
  function frame(id: number, name: string, body: unknown) {
    return `id: run-1:${id}\nevent: ${name}\ndata: ${JSON.stringify(body)}\n\n`
  }
  const completed = { conversation: { conversation_id: 'conversation-1', turns: [] }, knowledge_release_id: 'release-1' }

  it('replays by event identity without duplicated text or another POST', async () => {
    let body = ''
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(frame(1, 'turn_started', { run_id: 'run-1', conversation_id: 'conversation-1', replayed: false }) + frame(2, 'assistant_delta', { delta: 'ABC' })))
      .mockResolvedValueOnce(new Response(frame(2, 'assistant_delta', { delta: 'ABC' }) + frame(3, 'assistant_delta', { delta: 'DEF' }) + frame(4, 'turn_completed', completed)))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'question', idempotencyKey: 'key' }, event => { if (event.type === 'assistant_delta') body += event.delta })
    expect(body).toBe('ABCDEF')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetch.mock.calls[1][0]).toBe('https://api.qunxue.test/api/agent/runs/run-1/events?after=2')
  })

  it('reconciles lost initial headers with the original snapshot then subscribes after its cursor', async () => {
    let body = ''
    const snapshot = { run_id: 'run-1', conversation_id: 'conversation-1', idempotency_key: 'key', status: 'running', partial_answer: 'already persisted', last_event_sequence: 7, output_attempts: [{ attempt_id: 'attempt-1', ordinal: 1, status: 'running', answer: 'already persisted', created_at: '2026-10-05T00:00:00Z' }] }
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('headers lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
      .mockResolvedValueOnce(new Response(frame(8, 'assistant_delta', { delta: ' tail' }) + frame(9, 'turn_completed', completed)))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'question', idempotencyKey: 'key' }, event => {
      if (event.type === 'turn_snapshot') body = event.run.partial_answer
      if (event.type === 'assistant_delta') body += event.delta
    })
    expect(body).toBe('already persisted tail')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetch.mock.calls[1][0]).toBe('https://api.qunxue.test/api/agent/runs/by-idempotency-key')
    expect(fetch.mock.calls[2][0]).toBe('https://api.qunxue.test/api/agent/runs/run-1/events?after=7')
  })

  it('recovers an incomplete final frame by GET without regenerating', async () => {
    const received: string[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(frame(1, 'turn_started', { run_id: 'run-1', conversation_id: 'conversation-1' }) + frame(2, 'assistant_delta', { delta: 'body' }) + 'id: run-1:3\nevent: turn_completed\ndata: {"conversation":'))
      .mockResolvedValueOnce(new Response(frame(3, 'turn_completed', completed)))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'question', idempotencyKey: 'key' }, event => received.push(event.type))
    expect(received).toEqual(['turn_started', 'assistant_delta', 'turn_completed'])
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetch.mock.calls[1][0]).toBe('https://api.qunxue.test/api/agent/runs/run-1/events?after=2')
  })

  it('resumes a server-running restored turn with no execution command', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(frame(10, 'turn_completed', completed)))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'question', idempotencyKey: 'key' }, () => undefined, undefined, { runId: 'run-1', after: 9 })
    expect(fetch.mock.calls).toHaveLength(1)
    expect(fetch.mock.calls[0][0]).toBe('https://api.qunxue.test/api/agent/runs/run-1/events?after=9')
    expect(fetch.mock.calls[0][1]?.method).toBeUndefined()
  })
})

describe('dedicated document draft event recovery', () => {
  const draft = { run_id: 'run-1', attempt_id: 'attempt-1', call_id: 'call-1', document_id: 'doc', base_version: 1, selection_start: 0, selection_end: 2, sequence: 2, replacement_text: '新😀', state: 'streaming' }
  const frame = (id: number, name: string, body: unknown) => `id: run-1:${id}\nevent: ${name}\ndata: ${JSON.stringify(body)}\n\n`
  const ended = frame(10, 'turn_interrupted', { code: 'stop', message: 'stop' })
  it('parses replacement snapshots without exposing raw tool fields', () => {
    const events = parseAgentEventStream(frame(2, 'writing_preview', { ...draft, thinking: 'private', original_text: 'private', arguments: { secret: 'private' } }))
    expect(events).toEqual([{ type: 'writing_preview', ...draft, event_id: 'run-1:2' }])
  })
  it('replays cursor events once and never concatenates repeated writing snapshots', async () => {
    const received: string[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(frame(1, 'turn_started', { run_id: 'run-1', attempt_id: 'attempt-1', conversation_id: 'c' }) + frame(2, 'writing_preview', draft)))
      .mockResolvedValueOnce(new Response(frame(2, 'writing_preview', draft) + frame(3, 'writing_preview', { ...draft, sequence: 3, replacement_text: '新😀稿' }) + ended))
    vi.stubGlobal('fetch', fetch)
    await streamAgentTurn({ message: 'write', idempotencyKey: 'key' }, event => { if (event.type === 'writing_preview') received.push(event.replacement_text) })
    expect(received).toEqual(['新😀', '新😀稿'])
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('recovers exact preview state after lost initial headers, excluding other attempts and unsafe payloads', async () => {
    const snapshot = { run_id: 'run-1', conversation_id: 'c', idempotency_key: 'key', status: 'running', partial_answer: '', last_event_sequence: 7,
      output_attempts: [{ attempt_id: 'attempt-1', ordinal: 1, status: 'running', answer: '', created_at: '2026-10-05T00:00:00Z' }],
      writing_previews: [draft, { ...draft, attempt_id: 'old', replacement_text: '旧稿' }, { ...draft, run_id: 'foreign', replacement_text: 'foreign' }, { ...draft, replacement_text: '\uD83D' }] }
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('lost')).mockResolvedValueOnce(new Response(JSON.stringify(snapshot))).mockResolvedValueOnce(new Response(ended))
    vi.stubGlobal('fetch', fetch)
    const events = vi.fn()
    await streamAgentTurn({ message: 'write', idempotencyKey: 'key' }, events)
    const restored = events.mock.calls.find(([event]) => event.type === 'turn_snapshot')![0]
    expect(restored.run.writing_previews).toEqual([{ type: 'writing_preview', ...draft }])
    expect(fetch.mock.calls[2][0]).toContain('/events?after=7')
  })
  it('drops late previews from an earlier model attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(frame(1, 'turn_started', { run_id: 'run-1', attempt_id: 'attempt-new', conversation_id: 'c' }) + frame(2, 'writing_preview', draft) + ended)))
    const events = vi.fn()
    await streamAgentTurn({ message: 'write', idempotencyKey: 'key' }, events)
    expect(events.mock.calls.filter(([event]) => event.type === 'writing_preview')).toHaveLength(0)
  })
})


it('treats a stale or revoked context card as a definite rejection without run lookups', async () => {
  const message = '这张背景卡已更新或来源不可访问，请重新选择。'
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'conflict', message, trace_id: 'private-trace-id' } }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  await expect(streamAgentTurn({ message: '继续讨论\n整理下一步。', context_suggestion: { card_id: 'expired-card', version: 'old-version' }, idempotencyKey: 'stale-card-key' }, () => undefined)).rejects.toMatchObject({ message, status: 409 })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.qunxue.test/api/agent/turns', expect.objectContaining({ method: 'POST' }))
})
