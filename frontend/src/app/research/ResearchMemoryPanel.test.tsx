import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResearchMemoryPanel } from './ResearchMemoryPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function setup(preview = true, taskId: string | null = null) {
  render(<MemoryRouter initialEntries={['/research/materials?tab=memory&preview=memory']}><ResearchMemoryPanel taskId={taskId} projectName="研究项目" preview={preview} /></MemoryRouter>)
}
describe('ResearchMemoryPanel', () => {
  it('opens with a readable overview and reveals individual records on request', () => {
    setup()
    expect(screen.getByRole('region', { name: '记忆概览' })).toHaveTextContent('知识生产')
    expect(screen.queryByRole('list', { name: '个人记忆列表' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /查看记忆明细/ }))
    expect(screen.getByRole('list', { name: '个人记忆列表' })).toBeVisible()
  })
  it('previews creation, editing, history and deletion without network writes', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); setup()
    expect(screen.getByText('5 条记忆')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }))
    fireEvent.change(screen.getByLabelText('希望 Agent 记住什么？'), { target: { value: '核验原文。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    expect(await screen.findByText('6 条记忆')).toBeVisible()
    let card = screen.getByRole('complementary', { name: '记忆详情' })
    fireEvent.click(within(card).getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留反例。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    card = screen.getByRole('complementary', { name: '记忆详情' })
    fireEvent.click(within(card).getByRole('button', { name: /修改历史/ }))
    expect(within(card).getByText('核验原文。')).toBeVisible()
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(card).getByRole('button', { name: '取消' }))
    expect(card).toBeVisible()
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(card).getByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('5 条记忆')).toBeVisible()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('separates project memory use from learning and exposes source quotes', () => {
    setup(true, 'project-1')
    expect(screen.getByText('4 条记忆')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '记忆设置' }))
    fireEvent.click(screen.getByRole('switch', { name: '使用项目记忆' }))
    expect(screen.getByRole('switch', { name: '使用项目记忆' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: '从对话中学习' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /查看记忆明细/ }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '沉默' } })
    expect(screen.getAllByRole('button', { name: /^查看记忆/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^查看记忆/ }))
    expect(screen.getByText('这里的沉默可能是在想怎么表达，也可能是不同意，先把前后文留下。')).toBeVisible()
  })
  it('sends scope and version to the API and preserves an edit on conflict', async () => {
    const record = { memory_id: 'memory-1', task_id: 'project-1', key: 'method', content: '核验原文。', origin: 'manual', version: 3, created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z', source_quote: null, source_conversation_id: null, source_message_id: null }
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init); requests.push(req.clone())
      if (new URL(req.url).pathname.endsWith('/overview')) return json({ summary: '你希望核验原文。', memory_count: 1, scope_version: 0 })
      if (req.method === 'PATCH') return json({ detail: 'conflict' }, 409)
      if (new URL(req.url).pathname.endsWith('/settings')) return json({ task_id: 'project-1', version: 0, use_memory: true, learn_memory: true })
      return json({ items: [record], limits: { max_entries: 100, max_content_bytes: 2000 } })
    }))
    setup(false, 'project-1')
    expect(await screen.findByText('你希望核验原文。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /查看记忆明细/ }))
    fireEvent.click(await screen.findByRole('button', { name: '查看记忆：核验原文。' }))
    const card = screen.getByRole('complementary', { name: '记忆详情' })
    fireEvent.click(within(card).getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留反例。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已在别处更新')
    expect(screen.getByRole('textbox')).toHaveValue('保留反例。')
    expect(requests.filter(req => req.method === 'GET').every(req => new URL(req.url).searchParams.get('task_id') === 'project-1')).toBe(true)
    const patch = requests.find(req => req.method === 'PATCH')!
    expect(await patch.json()).toEqual({ content: '保留反例。', expected_version: 3 })
    expect(patch.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('counts UTF-8 bytes and prevents oversized Chinese memory in preview', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }))
    const input = screen.getByLabelText('希望 Agent 记住什么？')
    fireEvent.change(input, { target: { value: `${'中'.repeat(666)}ab` } })
    expect(screen.getByText(/2000 \/ 2000 字节/)).toBeVisible()
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeEnabled()
    fireEvent.change(input, { target: { value: '中'.repeat(667) } })
    expect(screen.getByText(/2001 \/ 2000 字节/)).toBeVisible()
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled()
  })

  it('respects server entry capacity while allowing edits at capacity', async () => {
    installMemoryServer({ entries: [record('原记忆')], maxEntries: 1 })
    setup(false)
    await screen.findByText('概览：原记忆')
    expect(screen.getByRole('button', { name: '添加记忆' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /查看记忆明细/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看记忆：原记忆' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '已修改' } })
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    expect(await screen.findByText('概览：已修改')).toBeVisible()
    expect(screen.getByRole('button', { name: '添加记忆' })).toBeDisabled()
  })

  it('keeps the overview when either setting changes without another overview request', async () => {
    const server = installMemoryServer({ entries: [record('原记忆')] })
    setup(false)
    await screen.findByText('概览：原记忆')
    fireEvent.click(screen.getByRole('button', { name: '记忆设置' }))
    fireEvent.click(screen.getByRole('switch', { name: '使用个人记忆' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '使用个人记忆' })).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText('概览：原记忆')).toBeVisible()
    fireEvent.click(screen.getByRole('switch', { name: '从对话中学习' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '从对话中学习' })).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText('概览：原记忆')).toBeVisible()
    expect(server.overviewVersions).toEqual([3])
  })

  it('uses a fresh server scope version after saving alongside background changes', async () => {
    const server = installMemoryServer({ entries: [record('原记忆')], nextWriteVersion: 37 })
    setup(false)
    await screen.findByText('概览：原记忆')
    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }))
    fireEvent.change(screen.getByLabelText('希望 Agent 记住什么？'), { target: { value: '新增记忆' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    expect(await screen.findByText('概览：原记忆、新增记忆')).toBeVisible()
    expect(server.overviewVersions).toEqual([3, 37])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('概览：原记忆')).toBeVisible()
    expect(server.overviewVersions).toEqual([3, 37, 38])
  })

  it('does not restore an old overview when its response arrives after a save', async () => {
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>(resolve => { resolveOld = resolve })
    const server = installMemoryServer({ entries: [record('原记忆')], overview: version => version === 3 ? oldResponse : undefined })
    setup(false)
    await waitFor(() => expect(server.overviewVersions).toEqual([3]))
    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }))
    fireEvent.change(screen.getByLabelText('希望 Agent 记住什么？'), { target: { value: '新增记忆' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await screen.findByText('概览：原记忆、新增记忆')
    await act(async () => { resolveOld(json({ summary: '过期概览', scope_version: 3, memory_count: 1 })); await oldResponse })
    expect(screen.queryByText('过期概览')).not.toBeInTheDocument()
    expect(screen.getByText('概览：原记忆、新增记忆')).toBeVisible()
  })

  it('keeps the successful write visible and clears stale overview when refresh fails', async () => {
    installMemoryServer({ entries: [record('原记忆')], failRefresh: true })
    const staleSummaryAfterSave: boolean[] = []
    render(<Profiler id="memory" onRender={() => {
      if (screen.queryByText('记忆已保存。')) staleSummaryAfterSave.push(Boolean(screen.queryByText('概览：原记忆')))
    }}><MemoryRouter><ResearchMemoryPanel taskId={null} /></MemoryRouter></Profiler>)
    await screen.findByText('概览：原记忆')
    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }))
    fireEvent.change(screen.getByLabelText('希望 Agent 记住什么？'), { target: { value: '新增记忆' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存记忆' })) })
    await screen.findByRole('alert')
    expect(staleSummaryAfterSave).not.toContain(true)
    expect(screen.queryByText('概览：原记忆')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看记忆：新增记忆' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '保存记忆' })).not.toBeInTheDocument()
  })
})

