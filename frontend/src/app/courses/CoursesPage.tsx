import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowClockwiseIcon, ArrowLeftIcon, ArrowUpRightIcon, BooksIcon, DotsThreeIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, ShareNetworkIcon, TrashIcon, TreeStructureIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { Select } from '../ui/Select'
import { useAccount } from '../../modules/account'
import { readImportBatches, type ImportBatch } from '../../modules/knowledge-import'
import { readPersonalGraph } from '../../modules/personal-graph'
import { ResearchAgentConversationPage } from '../agent/ResearchAgentConversationPage'
import { PageContent, PageShell } from '../ui/PageShell'
import { ReadOnlyMaterialReader } from './ReadOnlyMaterialReader'
import { retryCourseDocument, createCourse, deleteCourse, detachCourseDocument, getCourse, listCourses, readCourseDocument, updateCourse, readKnowledgeStorage, type SharedCourse, type SharedDocument, type SharedSource } from '../../modules/shared-knowledge'
import { KnowledgePage, KnowledgePageHead, KnowledgeViewSwitch } from './KnowledgeLayout'
import { LibraryScopeSwitcher } from './LibraryScopeSwitcher'
import { LibraryDialog } from './LibraryDialog'
import { LibraryMaterialCard, LibrarySkeleton, type LibraryMaterialSource } from './LibraryMaterialCard'
import { documentKind, isProcessing } from './libraryMaterials'
import { LibraryAddDialog } from '../imports/LibraryAddDialog'
import chromeLogo from '../../assets/brand/chrome.svg'
import obsidianLogo from '../../assets/brand/obsidian.svg'
import './courses.css'

const sourceNames: Record<string, string> = { chrome: '浏览器收藏', obsidian: 'Obsidian', markdown: 'Markdown', apple_notes: 'Apple 备忘录', enex: '印象笔记', notion: 'Notion', flomo: 'flomo', keep: 'Google Keep', bilibili: 'B 站收藏', image: '图片与截图' }

export function CoursesPage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  return <LibraryContent key={userId ?? 'anonymous'} userId={userId} />
}

