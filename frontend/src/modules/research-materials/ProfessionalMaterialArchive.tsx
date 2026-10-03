import { Select } from '../../ui/Select'
import {
  ArrowDownIcon,
  BookOpenTextIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FileArrowUpIcon,
  FolderPlusIcon,
  LinkSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  createLiteratureEntry,
  createMaterialBatch,
  createMaterialCollection,
  createMaterialRelation,
  createResearchCase,
  exportLiteratureEntries,
  getProfessionalMaterialArchive,
  importLiteratureEntries,
  resolveDoiMetadata,
  updateProfessionalMaterialProfile,
  uploadMaterialBatch,
} from './professionalMaterialsApi'
import {
  archiveLabel,
  CONSENT_SCOPES,
  DEIDENTIFICATION_STATUSES,
  MODEL_PROCESSING_SCOPES,
  profileUpdateFrom,
  RESEARCH_ROLES,
  RESEARCH_STAGES,
  SENSITIVITY_LEVELS,
  type LiteratureFormat,
  type MaterialKind,
  type MaterialRelationType,
  type ProfessionalMaterialArchive,
  type ProfessionalMaterialProfileUpdate,
} from './professionalMaterialsModel'
import type { ResearchMaterial } from './researchMaterialsModel'
import './material-views.css'

type ProfessionalMaterialArchiveProps = {
  readonly taskId: string
  readonly selectedMaterial: ResearchMaterial
  readonly materials: readonly ResearchMaterial[]
  readonly onMaterialsChanged: () => void
}

const MATERIAL_RELATION_TYPES: readonly MaterialRelationType[] = [
  'derived_from', 'supplements', 'translation_of', 'version_of', 'describes', 'related',
]

const RELATION_LABELS: Record<MaterialRelationType, string> = {
  derived_from: '源自', supplements: '补充', translation_of: '译自',
  version_of: '另一版本', describes: '描述', related: '相关',
}