function record(content: string) {
  return { memory_id: 'memory-1', task_id: null, key: 'note.1', content, origin: 'manual' as const, version: 1, created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z', source_quote: null, source_conversation_id: null, source_message_id: null }
}
function installMemoryServer({ entries, maxEntries = 100, nextWriteVersion = 4, overview, failRefresh = false }: {
  entries: ReturnType<typeof record>[]; maxEntries?: number; nextWriteVersion?: number;
  overview?: (version: number) => Promise<Response> | undefined; failRefresh?: boolean
}) {
  let version = 3
  let settings = { task_id: null, version, use_memory: true, learn_memory: true }
  const overviewVersions: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(req.url).pathname
    if (path.endsWith('/overview')) {
      const body = await req.json() as { expected_version: number }
      overviewVersions.push(body.expected_version)
      return overview?.(body.expected_version) ?? json({ summary: `概览：${entries.map(item => item.content).join('、')}`, scope_version: version, memory_count: entries.length })
    }
    if (path.endsWith('/settings')) {
      if (req.method === 'PATCH') settings = { ...settings, ...await req.json(), version: ++version }
      return json({ ...settings, version })
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await req.json() as { content: string }
      version = nextWriteVersion
      const updated = { ...record(body.content), memory_id: req.method === 'POST' ? 'memory-new' : 'memory-1', version: 2 }
      entries = [...entries.filter(item => item.memory_id !== updated.memory_id), updated]
      return json(updated, req.method === 'POST' ? 201 : 200)
    }
    if (req.method === 'DELETE') {
      entries = entries.filter(item => !path.endsWith(item.memory_id)); version++
      return new Response(null, { status: 204 })
    }
    if (failRefresh && version !== 3) return json({ detail: 'unavailable' }, 503)
    return json({ items: entries, limits: { max_entries: maxEntries, max_content_bytes: 2000 } })
  }))
  return { overviewVersions }
}

