import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, DownloadSimpleIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { genres, genreLabel, writingApi, type Genre, type WritingDocument, type WritingRevision } from '../../modules/writing'
import { SharedEditor, type SelectionAction } from '../../modules/shared-editor'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { PageShell } from '../ui/PageShell'
import { Select } from '../ui/Select'
import { draftKey, readDraft, saveDraft, message, useRequestKeys } from './writingState'
import { revisionDiff } from './revisionDiff'
import './reference-workbench.css'
import './writing.css'

export function WritingDocumentPage({ userId }: { userId: string | null }) {
  const { documentId = '' } = useParams()
  return <PageShell workspace><WritingDocumentEditor key={`${userId}:${documentId}`} userId={userId} documentId={documentId} /></PageShell>
}
export function WritingDocumentEditor({ userId, documentId }: { userId: string | null; documentId: string }) {
  const location = useLocation(), cache = useQueryClient(), keyFor = useRequestKeys()
  const [document, setDocument] = useState<WritingDocument | null>(null), [revisions, setRevisions] = useState<WritingRevision[]>([]), [markdown, setMarkdown] = useState(''), [title, setTitle] = useState(''), [genre, setGenre] = useState<Genre>('essay')
  const [error, setError] = useState<string>(location.state?.writingError ?? ''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [tab, setTab] = useState<'agent' | 'revisions' | 'outline'>('agent')
  const [refreshNotice, setRefreshNotice] = useState(''), [agentPrompt, setAgentPrompt] = useState<{ text: string; key: number } | null>(() => location.state?.writingInstruction ? { text: location.state.writingInstruction, key: 1 } : null)
  const conversationKey = userId ? `everplain.writing.conversation:${userId}:${documentId}` : null
  const [conversationId, setConversationId] = useState<string | null>(() => { try { return conversationKey ? sessionStorage.getItem(conversationKey) : null } catch { return null } })
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const selectionRef = useRef(selection); selectionRef.current = selection
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
  const pending = revisions.find(item => item.status === 'pending')
  const preview = pending ? revisionDiff(pending.before_markdown, pending.after_markdown) : null
  const updateBase = useCallback((value: WritingDocument, reset: boolean) => { setDocument(value); documentRef.current = value; if (reset) { draftRef.current = { title: value.title, genre: value.genre, markdown: value.markdown }; setTitle(value.title); setGenre(value.genre); setMarkdown(value.markdown); if (draftStorage) saveDraft(draftStorage, null) } }, [draftStorage])
  useEffect(() => {
    alive.current = true; const controller = new AbortController()
    if (!userId) { setLoading(false); return }
    Promise.all([writingApi.document(documentId, controller.signal), writingApi.revisions(documentId, controller.signal)]).then(([value, revisionList]) => {
      if (!alive.current) return
      const draft = draftStorage ? readDraft(draftStorage) : null
      updateBase(value, true); setRevisions(revisionList.items)
      if (draft) { setTitle(draft.title); setGenre(draft.genre); setMarkdown(draft.markdown); if (draft.version !== value.version) setRefreshNotice('已恢复此浏览器中的修改。服务器也有新版本，请核对后再保存。') }
      draftReady.current = true
    }).catch(failure => { if (alive.current && !controller.signal.aborted) setError(message(failure)) }).finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false; controller.abort() }
  }, [documentId, draftStorage, updateBase, userId])
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
    if (mutex.current) throw new Error('文稿正在保存，请稍后再发送。')
    mutex.current = true; setBusy(true); setError('')
    try {
      const selected = selectionRef.current
      const saved = await saveCurrent()
      if (!alive.current) throw new Error('文稿已关闭，请重新发送。')
      if (hasLocalChanges()) throw new Error('保存期间正文有新修改，已保留。请再发送一次，让 Agent 读取最新内容。')
      return { document_id: documentId, document_version: saved.version,
        ...(selected && saved.markdown.slice(selected.start, selected.end) === selected.text ? { selection_start: selected.start, selection_end: selected.end } : {}) }
    } finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  const refreshRevisions = useCallback(() => {
    const epoch = ++revisionFetchEpoch.current
    void writingApi.revisions(documentId).then(rows => { if (alive.current && epoch === revisionFetchEpoch.current) setRevisions(rows.items) }).catch(failure => { if (alive.current && epoch === revisionFetchEpoch.current) setError(message(failure)) })
  }, [documentId])
  function askAgent(text: string) { setAgentPrompt({ text, key: Date.now() }); setTab('agent') }
  async function resolve(revision: WritingRevision, decision: 'accept' | 'reject') {
    await run(async () => {
      const current = documentRef.current
      if (!current) return
      if (decision === 'accept' && hasLocalChanges()) throw new Error('正文有未保存修改。请先保存，或撤回这条修订。')
      const draft = draftRef.current
      const body = { decision, expected_version: current.version }
      const result = await writingApi.resolve(documentId, revision.revision_id, body, keyFor(`resolve:${revision.revision_id}`, body))
      if (alive.current) { revisionFetchEpoch.current += 1; const unchanged = sameDraft(draft); updateBase(result.document, unchanged && (decision === 'accept' || !hasLocalChanges())); if (!unchanged) setRefreshNotice('修订已处理，期间的新编辑仍保留，请核对后保存。'); setRevisions(rows => rows.map(row => row.revision_id === revision.revision_id ? result.revision : row)); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
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
  const selectionActions: SelectionAction[] = [{ id: 'rewrite', label: '讨论选区', run: (_editor, selected) => {
    const start = draftRef.current.markdown.indexOf(selected)
    if (start < 0 || start !== draftRef.current.markdown.lastIndexOf(selected)) { setError('这一选区无法唯一定位。请在源码模式选择准确范围后再发送。'); return }
    setSelection({ start, end: start + selected.length, text: selected }); askAgent('请帮我改进当前选区，先讨论建议。')
  } }, { id: 'personalize', label: '更像我', icon: <SparkleIcon />, run: (_editor, selected) => {
    const start = draftRef.current.markdown.indexOf(selected)
    if (start < 0 || start !== draftRef.current.markdown.lastIndexOf(selected)) { setError('这一选区无法唯一定位。请在源码模式选择准确范围后再发送。'); return }
    setSelection({ start, end: start + selected.length, text: selected }); askAgent('请参考我的同文体样文，改善当前选区的表达，提交待定修订。')
  } }]
  if (loading) return <div className="writing-load" role="status">正在读取文稿…</div>
  if (!document) return <div className="writing-load"><p role="alert">{error || '文稿不可用。'}</p><Link className="qx-btn qx-btn--secondary" to="/writing">返回写作</Link><button className="qx-btn qx-btn--secondary" onClick={() => { setLoading(true); void writingApi.document(documentId).then(value => { updateBase(value, true); draftReady.current = true }).catch(failure => setError(message(failure))).finally(() => setLoading(false)) }}>重新读取文稿</button></div>
  return <div className="wr-page writing-document"><div className="wr-workbench">
    <header className="wr-top"><div className="wr-crumbs"><Link className="qx-btn qx-btn--ghost" to="/writing">写作</Link><span>/</span><span>{title || '未命名文稿'}</span></div><span className="qx-meta" role="status">{busy ? '正在处理…' : dirty ? '尚未保存' : '已保存'}</span><div className="wr-top__right"><button className="qx-btn qx-btn--secondary" disabled={busy || !dirty} onClick={() => void save()}>保存</button><button className="qx-btn qx-btn--ghost" onClick={download}><DownloadSimpleIcon />导出 Markdown</button></div></header>
    {error && <div className="qx-notice qx-notice--danger writing-notice" role="alert"><p>{error}</p><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void refresh()}>刷新版本并保留修改</button></div>}
    {refreshNotice && <div className="qx-notice writing-notice"><p>{refreshNotice}</p><details><summary>查看服务器正文</summary><pre className="writing-raw">{document.markdown}</pre></details></div>}
    <div className="wr-body"><section className="wr-editor"><div className="writing-document-title"><label className="qx-meta">文体<Select aria-label="文稿文体" disabled={busy} value={genre} onChange={value => setGenre(value as Genre)} options={genres.map(item => ({ value: item.id, label: item.label }))} /></label><input className="writing-title" aria-label="文稿标题" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></div>
      {preview && pending && !dirty && <section className="writing-inline-revision" aria-label="待定修订预览"><header><span className="qx-meta">待定修订 · 接受前正文不变</span><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void resolve(pending, 'reject')}>撤回修订</button><button className="qx-btn qx-btn--primary" disabled={busy} onClick={() => void resolve(pending, 'accept')}>接受修订</button></header><pre className="writing-raw">{preview.prefix}<del className="wr-del">{preview.deleted}</del><ins className="wr-ins" data-phase="pending">{preview.inserted}</ins>{preview.suffix}</pre></section>}
      <SharedEditor markdown={markdown} onChange={setMarkdown} saveState={dirty ? busy ? 'saving' : 'dirty' : 'saved'} onSelectionChange={setSelection} selectionActions={selectionActions} />
      <footer className="wr-statusbar"><span>{genreLabel(genre)} · 版本 {document.version}</span><button className="qx-btn qx-btn--ghost" onClick={() => setTab('revisions')}>{pending ? '1 条待定修订' : '查看修订历史'}</button></footer>
    </section><aside className="wr-side"><div className="wr-tabs" role="tablist" aria-label="写作侧栏">{([['agent', 'Agent'], ['revisions', '修订'], ['outline', '大纲']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className="qx-btn qx-btn--ghost" key={id} onClick={() => setTab(id)}>{label}{id === 'revisions' && pending ? ' · 1' : ''}</button>)}</div>
      <div className="writing-agent" hidden={tab !== 'agent'} role="tabpanel">
        <div className="writing-agent-context"><span className="qx-meta">当前文稿 · 版本 {document.version}{dirty ? ' · 发送时保存最新内容' : ''}</span>{selection && <span className="qx-meta">已选 {selection.text.length} 字符<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setSelection(null)}>清除选区</button></span>}{pending && <button className="qx-btn qx-btn--secondary" onClick={() => setTab('revisions')}>查看待定修订 · 对话仍可继续</button>}</div>
        <ResearchAgentConversationPage userId={userId} embedded workspace="agent" writingDocumentId={documentId} initialWritingMessage={location.state?.writingSubmissionKey && location.state?.writingInstruction ? { id: location.state.writingSubmissionKey, text: location.state.writingInstruction } : null} prepareWritingContext={prepareWritingContext} conversationId={conversationId} onConversationStarted={rememberConversation} onConversationChange={rememberConversation} onTurnCompleted={refreshRevisions} onWritingRevisionCreated={refreshRevisions} showConversationManagement={false} composerAriaLabel="写作旁的 Agent 对话" suggestedPrompt={agentPrompt?.text} suggestedPromptKey={agentPrompt?.key} />
      </div>
      {tab === 'outline' && <nav className="writing-assist" aria-label="文稿大纲">{markdown.split('\n').filter(line => /^#{1,6}\s/.test(line)).map((line, i) => <p className="qx-item" key={i}>{line.replace(/^#+\s/, '')}</p>)}{!/^#{1,6}\s/m.test(markdown) && <p className="qx-meta">添加标题后，大纲会显示在这里。</p>}</nav>}
      {tab === 'revisions' && <section className="wr-revs" role="tabpanel">{!revisions.length && <p className="qx-meta">还没有修订。可以改写、参考样文或续写一段。</p>}{revisions.map(revision => <article className="wr-rev" key={revision.revision_id} data-state={revision.status}><header><span className="wr-rev__kind">{{ rewrite: '改写', personalize: '更像我', continue: '续写' }[revision.action]}</span><span className="wr-rev__state">{{ pending: '待定', accepted: '已接受', rejected: '已撤回', stale: '原文已更新' }[revision.status]}</span></header>{revision.warnings.map((warning, i) => <p key={i} className="qx-notice">{warning}</p>)}<details><summary>查看原文</summary><pre className="writing-raw">{revision.before_markdown || '空白文稿'}</pre></details><p className="qx-meta">修改建议</p><pre className="writing-raw wr-rev__after">{revision.after_markdown}</pre>{revision.status === 'accepted' && document.markdown === revision.after_markdown && <button type="button" className="qx-btn qx-btn--secondary" disabled={busy || dirty} onClick={() => void undoRevision(revision)}>撤销这次修订</button>}{revision.status === 'pending' && <footer><button type="button" className="qx-btn qx-btn--primary" disabled={busy || dirty} onClick={() => void resolve(revision, 'accept')}><CheckIcon />接受</button><button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void resolve(revision, 'reject')}><XIcon />撤回</button></footer>}</article>)}</section>}
    </aside></div>
  </div></div>
}