function LibraryContent({ userId }: { userId: string | null }) {
  const [params, setParams] = useSearchParams()
  const routerNavigate = useNavigate()
  const id = params.get('kb_id')
  const documentId = params.get('document_id')
  const segmentId = params.get('segment_id')
  const [reload, setReload] = useState(0)
  const [courses, setCourses] = useState<SharedCourse[]>([])
  const [libraryChoices, setLibraryChoices] = useState<SharedCourse[]>([])
  const [detail, setDetail] = useState<SharedCourse | null>(null)
  const [source, setSource] = useState<SharedSource | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [selectionLoading, setSelectionLoading] = useState(true)
  const loading = id ? selectionLoading : catalogLoading
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const showLibraries = params.has('manage')
  const [kindFilter, setKindFilter] = useState('')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [editing, setEditing] = useState<'create' | 'edit' | null>(params.has('new') ? 'create' : null)
  const [deleting, setDeleting] = useState(false)
  const [deletingDocument, setDeletingDocument] = useState<{ course: SharedCourse; document: SharedDocument } | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [libraryMenu, setLibraryMenu] = useState(false)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof readKnowledgeStorage>> | null>(null)
  const [materialSources, setMaterialSources] = useState<Record<string, LibraryMaterialSource>>({})
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const busyRef = useRef(false)
  const currentScope = useRef(params.toString())
  currentScope.current = params.toString()
  const currentLibrary = useRef(id)
  currentLibrary.current = id
  const menuRef = useRef<HTMLDivElement>(null)
  const editorSeed = useRef<string | null>(null)
  const newOpen = params.has('new')
  const editOpen = params.has('edit')
  useEffect(() => {
    if (newOpen && editorSeed.current !== 'new') { editorSeed.current = 'new'; setName(''); setDescription(''); setEditing('create') }
    else if (editOpen && detail && editorSeed.current !== detail.id) { editorSeed.current = detail.id; setName(detail.name ?? ''); setDescription(detail.description ?? ''); setEditing('edit') }
    else if (!newOpen && !editOpen) { editorSeed.current = null; setEditing(null) }
  }, [newOpen, editOpen, detail])
  useEffect(() => {
    if (!libraryMenu) return
    const outside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setLibraryMenu(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setLibraryMenu(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key) }
  }, [libraryMenu])
  useEffect(() => { setQuery(''); setKindFilter(''); setLibraryMenu(false); setDeleting(false); setDeletingDocument(null) }, [id, documentId])
  useEffect(() => {
    let active = true
    setCatalogLoading(true); setError(null); setCatalogError(null)
    const controller = new AbortController()
    // The owner-scoped overview lives for this page, independently of document navigation.
    const catalog = listCourses(controller.signal).then(async list => {
      if (!active) return
      const owned = list.filter(item => item.access === 'owner')
      setLibraryChoices(list.filter(item => item.access === 'owner' || item.access === 'reader'))
      setCourses(owned)
      await Promise.allSettled(owned.map(async item => {
        try {
          const value = await getCourse(item.id, controller.signal)
          if (!active) return
          if (value.access !== 'owner') throw new Error('此知识库不可访问。')
          setCourses(current => current.map(course => course.id === value.id ? value : course))
          setLibraryChoices(current => current.map(course => course.id === value.id ? value : course))
          // Show available cards immediately; another slow library cannot hide them.
          setCatalogLoading(false)
        } catch {
          if (active) setCatalogError('部分资料暂时无法读取。已保留可访问的资料，你可以重试或打开对应知识库。')
        }
      }))
    })
    void catalog.catch((failure: Error) => { if (active) setCatalogError(failure.message) })
      .finally(() => { if (active) setCatalogLoading(false) })
    void readKnowledgeStorage().then(value => { if (active) setStorage(value) }).catch(() => {})
    void readImportBatches().then(batches => {
      if (!active || !Array.isArray(batches)) return
      setImportBatches(batches)
      const metadata: Record<string, LibraryMaterialSource> = {}
      for (const batch of batches) for (const item of batch.items ?? []) if (item.document_id) metadata[`${batch.library_id}:${item.document_id}`] = { source: sourceNames[batch.source_type], url: item.source_url }
      setMaterialSources(metadata)
    }).catch(() => {})
    return () => { active = false; controller.abort() }
  }, [reload])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setDetail(null); setSource(null); setError(null)
    if (!id) { setSelectionLoading(false); return () => { active = false; controller.abort() } }
    setSelectionLoading(true)
    void Promise.all([
      getCourse(id, controller.signal),
      documentId ? readCourseDocument(id, documentId, undefined, controller.signal) : Promise.resolve(null),
    ]).then(([value, result]) => {
      if (!active) return
      if (value.access !== 'owner') throw new Error('此知识库不可访问。')
      setDetail(value); setSource(result)
    }).catch((failure: Error) => { if (active) setError(failure.message) })
      .finally(() => { if (active) setSelectionLoading(false) })
    return () => { active = false; controller.abort() }
  }, [id, documentId, reload])
  const materials = (detail ? [detail] : courses).flatMap(course => course.documents.map(document => ({ course, document })))
  const hasImages = materials.some(({ document }) => documentKind(document) === '图片')
  useEffect(() => {
    if (!hasImages) return
    let active = true
    void readPersonalGraph().then(graph => {
      if (!active) return
      setMaterialSources(current => {
        const next = { ...current }
        for (const record of Object.values(graph.sources ?? {})) {
          const key = `${record.library_id}:${record.document_id}`
          let image: string | undefined
          if (record.asset_url) { try { const url = new URL(record.asset_url, window.location.origin); if (url.origin === window.location.origin && /^https?:$/.test(url.protocol)) image = url.href } catch { /* No synthetic preview. */ } }
          next[key] = { ...next[key], image, url: record.source_url ?? next[key]?.url }
        }
        return next
      })
    }).catch(() => {})
    return () => { active = false }
  }, [hasImages, reload, id])
  useEffect(() => {
    const importing = new Set(importBatches.filter(batch => batch.status === 'processing').map(batch => batch.library_id))
    const pending = (detail ? [detail] : courses).filter(course => course.documents.some(isProcessing) || importing.has(course.id))
    if (!pending.length) return
    let active = true
    let refreshing = false
    const timer = window.setInterval(() => {
      if (refreshing) return
      refreshing = true
      void (async () => {
        // Read the batch before its documents so the final newly-created file is not missed.
        const batches = importing.size ? await readImportBatches() : null
        const values = await Promise.all(pending.map(course => getCourse(course.id)))
        if (!active) return
        if (Array.isArray(batches)) {
          setImportBatches(batches)
          const metadata: Record<string, LibraryMaterialSource> = {}
          for (const batch of batches) for (const item of batch.items ?? []) if (item.document_id) metadata[`${batch.library_id}:${item.document_id}`] = { source: sourceNames[batch.source_type], url: item.source_url }
          setMaterialSources(metadata)
        }
        if (detail) {
          const refreshed = values.find(value => value.id === detail.id)
          if (refreshed?.access === 'owner') setDetail(refreshed)
          else { setDetail(null); setSource(null); setError('此知识库不可访问。') }
        } else setCourses(current => current.flatMap(course => {
          const refreshed = values.find(value => value.id === course.id)
          return refreshed ? refreshed.access === 'owner' ? [refreshed] : [] : [course]
        }))
      })().catch((failure: Error) => { if (active) { setError(failure.message); window.clearInterval(timer) } }).finally(() => { refreshing = false })
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [detail, courses, importBatches])
  function navigate(libraryId?: string, docId?: string) {
    setEditing(null); setNotice(null); setError(null)
    const next = new URLSearchParams()
    if (libraryId) next.set('kb_id', libraryId)
    if (docId) next.set('document_id', docId)
    if (libraryId === id && params.get('conversation_id')) next.set('conversation_id', params.get('conversation_id')!)
    routerNavigate(`/library${next.size ? `?${next}` : ''}`)
  }
  function openAdd(source = 'extension', libraryId = id) {
    setParams(current => { const next = new URLSearchParams(current); if (libraryId) next.set('kb_id', libraryId); next.set('add', source); return next })
  }
  function closeAdd() { setParams(current => { const next = new URLSearchParams(current); next.delete('add'); return next }, { replace: true }) }
  function closeEditor() { setEditing(null); setParams(current => { const next = new URLSearchParams(current); next.delete('new'); next.delete('edit'); return next }, { replace: true }) }
  function startCreate() { setName(''); setDescription(''); setEditing('create'); setParams(current => { const next = new URLSearchParams(current); next.delete('edit'); next.set('new', ''); return next }) }
  async function action(work: (isCurrent: () => boolean) => Promise<void>) {
    if (busyRef.current) return
    const scope = currentScope.current
    const isCurrent = () => currentScope.current === scope
    busyRef.current = true; setBusy(true); setError(null); setNotice(null)
    try { await work(isCurrent); void readKnowledgeStorage().then(setStorage).catch(() => {}) }
    catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : '操作失败，请重试。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    await action(async isCurrent => {
      const result = editing === 'edit' && detail ? await updateCourse(detail.id, { name: name.trim(), description }) : await createCourse({ name: name.trim(), description })
      if (!isCurrent()) { setReload(value => value + 1); return }
      setDetail(result); setEditing(null)
      setParams({ kb_id: result.id }); setReload(value => value + 1)
    })
  }
  async function refreshLibrary(libraryId: string) {
    const refreshed = await getCourse(libraryId)
    if (refreshed.access !== 'owner') { setCourses(current => current.filter(course => course.id !== libraryId)); if (currentLibrary.current === libraryId) { setDetail(null); setSource(null) }; throw new Error('此知识库不可访问。') }
    setCourses(current => current.map(course => course.id === libraryId ? refreshed : course))
    if (currentLibrary.current === libraryId) setDetail(refreshed)
  }
  if (source) return <PageShell wide><PageContent>
    <ReadOnlyMaterialReader key={source.document.id} source={{ ...source, document: detail?.documents.find(doc => doc.id === source.document.id) ?? source.document }} selectedSegmentId={segmentId}
      onKnowledgeSaved={document => { setSource({ ...source, document }); setCourses(current => current.map(course => course.id === source.knowledgeBaseId ? { ...course, documents: course.documents.map(item => item.id === document.id ? document : item) } : course)); setDetail(value => value ? { ...value, documents: value.documents.map(item => item.id === document.id ? document : item) } : value) }}
      agentPanel={<ResearchAgentConversationPage embedded userId={userId} referenceKnowledgeBaseId={source.knowledgeBaseId} conversationId={params.get('conversation_id')} composerAriaLabel="结合本库资料提问" onOpenCourseCitation={citation => {
        if (!citation.knowledge_base_id || !citation.material_id || !citation.segment_id) return
        setParams(current => { const next = new URLSearchParams(current); next.set('kb_id', citation.knowledge_base_id!); next.set('document_id', citation.material_id!); next.set('segment_id', citation.segment_id!); return next })
      }} onConversationStarted={({ conversation_id }) => setParams(current => { const next = new URLSearchParams(current); next.set('conversation_id', conversation_id); return next }, { replace: true })} />}
      onBack={() => navigate(source.knowledgeBaseId)}
      navigation={<div className="ep-material__nav"><button className="qx-btn qx-btn--ghost" type="button" aria-label="返回知识库" onClick={() => navigate(source.knowledgeBaseId)}><ArrowLeftIcon size={18} />知识库</button><Select aria-label="切换资料" value={source.document.id} onChange={nextValue => navigate(source.knowledgeBaseId, nextValue)} options={detail?.documents.filter(doc => doc.status === 'ready').map(doc => ({ value: doc.id, label: doc.filename })) ?? []} /><Link className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="知识与关系" to={`/library/knowledge?kb_id=${encodeURIComponent(source.knowledgeBaseId)}`}><TreeStructureIcon size={18} /></Link></div>} />
  </PageContent></PageShell>

  const search = query.trim().toLocaleLowerCase()
  const kinds = [...new Set(materials.map(({ document }) => documentKind(document)))]
  const documents = materials.filter(({ course, document }) => (!kindFilter || documentKind(document) === kindFilter) && (!search || `${document.filename} ${document.knowledge?.summary ?? ''} ${document.knowledge?.topics.map(topic => `${topic.title} ${topic.summary}`).join(' ') ?? ''} ${course.name ?? ''}`.toLocaleLowerCase().includes(search)))
  const visible = courses.filter(course => !search || `${course.name} ${course.description}`.toLocaleLowerCase().includes(search))
  const pendingCount = materials.filter(({ document }) => isProcessing(document)).length
  const relevantImports = importBatches.filter(batch => (!id || batch.library_id === id) && (batch.status === 'processing' || batch.failed > 0))
  const importProgress = relevantImports.reduce((sum, batch) => ({ total: sum.total + batch.total, imported: sum.imported + batch.imported, duplicates: sum.duplicates + batch.duplicates, failed: sum.failed + batch.failed, pending: sum.pending + batch.total - batch.finished }), { total: 0, imported: 0, duplicates: 0, failed: 0, pending: 0 })
  const maxDocuments = storage?.max_documents_per_library ?? 100
  const full = !!detail && detail.documents.length >= maxDocuments
  const scopeLibraries = detail ? libraryChoices.map(library => library.id === detail.id ? detail : library) : libraryChoices
  return <KnowledgePage>
    <KnowledgePageHead title={<LibraryScopeSwitcher libraries={scopeLibraries} selectedId={id} view="cards" storage={storage} onCreate={startCreate} onManage={() => { setParams({ manage: '' }); setQuery('') }} />} actions={<>
      {detail && <Link className="qx-btn qx-btn--secondary" to="/sharing"><ShareNetworkIcon />共享</Link>}
      <button type="button" className="qx-btn qx-btn--primary" aria-label={detail ? '上传资料' : '添加资料'} disabled={busy || full} title={full ? `每个知识库最多 ${maxDocuments} 份资料` : undefined} onClick={() => openAdd()}><PlusIcon />添加</button>
      {detail && <div className="ep-library__options" ref={menuRef}><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="知识库选项" aria-expanded={libraryMenu} onClick={() => setLibraryMenu(value => !value)}><DotsThreeIcon weight="bold" /></button>{libraryMenu && <div className="qx-menu ep-library__options-menu"><button className="qx-item" type="button" aria-label="编辑知识库" disabled={busy} onClick={() => { setName(detail.name ?? ''); setDescription(detail.description ?? ''); setEditing('edit'); setLibraryMenu(false); setParams(current => { const next = new URLSearchParams(current); next.set('edit', ''); return next }) }}><PencilSimpleIcon />编辑名称与说明</button><button className="qx-item" type="button" aria-label="删除知识库" disabled={busy} onClick={() => { setDeleting(true); setLibraryMenu(false) }}><TrashIcon />删除知识库</button></div>}</div>}
    </>}>
      {detail && <div className="ep-library__context"><p className="qx-meta">{detail.description || '只有你可以访问这个知识库。'}</p><Link className="qx-btn qx-btn--ghost" to={`/my/graph?kb_id=${encodeURIComponent(detail.id)}&view=points`}>浏览知识与关系<TreeStructureIcon size={16} /></Link><Link className="qx-btn qx-btn--ghost" to={`/agent?reference_knowledge_base_id=${encodeURIComponent(detail.id)}`}>基于本库研究<ArrowUpRightIcon size={16} /></Link></div>}
      <div className="ep-library__search-row"><KnowledgeViewSwitch view="cards" /><label className="qx-search ep-library__search"><MagnifyingGlassIcon size={18} /><input type="search" aria-label={showLibraries && !detail ? '搜索知识库' : '搜索资料'} placeholder={showLibraries && !detail ? '搜索名称或说明' : '搜标题、摘要、知识点'} value={query} onChange={event => setQuery(event.target.value)} /></label>{showLibraries && <button type="button" className="qx-btn qx-btn--ghost" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.delete('manage'); return next })}>返回资料</button>}</div>
      {!showLibraries && !loading && materials.length > 0 && <div className="ep-knowledge-filters" aria-label="资料筛选"><button type="button" className="qx-tag" aria-pressed={!kindFilter} onClick={() => setKindFilter('')}>全部 {materials.length}</button>{kinds.map(kind => <button type="button" key={kind} className="qx-tag qx-tag--outline" aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kindFilter === kind ? '' : kind)}>{kind}</button>)}</div>}
    </KnowledgePageHead>
    {error && <p role="alert" className="qx-notice qx-notice--danger">{error}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setReload(value => value + 1)}>重新加载</button></p>}
    {catalogError && <p className="qx-notice qx-notice--danger" role="alert">{catalogError}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setReload(value => value + 1)}>重试读取资料</button></p>}
    {notice && <p role="status" className="qx-notice">{notice}</p>}
    {loading && <LibrarySkeleton />}
    {!loading && !error && <>
      {showLibraries && !detail ? <>
        <div className="ep-library__grid">{visible.map(course => <article className="qx-card ep-library-folder" key={course.id}><span className="qx-meta">私有 · {course.documents.length || course.readyDocumentCount} 份资料</span><h2 className="qx-card__title">{course.name}</h2><p className="qx-card__body">{course.description || '你的资料与研究依据'}</p><button type="button" className="qx-btn qx-btn--ghost" aria-label={`打开知识库 ${course.name}`} onClick={() => navigate(course.id)}>打开知识库<ArrowUpRightIcon size={16} /></button></article>)}</div>
        {!visible.length && <div className="ep-knowledge-empty"><BooksIcon size={32} /><h2 className="qx-card__title">{search ? '没有找到相关知识库' : '创建你的第一个知识库'}</h2><button type="button" className="qx-btn qx-btn--secondary" onClick={startCreate}>新建知识库</button></div>}
      </> : <>
        {relevantImports.length > 0 && <div className="qx-notice ep-library__status" role="status"><span>导入记录：{importProgress.total} 条已提交 · {importProgress.imported} 条已入库 · {importProgress.duplicates} 条重复 · {importProgress.pending} 条处理中 · {importProgress.failed} 条读取失败。下方仅显示已生成的资料。</span><button className="qx-btn qx-btn--ghost" type="button" onClick={() => openAdd('records')}>查看导入详情</button></div>}
        {pendingCount > 0 && <div className="qx-notice ep-library__status" role="status"><ArrowClockwiseIcon size={18} /><span>{pendingCount} 份资料正在解析、整理知识或建立语义索引。</span><button className="qx-btn qx-btn--ghost" type="button" onClick={() => openAdd('records')}>导入记录</button></div>}
        <div className="ep-library__grid" aria-label="资料卡片">{documents.map(({ course, document }) => <LibraryMaterialCard key={`${course.id}:${document.id}`} course={course} document={document} showLibrary={!detail} source={materialSources[`${course.id}:${document.id}`]} busy={busy} onRetry={() => void action(async () => { await retryCourseDocument(course.id, document.id); await refreshLibrary(course.id) })} onDelete={() => setDeletingDocument({ course, document })} onReupload={() => openAdd('file', course.id)} />)}</div>
        {!documents.length && !catalogError && <div className="ep-knowledge-empty ep-library__empty"><BooksIcon size={32} /><h2 className="qx-card__title">{search || kindFilter ? '没有找到相关资料' : !courses.length ? '创建你的第一个知识库' : '把第一份资料，放进来。'}</h2><p className="qx-meta">{search || kindFilter ? '换个关键词，或调整筛选条件。' : detail ? '在这里上传的文件只属于这个库。从其他应用导入的资料会统一放进「我的资料」。' : '收藏、笔记和文档会汇集在这里，保留原文与知识点。'}</p>
          {search || kindFilter ? <button className="qx-btn qx-btn--secondary" type="button" onClick={() => { setQuery(''); setKindFilter('') }}>清除搜索和筛选</button> : detail ? <button className="qx-btn qx-btn--primary" type="button" onClick={() => openAdd('file')}><UploadSimpleIcon />上传文件</button> : <><div className="ep-knowledge-actions"><button className="qx-btn qx-btn--secondary" type="button" onClick={() => openAdd('file')}><UploadSimpleIcon />上传文件</button><button className="qx-btn qx-btn--secondary" type="button" onClick={() => openAdd('chrome')}><img className="ep-library__source-logo" src={chromeLogo} alt="" />导入浏览器收藏</button><button className="qx-btn qx-btn--secondary" type="button" onClick={() => openAdd('obsidian')}><img className="ep-library__source-logo" src={obsidianLogo} alt="" />导入 Obsidian</button></div><button className="qx-btn qx-btn--ghost" type="button" onClick={() => openAdd()}>还支持印象笔记、Notion、flomo、B 站收藏等 →</button><button className="qx-btn qx-btn--ghost" type="button" disabled={!!storage && courses.length >= storage.max_libraries} onClick={startCreate}>新建知识库</button></>}
        </div>}
      </>}
    </>}
    {params.has('add') && <LibraryAddDialog key={`${id ?? 'all'}:${params.get('add')}`} userId={userId} libraries={courses} initialLibraryId={id ?? undefined} initialSource={params.get('add') || 'extension'} onClose={closeAdd} onChanged={() => setReload(value => value + 1)} />}
    {editing && <LibraryDialog title={editing === 'edit' ? '编辑知识库' : '新建知识库'} busy={busy} onClose={closeEditor}><form className="ep-library__form" onSubmit={event => void save(event)}><label>知识库名称<input className="qx-input" value={name} required maxLength={100} onChange={event => setName(event.target.value)} autoFocus /></label><label>说明（选填）<textarea className="qx-textarea" value={description} maxLength={1000} rows={3} onChange={event => setDescription(event.target.value)} placeholder="这些资料围绕什么主题？" /></label><div className="ep-knowledge-actions"><button type="submit" className="qx-btn qx-btn--primary" disabled={busy || !name.trim()}>保存知识库</button><button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={closeEditor}>取消</button></div>{error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}</form></LibraryDialog>}
    {deleting && <LibraryDialog title="删除知识库？" busy={busy} onClose={() => setDeleting(false)}><p className="qx-card__body">此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。</p><div className="ep-knowledge-actions"><button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => setDeleting(false)}>保留知识库</button><button type="button" className="qx-btn qx-btn--danger" disabled={busy} onClick={() => void action(async isCurrent => { if (!detail) return; await deleteCourse(detail.id); setDeleting(false); if (isCurrent()) navigate(); setReload(value => value + 1) })}>确认删除</button></div>{error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}</LibraryDialog>}
    {deletingDocument && <LibraryDialog title="删除资料？" busy={busy} onClose={() => setDeletingDocument(null)}><p className="qx-card__body">删除“{deletingDocument.document.filename}”及其知识与索引？此操作无法撤销。</p><div className="ep-knowledge-actions"><button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => setDeletingDocument(null)}>保留资料</button><button type="button" className="qx-btn qx-btn--danger" disabled={busy} onClick={() => void action(async isCurrent => { await detachCourseDocument(deletingDocument.course.id, deletingDocument.document.id); await refreshLibrary(deletingDocument.course.id); setDeletingDocument(null); if (isCurrent()) setNotice('资料及其知识、索引已从知识库删除。') })}>确认删除资料</button></div>{error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}</LibraryDialog>}
  </KnowledgePage>
}
