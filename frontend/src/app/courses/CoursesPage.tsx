import { useAccount } from '../../modules/account'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { CourseIconButton } from './CourseIconButton'
import { CourseShader } from './CourseShader'
import { ArrowClockwiseIcon, ArrowLeftIcon, ArrowUpRightIcon, BooksIcon, PencilSimpleIcon, TreeStructureIcon, XIcon, FileTextIcon, PlusIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PageContent, PageShell } from '../ui/PageShell'
import { ResearchHubToolbar } from '../research/ResearchHubToolbar'
import { ReadOnlyMaterialReader } from './ReadOnlyMaterialReader'
import { formatMaterialSize } from '../../modules/research-materials'
import { COURSE_DOCUMENT_ACCEPT, retryCourseDocument, createCourse, deleteCourse, detachCourseDocument, getCourse, listCourses, readCourseDocument, updateCourse, uploadCourseDocument, readKnowledgeStorage, type SharedCourse, type SharedSource } from '../../modules/shared-knowledge'
import '../research/research-materials-page.css'
import './courses.css'

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
    setLoading(true); setError(null); setDetail(null); setSource(null)
    void (async () => {
      const list = await listCourses()
      if (!active) return
      setCourses(list.filter((item) => item.access === 'owner'))
      if (id) {
        const value = await getCourse(id)
        if (!active) return
        if (value.access !== 'owner') throw new Error('此知识库不可访问。')
        setDetail(value)
        if (documentId) {
          const result = await readCourseDocument(id, documentId)
          if (active) setSource(result)
        }
      }
    })().catch((e: Error) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    void readKnowledgeStorage().then((value) => { if (active) setStorage(value) }).catch(() => {})
    return () => { active = false }
  }, [id, documentId, reload])
  useEffect(() => {
    if (!detail?.documents.some((doc) => doc.status === 'ready' && [doc.knowledgeStatus, doc.indexStatus].some((status) => status === 'queued' || status === 'running'))) return
    let active = true
    const timer = window.setInterval(() => {
      void getCourse(detail.id).then((value) => { if (active) setDetail(value) })
        .catch((e: Error) => { if (active) { setError(e.message); window.clearInterval(timer) } })
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [detail])
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
  const maxFileBytes = storage?.max_file_bytes ?? 20 * 1024 * 1024
  const maxDocuments = storage?.max_documents_per_library ?? 100

  if (source) return <PageShell immersive wide>
    <section className="coding-workspace course-reading-workspace" aria-label="资料阅读工作区">
      <ReadOnlyMaterialReader key={source.document.id} source={{ ...source, document: detail?.documents.find((doc) => doc.id === source.document.id) ?? source.document }} selectedSegmentId={segmentId}
        onKnowledgeSaved={(document) => { setSource({ ...source, document }); setDetail((value) => value ? { ...value, documents: value.documents.map((item) => item.id === document.id ? document : item) } : value) }}
        agentPanel={<ResearchAgentConversationPage embedded userId={userId} referenceKnowledgeBaseId={source.knowledgeBaseId} conversationId={params.get('conversation_id')} composerAriaLabel="结合本库资料提问" onOpenCourseCitation={(citation) => {
          if (!citation.knowledge_base_id || !citation.material_id || !citation.segment_id) return
          setParams((current) => { const next = new URLSearchParams(current); next.set('kb_id', citation.knowledge_base_id!); next.set('document_id', citation.material_id!); next.set('segment_id', citation.segment_id!); return next })
        }} onConversationStarted={({ conversation_id }) => setParams((current) => { const next = new URLSearchParams(current); next.set('conversation_id', conversation_id); return next }, { replace: true })} />}
        onBack={() => navigate(source.knowledgeBaseId)}
        navigation={<div className="coding-workspace__navigation course-reading-workspace__navigation">
          <CourseIconButton label="返回知识库" onClick={() => navigate(source.knowledgeBaseId)}><ArrowLeftIcon size={18} /></CourseIconButton>
          <span className="course-reading-workspace__title">{source.knowledgeBaseName}</span><span aria-hidden="true">/</span>
          <select aria-label="切换资料" value={source.document.id} onChange={(event) => navigate(source.knowledgeBaseId, event.target.value)}>
            {detail?.documents.filter((doc) => doc.status === 'ready').map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}
          </select>
          <Link className="course-icon-button" aria-label="知识与关系" title="知识与关系" to={`/library/knowledge?kb_id=${encodeURIComponent(source.knowledgeBaseId)}`}><TreeStructureIcon size={18} /></Link>
        </div>} />
    </section>
  </PageShell>

  return <PageShell wide backdrop={<CourseShader />}><PageContent><section className="courses-page research-hub">
    <header className="courses-page__heading"><BooksIcon size={32} weight="light" aria-hidden="true" /><h1>知识库</h1><p>收好资料，连接知识，让每一次研究都有据可查。</p></header>
    <div className="research-hub__body"><div className="research-hub__panel">
      {error ? <p role="alert" className="qx-message is-error">{error}<button type="button" className="courses-page__text-button" onClick={() => setReload((n) => n + 1)}>重新加载</button></p> : null}
      {notice || uploadProgress ? <p role="status" className="research-hub__notice">{uploadProgress ?? notice}</p> : null}
      {loading ? <p role="status">正在读取知识库…</p> : null}
      {detail ? <>
        <button className="courses-page__text-button" type="button" onClick={() => navigate()}><ArrowLeftIcon size={16} />所有知识库</button>
        <header className="courses-page__detail"><div><h2>{detail.name}</h2><p>{detail.description || '只有你可以访问这个知识库。'}</p></div><div className="courses-page__actions"><Link className="qx-button" to={`/library/knowledge?kb_id=${encodeURIComponent(detail.id)}`}><TreeStructureIcon size={16} />浏览知识与关系</Link><Link className="research-hub__new" to={`/agent?reference_knowledge_base_id=${encodeURIComponent(detail.id)}`}>基于本库研究</Link></div></header>
        <div className="courses-page__actions"><button type="button" className="research-hub__new" disabled={busy || detail.documents.length >= maxDocuments} onClick={() => uploadRef.current?.click()}><UploadSimpleIcon size={16} />{busy ? '正在处理…' : '上传资料'}</button><CourseIconButton label="编辑知识库" disabled={busy} onClick={() => { setName(detail.name ?? ''); setDescription(detail.description ?? ''); setEditing(!editing) }}><PencilSimpleIcon size={19} /></CourseIconButton><button type="button" className="course-icon-button course-icon-button--danger" aria-label="删除知识库" title="删除知识库" disabled={busy} onClick={() => setDeleting(true)}><TrashIcon size={19} /></button></div>
        <input ref={uploadRef} type="file" aria-label="选择资料文件" hidden multiple accept={COURSE_DOCUMENT_ACCEPT} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ''
          if (!files.length) return
          void action(async () => {
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
        }} />
        <div className="material-files courses-page__files"><div className="material-files__table-scroll"><table aria-label="知识库资料列表"><thead><tr><th>文件名称</th><th>大小</th><th>状态</th><th>操作</th></tr></thead><tbody>{detail.documents.map((doc) => <tr key={doc.id}><td><button type="button" className="material-files__filename courses-page__file" disabled={doc.status !== 'ready'} onClick={() => navigate(detail.id, doc.id)}><FileTextIcon size={22} /><strong>{doc.filename}</strong></button>{doc.warnings.map((warning) => <small key={warning} className="courses-page__hint">{warning}</small>)}{doc.errorMessage ? <small className="courses-page__failure">{doc.errorMessage}</small> : null}</td><td>{formatMaterialSize(doc.sizeBytes)}</td><td><span>{doc.status === 'ready' ? '可阅读' : doc.status === 'failed' ? '解析失败' : '解析中'}</span>{doc.status === 'ready' ? <><small className="courses-page__hint">{({queued: '等待知识整理', running: '知识整理中', ready: '知识已整理', failed: '知识整理失败'})[doc.knowledgeStatus]}</small><small className="courses-page__hint">{({queued: '等待语义索引', running: '建立语义索引中', ready: '语义索引就绪', failed: '语义索引失败'})[doc.indexStatus]}</small>{doc.knowledgeError || doc.indexError ? <small className="courses-page__failure">{doc.knowledgeError || doc.indexError}</small> : null}</> : null}</td><td>{doc.status === 'ready' && (doc.knowledgeStatus === 'failed' || doc.indexStatus === 'failed') ? <button type="button" className="course-icon-button" title="重试处理" aria-label={`重试处理 ${doc.filename}`} disabled={busy} onClick={() => void action(async () => { await retryCourseDocument(detail.id, doc.id); setDetail(await getCourse(detail.id)) })}><ArrowClockwiseIcon size={18} /></button> : null}<button type="button" className="course-icon-button course-icon-button--danger" title="删除资料" aria-label={`删除 ${doc.filename}`} disabled={busy} onClick={() => { if (window.confirm(`删除“${doc.filename}”及其知识与索引？此操作无法撤销。`)) void action(async () => { await detachCourseDocument(detail.id, doc.id); setDetail(await getCourse(detail.id)); setNotice('资料及其知识、索引已从知识库删除。') }) }}><TrashIcon size={16} /></button></td></tr>)}</tbody></table></div>{!detail.documents.length ? <div className="material-files__empty"><FileTextIcon size={28} /><p>上传文档、报告或笔记，开始整理你的知识。</p></div> : null}</div>
        <p className="courses-page__hint">支持 PDF、DOCX、PPTX、Markdown、TXT，单份不超过 {formatMaterialSize(maxFileBytes)}，每库最多 {maxDocuments} 份。扫描图片需先转为可选取文字的文档；PPTX 读取可见页正文。</p>
      </> : !loading && !error ? <>
        <ResearchHubToolbar query={query} onQueryChange={setQuery} searchLabel="搜索知识库" placeholder="搜索名称或说明"><button type="button" className="research-hub__new" disabled={!!storage && courses.length >= storage.max_libraries} onClick={() => { setName(''); setDescription(''); setEditing(!editing) }}><PlusIcon size={17} />新建知识库</button></ResearchHubToolbar>
        {!editing && !visible.length ? <div className="material-files__empty"><BooksIcon size={36} weight="light" /><h2>{query ? '没有找到相关知识库' : '创建你的第一个知识库'}</h2><p>按工作、兴趣或研究主题归集资料。上传后，知识点、关系与出处会在这里逐步整理出来。</p></div> : null}
        <div className="research-hub__projects">{visible.map((course) => <article className="research-project-card" key={course.id}><span className="courses-page__hint">私有 · {course.readyDocumentCount} 份资料</span><h2>{course.name}</h2><p>{course.description || '你的资料与研究依据'}</p><button type="button" className="course-icon-button courses-page__card-link" title="打开知识库" aria-label={`打开知识库 ${course.name}`} onClick={() => navigate(course.id)}><ArrowUpRightIcon size={19} /></button></article>)}</div>
      </> : null}
      {editing ? <form className="courses-page__form" onSubmit={(e) => void save(e)}><h2>{detail ? '编辑知识库' : '新建知识库'}</h2><label>知识库名称<input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus /></label><label>说明（选填）<textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="这些资料围绕什么主题？" /></label><div className="courses-page__actions"><button type="submit" className="research-hub__new" disabled={busy || !name.trim()}>保存知识库</button><CourseIconButton label="取消" disabled={busy} onClick={() => setEditing(false)}><XIcon size={19} /></CourseIconButton></div></form> : null}
      {storage && Number.isFinite(storage.used_bytes) ? <p className="courses-page__hint">知识库存储 {formatMaterialSize(storage.used_bytes)} / {formatMaterialSize(storage.max_bytes)} · {storage.library_count} / {storage.max_libraries} 个知识库 · 资料仅对你可见</p> : null}
      <dialog ref={deleteDialog} className="course-delete-dialog" aria-labelledby="course-delete-title" onCancel={(event) => { event.preventDefault(); if (!busy) setDeleting(false) }}><h2 id="course-delete-title">删除知识库？</h2><p>此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。</p><div className="courses-page__actions"><button type="button" className="qx-button" disabled={busy} onClick={() => setDeleting(false)}>保留知识库</button><button type="button" className="qx-button" disabled={busy} onClick={() => void action(async () => { if (!detail) return; await deleteCourse(detail.id); setDeleting(false); navigate(); setReload((n) => n + 1) })}>{busy ? '正在删除…' : '确认删除'}</button></div>{deleting && error ? <p role="alert" className="qx-message is-error">{error}</p> : null}</dialog>
    </div></div>
  </section></PageContent></PageShell>
}
