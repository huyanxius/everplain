import { Select } from '../ui/Select'
import { ArrowCounterClockwiseIcon, ClockCounterClockwiseIcon, PencilSimpleIcon, PlusIcon, SlidersHorizontalIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useAccount } from '../../modules/account'
import { conversationContextSummaryKey } from '../conversation-view/useConversationContextSummary'
import { Link, useSearchParams } from 'react-router'
import { loadMemoryOverview, loadMemories, loadMemoryHistory, memoryPreviewLimits, removeMemory, saveMemory, saveMemorySettings, type ResearchMemory, type ResearchMemoryLimits, type ResearchMemorySettings } from '../../modules/research-memory'
import { memoryPreview } from './researchMemoryPreview'
import './research-memory-panel.css'

const originLabels = { manual: '手动记录', explicit: '对话中记住', learned: '自动整理' }
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'

export function ResearchMemoryPanel({ taskId, projectName, preview = false }: { taskId: string | null; projectName?: string; preview?: boolean }) {
  const account = useAccount()
  const queryClient = useContext(QueryClientContext)
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const [params] = useSearchParams()
  const exitParams = new URLSearchParams(params); exitParams.delete('preview')
  const [items, setItems] = useState<ResearchMemory[]>(() => preview ? memoryPreview(taskId) : [])
  const [settings, setSettings] = useState<ResearchMemorySettings | null>(() => preview ? { task_id: taskId, version: 0, use_memory: true, learn_memory: true } : null)
  const [limits, setLimits] = useState<ResearchMemoryLimits | null>(() => preview ? memoryPreviewLimits : null)
  // Settings can advance independently; overview requests use the version read with these records.
  const [overviewVersion, setOverviewVersion] = useState<number | null>(null)
  const [loading, setLoading] = useState(!preview)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [origin, setOrigin] = useState('all')
  const [sort, setSort] = useState('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [editor, setEditor] = useState<ResearchMemory | 'new' | null>(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, ResearchMemory[]>>({})
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const overviewRequest = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setLoading(true); setError(''); setOverviewVersion(null)
    void loadMemories(taskId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setItems(result.items); setSettings(result.settings); setLimits(result.limits); setOverviewVersion(result.settings.version) }
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [taskId, preview, reload])
  useEffect(() => { if (editor) editorRef.current?.focus() }, [editor])
  useEffect(() => {
    const controller = new AbortController()
    overviewRequest.current = controller
    setSummary(''); setSummaryError('')
    if (loading || !items.length) { setSummaryBusy(false); return }
    if (preview) {
      setSummary(items.map(item => item.content).join(' '))
      setSummaryBusy(false)
      return
    }
    if (overviewVersion === null) { setSummaryBusy(false); return }
    setSummaryBusy(true)
    void loadMemoryOverview(taskId, overviewVersion, controller.signal).then(value => {
      if (!controller.signal.aborted) setSummary(value)
    }).catch(cause => {
      if (!controller.signal.aborted) setSummaryError(message(cause))
    }).finally(() => { if (!controller.signal.aborted) setSummaryBusy(false) })
    return () => controller.abort()
  }, [taskId, overviewVersion, items, loading, preview])

  function refreshRecords() {
    // Refetch the server snapshot without replacing the user's editor or draft.
    setLoading(true); setDeleteId(null); setHistoryId(null); setHistory({})
    setReload(value => value + 1)
  }

  async function resetRecentActivity() {
    if (preview || !queryClient || !userId) return
    const queryKey = conversationContextSummaryKey(userId)
    await queryClient.cancelQueries({ queryKey, exact: true })
    // Reset removes old cards immediately while the fresh permission-fenced read runs.
    await queryClient.resetQueries({ queryKey, exact: true })
  }

  async function refreshAfterWrite() {
    await resetRecentActivity()
    // A successful write invalidates the old summary before the next render or refresh response.
    overviewRequest.current?.abort()
    setSummary(''); setSummaryError(''); setSummaryBusy(false)
    setLoading(true); setSettings(null); setOverviewVersion(null)
    try {
      const result = await loadMemories(taskId)
      if (alive.current) { setItems(result.items); setSettings(result.settings); setLimits(result.limits); setOverviewVersion(result.settings.version) }
    } finally { if (alive.current) setLoading(false) }
  }

  function edit(item: ResearchMemory | 'new') { setDetailsOpen(true); setSelectedId(item === 'new' ? null : item.memory_id); setEditor(item); setContent(item === 'new' ? '' : item.content); setError(''); setNotice('') }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!editor || busy || loading || editorNeedsReview || !limits || !content.trim()) return
    if (new TextEncoder().encode(content.trim()).length > limits.max_content_bytes) { setError(`每条记忆最多 ${limits.max_content_bytes} 字节（UTF-8），请缩短内容。`); return }
    if (editor === 'new' && items.length >= limits.max_entries) { setError(`此范围最多保存 ${limits.max_entries} 条记忆，请先删除不再需要的条目。`); return }
    setBusy(true); setError('')
    try {
      const existing = editor === 'new' ? undefined : editor
      const updated: ResearchMemory = preview ? {
        memory_id: existing?.memory_id ?? `preview-${crypto.randomUUID()}`, task_id: taskId, key: existing?.key ?? 'preview.note',
        content: content.trim(), origin: 'manual', version: (existing?.version ?? 0) + 1,
        created_at: existing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
        source_conversation_id: null, source_message_id: null, source_quote: null,
      } : await saveMemory(taskId, content.trim(), existing)
      if (!alive.current) return
      if (preview) setHistory(current => ({ ...current, [updated.memory_id]: [updated, ...(current[updated.memory_id] ?? (existing ? [existing] : []))] }))
      else setHistory(current => { const next = { ...current }; delete next[updated.memory_id]; return next })
      setItems(current => [updated, ...current.filter(item => item.memory_id !== updated.memory_id)])
      setEditor(null); setSelectedId(updated.memory_id); setNotice(preview ? '示例已更新，仅保留在当前预览。' : '记忆已保存。')
      if (!preview) await refreshAfterWrite()
    } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  async function remove(item: ResearchMemory) {
    setBusy(true); setError('')
    try {
      if (!preview) await removeMemory(item)
      if (!alive.current) return
      setItems(current => current.filter(entry => entry.memory_id !== item.memory_id)); setDeleteId(null); setSelectedId(null); setEditor(null)
      setNotice(preview ? '示例已删除，刷新可恢复。' : '记忆已删除。')
      if (!preview) await refreshAfterWrite()
    } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  async function toggle(field: 'use_memory' | 'learn_memory') {
    if (!settings || busy) return
    setBusy(true); setError('')
    try {
      const updated = preview ? { ...settings, [field]: !settings[field], version: settings.version + 1 } : await saveMemorySettings(settings, field, !settings[field])
      if (!preview) await resetRecentActivity()
      if (alive.current) { setSettings(updated); setNotice(preview ? '示例设置已更新。' : '记忆设置已保存。') }
    } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  async function showHistory(item: ResearchMemory) {
    if (historyId === item.memory_id) { setHistoryId(null); return }
    setHistoryId(item.memory_id)
    if (history[item.memory_id]) return
    setHistoryBusy(true); setError('')
    try {
      const records = preview ? [item] : await loadMemoryHistory(item.memory_id)
      if (alive.current) setHistory(current => ({ ...current, [item.memory_id]: records }))
    } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setHistoryBusy(false) }
  }
  const visible = items.filter(item => (origin === 'all' || item.origin === origin) && `${item.content} ${item.source_quote ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'recent' ? b.updated_at.localeCompare(a.updated_at) : a.updated_at.localeCompare(b.updated_at))
  const selected = items.find(item => item.memory_id === selectedId)
  const editorCurrent = editor && editor !== 'new' ? items.find(item => item.memory_id === editor.memory_id) : undefined
  const editorNeedsReview = Boolean(editor && editor !== 'new' && (!editorCurrent || editorCurrent.version !== editor.version))
  const detailOpen = Boolean(selected || editor)
  const contentBytes = new TextEncoder().encode(content.trim()).length
  const contentTooLong = Boolean(limits && contentBytes > limits.max_content_bytes)
  const atCapacity = Boolean(limits && items.length >= limits.max_entries)

  const closeDetail = () => { setEditor(null); setSelectedId(null); setDeleteId(null); setHistoryId(null) }
  const originLabel = (item: ResearchMemory) => item.source_quote?.startsWith('引导问卷') ? '引导问卷' : originLabels[item.origin]
  return <div className="ep-memory">
    <section className="ep-memory__overview" aria-label="记忆概览" aria-busy={loading || summaryBusy}>
      <header className="ep-memory__head"><div><h2 className="qx-heading">{taskId ? '关于这个项目' : 'Agent 记住了什么'}</h2><p className="qx-meta">{taskId ? projectName ?? '项目记忆' : '个人记忆'} · <span>{loading ? '正在读取…' : `${items.length} 条记忆`}</span>{!loading && limits ? ` · 上限 ${limits.max_entries} 条` : ''}</p></div><button className="qx-btn qx-btn--ghost" type="button" aria-expanded={settingsOpen} aria-controls="memory-settings" onClick={() => setSettingsOpen(open => !open)}><SlidersHorizontalIcon />记忆设置</button></header>
      {loading || summaryBusy ? <p className="qx-meta" role="status">{loading ? '正在读取记忆…' : 'Agent 正在整理记忆概览…'}</p> : summary ? <p className="ep-memory__summary">{summary}</p> : summaryError ? <div><p className="qx-meta">{summaryError}</p><button className="qx-btn qx-btn--secondary" type="button" onClick={refreshRecords}>重新整理</button></div> : <p className="qx-card__body">{error ? '暂时无法读取记忆。' : taskId ? '这里保存当前项目的研究约定。你可以先添加一条，也可以在项目对话中让 Agent 记住。' : '这里会逐渐形成 Agent 对你的了解。你可以先添加一条记忆，也可以在对话中让它记住。'}</p>}
      <div className="ep-memory__actions"><button className="qx-btn qx-btn--secondary" type="button" aria-expanded={detailsOpen} aria-controls="memory-records" onClick={() => setDetailsOpen(open => !open)}>{detailsOpen ? '收起记忆明细' : '查看记忆明细'}</button><button className="qx-btn qx-btn--primary" type="button" disabled={loading || busy || !settings || !limits || atCapacity} onClick={() => edit('new')}><PlusIcon />添加记忆</button></div>
      {atCapacity ? <p className="qx-meta">已达到 {limits?.max_entries} 条上限，可编辑已有记忆，或删除后再添加。</p> : null}
      {taskId ? <p className="qx-meta">项目对话也会参考已开启的个人记忆。</p> : null}
      {settings && !settings.use_memory ? <p className="qx-meta">已暂停在对话中使用{taskId ? '项目' : '个人'}记忆，保存的内容仍可查看。</p> : null}
    </section>
    {preview ? <div className="ep-memory__preview"><span className="qx-meta">示例预览 · 修改不会写入真实记忆</span><Link to={`?${exitParams}`}>查看真实记忆</Link><button className="qx-btn qx-btn--ghost" type="button" onClick={() => { setItems(memoryPreview(taskId)); setHistory({}); closeDetail(); setNotice('示例已恢复。') }}><ArrowCounterClockwiseIcon />恢复示例</button></div> : null}
    {settingsOpen ? <section className="ep-memory__settings qx-card" id="memory-settings" aria-label="记忆设置">{([{ field: 'use_memory', label: `使用${taskId ? '项目' : '个人'}记忆`, detail: '在对话中按需参考已保存的记忆。关闭后仍然保留内容。' }, { field: 'learn_memory', label: '从对话中学习', detail: '从对话中整理值得保留的信息。关闭后仍可手动添加。' }] as const).map(item => <div key={item.field}><div><strong>{item.label}</strong><p className="qx-meta">{item.detail}</p></div><button className="ep-memory__switch" type="button" role="switch" aria-label={item.label} aria-checked={settings?.[item.field] ?? false} disabled={!settings || busy} onClick={() => void toggle(item.field)}><span /></button></div>)}</section> : null}
    {error ? <div className="ep-memory__error" role="alert"><p>{error}</p>{!preview ? <button className="qx-btn qx-btn--secondary" type="button" disabled={loading || busy} onClick={refreshRecords}>刷新记录</button> : null}</div> : null}
    {notice ? <p className="qx-meta" role="status">{notice}</p> : null}
    {detailsOpen ? <section id="memory-records" className="ep-memory__details" aria-label="记忆明细">
      <div className="ep-memory__filters"><input type="search" className="qx-input" aria-label="搜索记忆" placeholder="搜索记忆内容" value={query} onChange={event => setQuery(event.target.value)} /><Select className="qx-input" aria-label="记忆来源" value={origin} onChange={nextValue => setOrigin(nextValue)} options={[{ value: "all", label: "全部来源" }, ...(Object.entries(originLabels).map(([id, label]) => ({ value: id, label: label })))]} /><Select className="qx-input" aria-label="记忆排序" value={sort} onChange={nextValue => setSort(nextValue)} options={[{ value: "recent", label: "最近更新" }, { value: "oldest", label: "最早更新" }]} /></div>
      <p className="qx-meta">手动添加、修改或明确要求记住的内容，后台学习不会覆盖；这不代表每轮对话都会加载全文。</p>
      <div className="ep-memory__body" data-detail={detailOpen}>
        <ul className="ep-memory__records" aria-label={taskId ? '项目记忆列表' : '个人记忆列表'}>{visible.map(item => <li key={item.memory_id}><button className="qx-card ep-memory__record" type="button" aria-label={`查看记忆：${item.content}`} aria-expanded={selectedId === item.memory_id} disabled={busy || Boolean(editor)} onClick={() => { setSelectedId(item.memory_id); setDeleteId(null); setHistoryId(null); setError('') }}><span className="ep-memory__record-copy">{item.content}</span><span className="qx-meta">{originLabel(item)} · <time dateTime={item.updated_at}>{date(item.updated_at)}</time></span></button></li>)}</ul>
        {!loading && !visible.length && !error ? <p className="qx-meta">{query || origin !== 'all' ? '没有匹配的记忆' : '还没有记忆'}</p> : null}
        {detailOpen ? <aside className="qx-card ep-memory__detail" aria-label="记忆详情">
          <header><h3 className="qx-heading">{editor ? editor === 'new' ? '添加记忆' : '编辑记忆' : '记忆详情'}</h3><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={editor ? '关闭编辑' : '关闭记忆详情'} disabled={busy} onClick={closeDetail}><XIcon /></button></header>
          {editor ? <form className="ep-memory__editor" onSubmit={event => void submit(event)}>
            <label htmlFor="memory-content">{taskId ? '希望在这个项目里记住什么？' : '希望 Agent 记住什么？'}</label>
            <textarea className="qx-textarea" ref={editorRef} id="memory-content" rows={5} value={content} onChange={event => setContent(event.target.value)} aria-describedby="memory-content-budget" aria-invalid={contentTooLong} placeholder="例如：比较不同解释时，先回到原始材料核验。" disabled={busy} required />
            <p id="memory-content-budget" className={contentTooLong ? 'ep-memory__error' : 'qx-meta'}>本条 {contentBytes} / {limits?.max_content_bytes ?? '…'} 字节（UTF-8）{contentTooLong ? '，请缩短内容后保存。' : '；通常一个汉字占 3 字节。'}</p>
            {!loading && editorNeedsReview ? <section className="ep-memory__source" aria-label="核对最新记忆">
              {editorCurrent ? <>
                <h4 className="qx-group-label">最新记录 · 第 {editorCurrent.version} 版</h4>
                <p className="ep-memory__detail-copy">{editorCurrent.content}</p>
                <p className="qx-meta">你的草稿仍保留在上方。请对照最新记录合并需要保留的内容；核对后再保存，会以草稿替换最新记录。</p>
                <button className="qx-btn qx-btn--secondary" type="button" onClick={() => setEditor(editorCurrent)}>已核对，基于最新版本继续编辑</button>
              </> : <p className="qx-meta">这条记忆已被删除。你的草稿仍保留在上方，可复制留存；不会自动重新创建。</p>}
            </section> : null}
            <div className="ep-memory__actions">
              <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button>
              <button className="qx-btn qx-btn--primary" type="submit" disabled={busy || loading || editorNeedsReview || !limits || !content.trim() || contentTooLong || (editor === 'new' && atCapacity)}>{busy ? '保存中…' : '保存记忆'}</button>
            </div>
          </form> : selected ? <>
            <p className="ep-memory__detail-copy">{selected.content}</p>
            <div className="ep-memory__actions"><button className="qx-btn qx-btn--secondary" type="button" disabled={busy} onClick={() => edit(selected)}><PencilSimpleIcon />编辑</button><button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => setDeleteId(selected.memory_id)}><TrashIcon />删除</button></div>
            <dl className="ep-memory__metadata">{[['范围', taskId ? projectName ?? '当前项目' : '个人记忆'], ['来源', originLabel(selected)], ['创建于', date(selected.created_at)], ['更新于', date(selected.updated_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {selected.source_quote ? <section className="ep-memory__source"><h4 className="qx-group-label">来源原话</h4><blockquote>{selected.source_quote}</blockquote>{selected.source_conversation_id ? <Link to={`/agent?conversation_id=${encodeURIComponent(selected.source_conversation_id)}`}>打开来源对话</Link> : null}</section> : null}
            <button type="button" className="qx-btn qx-btn--ghost" aria-expanded={historyId === selected.memory_id} disabled={historyBusy} onClick={() => void showHistory(selected)}><ClockCounterClockwiseIcon />修改历史 · 最近 {Math.min(selected.version, 50)} 个版本</button>
            {historyId === selected.memory_id ? <ol className="ep-memory__history" aria-label="修改历史">{historyBusy && !history[selected.memory_id] ? <li role="status">正在读取修改历史…</li> : history[selected.memory_id]?.slice().sort((a, b) => b.version - a.version).map(revision => <li key={revision.version}><span className="qx-meta">第 {revision.version} 版 · {date(revision.updated_at)} · {originLabels[revision.origin]}</span><p>{revision.content}</p>{revision.source_quote ? <blockquote>{revision.source_quote}</blockquote> : null}</li>)}</ol> : null}
            {deleteId === selected.memory_id ? <div className="ep-memory__delete" role="group" aria-label="确认删除记忆"><p>{preview ? '删除这条示例记忆？刷新预览可以恢复。' : '删除这条记忆及其修改历史？原始对话仍保留。'}</p><div className="ep-memory__actions"><button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => setDeleteId(null)}>取消</button><button type="button" className="qx-btn qx-btn--danger" disabled={busy} onClick={() => void remove(selected)}>确认删除</button></div></div> : null}
          </> : null}
        </aside> : null}
      </div>
    </section> : null}
  </div>
}
