import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, DownloadSimpleIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { genres, genreLabel, writingApi, type Genre, type WritingDocument, type WritingRevision } from '../../modules/writing'
import { SharedEditor, type SelectionAction } from '../../modules/shared-editor'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { PageShell } from '../ui/PageShell'
import { Select } from '../ui/Select'
import { WritingComposer } from './WritingComposer'
import { draftKey, readDraft, saveDraft, message, useRequestKeys } from './writingState'
import { revisionDiff } from './revisionDiff'
import './reference-workbench.css'
import './writing.css'

type Action = 'rewrite' | 'personalize' | 'continue'
export function WritingDocumentPage({ userId }: { userId: string | null }) {
  const { documentId = '' } = useParams()
  return <PageShell workspace><WritingDocumentEditor key={`${userId}:${documentId}`} userId={userId} documentId={documentId} /></PageShell>
}
export function WritingDocumentEditor({ userId, documentId }: { userId: string | null; documentId: string }) {
  const location = useLocation(), cache = useQueryClient(), keyFor = useRequestKeys()
  const [document, setDocument] = useState<WritingDocument | null>(null), [revisions, setRevisions] = useState<WritingRevision[]>([]), [markdown, setMarkdown] = useState(''), [title, setTitle] = useState(''), [genre, setGenre] = useState<Genre>('essay')
  const [error, setError] = useState<string>(location.state?.writingError ?? ''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [instruction, setInstruction] = useState<string>(location.state?.writingInstruction ?? ''), [tab, setTab] = useState<'writing' | 'agent' | 'revisions' | 'outline'>('writing')
  const [refreshNotice, setRefreshNotice] = useState(''), [agentPrompt, setAgentPrompt] = useState<{ text: string; key: number } | null>(null)
  const generationEpoch = useRef(0)
  const mutex = useRef(false), alive = useRef(true), draftReady = useRef(false), documentRef = useRef<WritingDocument | null>(null), draftRef = useRef({ title: '', genre: 'essay' as Genre, markdown: '' }), draftStorage = userId ? draftKey(userId, documentId) : null
  draftRef.current = { title, genre, markdown }; documentRef.current = document
  const dirty = Boolean(document && (title !== document.title || genre !== document.genre || markdown !== document.markdown))
  const pending = revisions.find(item => item.status === 'pending')
  const preview = pending ? revisionDiff(pending.before_markdown, pending.after_markdown) : null
  const updateBase = useCallback((value: WritingDocument, reset: boolean) => { setDocument(value); documentRef.current = value; if (reset) { setTitle(value.title); setGenre(value.genre); setMarkdown(value.markdown); if (draftStorage) saveDraft(draftStorage, null) } }, [draftStorage])
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
    if (alive.current) { updateBase(saved, true); setRefreshNotice(''); void writingApi.revisions(documentId).then(rows => { if (alive.current) setRevisions(rows.items) }).catch(() => {}); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
    return saved
  }
  async function run(action: () => Promise<void>) {
    if (!userId || mutex.current) return
    mutex.current = true; setBusy(true); setError('')
    try { await action() } catch (failure) { if (alive.current) setError(message(failure)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  const save = () => run(async () => { await saveCurrent() })
  async function propose(action: Action, selected?: string) {
    await run(async () => {
      if (pending) { setTab('revisions'); throw new Error('请先接受或撤回待定修订。') }
      const saved = await saveCurrent()
      if (!alive.current) return
      let selection: { selection_start?: number; selection_end?: number } = {}
      if (selected) {
        const start = saved.markdown.indexOf(selected)
        if (start < 0 || start !== saved.markdown.lastIndexOf(selected)) throw new Error('无法在 Markdown 中唯一定位这一选区。请在写作要求里说明要修改的段落，或先在源码中调整。')
        selection = { selection_start: start, selection_end: start + selected.length }
      }
      const body = { action, instruction, expected_version: saved.version, ...selection }
      const revision = await writingApi.propose(documentId, body, keyFor(`propose:${documentId}:${generationEpoch.current}`, body))
      if (alive.current) { setRevisions(current => [revision, ...current.filter(item => item.revision_id !== revision.revision_id)]); setTab('revisions') }
    })
  }
  async function resolve(revision: WritingRevision, decision: 'accept' | 'reject') {
    await run(async () => {
      const current = documentRef.current
      if (!current) return
      if (decision === 'accept' && dirty) throw new Error('正文有未保存修改。请先保存，或撤回这条修订。')
      const body = { decision, expected_version: current.version }
      const result = await writingApi.resolve(documentId, revision.revision_id, body, keyFor(`resolve:${revision.revision_id}`, body))
      if (alive.current) { generationEpoch.current += 1; updateBase(result.document, decision === 'accept' || !dirty); setRevisions(rows => rows.map(row => row.revision_id === revision.revision_id ? result.revision : row)); void cache.invalidateQueries({ queryKey: ['writing', userId] }) }
    })
  }
  async function refresh() {
    await run(async () => { const [latest, rows] = await Promise.all([writingApi.document(documentId), writingApi.revisions(documentId)]); if (!alive.current) return; updateBase(latest, !dirty); setRevisions(rows.items); if (dirty) setRefreshNotice('服务器版本已刷新，本地修改仍保留。请对照最新正文后再保存。') })
  }
  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '-') || '文稿'}.md`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const selectionActions: SelectionAction[] = [{ id: 'rewrite', label: '改写', run: (_editor, selected) => { void propose('rewrite', selected) } }, { id: 'personalize', label: '更像我', icon: <SparkleIcon />, run: (_editor, selected) => { void propose('personalize', selected) } }]
  if (loading) return <div className="writing-load" role="status">正在读取文稿…</div>
  if (!document) return <div className="writing-load"><p role="alert">{error || '文稿不可用。'}</p><Link className="qx-btn qx-btn--secondary" to="/writing">返回写作</Link><button className="qx-btn qx-btn--secondary" onClick={() => { setLoading(true); void writingApi.document(documentId).then(value => { updateBase(value, true); draftReady.current = true }).catch(failure => setError(message(failure))).finally(() => setLoading(false)) }}>重新读取文稿</button></div>
  return <div className="wr-page writing-document"><div className="wr-workbench">
    <header className="wr-top"><div className="wr-crumbs"><Link className="qx-btn qx-btn--ghost" to="/writing">写作</Link><span>/</span><span>{title || '未命名文稿'}</span></div><span className="qx-meta" role="status">{busy ? '正在处理…' : dirty ? '尚未保存' : '已保存'}</span><div className="wr-top__right"><button className="qx-btn qx-btn--secondary" disabled={busy || !dirty} onClick={() => void save()}>保存</button><button className="qx-btn qx-btn--ghost" onClick={download}><DownloadSimpleIcon />导出 Markdown</button></div></header>
    {error && <div className="qx-notice qx-notice--danger writing-notice" role="alert"><p>{error}</p><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void refresh()}>刷新版本并保留修改</button></div>}
    {refreshNotice && <div className="qx-notice writing-notice"><p>{refreshNotice}</p><details><summary>查看服务器正文</summary><pre className="writing-raw">{document.markdown}</pre></details></div>}
    <div className="wr-body"><section className="wr-editor"><div className="writing-document-title"><label className="qx-meta">文体<Select aria-label="文稿文体" disabled={busy} value={genre} onChange={value => setGenre(value as Genre)} options={genres.map(item => ({ value: item.id, label: item.label }))} /></label><input className="writing-title" aria-label="文稿标题" value={title} maxLength={200} readOnly={busy} onChange={event => setTitle(event.target.value)} /></div>
      {preview && pending && !dirty && <section className="writing-inline-revision" aria-label="待定修订预览"><header><span className="qx-meta">待定修订 · 接受前正文不变</span><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void resolve(pending, 'reject')}>撤回修订</button><button className="qx-btn qx-btn--primary" disabled={busy} onClick={() => void resolve(pending, 'accept')}>接受修订</button></header><pre className="writing-raw">{preview.prefix}<del className="wr-del">{preview.deleted}</del><ins className="wr-ins" data-phase="pending">{preview.inserted}</ins>{preview.suffix}</pre></section>}
      <SharedEditor markdown={markdown} onChange={setMarkdown} saveState={dirty ? busy ? 'saving' : 'dirty' : 'saved'} readOnly={busy} selectionActions={selectionActions} />
      <footer className="wr-statusbar"><span>{genreLabel(genre)} · 版本 {document.version}</span><button className="qx-btn qx-btn--ghost" onClick={() => setTab('revisions')}>{pending ? '1 条待定修订' : '查看修订历史'}</button></footer>
    </section><aside className="wr-side"><div className="wr-tabs" role="tablist" aria-label="写作侧栏">{([['writing', '写作'], ['revisions', '修订'], ['agent', 'Agent'], ['outline', '大纲']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className="qx-btn qx-btn--ghost" key={id} onClick={() => setTab(id)}>{label}{id === 'revisions' && pending ? ' · 1' : ''}</button>)}</div>
      {tab === 'writing' && <section className="writing-assist" role="tabpanel"><h2 className="qx-heading">继续写你的文章</h2><p className="qx-meta">改写会先保存当前正文，再生成待定修订。接受前，正文不变。</p><div className="writing-actions"><button type="button" className="qx-btn qx-btn--secondary" disabled={busy || Boolean(pending)} onClick={() => void propose('rewrite')}>改写全文</button><button type="button" className="qx-btn qx-btn--secondary" disabled={busy || Boolean(pending)} onClick={() => void propose('personalize')}>更像我</button><button type="button" className="qx-btn qx-btn--secondary" disabled={busy || Boolean(pending)} onClick={() => void propose('continue')}>接着写</button></div><WritingComposer value={instruction} onChange={setInstruction} onSend={() => void propose(markdown.trim() ? 'rewrite' : 'continue')} busy={busy || Boolean(pending)} placeholder="告诉我这次怎么改，或想从哪里开始" /><p className="qx-meta">生成按现有模型价格使用你的积分。文风效果仍在打磨，请核对事实。</p><button type="button" className="qx-btn qx-btn--ghost" onClick={() => { setAgentPrompt({ text: `请讨论下面的文稿，先给建议，不要假定你已经修改了文稿：\n\n${markdown.slice(0, 9000)}`, key: Date.now() }); setTab('agent') }}>将本文放进 Agent 输入框</button></section>}
      {tab === 'agent' && <div className="writing-agent"><ResearchAgentConversationPage userId={userId} embedded workspace="agent" showConversationManagement={false} composerAriaLabel="写作旁的 Agent 对话" suggestedPrompt={agentPrompt?.text} suggestedPromptKey={agentPrompt?.key} /></div>}
      {tab === 'outline' && <nav className="writing-assist" aria-label="文稿大纲">{markdown.split('\n').filter(line => /^#{1,6}\s/.test(line)).map((line, i) => <p className="qx-item" key={i}>{line.replace(/^#+\s/, '')}</p>)}{!/^#{1,6}\s/m.test(markdown) && <p className="qx-meta">添加标题后，大纲会显示在这里。</p>}</nav>}
      {tab === 'revisions' && <section className="wr-revs" role="tabpanel">{!revisions.length && <p className="qx-meta">还没有修订。可以改写、参考样文或续写一段。</p>}{revisions.map(revision => <article className="wr-rev" key={revision.revision_id} data-state={revision.status}><header><span className="wr-rev__kind">{{ rewrite: '改写', personalize: '更像我', continue: '续写' }[revision.action]}</span><span className="wr-rev__state">{{ pending: '待定', accepted: '已接受', rejected: '已撤回', stale: '原文已更新' }[revision.status]}</span></header>{revision.warnings.map((warning, i) => <p key={i} className="qx-notice">{warning}</p>)}<details><summary>查看原文</summary><pre className="writing-raw">{revision.before_markdown || '空白文稿'}</pre></details><p className="qx-meta">修改建议</p><pre className="writing-raw wr-rev__after">{revision.after_markdown}</pre>{revision.status === 'pending' && <footer><button type="button" className="qx-btn qx-btn--primary" disabled={busy || dirty} onClick={() => void resolve(revision, 'accept')}><CheckIcon />接受</button><button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void resolve(revision, 'reject')}><XIcon />撤回</button></footer>}</article>)}</section>}
    </aside></div>
  </div></div>
}
