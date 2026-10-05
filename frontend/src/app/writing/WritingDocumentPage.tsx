import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import { Link, useLocation, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { DownloadSimpleIcon, SparkleIcon } from '@phosphor-icons/react'
import { genres, genreLabel, writingApi, type Genre, type WritingDocument, type WritingRevision } from '../../modules/writing'
import { SharedEditor, type MarkdownSelection, type SelectionAction } from '../../modules/shared-editor'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { PageShell } from '../ui/PageShell'
import { Select } from '../ui/Select'
import { draftKey, readDraft, saveDraft, message, useRequestKeys } from './writingState'
import { revisionDiff } from './revisionDiff'
import { WritingRevisionBubble } from './WritingRevisionBubble'
import { WritingRevisionComparison, WritingRevisionPreview } from './WritingRevisionPreview'
import { stopAgentRun, type WritingPreviewEvent } from '../../modules/research-agent'
import { WritingLivePreview } from './WritingLivePreview'
import { applyWritingPreview, liveWritingMarkdown, readLiveWritingDraft, writingPreviewKey, type WritingLiveDraft } from './writingLivePreviewState'
import { useWritingPanelWidth } from './useWritingPanelWidth'
import './reference-workbench.css'
import './writing.css'

export function WritingDocumentPage({ userId }: { userId: string | null }) {
  const { documentId = '' } = useParams()
  return <PageShell workspace><WritingDocumentEditor key={`${userId}:${documentId}`} userId={userId} documentId={documentId} /></PageShell>
}
export function WritingDocumentEditor({ userId, documentId }: { userId: string | null; documentId: string }) {
  const location = useLocation(), cache = useQueryClient(), keyFor = useRequestKeys()
  const [document, setDocument] = useState<WritingDocument | null>(null), [revisions, setRevisions] = useState<WritingRevision[]>([]), [markdown, setMarkdown] = useState(''), [title, setTitle] = useState(''), [genre, setGenre] = useState<Genre>('essay')
  const [error, setError] = useState<string>(location.state?.writingError ?? ''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState(''), [agentPrompt] = useState<{ text: string; key: number } | null>(() => location.state?.writingInstruction ? { text: location.state.writingInstruction, key: 1 } : null)
  const panel = useWritingPanelWidth(userId, !loading)
  const [writingAction, setWritingAction] = useState<{ id: string; text: string } | null>(null)
  const [checkingAction, setCheckingAction] = useState(false), [agentBusy, setAgentBusy] = useState(false), [actionNotice, setActionNotice] = useState('')
  const actionGate = useRef(false), activeActionId = useRef<string | null>(null)
  const actionFinished = useCallback((id: string) => {
    if (activeActionId.current !== id) return
    actionGate.current = false; activeActionId.current = null; setWritingAction(null)
  }, [])
  const conversationKey = userId ? `everplain.writing.conversation:${userId}:${documentId}` : null
  const [conversationId, setConversationId] = useState<string | null>(() => { try { return conversationKey ? sessionStorage.getItem(conversationKey) : null } catch { return null } })
  const [selection, setSelection] = useState<MarkdownSelection>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null), [editingRevisionId, setEditingRevisionId] = useState<string | null>(null)
  const [acceptedAnimation, setAcceptedAnimation] = useState<WritingRevision | null>(null)
  const [liveDraft, setLiveDraft] = useState<WritingLiveDraft | null>(null), [cancellingDraft, setCancellingDraft] = useState(false)
  const dismissedCalls = useRef(new Set<string>()), discardedRevisions = useRef(new Set<string>()), discardAttempts = useRef(new Set<string>()), invalidRevisions = useRef(new Set<string>())
  const selectionRef = useRef(selection)
  const updateSelection = useCallback((value: MarkdownSelection) => { selectionRef.current = value; setSelection(value) }, [])
  const rememberConversation = useCallback(({ conversation_id }: { conversation_id: string }) => {
    setConversationId(conversation_id)
    try { if (conversationKey) sessionStorage.setItem(conversationKey, conversation_id) } catch { /* In-memory conversation still works. */ }
  }, [conversationKey])
  const revisionFetchEpoch = useRef(0)
  const mutex = useRef(false), alive = useRef(true), draftReady = useRef(false), documentRef = useRef<WritingDocument | null>(null), draftRef = useRef({ title: '', genre: 'essay' as Genre, markdown: '' }), draftStorage = userId ? draftKey(userId, documentId) : null
  draftRef.current = { title, genre, markdown }; documentRef.current = document
  const dirty = Boolean(document && (title !== document.title || genre !== document.genre || markdown !== document.markdown))
  const hasLocalChanges = () => { const base = documentRef.current, draft = draftRef.current; return Boolean(base && (draft.title !== base.title || draft.genre !== base.genre || draft.markdown !== base.markdown)) }
  const sameDraft = (draft: typeof draftRef.current) => { const latest = draftRef.current; return latest.title === draft.title && latest.genre === draft.genre && latest.markdown === draft.markdown }
  const liveStorage = userId ? `everplain.writing.preview:${userId}:${documentId}` : null
  useEffect(() => {
    if (!liveStorage || !draftReady.current) return
    try { if (liveDraft) sessionStorage.setItem(liveStorage, JSON.stringify(liveDraft)); else sessionStorage.removeItem(liveStorage) } catch { /* The in-memory draft stays unsaved and usable. */ }
  }, [liveDraft, liveStorage])
  const pending = revisions.find(item => item.status === 'pending')
  const discardedPending = Boolean(pending && discardedRevisions.current.has(pending.revision_id))
  const liveConflict = Boolean(pending && invalidRevisions.current.has(pending.revision_id))
  const preview = pending ? revisionDiff(pending.before_markdown, pending.after_markdown) : null
  const inlinePending = Boolean(pending && !discardedPending && !liveConflict && !dirty && pending.base_version === document?.version && pending.before_markdown === markdown && editingRevisionId !== pending.revision_id)
  const liveVisible = Boolean(liveDraft && !pending && !dirty && document && liveDraft.state !== 'invalidated' && liveDraft.base_version === document.version && liveDraft.original_markdown === markdown && !dismissedCalls.current.has(writingPreviewKey(liveDraft)))
  const refreshRevisions = useCallback(() => {
    const epoch = ++revisionFetchEpoch.current
    void writingApi.revisions(documentId).then(rows => { if (alive.current && epoch === revisionFetchEpoch.current) setRevisions(rows.items) }).catch(failure => { if (alive.current && epoch === revisionFetchEpoch.current) setError(message(failure)) })
  }, [documentId])
  const receiveWritingPreview = useCallback((event: WritingPreviewEvent) => {
    const current = documentRef.current
    if (!alive.current || !current || event.document_id !== documentId) return
    if (dismissedCalls.current.has(writingPreviewKey(event))) {
      if (event.state === 'ready' && event.revision_id) { discardedRevisions.current.add(event.revision_id); refreshRevisions() }
      return
    }
    setLiveDraft(draft => applyWritingPreview(draft, event, current, performance.now()))
    if (event.state === 'ready') refreshRevisions()
    if (event.state === 'invalidated') setActionNotice('生成草稿未通过核对，原文已保留。请重新发起修改。')
  }, [documentId, refreshRevisions])
  const finishWritingPreview = useCallback(() => { setLiveDraft(draft => draft && draft.state === 'streaming' ? { ...draft, incomplete: true } : draft) }, [])
  useEffect(() => {
    if (liveDraft?.state === 'ready' && pending?.revision_id === liveDraft.revision_id) {
      if (pending.before_markdown === liveDraft.original_markdown && pending.after_markdown === liveWritingMarkdown(liveDraft)) setLiveDraft(null)
      else { invalidRevisions.current.add(pending.revision_id); setLiveDraft(draft => draft ? { ...draft, state: 'invalidated', revision_id: undefined, replacement_text: '', revealedAt: [] } : null); setActionNotice('生成草稿与最终修订不一致，已保留原文，请核对最终修订。') }
    }
  }, [liveDraft, pending])
  const rejectDiscarded = useEffectEvent((row: WritingRevision) => { void resolve(row, 'reject') })
  useEffect(() => {
    const row = revisions.find(item => item.status === 'pending' && discardedRevisions.current.has(item.revision_id) && !discardAttempts.current.has(item.revision_id))
    if (!row || busy) return
    discardAttempts.current.add(row.revision_id)
    rejectDiscarded(row)
  }, [revisions, busy])
  async function cancelWritingPreview() {
    if (!liveDraft || cancellingDraft) return
    dismissedCalls.current.add(writingPreviewKey(liveDraft)); setLiveDraft(null); setCancellingDraft(true)
    try { if (liveStorage) sessionStorage.setItem(`${liveStorage}:dismissed`, JSON.stringify([...dismissedCalls.current].slice(-32))) } catch { /* The in-memory cancellation fence remains. */ }
    if (liveDraft.revision_id) { discardedRevisions.current.add(liveDraft.revision_id); refreshRevisions() }
    try { await stopAgentRun(liveDraft.run_id) } catch (failure) { if (alive.current) setError(message(failure)) }
    finally { if (alive.current) setCancellingDraft(false) }
  }
  useEffect(() => {
    if (!acceptedAnimation) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || markdown !== acceptedAnimation.after_markdown) { setAcceptedAnimation(null); return }
    const timer = window.setTimeout(() => setAcceptedAnimation(null), 1700)
    return () => window.clearTimeout(timer)
  }, [acceptedAnimation, markdown])
  const updateBase = useCallback((value: WritingDocument, reset: boolean) => { setDocument(value); documentRef.current = value; if (reset) { draftRef.current = { title: value.title, genre: value.genre, markdown: value.markdown }; setTitle(value.title); setGenre(value.genre); setMarkdown(value.markdown); if (draftStorage) saveDraft(draftStorage, null) } }, [draftStorage])
  useEffect(() => {
    alive.current = true; const controller = new AbortController()
    if (!userId) { setLoading(false); return }
    Promise.all([writingApi.document(documentId, controller.signal), writingApi.revisions(documentId, controller.signal)]).then(([value, revisionList]) => {
      if (!alive.current) return
      const draft = draftStorage ? readDraft(draftStorage) : null
      updateBase(value, true); setRevisions(revisionList.items)
      if (liveStorage) {
        setLiveDraft(readLiveWritingDraft(liveStorage, value))
        try { const discarded = JSON.parse(sessionStorage.getItem(`${liveStorage}:dismissed`) ?? '[]'); if (Array.isArray(discarded)) dismissedCalls.current = new Set(discarded.filter((key): key is string => typeof key === 'string').slice(-32)) } catch { /* No discarded preview is restored. */ }
      }
      if (draft) { setTitle(draft.title); setGenre(draft.genre); setMarkdown(draft.markdown); if (draft.version !== value.version) setRefreshNotice('已恢复此浏览器中的修改。服务器也有新版本，请核对后再保存。') }
      draftReady.current = true
    }).catch(failure => { if (alive.current && !controller.signal.aborted) setError(message(failure)) }).finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false; controller.abort() }
  }, [documentId, draftStorage, updateBase, userId, liveStorage])
  useEffect(() => { if (draftStorage && draftReady.current && document) saveDraft(draftStorage, dirty ? { title, genre, markdown, version: document.version } : null) }, [document, draftStorage, title, genre, markdown, dirty])
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty, busy])
  async function saveCurrent() {
    const current = documentRef.current
    if (!current) throw new Error('文稿尚未读取。')
    const draft = draftRef.current
    if (draft.title === current.title && draft.genre === current.genre && draft.markdown === current.markdown) return current
    if (!draft.title.trim()) throw new Error('请填写文稿标题。')
    const body = { expected_version: current.version, title: draft.title.trim(), genre: draft.genre, markdown: draft.markdown }
    const saved = await writingApi.update(documentId, body, keyFor(`save:${documentId}`, body))
    if (alive.current) { updateBase(saved, sameDraft(draft)); setRefreshNotice(''); refreshRevisions(); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
    return saved
  }
  async function run(action: () => Promise<void>) {
    if (!userId || mutex.current) return
    mutex.current = true; setBusy(true); setError('')
    try { await action() } catch (failure) { if (alive.current) setError(message(failure)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  const save = () => run(async () => { await saveCurrent() })
  async function prepareWritingContext() {
    if (activeActionId.current && pending) throw new Error('请先接受或撤回当前待定修订，再执行优化。')
    if (mutex.current) throw new Error('文稿正在保存，请稍后再发送。')
    mutex.current = true; setBusy(true); setError('')
    try {
      const selected = selectionRef.current
      if (selected && 'error' in selected) throw new Error(selected.error)
      const range = selected && 'start' in selected ? selected : null
      const saved = await saveCurrent()
      if (!alive.current) throw new Error('文稿已关闭，请重新发送。')
      if (hasLocalChanges()) throw new Error('保存期间正文有新修改，已保留。请再发送一次，让 Agent 读取最新内容。')
      if (range && saved.markdown.slice(range.start, range.end) !== range.text) throw new Error('选区已变化，请重新选择后再发送。')
      return { document_id: documentId, document_version: saved.version,
        ...(range ? { selection_start: range.start, selection_end: range.end } : {}) }
    } finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  async function optimize(kind: 'rewrite' | 'personalize' | 'continue', selected = selectionRef.current) {
    if (!userId || actionGate.current || busy || agentBusy) return
    if (pending) { setActionNotice('请先接受或撤回左侧待定修订，再开始下一次优化。自由聊天仍可继续。'); return }
    actionGate.current = true; setCheckingAction(true); setActionNotice('')
    const original = draftRef.current
    try {
      if (selected && 'error' in selected) throw new Error(selected.error)
      if (kind === 'personalize') {
        const summary = await writingApi.summary()
        if (!alive.current) return
        const profile = summary.genres.find(item => item.genre === original.genre)
        if (!profile || profile.sample_count === 0 || profile.readiness === 'empty') throw new Error(`当前${genreLabel(original.genre)}还没有可用样文。请先添加同文体文章，再使用“更像我”；也可以直接优化表达。`)
        if (profile.readiness !== 'ready') setActionNotice('现有同文体样文较少，本次只参考已有表达，不会声称已经学会你的文风。')
      }
      if (!alive.current) return
      if (!sameDraft(original)) throw new Error('检查期间正文有新修改。已保留新内容，请再次点击优化。')
      const context = selected && 'start' in selected ? selected : null
      if (context && original.markdown.slice(context.start, context.end) !== context.text) throw new Error('选区已变化，请重新选择后再优化。')
      updateSelection(context)
      const target = context ? '当前选区' : '当前全文'
      const text = kind === 'personalize' ? `参考真实同文体样文优化${target}` : kind === 'continue' ? '在当前选区末尾接着写，保留原文' : `优化${target}`
      const id = `writing-ui:${kind}:${crypto.randomUUID()}`; activeActionId.current = id
      setWritingAction({ id, text })
    } catch (failure) { if (alive.current) setActionNotice(message(failure)) }
    finally { if (!activeActionId.current) actionGate.current = false; if (alive.current) setCheckingAction(false) }
  }
  async function resolve(revision: WritingRevision, decision: 'accept' | 'reject') {
    await run(async () => {
      const current = documentRef.current
      if (!current) return
      if (decision === 'accept' && hasLocalChanges()) throw new Error('正文有未保存修改。请先保存，或撤回这条修订。')
      const draft = draftRef.current
      const body = { decision, expected_version: current.version }
      const result = await writingApi.resolve(documentId, revision.revision_id, body, keyFor(`resolve:${revision.revision_id}`, body))
      if (alive.current) { revisionFetchEpoch.current += 1; const unchanged = sameDraft(draft); updateBase(result.document, unchanged && (decision === 'accept' || !hasLocalChanges())); if (!unchanged) setRefreshNotice('修订已处理，期间的新编辑仍保留，请核对后保存。'); setRevisions(rows => rows.map(row => row.revision_id === revision.revision_id ? result.revision : row)); setCompareId(null); setEditingRevisionId(null); if (decision === 'accept' && unchanged && result.document.markdown === revision.after_markdown) setAcceptedAnimation(revision); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
    })
  }
  async function refresh() {
    await run(async () => { const [latest, rows] = await Promise.all([writingApi.document(documentId), writingApi.revisions(documentId)]); if (!alive.current) return; const preserve = hasLocalChanges(); updateBase(latest, !preserve); setRevisions(rows.items); if (preserve) setRefreshNotice('服务器版本已刷新，本地修改仍保留。请对照最新正文后再保存。') })
  }
  async function undoRevision(revision: WritingRevision) {
    await run(async () => {
      const current = documentRef.current, draft = draftRef.current
      if (!current || hasLocalChanges() || current.markdown !== revision.after_markdown) throw new Error('正文已有新修改，不能直接撤销这条修订。请先核对当前内容。')
      const body = { expected_version: current.version, title: current.title, genre: current.genre, markdown: revision.before_markdown }
      const saved = await writingApi.update(documentId, body, keyFor(`undo:${revision.revision_id}`, body))
      if (alive.current) { updateBase(saved, sameDraft(draft)); refreshRevisions(); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
    })
  }
  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '-') || '文稿'}.md`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  function optimizeSelection(kind: 'rewrite' | 'personalize' | 'continue', selected: MarkdownSelection) {
    if (!selected || 'error' in selected) { setActionNotice(selected && 'error' in selected ? selected.error : '选区已变化，请重新选择后再优化。'); return }
    void optimize(kind, selected)
  }
  const quickBusy = checkingAction || Boolean(writingAction) || busy || agentBusy
  const selectionActions: SelectionAction[] = [{ id: 'rewrite', label: '优化选区', disabled: quickBusy, run: (_editor, _text, selected) => optimizeSelection('rewrite', selected) }, { id: 'personalize', label: '更像我', icon: <SparkleIcon />, disabled: quickBusy, run: (_editor, _text, selected) => optimizeSelection('personalize', selected) }, { id: 'continue', label: '接着写', disabled: quickBusy, run: (_editor, _text, selected) => optimizeSelection('continue', selected) }]
  if (loading) return <div className="writing-load" role="status">正在读取文稿…</div>
  if (!document) return <div className="writing-load"><p role="alert">{error || '文稿不可用。'}</p><Link className="qx-btn qx-btn--secondary" to="/writing">返回写作</Link><button className="qx-btn qx-btn--secondary" onClick={() => { setLoading(true); void writingApi.document(documentId).then(value => { updateBase(value, true); draftReady.current = true }).catch(failure => setError(message(failure))).finally(() => setLoading(false)) }}>重新读取文稿</button></div>
  return <div className="wr-page writing-document"><div className="wr-workbench">
    <header className="wr-top"><div className="wr-crumbs"><Link className="qx-btn qx-btn--ghost" to="/writing">写作</Link><span>/</span><input className="writing-crumb-title" aria-label="文稿标题" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></div><span className="qx-meta" role="status">{busy ? '正在处理…' : dirty ? '尚未保存' : '已保存'}</span><div className="wr-top__right"><button className="qx-btn qx-btn--secondary" disabled={busy || !dirty} onClick={() => void save()}>保存</button><button className="qx-btn qx-btn--ghost" onClick={download}><DownloadSimpleIcon />导出 Markdown</button></div></header>
    {error && <div className="qx-notice qx-notice--danger writing-notice" role="alert"><p>{error}</p><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void refresh()}>刷新版本并保留修改</button></div>}
    {refreshNotice && <div className="qx-notice writing-notice"><p>{refreshNotice}</p><details><summary>查看服务器正文</summary><pre className="writing-raw">{document.markdown}</pre></details></div>}
    <div className="wr-body" ref={panel.layoutRef} data-resizing={panel.resizing} style={{ '--writing-agent-width': `${panel.width}px` } as CSSProperties}><section className="wr-editor">
      {actionNotice && <div className="qx-notice writing-action-notice" role="status"><p>{actionNotice}</p>{actionNotice.includes('样文') && <Link className="qx-btn qx-btn--ghost" to="/writing">管理同文体样文</Link>}</div>}
      {liveVisible && liveDraft && <div className="writing-action-notice" role="status"><p className="qx-meta">{liveDraft.incomplete ? '生成已中断，以下仅为未完成草稿，原文未保存。' : liveDraft.state === 'ready' ? '正文生成完成，正在读取可确认修订…' : '正文正在流式生成，尚未保存。'}</p><button type="button" className="qx-btn qx-btn--ghost" disabled={cancellingDraft} onClick={() => void cancelWritingPreview()}>取消生成草稿</button></div>}
      {pending && (dirty || pending.base_version !== document.version || pending.before_markdown !== markdown || pending.warnings.length > 0 || editingRevisionId === pending.revision_id) && <div className="writing-action-notice" role="status">
        {editingRevisionId === pending.revision_id && !dirty && <p className="qx-meta">正在编辑原文。修改会保留；建议稿可用“对照”查看。保存原文后需重新生成修订。</p>}
        {dirty && <p className="qx-meta">你有新的手写修改，已保留；请先核对，当前修订不会覆盖它。</p>}
        {!dirty && (pending.base_version !== document.version || pending.before_markdown !== markdown) && <p className="qx-meta">修订的原文版本已变化，请取消后重新修改。</p>}
        {pending.warnings.map((warning, i) => <p className="qx-meta" key={i}>{warning}</p>)}
      </div>}
      <div className="writing-editor-canvas">
        <SharedEditor markdown={markdown} onChange={setMarkdown} onReady={setEditor} saveState={dirty ? busy ? 'saving' : 'dirty' : 'saved'} onSelectionChange={updateSelection} selectionActions={selectionActions}
          bodyPreview={editor && inlinePending && pending ? <WritingRevisionPreview key={pending.revision_id} editor={editor} before={pending.before_markdown} after={pending.after_markdown} /> : liveVisible && liveDraft ? <WritingLivePreview draft={liveDraft} /> : editor && acceptedAnimation && markdown === acceptedAnimation.after_markdown ? <WritingRevisionPreview key={`accepted:${acceptedAnimation.revision_id}`} editor={editor} before={acceptedAnimation.before_markdown} after={acceptedAnimation.after_markdown} animate /> : undefined}
          statusContent={<><label className="writing-status-genre">文体<Select aria-label="文稿文体" disabled={busy} value={genre} onChange={value => setGenre(value as Genre)} options={genres.map(item => ({ value: item.id, label: item.label }))} /></label><span>版本 {document.version}</span>{revisions.find(item => item.status === 'accepted' && item.after_markdown === document.markdown) && <button type="button" className="qx-btn qx-btn--ghost" disabled={busy || dirty} onClick={() => { setAcceptedAnimation(null); void undoRevision(revisions.find(item => item.status === 'accepted' && item.after_markdown === document.markdown)!) }}>撤销最近优化</button>}</>} />
        {preview && pending && <WritingRevisionBubble editor={editor} markdown={pending.before_markdown} offset={preview.prefix.length} previewKey={inlinePending ? pending.revision_id : 'original'}>
          <div className="se-bubble" role="toolbar" aria-label="确认当前正文修订"><button type="button" disabled={busy} title="返回原文编辑，再次点击继续预览建议" aria-pressed={editingRevisionId === pending.revision_id} onClick={() => setEditingRevisionId(editingRevisionId === pending.revision_id ? null : pending.revision_id)}>修改</button><button type="button" disabled={!editor} aria-expanded={compareId === pending.revision_id} onClick={() => setCompareId(compareId === pending.revision_id ? null : pending.revision_id)}>对照</button><button type="button" disabled={busy} onClick={() => void resolve(pending, 'reject')}>取消</button><button type="button" disabled={busy || dirty || discardedPending || liveConflict || pending.base_version !== document.version || pending.before_markdown !== markdown} onClick={() => void resolve(pending, 'accept')}>同意</button></div>
        </WritingRevisionBubble>}
        {editor && pending && compareId === pending.revision_id && <WritingRevisionComparison editor={editor} before={pending.before_markdown} after={pending.after_markdown} onClose={() => setCompareId(null)} />}
      </div>
    </section><div className="writing-resize" role="separator" tabIndex={0} aria-label="调整写作 Agent 侧栏宽度" aria-orientation="vertical" aria-controls="writing-agent-panel" title="拖动调整宽度；左右键微调，Home/End到最小/最大，双击恢复默认" {...panel.separatorProps} /><aside id="writing-agent-panel" className="wr-side"><div className="writing-agent" aria-label="写作 Agent">
        <div className="writing-agent-context"><span className="qx-meta">当前文稿 · 版本 {document.version}{dirty ? ' · 发送时保存最新内容' : ''}</span>{selection && <span className="qx-meta">{'error' in selection ? '选区待重新定位' : `已选 ${selection.text.length} 字符`}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => updateSelection(null)}>清除选区</button></span>}</div>
        <ResearchAgentConversationPage userId={userId} embedded workspace="agent" writingDocumentId={documentId} writingAction={writingAction} onWritingActionFinished={actionFinished} onBusyChange={setAgentBusy} initialWritingMessage={location.state?.writingSubmissionKey && location.state?.writingInstruction ? { id: location.state.writingSubmissionKey, text: location.state.writingInstruction } : null} prepareWritingContext={prepareWritingContext} conversationId={conversationId} onConversationStarted={rememberConversation} onConversationChange={rememberConversation} onTurnCompleted={refreshRevisions} onWritingRevisionCreated={refreshRevisions} onWritingPreview={receiveWritingPreview} onWritingPreviewEnded={finishWritingPreview} showConversationManagement={false} composerAriaLabel="写作旁的 Agent 对话" suggestedPrompt={agentPrompt?.text} suggestedPromptKey={agentPrompt?.key} />
      </div>
    </aside></div>
  </div></div>
}
