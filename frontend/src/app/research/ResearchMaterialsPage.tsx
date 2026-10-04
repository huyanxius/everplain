import { usePresence } from '../../ui/usePresence'
import { PageLoading } from '../../ui/PageLoading'
import { Select } from '../ui/Select'
import { ArrowLeftIcon, ArrowUpRightIcon, MagnifyingGlassIcon, CheckCircleIcon, FileDocIcon, FilePdfIcon, FileTextIcon, MarkdownLogoIcon, PlusIcon, TrashIcon, VideoCameraIcon, WaveformIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'

import { listMyResearchViaApi, type MyResearchItem } from '../../modules/account'
import { addResearchLibraryMaterial, formatMaterialSize, listResearchLibraryMaterials, removeResearchLibraryMaterial, materialMediaLabel, materialStatusLabel, isSupportedResearchMaterialFile, RESEARCH_MATERIAL_ACCEPT, uploadInitialResearchMaterials, type ResearchMaterial } from '../../modules/research-materials'
import { createMaterialFirstResearchProject } from '../../modules/socio-match-workspace'
import { PageContent, PageShell } from '../ui/PageShell'
import { researchLibraryPreview } from './researchLibraryPreview'
import { ResearchMemoryPanel } from './ResearchMemoryPanel'
import './research-materials-page.css'

type LibraryMaterial = { material: ResearchMaterial; research: MyResearchItem }

function researchTitle(item: MyResearchItem) {
  return (item.projectTitle !== '未命名研究' ? item.projectTitle : '') || (item.phenomenonSummary !== '尚未确认现象' ? item.phenomenonSummary : '') || '未命名研究'
}

function MaterialTypeIcon({ material }: { material: ResearchMaterial }) {
  const format = materialMediaLabel(material.mediaType, material.filename)
  if (format === 'PDF') return <FilePdfIcon size={24} />
  if (format === 'DOCX') return <FileDocIcon size={24} />
  if (format === 'Markdown') return <MarkdownLogoIcon size={24} />
  if (format === 'MP3' || format === 'M4A' || format === 'WAV') return <WaveformIcon size={24} />
  if (format === 'MP4' || format === 'WebM') return <VideoCameraIcon size={24} />
  return <FileTextIcon size={24} />
}

const researchStages = ['提问', '找资料', '写大纲', '写作'] as const

function ResearchStageBar({ item }: { item: MyResearchItem }) {
  // The account API supplies a server label, not a client workflow enum. Unknown
  // labels stay visible without suggesting that any stage has been completed.
  const label = item.stageLabel
  const stage = /写作|文稿|已完成|成果|交付/.test(label) ? 3
    : /大纲|框架|研究方案|方案确认/.test(label) ? 2
      : /资料|材料|理论|匹配/.test(label) ? 1
        : /提问|现象|问题/.test(label) ? 0 : -1
  const stageName = researchStages.at(stage >= 0 ? stage : researchStages.length) ?? label
  return <div className="ep-research__stage" role="img" aria-label={`研究进度：${stageName}；${label}`}>
    {researchStages.map((name, index) => <span key={name} data-done={index <= stage} aria-hidden="true" />)}
    <em>{stageName}</em>
  </div>
}

/**
 * 材料始终属于一个 ResearchTask；页面只负责让用户找到该研究的材料面板。
 * 不在这里复制上传、解析或分析逻辑，避免出现第二套材料系统。
 */
export function ResearchMaterialsPage({ userId: _userId = null }: { userId?: string | null }) {
  const navigate = useNavigate()
  const emptyUploadInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadPopoverRef = useRef<HTMLDivElement>(null)
  const uploadSurfaceRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task_id')
  const selectedMaterialId = searchParams.get('material_id')
  const previewFiles = import.meta.env.DEV && searchParams.get('preview') === 'files'
  const [projectQuery, setProjectQuery] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'documents' | 'media'>('all')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated')
  const [research, setResearch] = useState<MyResearchItem[]>([])
  const [libraryMaterials, setLibraryMaterials] = useState<LibraryMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [materialLoadStates, setMaterialLoadStates] = useState<Record<string, 'loading' | 'ready' | 'error'>>({})
  const [materialReload, setMaterialReload] = useState(0)
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null)
  const [materialActionError, setMaterialActionError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [researchReload, setResearchReload] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const uploadMotion = usePresence(uploadOpen, uploadSurfaceRef)
  const [uploadTaskId, setUploadTaskId] = useState(selectedTaskId ?? '')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
  const [emptyUploading, setEmptyUploading] = useState(false)
  const [emptyUploadError, setEmptyUploadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void listMyResearchViaApi()
      .then((items) => {
        if (active) {
          setResearch(items)
          setUploadTaskId((current) => current || items[0]?.taskId || '')
        }
      })
      .catch(() => {
        if (active) setError('研究列表暂时无法加载，请稍后重试。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [researchReload])

  useEffect(() => {
    if (loading) return undefined
    if (!research.length) {
      setLibraryLoading(false)
      return undefined
    }
    const controller = new AbortController()
    let remaining = research.length
    setLibraryLoading(true)
    setMaterialLoadStates(Object.fromEntries(research.map(item => [item.taskId, 'loading'])))
    for (const item of research) {
      void listResearchLibraryMaterials(item.taskId, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setLibraryMaterials(current => [
          ...current.filter(({ material }) => material.taskId !== item.taskId),
          ...result.items.map(material => ({ material, research: item })),
        ])
        setMaterialLoadStates(current => ({ ...current, [item.taskId]: 'ready' }))
      }).catch(() => {
        if (!controller.signal.aborted) setMaterialLoadStates(current => ({ ...current, [item.taskId]: 'error' }))
      }).finally(() => {
        remaining -= 1
        if (!controller.signal.aborted && !remaining) setLibraryLoading(false)
      })
    }
    return () => controller.abort()
  }, [loading, research, materialReload])

  useEffect(() => {
    if (selectedTaskId) setUploadTaskId(selectedTaskId)
    setUploadOpen(false)
    setUploadNotice(null)
    setMaterialActionError(null)
  }, [selectedTaskId])

  useEffect(() => {
    if (!uploadOpen) return undefined
    function closeUpload(event: KeyboardEvent | PointerEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setUploadOpen(false)
        return
      }
      if (!uploadPopoverRef.current?.contains(event.target as Node)) setUploadOpen(false)
    }
    document.addEventListener('keydown', closeUpload)
    document.addEventListener('pointerdown', closeUpload)
    return () => {
      document.removeEventListener('keydown', closeUpload)
      document.removeEventListener('pointerdown', closeUpload)
    }
  }, [uploadOpen])

  const selectedResearch = research.find((item) => item.taskId === selectedTaskId) ?? null
  const displayedMaterials = previewFiles && selectedResearch
    ? researchLibraryPreview(selectedResearch.taskId).map(material => ({ material, research: selectedResearch }))
    : libraryMaterials
  const currentLibraryLoading = previewFiles && selectedResearch ? false : selectedTaskId
    ? loading || !materialLoadStates[selectedTaskId] || materialLoadStates[selectedTaskId] === 'loading'
    : libraryLoading
  const failedProjects = Object.entries(materialLoadStates).filter(([taskId, state]) => !previewFiles && state === 'error' && (!selectedTaskId || selectedTaskId === taskId))
  function fileCount(taskId: string) {
    if (previewFiles && taskId === selectedTaskId) return `${displayedMaterials.length} 份文件`
    const state = materialLoadStates[taskId]
    if (state === 'error') return '文件读取失败'
    if (state !== 'ready') return '正在读取文件…'
    return `${libraryMaterials.filter(({ material }) => material.taskId === taskId).length} 份文件`
  }

  const visibleMaterials = displayedMaterials.filter(({ material, research: owner }) => {
    const media = material.mediaType.startsWith('audio/') || material.mediaType.startsWith('video/')
    return (category === 'all' || (category === 'media' ? media : !media))
      && (!(selectedTaskId || ownerFilter) || material.taskId === (selectedTaskId || ownerFilter))
      && `${material.filename} ${researchTitle(owner)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  }).sort((a, b) => sortBy === 'name' ? a.material.filename.localeCompare(b.material.filename, 'zh-CN') : b.material.updatedAt.localeCompare(a.material.updatedAt))

  async function addMaterial(file: File) {
    const targetTaskId = selectedTaskId || uploadTaskId
    if (!targetTaskId) return
    setUploading(true)
    setUploadError(null)
    setUploadNotice(null)
    try {
      const material = await addResearchLibraryMaterial(targetTaskId, file)
      const owner = research.find((item) => item.taskId === targetTaskId)
      if (owner) setLibraryMaterials((current) => [{ material, research: owner }, ...current])
      setUploadOpen(false)
      setUploadNotice('材料已添加')
    } catch {
      setUploadError('材料添加失败，请重试。')
    } finally {
      setUploading(false)
    }
  }

  async function removeMaterial(material: ResearchMaterial) {
    if (removingMaterialId || !globalThis.confirm(`确定删除“${material.filename}”？删除后，Agent 将不能再检索或引用它。`)) return
    setRemovingMaterialId(material.materialId)
    setMaterialActionError(null)
    try {
      await removeResearchLibraryMaterial(material.taskId, material.materialId)
      setLibraryMaterials(current => current.filter(item => item.material.materialId !== material.materialId))
    } catch {
      setMaterialActionError('文件删除失败，请重试。')
    } finally {
      setRemovingMaterialId(null)
    }
  }

  async function startFromMaterials(files: File[]) {
    if (!files.length || emptyUploading) return
    const unsupported = files.find((file) => !isSupportedResearchMaterialFile(file))
    if (unsupported) {
      setEmptyUploadError(`${unsupported.name} 不是可导入的研究材料。`)
      return
    }
    setEmptyUploading(true)
    setEmptyUploadError(null)
    try {
      const requestKey = `material-entry:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
      const { taskId } = await createMaterialFirstResearchProject(requestKey, files[0].name)
      await uploadInitialResearchMaterials(taskId, files)
      setResearch(await listMyResearchViaApi())
      setUploadTaskId(taskId)
      navigate(`/research/materials?task_id=${encodeURIComponent(taskId)}`, { replace: true })
    } catch (cause: unknown) {
      setEmptyUploadError(cause instanceof Error ? cause.message : '材料暂时无法导入，请重试。')
    } finally {
      setEmptyUploading(false)
    }
  }

  if (selectedResearch && selectedMaterialId) return <Navigate replace to={`/research/${encodeURIComponent(selectedResearch.taskId)}/workspace/materials${selectedMaterialId ? `?material_id=${encodeURIComponent(selectedMaterialId)}` : ''}`} />

  const activeTab = searchParams.get('tab') === 'memory' ? 'memory'
    : selectedTaskId || searchParams.get('tab') === 'files' ? 'files' : 'projects'
  const tabs = selectedResearch
    ? [{ id: 'files', label: '研究材料' }, { id: 'memory', label: '项目记忆' }]
    : [{ id: 'projects', label: '研究项目' }, { id: 'files', label: '全部文件' }, { id: 'memory', label: '个人记忆' }]
  const visibleProjects = research.filter((item) => researchTitle(item).toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()))
  function changeTab(tab: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    navigate(`/research/materials?${params}`, { replace: true })
    setUploadOpen(false)
  }

  return <PageShell wide><PageContent>
    <section className="ep-research" aria-label="我的研究">
      <header className="ep-research__head">
        {selectedResearch ? <Link className="qx-btn qx-btn--ghost ep-research__back" to="/research/materials"><ArrowLeftIcon size={17} aria-hidden="true" />研究</Link> : null}
        <div className="ep-research__heading-row">
          <h1 className="qx-section-title">{selectedResearch ? researchTitle(selectedResearch) : '研究'}</h1>
          {selectedResearch
            ? <Link className="qx-btn qx-btn--secondary" to={`/research/${encodeURIComponent(selectedResearch.taskId)}/workspace`}>继续研究<ArrowUpRightIcon size={17} aria-hidden="true" /></Link>
            : <Link className="qx-btn qx-btn--primary" to="/research/new"><PlusIcon size={18} aria-hidden="true" />新建研究</Link>}
        </div>
        {selectedResearch ? <div className="ep-research__project-meta">
          <ResearchStageBar item={selectedResearch} /><span>{fileCount(selectedResearch.taskId)}</span>
          {previewFiles ? <><span>示例预览</span><Link to={`/research/materials?task_id=${encodeURIComponent(selectedResearch.taskId)}`}>退出预览</Link></> : null}
        </div> : null}
        <div className="ep-research__navigation">
          <div className="qx-segmented ep-research__tabs" role="tablist" aria-label={selectedResearch ? '项目内容' : '我的研究视图'} onKeyDown={(event) => {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
            if (next !== null) { event.preventDefault(); buttons[next].focus(); buttons[next].click() }
          }}>
            {tabs.map(({ id, label }) => <button key={id} id={`research-tab-${id}`} type="button" role="tab" aria-controls={`research-panel-${id}`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} onClick={() => changeTab(id)}>{label}</button>)}
          </div>
          {activeTab === 'projects' ? <label className="qx-search ep-research__search">
            <MagnifyingGlassIcon size={18} aria-hidden="true" /><input type="search" aria-label="搜索研究项目" placeholder="搜索研究" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} />
          </label> : null}
        </div>
      </header>

      {error ? <div className="ep-research__notice" role="alert"><p>{error}</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => setResearchReload(value => value + 1)}>重新读取研究</button></div> : null}
      {!loading && !error && selectedTaskId && !selectedResearch ? <div className="ep-research__notice" role="alert"><p>找不到这个研究项目。</p><Link className="qx-btn qx-btn--secondary" to="/research/materials">返回研究</Link></div> : null}

      {!selectedResearch ? <section className="ep-research__panel" role="tabpanel" id="research-panel-projects" aria-labelledby="research-tab-projects" hidden={activeTab !== 'projects'}>
        {loading ? <PageLoading message="正在读取研究项目…" /> : <>
          {!visibleProjects.length && !error ? <div className="ep-research__empty ep-research__empty--projects">
            <h2 className="qx-card__title">{projectQuery ? '没有找到这个项目' : '开始你的第一项研究'}</h2>
            <p>{projectQuery ? '换一个项目名称试试。' : '从一个问题或一份材料开始。'}</p>
          </div> : null}
          <div className="ep-research__grid" aria-label="研究项目列表">
            {visibleProjects.map(item => <Link className="qx-card qx-card--interactive ep-research__card" key={item.taskId} to={`/research/materials?task_id=${encodeURIComponent(item.taskId)}`} aria-label={`打开研究 ${researchTitle(item)}`} onClick={() => { setQuery(''); setCategory('all'); setUploadTaskId(item.taskId) }}>
              <ResearchStageBar item={item} />
              <h2 className="qx-card__title">{researchTitle(item)}</h2>
              <p className="qx-card__body ep-research__question">{item.phenomenonSummary !== '尚未确认现象' && item.phenomenonSummary !== researchTitle(item) ? item.phenomenonSummary : item.nextActionLabel || '从一个问题开始，逐步整理研究。'}</p>
              <div className="qx-card__meta"><span>{fileCount(item.taskId)}</span><span aria-hidden="true">·</span><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(item.updatedAt))}</time></div>
            </Link>)}
            <Link className="qx-card qx-card--muted ep-research__add-card" to="/research/new"><PlusIcon aria-hidden="true" /><span className="qx-heading">从一个问题开始</span></Link>
          </div>
        </>}
      </section> : null}

      <section className="ep-research__panel" role="tabpanel" id="research-panel-files" aria-labelledby="research-tab-files" hidden={activeTab !== 'files'}>
        <div className="ep-research__tools">
          <label className="qx-search ep-research__file-search"><MagnifyingGlassIcon size={18} aria-hidden="true" /><input type="search" aria-label="搜索研究材料" placeholder={selectedResearch ? '搜索项目内的材料' : '搜索文件或研究名称'} value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="ep-research__upload-anchor" ref={uploadPopoverRef}>
            <button type="button" className="qx-btn qx-btn--primary" aria-expanded={uploadOpen} aria-controls="research-materials-upload-popover" disabled={loading || !!error || previewFiles || uploading || emptyUploading} onClick={() => research.length ? setUploadOpen(open => !open) : emptyUploadInputRef.current?.click()}><PlusIcon size={17} aria-hidden="true" />{uploading || emptyUploading ? '正在导入…' : '添加材料'}</button>
            {uploadMotion.present && research.length ? <div ref={uploadSurfaceRef} data-motion-surface="popover" {...uploadMotion.props} id="research-materials-upload-popover" className="qx-popover-surface ep-research__upload" role="dialog" aria-label="添加材料">
              {!selectedResearch ? <label>保存到研究<Select className="qx-input" aria-label="材料所属研究" value={uploadTaskId} onChange={nextValue => setUploadTaskId(nextValue)} options={research.map(item => ({ value: item.taskId, label: researchTitle(item) }))} /></label> : <span>添加到「{researchTitle(selectedResearch)}」</span>}
              <button type="button" className="qx-btn qx-btn--primary" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>选择文件</button>
              <input ref={uploadInputRef} hidden type="file" accept={RESEARCH_MATERIAL_ACCEPT} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMaterial(file) }} />
              {uploadError ? <span role="alert">{uploadError}</span> : null}
            </div> : null}
          </div>
        </div>
        <div className="ep-research__files" role="region" aria-label="全部研究材料">
          <div className="ep-research__filters">
            <Select className="qx-input" aria-label="材料类型" value={category} onChange={nextValue => setCategory(nextValue as typeof category)} options={[{ value: "all", label: "所有类型" }, { value: "documents", label: "文档与文本" }, { value: "media", label: "录音与视频" }]} />
            {!selectedResearch ? <Select className="qx-input" aria-label="按研究筛选材料" value={ownerFilter} onChange={nextValue => setOwnerFilter(nextValue)} options={[{ value: "", label: "全部研究" }, ...(research.map(item => ({ value: item.taskId, label: researchTitle(item) })))]} /> : null}
            <span className="qx-meta">{currentLibraryLoading ? `已读取 ${visibleMaterials.length} 份材料` : `${visibleMaterials.length} 份材料`}</span>
            <Select className="qx-input ep-research__sort" aria-label="材料排序" value={sortBy} onChange={nextValue => setSortBy(nextValue as typeof sortBy)} options={[{ value: "updated", label: "最近修改" }, { value: "name", label: "文件名称" }]} />
          </div>
          {loading || currentLibraryLoading ? <PageLoading message="正在读取研究材料…" /> : null}
          {failedProjects.length ? <div className="ep-research__notice" role="alert"><p>{selectedTaskId ? '当前项目的文件暂时无法读取。' : `${failedProjects.length} 个项目的文件暂时无法读取。`}</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => setMaterialReload(value => value + 1)}>重试</button></div> : null}
          {materialActionError ? <p className="ep-research__notice" role="alert">{materialActionError}</p> : null}
          {emptyUploadError ? <p className="ep-research__notice" role="alert">{emptyUploadError}</p> : null}
          {uploadNotice ? <p className="ep-research__notice" role="status">{uploadNotice}</p> : null}
          {!loading && visibleMaterials.length ? <div className="ep-research__table-scroll"><table className="qx-data-table ep-research__table" aria-label="研究材料文件列表">
            <thead><tr><th scope="col">文件名称</th><th scope="col">所属研究</th><th scope="col">最近修改</th><th scope="col">大小</th><th scope="col">状态</th><th scope="col" className="ep-research__actions-heading"><span className="ep-research__sr-only">文件操作</span></th></tr></thead>
            <tbody>{visibleMaterials.map(({ material, research: owner }) => <tr key={material.materialId}>
              <td><Link className="ep-research__filename" to={`/research/${encodeURIComponent(material.taskId)}/workspace/materials?material_id=${encodeURIComponent(material.materialId)}`} aria-label={`打开材料 ${material.filename}`} aria-disabled={previewFiles || undefined} onClick={previewFiles ? event => event.preventDefault() : undefined}><span className="ep-research__file-icon" aria-hidden="true"><MaterialTypeIcon material={material} /></span><span className="ep-research__file-copy"><strong>{material.filename}</strong><span className="qx-meta">{materialMediaLabel(material.mediaType, material.filename)}</span></span><ArrowUpRightIcon size={15} aria-hidden="true" /></Link></td>
              <td title={researchTitle(owner)}>{researchTitle(owner)}</td>
              <td><time dateTime={material.updatedAt}>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(material.updatedAt))}</time></td>
              <td>{formatMaterialSize(material.sizeBytes)}</td>
              <td><span className="ep-research__status" data-status={material.status}>{material.status === 'ready' ? <CheckCircleIcon size={14} aria-hidden="true" /> : null}{materialStatusLabel(material.status)}</span></td>
              <td><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={`删除文件 ${material.filename}`} title="删除文件" disabled={previewFiles || !!removingMaterialId} onClick={() => void removeMaterial(material)}><TrashIcon size={16} aria-hidden="true" /></button></td>
            </tr>)}</tbody>
          </table></div> : null}
          {!loading && !error && !currentLibraryLoading && !failedProjects.length && !visibleMaterials.length ? <div className="ep-research__empty" role="region" aria-label={!research.length ? '还没有研究' : '材料列表为空'}>
            <FileTextIcon size={34} aria-hidden="true" /><h2 className="qx-card__title">{query || ownerFilter || category !== 'all' ? '没有匹配的材料' : '从材料开始研究'}</h2>
            <p>{query || ownerFilter || category !== 'all' ? '调整搜索词或分类，材料仍保存在所属研究中。' : '导入文档、音频或视频，整理原文并与 Agent 讨论。'}</p>
            {!research.length ? <button type="button" className="qx-btn qx-btn--secondary" disabled={emptyUploading} onClick={() => emptyUploadInputRef.current?.click()}>{emptyUploading ? '正在导入…' : '导入研究材料'}</button> : null}
          </div> : null}
        </div>
        <input ref={emptyUploadInputRef} hidden type="file" multiple accept={RESEARCH_MATERIAL_ACCEPT} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void startFromMaterials(files) }} />
      </section>

      <section className="ep-research__panel" role="tabpanel" id="research-panel-memory" aria-labelledby="research-tab-memory" hidden={activeTab !== 'memory'}>
        {activeTab === 'memory' ? <ResearchMemoryPanel key={`${selectedTaskId ?? 'personal'}:${searchParams.get('preview') ?? ''}`} taskId={selectedTaskId} projectName={selectedResearch ? researchTitle(selectedResearch) : undefined} preview={import.meta.env.DEV && searchParams.get('preview') === 'memory'} /> : null}
      </section>
    </section>
  </PageContent></PageShell>
}
