import { Select } from '../ui/Select'
import { useAccount } from '../../modules/account'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { ArrowClockwiseIcon, ArrowLeftIcon, ArrowUpRightIcon, BooksIcon, PencilSimpleIcon, TreeStructureIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PageContent, PageShell } from '../ui/PageShell'
import { ReadOnlyMaterialReader } from './ReadOnlyMaterialReader'
import { formatMaterialSize } from '../../modules/research-materials'
import { COURSE_DOCUMENT_ACCEPT, retryCourseDocument, createCourse, deleteCourse, detachCourseDocument, getCourse, listCourses, readCourseDocument, updateCourse, uploadCourseDocument, readKnowledgeStorage, type SharedCourse, type SharedDocument, type SharedSource } from '../../modules/shared-knowledge'
import { KnowledgePage, KnowledgePageHead, KnowledgeViewSwitch } from './KnowledgeLayout'
import './courses.css'

function documentKind(document: SharedDocument) {
  const extension = document.filename.split('.').pop()?.toLocaleLowerCase()
  if (extension === 'pdf' || document.mediaType === 'application/pdf') return 'PDF'
  if (extension === 'docx') return 'Word'
  if (extension === 'pptx') return '演示文稿'
  if (document.mediaType?.startsWith('image/')) return '图片'
  if (extension === 'html' || extension === 'htm') return '网页'
  return '笔记'
}

function isProcessing(document: SharedDocument) {
  return document.status === 'processing' || (document.status === 'ready' && [document.knowledgeStatus, document.indexStatus].some(status => status === 'queued' || status === 'running'))
}