describe('memory conflict refresh', () => {
  it('retains the draft and requires review before saving against the latest version', async () => {
    const server = await openConflictingEditor()
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    const comparison = await screen.findByRole('region', { name: '核对最新记忆' })
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
    expect(comparison).toHaveTextContent('最新记录 · 第 2 版')
    expect(comparison).toHaveTextContent('远端更新')
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled()
    expect(server.writes).toEqual([{ content: '我的草稿', expected_version: 1 }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '我的草稿，保留远端更新' } })
    fireEvent.click(screen.getByRole('button', { name: '已核对，基于最新版本继续编辑' }))
    expect(server.writes).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await screen.findByText('记忆已保存。')
    expect(server.writes).toEqual([{ content: '我的草稿', expected_version: 1 }, { content: '我的草稿，保留远端更新', expected_version: 2 }])
  })

  it('keeps a concurrently deleted record draft visible without recreating it', async () => {
    const server = await openConflictingEditor()
    server.entries = []
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    await screen.findByText(/这条记忆已被删除/)
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '已核对，基于最新版本继续编辑' })).not.toBeInTheDocument()
    expect(server.writes).toHaveLength(1)
    expect(server.creates).toBe(0)
  })

  it('retains the draft when refresh fails and permits retrying the refresh', async () => {
    const server = await openConflictingEditor()
    server.refresh = () => Promise.resolve(json({ detail: 'unavailable' }, 503))
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂时无法保存或读取'))
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
    server.refresh = undefined
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    await screen.findByRole('region', { name: '核对最新记忆' })
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
  })

  it('does not replace a new selection when a slow refresh finishes', async () => {
    const server = await openConflictingEditor()
    let resolveRefresh!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { resolveRefresh = resolve })
    server.refresh = () => pending
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '查看记忆：另一条记忆' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '另一条草稿' } })
    await act(async () => { resolveRefresh(json({ items: server.entries, limits: { max_entries: 100, max_content_bytes: 2000 } })); await pending })
    server.refresh = undefined
    expect(screen.getByRole('textbox')).toHaveValue('另一条草稿')
    expect(screen.queryByRole('region', { name: '核对最新记忆' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await screen.findByText('记忆已保存。')
    expect(server.writtenIds).toEqual(['memory-1', 'memory-2'])
  })

  it('still uses CAS when the record changes again after reconciliation', async () => {
    const server = await openConflictingEditor()
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '已核对，基于最新版本继续编辑' }))
    server.entries[0] = { ...server.entries[0], content: '再次远端更新', version: 3 }
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('已在别处更新'))
    expect(screen.getByRole('textbox')).toHaveValue('我的草稿')
    expect(server.writes.at(-1)).toEqual({ content: '我的草稿', expected_version: 2 })
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    const comparison = await screen.findByRole('region', { name: '核对最新记忆' })
    expect(comparison).toHaveTextContent('最新记录 · 第 3 版')
    expect(comparison).toHaveTextContent('再次远端更新')
    expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled()
  })

  it('requires a fresh delete confirmation after a conflict refresh', async () => {
    const server = await openConflictingEditor()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(server.deletions).toEqual([1]))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新记录' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
    await screen.findByRole('button', { name: '查看记忆：远端更新' })
    expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument()
    expect(server.deletions).toEqual([1])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('记忆已删除。')
    expect(server.deletions).toEqual([1, 2])
  })

})

async function openConflictingEditor() {
  const server = {
    entries: [record('原记忆'), { ...record('另一条记忆'), memory_id: 'memory-2' }],
    writes: [] as { content: string; expected_version: number }[],
    writtenIds: [] as string[],
    creates: 0,
    deletions: [] as number[],
    refresh: undefined as (() => Promise<Response>) | undefined,
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(req.url).pathname
    if (path.endsWith('/overview')) return json({ summary: '概览', scope_version: 2, memory_count: server.entries.length })
    if (path.endsWith('/settings')) return json({ task_id: null, version: 2, use_memory: true, learn_memory: true })
    if (req.method === 'DELETE') {
      const expected = Number(new URL(req.url).searchParams.get('expected_version'))
      server.deletions.push(expected)
      const current = server.entries.find(item => path.endsWith(item.memory_id))
      if (!current || current.version !== expected) return json({ detail: 'conflict' }, 409)
      server.entries = server.entries.filter(item => item !== current)
      return new Response(null, { status: 204 })
    }
    if (req.method === 'POST') { server.creates++; return json({}, 500) }
    if (req.method === 'PATCH') {
      const body = await req.json() as { content: string; expected_version: number }
      server.writes.push(body)
      const id = path.split('/').at(-1)!
      server.writtenIds.push(id)
      const current = server.entries.find(item => item.memory_id === id)
      if (!current || current.version !== body.expected_version) return json({ detail: 'conflict' }, 409)
      const updated = { ...current, content: body.content, version: current.version + 1 }
      server.entries = server.entries.map(item => item.memory_id === id ? updated : item)
      return json(updated)
    }
    return server.refresh?.() ?? json({ items: server.entries, limits: { max_entries: 100, max_content_bytes: 2000 } })
  }))
  setup(false)
  await screen.findByText('概览')
  fireEvent.click(screen.getByRole('button', { name: /查看记忆明细/ }))
  fireEvent.click(screen.getByRole('button', { name: '查看记忆：原记忆' }))
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '我的草稿' } })
  server.entries[0] = { ...server.entries[0], content: '远端更新', version: 2 }
  fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('已在别处更新')
  return server
}
