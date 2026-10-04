import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, MagnifyingGlassIcon, SignOutIcon } from '@phosphor-icons/react'
import { useAccount } from '../../modules/account'
import { leave } from '../../modules/product-integrations'
import { getCourse, listCourses, readCourseDocument, readKnowledgeStorage, type SharedCourse, type SharedSource } from '../../modules/shared-knowledge'
import { KnowledgePage, KnowledgePageHead } from './KnowledgeLayout'
import { LibraryScopeSwitcher } from './LibraryScopeSwitcher'
import { LibraryMaterialCard, LibrarySkeleton } from './LibraryMaterialCard'
import { LibraryDialog } from './LibraryDialog'
import './courses.css'

export function LibrarySharedPage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const { libraryId = '' } = useParams()
  return <SharedLibraryContent key={`${userId}:${libraryId}`} libraryId={libraryId} />
}
function SharedLibraryContent({ libraryId }: { libraryId: string }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const documentId = params.get('document_id')
  const [libraries, setLibraries] = useState<SharedCourse[]>([])
  const [library, setLibrary] = useState<SharedCourse | null>(null)
  const [source, setSource] = useState<SharedSource | null>(null)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof readKnowledgeStorage>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setLeaving(false) }, [documentId])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setLibrary(null); setSource(null)
    void (async () => {
      const value = await getCourse(libraryId)
      if (!active) return
      if (value.access !== 'reader' && value.access !== 'owner') throw new Error('此知识库不可访问。')
      setLibrary(value)
      if (documentId) {
        if (!value.documents.some(document => document.id === documentId)) throw new Error('此资料不可访问。')
        const result = await readCourseDocument(libraryId, documentId)
        if (active) setSource(result)
      }
    })().catch(failure => { if (active) { setLibrary(null); setSource(null); setError(failure instanceof Error ? failure.message : '资料暂时无法读取。') } }).finally(() => { if (active) setLoading(false) })
    void listCourses().then(value => { if (active) setLibraries(value.filter(item => item.access === 'owner' || item.access === 'reader')) }).catch(() => {})
    void readKnowledgeStorage().then(value => { if (active) setStorage(value) }).catch(() => {})
    return () => { active = false }
  }, [libraryId, documentId, reload])
  async function exitLibrary() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await leave(libraryId); if (alive.current) navigate('/library', { replace: true }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '退出失败，请重试。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const search = query.trim().toLocaleLowerCase()
  const documents = library?.documents.filter(document => !search || `${document.filename} ${document.knowledge?.summary ?? ''}`.toLocaleLowerCase().includes(search)) ?? []
  return <KnowledgePage>
    <KnowledgePageHead title={<LibraryScopeSwitcher libraries={library && !libraries.some(item => item.id === library.id) ? [...libraries, library] : libraries} selectedId={libraryId} view="cards" storage={storage} onCreate={() => navigate('/library?new')} />} actions={library?.access === 'reader' ? <button type="button" className="qx-btn qx-btn--ghost" onClick={() => setLeaving(true)}><SignOutIcon />退出这个知识库</button> : undefined}>
      <p className="qx-meta">共享给我的 · 只读。所有者撤销访问后，这些资料将不可继续读取。</p>
      {source ? <div className="ep-knowledge-actions"><button type="button" className="qx-btn qx-btn--ghost" onClick={() => setParams({})}><ArrowLeftIcon />返回资料</button><span className="qx-tag">只读原文</span></div> : <label className="qx-search"><MagnifyingGlassIcon /><input type="search" aria-label="搜索共享资料" placeholder="搜索标题或摘要" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    </KnowledgePageHead>
    {loading && <LibrarySkeleton />}
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
    {!loading && !error && library && (source ? <div className="ep-library-shared__reader"><nav aria-label="选择资料">{library.documents.map(document => <Link className="qx-item" key={document.id} aria-current={document.id === documentId ? 'true' : undefined} to={`/shared/${encodeURIComponent(libraryId)}?document_id=${encodeURIComponent(document.id)}`}>{document.filename}</Link>)}</nav><article className="qx-prose" aria-label="只读原文"><h2 className="qx-section-title">{source.document.filename}</h2>{source.segments.map(segment => <p key={segment.id}>{segment.text}</p>)}</article></div> : <><div className="ep-library__grid" aria-label="共享资料卡片">{documents.map(document => <LibraryMaterialCard key={document.id} course={library} document={document} readOnly showLibrary={false} busy={false} href={`/shared/${encodeURIComponent(libraryId)}?document_id=${encodeURIComponent(document.id)}`} onRetry={() => {}} onDelete={() => {}} onReupload={() => {}} />)}</div>{!documents.length && <div className="ep-knowledge-empty"><h2 className="qx-card__title">{search ? '没有找到相关资料' : '当前没有可读资料'}</h2>{search && <button className="qx-btn qx-btn--secondary" type="button" onClick={() => setQuery('')}>清除搜索</button>}</div>}</>)}
    {leaving && <LibraryDialog title="退出这个知识库？" busy={busy} onClose={() => setLeaving(false)}><p className="qx-card__body">退出后将无法继续阅读这里的共享资料。资料本身不会被删除，重新加入需要有效邀请。</p><div className="ep-knowledge-actions"><button className="qx-btn qx-btn--secondary" type="button" disabled={busy} onClick={() => setLeaving(false)}>保留访问</button><button className="qx-btn qx-btn--danger" type="button" disabled={busy} onClick={() => void exitLibrary()}>确认退出</button></div>{error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}</LibraryDialog>}
  </KnowledgePage>
}