export function CoursesPage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const [params, setParams] = useSearchParams()
  const routerNavigate = useNavigate()
  const id = params.get('kb_id')
  const documentId = params.get('document_id')
  const segmentId = params.get('segment_id')
  const [reload, setReload] = useState(0)
  const [courses, setCourses] = useState<SharedCourse[]>([])
  const [detail, setDetail] = useState<SharedCourse | null>(null)
  const [source, setSource] = useState<SharedSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showLibraries, setShowLibraries] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof readKnowledgeStorage>> | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal()
    else deleteDialog.current?.close()
  }, [deleting])
  useEffect(() => {
    let active = true
    setLoading(true); setError(null); setCatalogError(null); setDetail(null); setSource(null)
    void (async () => {
      const list = await listCourses()
      if (!active) return
      const owned = list.filter((item) => item.access === 'owner')
      setCourses(owned)
      if (id) {
        const value = await getCourse(id)
        if (!active) return
        if (value.access !== 'owner') throw new Error('此知识库不可访问。')
        setDetail(value)
        if (documentId) {
          const result = await readCourseDocument(id, documentId)
          if (active) setSource(result)
        }
      } else {
        // The list API contains library summaries; document cards use owner-checked details.
        const results = await Promise.allSettled(owned.map(item => getCourse(item.id)))
        if (!active) return
        setCourses(owned.map((item, index) => {
          const result = results[index]
          return result.status === 'fulfilled' && result.value.access === 'owner' ? result.value : { ...item, documents: [] }
        }))
        if (results.some(result => result.status === 'rejected' || result.value.access !== 'owner')) setCatalogError('部分资料暂时无法读取。已保留可访问的资料，你可以重试或打开对应知识库。')
      }
    })().catch((e: Error) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    void readKnowledgeStorage().then((value) => { if (active) setStorage(value) }).catch(() => {})
    return () => { active = false }
  }, [id, documentId, reload])
  useEffect(() => {
    const pending = (detail ? [detail] : courses).filter(course => course.documents.some(isProcessing))
    if (!pending.length) return
    let active = true
    const timer = window.setInterval(() => {
      void Promise.all(pending.map(course => getCourse(course.id))).then(values => {
        if (!active) return
        if (detail) {
          const refreshed = values.find(value => value.id === detail.id)
          if (refreshed?.access === 'owner') setDetail(refreshed)
          else { setDetail(null); setSource(null); setError('此知识库不可访问。') }
        } else setCourses(current => current.flatMap(course => {
          const refreshed = values.find(value => value.id === course.id)
          return refreshed ? refreshed.access === 'owner' ? [refreshed] : [] : [course]
        }))
      }).catch((e: Error) => { if (active) { setError(e.message); window.clearInterval(timer) } })
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [detail, courses])
  function navigate(libraryId?: string, docId?: string) {
    setEditing(false); setNotice(null); setError(null)
    const next = new URLSearchParams()
    if (libraryId) next.set('kb_id', libraryId)
    if (docId) next.set('document_id', docId)
    if (libraryId === id && params.get('conversation_id')) next.set('conversation_id', params.get('conversation_id')!)
    routerNavigate(`/library${next.size ? `?${next}` : ''}`)
  }
  async function action(work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null); setNotice(null)
    try { await work(); void readKnowledgeStorage().then(setStorage).catch(() => {}) }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    await action(async () => {
      const result = detail ? await updateCourse(detail.id, { name: name.trim(), description }) : await createCourse({ name: name.trim(), description })
      setDetail(result); setEditing(false); setCourses((await listCourses()).filter((item) => item.access === 'owner'))
      if (!detail) setParams({ kb_id: result.id })
    })
  }
  const visible = courses.filter((course) => !query || `${course.name} ${course.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const search = query.trim().toLocaleLowerCase()
  const materials = courses.flatMap(course => course.documents.map(document => ({ course, document })))
  const kinds = [...new Set(materials.map(({ document }) => documentKind(document)))]
  const shownMaterials = materials.filter(({ course, document }) =>
    (!libraryFilter || course.id === libraryFilter) && (!kindFilter || documentKind(document) === kindFilter) &&
    (!search || `${document.filename} ${document.knowledge?.summary ?? ''} ${document.knowledge?.topics.map(topic => `${topic.title} ${topic.summary}`).join(' ') ?? ''} ${course.name ?? ''}`.toLocaleLowerCase().includes(search)))
  const pendingCount = materials.filter(({ document }) => isProcessing(document)).length
  const startCreate = () => { setName(''); setDescription(''); setEditing(!editing) }
  const maxFileBytes = storage?.max_file_bytes ?? 20 * 1024 * 1024
  const maxDocuments = storage?.max_documents_per_library ?? 100

  async function upload(files: File[]) {
    if (!detail || !files.length) return
    await action(async () => {
      if (files.length + detail.documents.length > maxDocuments) throw new Error(`每个知识库最多 ${maxDocuments} 份资料，请减少本次文件数量。`)
      const failed: string[] = []
      try {
        for (const [index, file] of files.entries()) {
          setUploadProgress(`正在上传 ${index + 1}/${files.length}：${file.name}`)
          try {
            if (file.size > maxFileBytes) throw new Error(`超过 ${formatMaterialSize(maxFileBytes)}`)
            const result = await uploadCourseDocument(detail.id, file)
            if (result.status === 'failed') failed.push(`${file.name}：${result.errorMessage ?? '解析失败'}`)
          } catch (e) { failed.push(`${file.name}：${e instanceof Error ? e.message : '上传失败'}`) }
        }
        setDetail(await getCourse(detail.id))
        setNotice(failed.length ? `${failed.length} 份资料上传或解析失败：${failed.join('；')}。其余文件已保留，可单独重试失败文件。` : '资料已上传，正在后台建立语义索引并整理知识。')
      } finally { setUploadProgress(null) }
    })
  }

  if (source) return <PageShell wide><PageContent>
    <ReadOnlyMaterialReader key={source.document.id} source={{ ...source, document: detail?.documents.find(doc => doc.id === source.document.id) ?? source.document }} selectedSegmentId={segmentId}
      onKnowledgeSaved={document => { setSource({ ...source, document }); setDetail(value => value ? { ...value, documents: value.documents.map(item => item.id === document.id ? document : item) } : value) }}
      agentPanel={<ResearchAgentConversationPage embedded userId={userId} referenceKnowledgeBaseId={source.knowledgeBaseId} conversationId={params.get('conversation_id')} composerAriaLabel="结合本库资料提问" onOpenCourseCitation={citation => {
        if (!citation.knowledge_base_id || !citation.material_id || !citation.segment_id) return
        setParams(current => { const next = new URLSearchParams(current); next.set('kb_id', citation.knowledge_base_id!); next.set('document_id', citation.material_id!); next.set('segment_id', citation.segment_id!); return next })
      }} onConversationStarted={({ conversation_id }) => setParams(current => { const next = new URLSearchParams(current); next.set('conversation_id', conversation_id); return next }, { replace: true })} />}
      onBack={() => navigate(source.knowledgeBaseId)}
      navigation={<div className="ep-material__nav"><button className="qx-btn qx-btn--ghost" type="button" aria-label="返回知识库" onClick={() => navigate(source.knowledgeBaseId)}><ArrowLeftIcon size={18} />知识库</button><Select aria-label="切换资料" value={source.document.id} onChange={nextValue => navigate(source.knowledgeBaseId, nextValue)} options={detail?.documents.filter(doc => doc.status === 'ready').map(doc => ({ value: doc.id, label: doc.filename })) ?? []} /><Link className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="知识与关系" to={`/library/knowledge?kb_id=${encodeURIComponent(source.knowledgeBaseId)}`}><TreeStructureIcon size={18} /></Link></div>} />
  </PageContent></PageShell>

  const documents = detail ? detail.documents.filter(doc => !search || `${doc.filename} ${doc.knowledge?.summary ?? ''} ${doc.knowledge?.topics.map(topic => topic.title).join(' ') ?? ''}`.toLocaleLowerCase().includes(search)).map(document => ({ course: detail, document })) : shownMaterials
  return <KnowledgePage>
    <KnowledgePageHead title={detail?.name ?? '知识库'} actions={detail ? <>
      <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="编辑知识库" disabled={busy} onClick={() => { setName(detail.name ?? ''); setDescription(detail.description ?? ''); setEditing(!editing) }}><PencilSimpleIcon size={18} /></button>
      <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="删除知识库" disabled={busy} onClick={() => setDeleting(true)}><TrashIcon size={18} /></button>
      <button type="button" className="qx-btn qx-btn--primary" disabled={busy || detail.documents.length >= maxDocuments} onClick={() => uploadRef.current?.click()}><UploadSimpleIcon size={18} />{busy ? '正在处理…' : '上传资料'}</button>
    </> : <><KnowledgeViewSwitch view="cards" /><button type="button" className="qx-btn qx-btn--ghost" aria-pressed={showLibraries} onClick={() => { setShowLibraries(!showLibraries); setQuery(''); setEditing(false) }}>管理知识库</button><Link className="qx-btn qx-btn--primary" to="/imports"><PlusIcon size={18} />添加资料</Link></>}>
      {detail && <div className="ep-library__context"><button className="qx-btn qx-btn--ghost" type="button" onClick={() => { navigate(); setQuery('') }}><ArrowLeftIcon size={16} />所有知识库</button><p className="qx-meta">{detail.description || '只有你可以访问这个知识库。'}</p><Link className="qx-btn qx-btn--ghost" to={`/library/knowledge?kb_id=${encodeURIComponent(detail.id)}`}><TreeStructureIcon size={16} />浏览知识与关系</Link><Link className="qx-btn qx-btn--secondary" to={`/agent?reference_knowledge_base_id=${encodeURIComponent(detail.id)}`}>基于本库研究</Link></div>}
      <div className="ep-library__search-row"><label className="qx-search ep-knowledge-search"><MagnifyingGlassIcon size={18} /><input type="search" aria-label={showLibraries && !detail ? '搜索知识库' : '搜索资料'} placeholder={showLibraries && !detail ? '搜索名称或说明' : '搜标题、摘要、知识点'} value={query} onChange={event => setQuery(event.target.value)} /></label>{showLibraries && !detail && <button type="button" className="qx-btn qx-btn--secondary" disabled={!!storage && courses.length >= storage.max_libraries} onClick={startCreate}><PlusIcon size={17} />新建知识库</button>}</div>
      {!showLibraries && !detail && <div className="ep-knowledge-filters" aria-label="资料筛选"><button type="button" className="qx-tag" aria-pressed={!libraryFilter && !kindFilter} onClick={() => { setLibraryFilter(''); setKindFilter('') }}>全部 {materials.length}</button>{courses.map(course => <button type="button" className="qx-tag" key={course.id} aria-pressed={libraryFilter === course.id} onClick={() => setLibraryFilter(libraryFilter === course.id ? '' : course.id)}>{course.name}</button>)}{kinds.length > 1 && <><span className="ep-knowledge-filters__separator" aria-hidden="true" />{kinds.map(kind => <button type="button" key={kind} className="qx-tag qx-tag--outline" aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kindFilter === kind ? '' : kind)}>{kind}</button>)}</>}</div>}
    </KnowledgePageHead>
    {error && <p role="alert" className="qx-notice qx-notice--danger">{error}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setReload(n => n + 1)}>重新加载</button></p>}
    {(notice || uploadProgress) && <p role="status" className="qx-notice">{uploadProgress ?? notice}</p>}
    {loading && <p className="qx-meta" role="status">正在读取知识库…</p>}
    {editing && <form className="qx-card ep-library__form" onSubmit={event => void save(event)}><h2 className="qx-card__title">{detail ? '编辑知识库' : '新建知识库'}</h2><label>知识库名称<input className="qx-input" value={name} required maxLength={100} onChange={event => setName(event.target.value)} autoFocus /></label><label>说明（选填）<textarea className="qx-textarea" value={description} maxLength={1000} rows={3} onChange={event => setDescription(event.target.value)} placeholder="这些资料围绕什么主题？" /></label><div className="ep-knowledge-actions"><button type="submit" className="qx-btn qx-btn--primary" disabled={busy || !name.trim()}>保存知识库</button><button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => setEditing(false)}>取消</button></div></form>}
    {!loading && !error && <>
      {showLibraries && !detail ? <>
        <div className="ep-library__grid">{visible.map(course => <article className="qx-card ep-library-folder" key={course.id}><span className="qx-meta">私有 · {course.documents.length || course.readyDocumentCount} 份资料</span><h2 className="qx-card__title">{course.name}</h2><p className="qx-card__body">{course.description || '你的资料与研究依据'}</p><button type="button" className="qx-btn qx-btn--ghost" aria-label={`打开知识库 ${course.name}`} onClick={() => { navigate(course.id); setQuery('') }}>打开知识库<ArrowUpRightIcon size={16} /></button></article>)}</div>
        {!visible.length && !editing && <div className="ep-knowledge-empty"><BooksIcon size={32} /><h2 className="qx-card__title">{query ? '没有找到相关知识库' : '创建你的第一个知识库'}</h2><p className="qx-meta">按工作、兴趣或研究主题归集资料。</p></div>}
      </> : <>
        {catalogError && <p className="qx-notice" role="alert">{catalogError}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setReload(n => n + 1)}>重试读取资料</button></p>}
        {!detail && pendingCount > 0 && <div className="qx-notice ep-library__status" role="status"><ArrowClockwiseIcon size={18} /><span>{pendingCount} 份资料正在解析、整理知识或建立语义索引。</span><Link className="qx-btn qx-btn--ghost" to="/imports">导入记录</Link></div>}
        <div className="ep-library__grid" aria-label="资料卡片">{documents.map(({ course, document: doc }) => <article className="qx-card qx-card--interactive ep-library-card" key={`${course.id}:${doc.id}`}>
          <div className="ep-library-card__top"><span><FileTextIcon size={16} />{documentKind(doc)}</span><span title={course.name ?? undefined}>{course.name}</span></div>
          <h2 className="qx-card__title">{doc.status === 'ready' ? <Link to={`/library?kb_id=${encodeURIComponent(course.id)}&document_id=${encodeURIComponent(doc.id)}`}>{doc.filename}</Link> : doc.filename}</h2>
          <p className="qx-card__body ep-library-card__summary">{doc.knowledge?.summary || doc.errorMessage || (doc.status === 'processing' ? '正在解析资料，完成后即可阅读原文。' : doc.status === 'failed' ? '资料解析失败，可查看原因后重新上传。' : '原文已保存，知识摘要将在整理完成后显示。')}</p>
          <div className="ep-library-card__states"><span>{doc.status === 'ready' ? '可阅读' : doc.status === 'failed' ? '解析失败' : '解析中'}</span>{doc.status === 'ready' && <><span>{({queued: '等待知识整理', running: '知识整理中', ready: '知识已整理', failed: '知识整理失败'})[doc.knowledgeStatus]}</span><span>{({queued: '等待语义索引', running: '建立语义索引中', ready: '语义索引就绪', failed: '语义索引失败'})[doc.indexStatus]}</span></>}</div>
          {(doc.knowledgeError || doc.indexError) && <p className="ep-library-card__error">{doc.knowledgeError || doc.indexError}</p>}{detail && doc.warnings.map(warning => <p className="qx-meta" key={warning}>{warning}</p>)}
          <footer className="qx-card__meta"><span>{formatMaterialSize(doc.sizeBytes)}{doc.knowledge ? ` · ${doc.knowledge.topics.length} 个知识点` : ''}</span><div className="ep-library-card__actions">{detail ? <>
            {doc.status === 'ready' && (doc.knowledgeStatus === 'failed' || doc.indexStatus === 'failed') && <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`重试处理 ${doc.filename}`} disabled={busy} onClick={() => void action(async () => { await retryCourseDocument(course.id, doc.id); setDetail(await getCourse(course.id)) })}><ArrowClockwiseIcon size={17} /></button>}
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`删除 ${doc.filename}`} disabled={busy} onClick={() => { if (window.confirm(`删除“${doc.filename}”及其知识与索引？此操作无法撤销。`)) void action(async () => { await detachCourseDocument(course.id, doc.id); setDetail(await getCourse(course.id)); setNotice('资料及其知识、索引已从知识库删除。') }) }}><TrashIcon size={17} /></button>
          </> : <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`管理资料 ${doc.filename}`} onClick={() => { navigate(course.id); setQuery('') }}><ArrowUpRightIcon size={17} /></button>}</div></footer>
        </article>)}</div>
        {!documents.length && !editing && <div className="ep-knowledge-empty"><BooksIcon size={32} /><h2 className="qx-card__title">{search || libraryFilter || kindFilter ? '没有找到相关资料' : !courses.length ? '创建你的第一个知识库' : '把第一份资料，放进来。'}</h2><p className="qx-meta">{search || libraryFilter || kindFilter ? '换个关键词，或调整筛选条件。' : '收藏、笔记和文档会汇集在这里，保留原文与知识点。'}</p>{!detail && !search && !libraryFilter && !kindFilter && <div className="ep-knowledge-actions"><Link className="qx-btn qx-btn--primary" to="/imports">导入资料</Link><button type="button" className="qx-btn qx-btn--secondary" disabled={!!storage && courses.length >= storage.max_libraries} onClick={startCreate}><PlusIcon size={17} />新建知识库</button></div>}</div>}
      </>}
    </>}
    {detail && <><input ref={uploadRef} type="file" aria-label="选择资料文件" hidden multiple accept={COURSE_DOCUMENT_ACCEPT} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files) }} /><p className="qx-meta ep-library__footnote">支持 PDF、DOCX、PPTX、Markdown、TXT，单份不超过 {formatMaterialSize(maxFileBytes)}，每库最多 {maxDocuments} 份。扫描图片需先转为可选取文字的文档；PPTX 读取可见页正文。</p></>}
    {storage && Number.isFinite(storage.used_bytes) && <p className="qx-meta ep-library__footnote">知识库存储 {formatMaterialSize(storage.used_bytes)} / {formatMaterialSize(storage.max_bytes)} · {storage.library_count} / {storage.max_libraries} 个知识库 · 资料仅对你可见</p>}
    <dialog ref={deleteDialog} className="qx-modal ep-library__delete" aria-labelledby="course-delete-title" onCancel={event => { event.preventDefault(); if (!busy) setDeleting(false) }}><h2 id="course-delete-title" className="qx-section-title">删除知识库？</h2><p className="qx-card__body">此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。</p><div className="ep-knowledge-actions"><button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => setDeleting(false)}>保留知识库</button><button type="button" className="qx-btn qx-btn--primary" disabled={busy} onClick={() => void action(async () => { if (!detail) return; await deleteCourse(detail.id); setDeleting(false); navigate(); setReload(n => n + 1) })}>{busy ? '正在删除…' : '确认删除'}</button></div>{deleting && error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}</dialog>
  </KnowledgePage>
}