function parseAttributes(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/[；;\n]/).map((part) => part.trim()).filter(Boolean)
    .map((part) => {
      const [key, ...rest] = part.split(/[=：:]/)
      return [key.trim(), rest.join('=').trim()]
    }).filter(([key, content]) => key && content))
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ProfessionalMaterialArchivePanel({
  taskId,
  selectedMaterial,
  materials,
  onMaterialsChanged,
}: ProfessionalMaterialArchiveProps) {
  const [activeView, setActiveView] = useState<'profile' | 'organize' | 'literature'>('profile')
  const [archive, setArchive] = useState<ProfessionalMaterialArchive | null>(null)
  const [draft, setDraft] = useState<ProfessionalMaterialProfileUpdate | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batchName, setBatchName] = useState('')
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [batchKind, setBatchKind] = useState<MaterialKind>('other')
  const [uploadResults, setUploadResults] = useState<Array<{
    filename: string
    status: string
    message?: string | null
  }>>([])
  const [collectionName, setCollectionName] = useState('')
  const [collectionDescription, setCollectionDescription] = useState('')
  const [caseName, setCaseName] = useState('')
  const [caseAttributes, setCaseAttributes] = useState('')
  const [relationTarget, setRelationTarget] = useState('')
  const [relationType, setRelationType] = useState<MaterialRelationType>('related')
  const [relationNote, setRelationNote] = useState('')
  const [literatureFormat, setLiteratureFormat] = useState<LiteratureFormat>('bibtex')
  const [doi, setDoi] = useState('')
  const batchFileRef = useRef<HTMLInputElement>(null)
  const literatureFileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setArchive(await getProfessionalMaterialArchive(taskId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '研究档案暂时无法加载。')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { void refresh() }, [refresh])

  const profile = archive?.profiles.find(
    (item) => item.material_id === selectedMaterial.materialId,
  ) ?? null

  useEffect(() => {
    setDraft(profile ? profileUpdateFrom(profile) : null)
  }, [profile])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作暂时无法完成。')
    } finally {
      setBusy(null)
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    await run('profile', async () => {
      await updateProfessionalMaterialProfile(
        taskId, selectedMaterial.materialId, draft,
      )
      await refresh()
      setNotice('材料档案已保存。')
    })
  }

  async function addBatch(event: FormEvent) {
    event.preventDefault()
    if (!batchName.trim()) return
    await run('batch', async () => {
      const created = await createMaterialBatch(taskId, batchName)
      setArchive((current) => current
        ? { ...current, batches: [...current.batches, created] }
        : current)
      setSelectedBatchId(created.batch_id)
      setBatchName('')
      setNotice('批次已建立，可以一次加入多份材料。')
    })
  }

  async function uploadBatchFiles(files: FileList | null) {
    if (!files?.length || !selectedBatchId) return
    await run('upload', async () => {
      const response = await uploadMaterialBatch(
        taskId, selectedBatchId, Array.from(files), batchKind,
      )
      setUploadResults(response.items)
      if (batchFileRef.current) batchFileRef.current.value = ''
      await refresh()
      onMaterialsChanged()
      const failed = response.items.filter((item) => item.status === 'failed').length
      setNotice(failed
        ? `${response.items.length - failed} 份已加入，${failed} 份需要处理。`
        : `${response.items.length} 份材料已加入批次。`)
    })
  }

  async function addCollection(event: FormEvent) {
    event.preventDefault()
    if (!collectionName.trim()) return
    await run('collection', async () => {
      const created = await createMaterialCollection(taskId, {
        name: collectionName, description: collectionDescription || null,
      })
      setArchive((current) => current
        ? { ...current, collections: [...current.collections, created] }
        : current)
      setCollectionName('')
      setCollectionDescription('')
      setNotice('材料集合已建立。')
    })
  }

  async function addCase(event: FormEvent) {
    event.preventDefault()
    if (!caseName.trim()) return
    await run('case', async () => {
      const created = await createResearchCase(taskId, {
        name: caseName,
        attributes: parseAttributes(caseAttributes),
        material_ids: [selectedMaterial.materialId],
      })
      setArchive((current) => current
        ? { ...current, cases: [...current.cases, created] }
        : current)
      setCaseName('')
      setCaseAttributes('')
      setNotice('个案已与当前材料关联。')
    })
  }

  async function addRelation(event: FormEvent) {
    event.preventDefault()
    if (!relationTarget) return
    await run('relation', async () => {
      const created = await createMaterialRelation(taskId, {
        source_material_id: selectedMaterial.materialId,
        target_material_id: relationTarget,
        relation_type: relationType,
        note: relationNote || null,
      })
      setArchive((current) => current
        ? { ...current, relations: [...current.relations, created] }
        : current)
      setRelationTarget('')
      setRelationNote('')
      setNotice('材料关系已记录。')
    })
  }

  async function importLiterature(file: File | null) {
    if (!file) return
    await run('literature-import', async () => {
      const created = await importLiteratureEntries(taskId, file, literatureFormat)
      if (literatureFileRef.current) literatureFileRef.current.value = ''
      await refresh()
      setNotice(`已导入 ${created.length} 条文献，疑似重复项会保留供核对。`)
    })
  }

  async function exportLiterature(format: LiteratureFormat) {
    await run(`export-${format}`, async () => {
      const blob = await exportLiteratureEntries(taskId, format)
      const extension = format === 'csl_json' ? 'json' : format === 'bibtex' ? 'bib' : 'ris'
      download(blob, `qunxue-literature.${extension}`)
      setNotice('文献条目已导出。')
    })
  }

  async function addByDoi(event: FormEvent) {
    event.preventDefault()
    if (!doi.trim()) return
    await run('doi', async () => {
      const candidate = await resolveDoiMetadata(taskId, doi)
      await createLiteratureEntry(taskId, {
        item_type: candidate.item_type,
        title: candidate.title,
        doi: candidate.doi,
        csl_data: candidate.csl_data,
        attachment_material_ids: [],
        collection_ids: [],
      })
      setDoi('')
      await refresh()
      setNotice('DOI 元数据已核对并加入文献条目。')
    })
  }

  if (loading && !archive) {
    return <p className="ep-material-notice" role="status"><CircleNotchIcon className="ep-material-library__spin" size={17} aria-hidden="true" />正在清点研究档案</p>
  }
  if (!archive || !draft) {
    return <div className="ep-material-notice" role="alert"><WarningCircleIcon size={17} aria-hidden="true" /><span>{error || '当前材料档案暂时无法打开。'}</span><button type="button" className="qx-btn qx-btn--secondary" onClick={() => { void refresh() }}>重新读取档案</button></div>
  }

  const inventory = archive.inventory
  const currentRestricted = inventory.restricted_material_ids.includes(selectedMaterial.materialId)
  const currentPending = inventory.pending_deidentification_material_ids.includes(
    selectedMaterial.materialId,
  )
  const otherMaterials = materials.filter(
    (item) => item.materialId !== selectedMaterial.materialId,
  )

  return <div className="ep-archive">
    <section className="ep-archive__inventory" aria-label="档案清点">
      <p className="qx-meta">已编目 {archive.profiles.length} / {materials.length} 份材料</p>
      <dl>{[
        ['待编目', inventory.catalog_pending_material_ids.length],
        ['待去标识化', inventory.pending_deidentification_material_ids.length],
        ['限制模型处理', inventory.restricted_material_ids.length],
        ['疑似重复文献', inventory.suspected_duplicate_literature_ids.length],
      ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    </section>
    {currentRestricted || currentPending ? <p className="ep-material-notice" role="status"><ShieldCheckIcon size={18} aria-hidden="true" /><span><strong>当前材料仍可人工阅读。</strong>{currentPending ? ' 完成去标识化，' : ''}{currentRestricted ? '明确模型处理范围后，才会进入 Agent 检索。' : ''}</span></p> : null}
    {error ? <p className="ep-material-notice" role="alert"><WarningCircleIcon size={17} aria-hidden="true" />{error}</p> : null}
    {notice ? <p className="ep-material-notice" role="status"><CheckCircleIcon size={17} aria-hidden="true" />{notice}</p> : null}
    <div className="qx-segmented ep-archive__tabs" role="tablist" aria-label="材料档案视图" onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowRight' ? (current + 1) % buttons.length : event.key === 'ArrowLeft' ? (current + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
      if (next !== null) { event.preventDefault(); buttons[next].focus(); buttons[next].click() }
    }}>
      {([['profile', '材料信息'], ['organize', '组织材料'], ['literature', '文献交换']] as const).map(([id, label]) => <button type="button" key={id} role="tab" id={`archive-tab-${id}`} aria-controls={`archive-panel-${id}`} aria-selected={activeView === id} tabIndex={activeView === id ? 0 : -1} onClick={() => setActiveView(id)}>{label}</button>)}
    </div>
    <section role="tabpanel" id="archive-panel-profile" aria-labelledby="archive-tab-profile" hidden={activeView !== 'profile'}>
      <form className="ep-archive__form" onSubmit={saveProfile}>
        <fieldset><legend className="qx-heading">身份与分类</legend><div className="ep-archive__fields">
          <label className="ep-material-field"><span>研究角色</span><Select className="qx-input" value={draft.research_role} onChange={nextValue => setDraft({ ...draft, research_role: nextValue as typeof draft.research_role })} options={RESEARCH_ROLES.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
          <label className="ep-material-field"><span>专业类型</span><input className="qx-input" value={draft.specific_type} onChange={event => setDraft({ ...draft, specific_type: event.target.value })} placeholder="如：半结构访谈" /></label>
          <label className="ep-material-field"><span>研究阶段</span><Select className="qx-input" value={draft.stage} onChange={nextValue => setDraft({ ...draft, stage: nextValue as typeof draft.stage })} options={RESEARCH_STAGES.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
          <label className="ep-material-field"><span>批次</span><Select className="qx-input" value={draft.batch_id ?? ''} onChange={nextValue => setDraft({ ...draft, batch_id: nextValue || null })} options={[{ value: "", label: "未归批次" }, ...(archive.batches.map(item => ({ value: item.batch_id, label: item.name })))]} /></label>
          <label className="ep-material-field ep-archive__full"><span>标签 <small className="qx-meta">用逗号分隔</small></span><input className="qx-input" value={draft.tags.join('，')} onChange={event => setDraft({ ...draft, tags: event.target.value.split(/[，,]/).map(item => item.trim()).filter(Boolean) })} placeholder="迁移，照护" /></label>
        </div></fieldset>
        <fieldset><legend className="qx-heading">伦理与处理范围</legend><div className="ep-archive__fields">
          <label className="ep-material-field"><span>敏感性</span><Select className="qx-input" value={draft.sensitivity} onChange={nextValue => setDraft({ ...draft, sensitivity: nextValue as typeof draft.sensitivity })} options={SENSITIVITY_LEVELS.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
          <label className="ep-material-field"><span>同意范围</span><Select className="qx-input" value={draft.consent_scope} onChange={nextValue => setDraft({ ...draft, consent_scope: nextValue as typeof draft.consent_scope })} options={CONSENT_SCOPES.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
          <label className="ep-material-field"><span>去标识化</span><Select className="qx-input" value={draft.deidentification_status} onChange={nextValue => setDraft({ ...draft, deidentification_status: nextValue as typeof draft.deidentification_status })} options={DEIDENTIFICATION_STATUSES.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
          <label className="ep-material-field"><span>模型处理</span><Select className="qx-input" value={draft.model_processing_scope} onChange={nextValue => setDraft({ ...draft, model_processing_scope: nextValue as typeof draft.model_processing_scope })} options={MODEL_PROCESSING_SCOPES.map(value => ({ value: value, label: archiveLabel(value) }))} /></label>
        </div></fieldset>
        {archive.collections.length ? <fieldset className="ep-archive__collections"><legend className="qx-heading">材料集合</legend>{archive.collections.map(item => <label key={item.collection_id}><input type="checkbox" checked={(draft.collection_ids ?? []).includes(item.collection_id)} onChange={event => setDraft({ ...draft, collection_ids: event.target.checked ? [...(draft.collection_ids ?? []), item.collection_id] : (draft.collection_ids ?? []).filter(id => id !== item.collection_id) })} />{item.name}</label>)}</fieldset> : null}
        <footer><button className="qx-btn qx-btn--primary" type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? '正在保存' : '保存材料档案'}</button></footer>
      </form>
    </section>
    <section className="ep-archive__operations" role="tabpanel" id="archive-panel-organize" aria-labelledby="archive-tab-organize" hidden={activeView !== 'organize'}>
      <section className="qx-card ep-archive__operation"><h3 className="qx-card__title"><FileArrowUpIcon size={18} aria-hidden="true" />批次与多文件</h3>
        <form onSubmit={addBatch}><input className="qx-input" aria-label="新批次名称" value={batchName} onChange={event => setBatchName(event.target.value)} placeholder="如：2026 春季田野" /><button className="qx-btn qx-btn--secondary" disabled={!batchName.trim() || busy === 'batch'}>建立批次</button></form>
        <div className="ep-archive__controls"><Select className="qx-input" aria-label="选择批次" value={selectedBatchId} onChange={nextValue => setSelectedBatchId(nextValue)} options={[{ value: "", label: "选择批次" }, ...(archive.batches.map(item => ({ value: item.batch_id, label: item.name })))]} /><Select className="qx-input" aria-label="批量材料类型" value={batchKind} onChange={nextValue => setBatchKind(nextValue as MaterialKind)} options={[{ value: "paper", label: "论文" }, { value: "interview_transcript", label: "访谈转录" }, { value: "observation_record", label: "观察记录" }, { value: "field_note", label: "田野笔记" }, { value: "other", label: "其他" }]} /><button className="qx-btn qx-btn--secondary" type="button" disabled={!selectedBatchId || busy === 'upload'} onClick={() => batchFileRef.current?.click()}>{busy === 'upload' ? '正在上传' : '选择多份文件'}</button><input ref={batchFileRef} hidden multiple type="file" onChange={event => { void uploadBatchFiles(event.target.files) }} /></div>
        {uploadResults.length ? <ul className="ep-archive__results">{uploadResults.map((item, index) => <li key={`${item.filename}:${index}`} data-status={item.status}><span>{item.filename}</span><span className="qx-meta">{item.status === 'created' ? '已加入' : item.message || '未加入'}</span></li>)}</ul> : null}
      </section>
      <section className="qx-card ep-archive__operation"><h3 className="qx-card__title"><FolderPlusIcon size={18} aria-hidden="true" />集合与个案</h3><p className="qx-meta">{archive.collections.length} 个集合 · {archive.cases.length} 个个案</p>
        <form onSubmit={addCollection}><input className="qx-input" aria-label="集合名称" value={collectionName} onChange={event => setCollectionName(event.target.value)} placeholder="集合名称" /><input className="qx-input" aria-label="集合说明" value={collectionDescription} onChange={event => setCollectionDescription(event.target.value)} placeholder="说明（可选）" /><button className="qx-btn qx-btn--secondary" disabled={!collectionName.trim() || busy === 'collection'}>新建集合</button></form>
        <form onSubmit={addCase}><input className="qx-input" aria-label="个案名称" value={caseName} onChange={event => setCaseName(event.target.value)} placeholder="个案名称" /><input className="qx-input" aria-label="个案属性" value={caseAttributes} onChange={event => setCaseAttributes(event.target.value)} placeholder="属性，如：地区=杭州；阶段=两年内" /><button className="qx-btn qx-btn--secondary" disabled={!caseName.trim() || busy === 'case'}>关联当前材料</button></form>
      </section>
      <section className="qx-card ep-archive__operation"><h3 className="qx-card__title"><LinkSimpleIcon size={18} aria-hidden="true" />材料关系</h3><p className="qx-meta">{archive.relations.length} 条关系</p>
        <form onSubmit={addRelation}><Select className="qx-input" aria-label="关联材料" value={relationTarget} onChange={nextValue => setRelationTarget(nextValue)} options={[{ value: "", label: "选择另一份材料" }, ...(otherMaterials.map(item => ({ value: item.materialId, label: item.filename })))]} /><Select className="qx-input" aria-label="关系类型" value={relationType} onChange={nextValue => setRelationType(nextValue as MaterialRelationType)} options={MATERIAL_RELATION_TYPES.map(value => ({ value: value, label: RELATION_LABELS[value] }))} /><input className="qx-input" aria-label="关系说明" value={relationNote} onChange={event => setRelationNote(event.target.value)} placeholder="说明（可选）" /><button className="qx-btn qx-btn--secondary" disabled={!relationTarget || busy === 'relation'}>记录关系</button></form>
      </section>
    </section>
    <section className="ep-archive__operations" role="tabpanel" id="archive-panel-literature" aria-labelledby="archive-tab-literature" hidden={activeView !== 'literature'}>
      <section className="qx-card ep-archive__operation"><h3 className="qx-card__title"><BookOpenTextIcon size={18} aria-hidden="true" />文献交换</h3><p className="qx-meta">{archive.literature.length} 条文献 · {archive.duplicate_hints.length} 组待核对</p>
        <form onSubmit={addByDoi}><input className="qx-input" aria-label="DOI" value={doi} onChange={event => setDoi(event.target.value)} placeholder="输入 DOI 核对并加入" /><button className="qx-btn qx-btn--secondary" disabled={!doi.trim() || busy === 'doi'}>核对 DOI</button></form>
        <div className="ep-archive__controls"><Select className="qx-input" aria-label="文献交换格式" value={literatureFormat} onChange={nextValue => setLiteratureFormat(nextValue as LiteratureFormat)} options={[{ value: "bibtex", label: "BibTeX" }, { value: "ris", label: "RIS" }, { value: "csl_json", label: "CSL-JSON" }]} /><button className="qx-btn qx-btn--secondary" type="button" onClick={() => literatureFileRef.current?.click()} disabled={busy === 'literature-import'}>导入条目</button><input ref={literatureFileRef} hidden type="file" onChange={event => { void importLiterature(event.target.files?.[0] ?? null) }} /><button className="qx-btn qx-btn--secondary" type="button" onClick={() => { void exportLiterature(literatureFormat) }}><ArrowDownIcon size={17} aria-hidden="true" />导出</button></div>
        {archive.duplicate_hints.length ? <ul className="ep-archive__results">{archive.duplicate_hints.map(item => <li key={`${item.literature_id}:${item.candidate_id}`}>疑似重复：{item.reasons.join('、')}</li>)}</ul> : null}
      </section>
    </section>
  </div>
}
