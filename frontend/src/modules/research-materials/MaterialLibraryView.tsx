import { Select } from '../../ui/Select'
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FilePlusIcon,
  FileTextIcon,
  IdentificationCardIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { ChangeEvent, RefObject } from 'react'

import {
  formatMaterialSize,
  materialKindLabel,
  materialMediaLabel,
  RESEARCH_MATERIAL_ACCEPT,
  type ResearchMaterial,
  type ResearchMaterialKind,
  type ResearchMaterialSearchHit,
} from './researchMaterialsModel'
import './material-views.css'

const MATERIAL_KINDS: readonly ResearchMaterialKind[] = [
  'paper',
  'interview_transcript',
  'observation_record',
  'field_note',
  'other',
]

function formatUpdatedAt(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function searchLocator(hit: ResearchMaterialSearchHit): string {
  if (hit.locator.page !== null) return `第 ${hit.locator.page} 页`
  if (hit.locator.paragraph !== null) return `第 ${hit.locator.paragraph} 段`
  if (hit.locator.lineStart !== null) return `第 ${hit.locator.lineStart} 行`
  return '可定位原文'
}

/**
 * 状态列写的是「这份材料现在能干什么」，不是它的内部状态名。
 *
 * ready 不写「已就绪」而写片段数：每行都挂一个「已就绪」等于每行都没说话，而片段数直接
 * 回答了研究者真正要判断的事——这份材料能不能拿来引用、够不够细。processing 和 failed
 * 才是需要占用注意力的状态，只有它们配图标。
 */
function statusSummary(material: ResearchMaterial) {
  if (material.unavailableReason === 'ocr_required') {
    return { tone: 'failed' as const, icon: <WarningCircleIcon size={14} aria-hidden="true" />, text: '需要 OCR，当前不可检索' }
  }
  if (material.unavailableReason === 'transcription_unavailable') {
    return { tone: 'failed' as const, icon: <WarningCircleIcon size={14} aria-hidden="true" />, text: '转写服务未配置' }
  }
  if (material.unavailableReason === 'transcription_required') {
    return { tone: 'pending' as const, icon: null, text: '等待转写' }
  }
  if (material.ingestionStatus === 'queued') {
    return { tone: 'pending' as const, icon: null, text: '等待解析' }
  }
  if (material.ingestionStatus === 'processing' || material.status === 'processing') {
    return { tone: 'processing' as const, icon: <CircleNotchIcon className="ep-material-library__spin" size={14} aria-hidden="true" />, text: '正在解析' }
  }
  if (material.ingestionStatus === 'failed' || material.status === 'failed') {
    return { tone: 'failed' as const, icon: <WarningCircleIcon size={14} aria-hidden="true" />, text: '解析失败' }
  }
  if (material.status === 'ready') {
    return material.segmentCount
      ? { tone: 'ready' as const, icon: null, text: `${material.segmentCount} 个可定位片段` }
      : { tone: 'ready' as const, icon: <CheckCircleIcon size={14} aria-hidden="true" />, text: '已就绪' }
  }
  return { tone: 'pending' as const, icon: null, text: '等待解析' }
}

type MaterialLibraryViewProps = {
  readonly materials: readonly ResearchMaterial[]
  readonly loading: boolean
  readonly error: string | null
  readonly notice: string | null
  readonly uploading: boolean
  readonly busyMaterialId: string | null
  readonly kind: ResearchMaterialKind
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly onKindChange: (kind: ResearchMaterialKind) => void
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  readonly onOpenMaterial: (material: ResearchMaterial) => void
  readonly onOpenArchive: (material: ResearchMaterial) => void
  readonly onRetry: (material: ResearchMaterial) => void
  readonly onReload: () => void
  readonly onDelete: (material: ResearchMaterial) => void
  readonly searchQuery: string
  readonly searchResults: readonly ResearchMaterialSearchHit[]
  readonly searchLoading: boolean
  readonly searchError: string | null
  readonly onSearchQueryChange: (query: string) => void
  readonly onOpenSearchResult: (hit: ResearchMaterialSearchHit) => void
}

/**
 * 材料库：这个研究里有哪些材料，我要打开哪一份、再加一份。
 *
 * 顺序上材料列表紧跟标题，上传收在列表末尾。上传是低频动作，把它摆在列表之前会让页面的
 * 第一屏回答不了「我有什么」这个唯一的问题。只有一份材料都没有时，上传才升级成页面主体。
 */
export function MaterialLibraryView({
  materials,
  loading,
  error,
  notice,
  uploading,
  busyMaterialId,
  kind,
  fileInputRef,
  onKindChange,
  onFileChange,
  onOpenMaterial,
  onOpenArchive,
  onRetry,
  onReload,
  onDelete,
  searchQuery,
  searchResults,
  searchLoading,
  searchError,
  onSearchQueryChange,
  onOpenSearchResult,
}: MaterialLibraryViewProps) {
  const readyCount = materials.filter(material => material.status === 'ready').length
  const empty = !loading && !error && !materials.length
  return <section className="ep-material-library" aria-label="材料库">
    <header className="ep-material-library__header">
      <div><h2 className="qx-section-title" id="research-materials-heading">研究材料</h2><p className="qx-meta">{materials.length ? `${materials.length} 份材料 · ${readyCount} 份可检索` : '把论文、访谈和田野记录放在同一处'}</p></div>
      <button type="button" className="qx-btn qx-btn--primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
        {uploading ? <CircleNotchIcon className="ep-material-library__spin" size={17} aria-hidden="true" /> : <FilePlusIcon size={17} aria-hidden="true" />}{uploading ? '正在上传' : '选择文件'}
      </button>
    </header>
    <input ref={fileInputRef} className="ep-material-library__file-input" type="file" accept={RESEARCH_MATERIAL_ACCEPT} aria-label="选择研究材料文件" onChange={onFileChange} />
    <div className="ep-material-library__toolbar">
      {!empty && !loading ? <label className="qx-search ep-material-library__search"><MagnifyingGlassIcon size={18} aria-hidden="true" /><input type="search" aria-label="检索全部材料" value={searchQuery} placeholder="检索全部材料中的原文" onChange={event => onSearchQueryChange(event.target.value)} />{searchLoading ? <CircleNotchIcon className="ep-material-library__spin" size={16} aria-label="正在检索" /> : null}</label> : null}
      <label className="ep-material-library__kind"><span className="qx-meta">导入类型</span><Select className="qx-input" value={kind} aria-label="材料类型" onChange={nextValue => onKindChange(nextValue as ResearchMaterialKind)} options={MATERIAL_KINDS.map(item => ({ value: item, label: materialKindLabel(item) }))} /></label>
    </div>
    {error ? <div className="ep-material-notice" role="alert"><WarningCircleIcon size={17} aria-hidden="true" /><span>{error}</span><button className="qx-btn qx-btn--secondary" type="button" onClick={onReload}>重新加载材料</button></div> : null}
    {notice ? <p className="ep-material-notice" role="status"><CheckCircleIcon size={17} aria-hidden="true" />{notice}</p> : null}
    {loading ? <p className="ep-material-notice" role="status"><CircleNotchIcon className="ep-material-library__spin" size={17} aria-hidden="true" />正在加载材料</p> : null}
    {searchError ? <p className="ep-material-notice" role="alert">{searchError}</p> : null}
    {searchQuery.trim() && !searchLoading && !searchError ? <section className="ep-material-library__results" aria-label="材料检索结果">
      <p className="qx-meta">{searchResults.length ? `${searchResults.length} 处命中` : '没有找到匹配原文'}</p>
      {searchResults.map(hit => <button className="qx-card qx-card--interactive ep-material-library__hit" type="button" key={`${hit.materialId}:${hit.parseId}:${hit.segmentId}`} aria-label={`打开检索结果：${hit.title}，${searchLocator(hit)}`} onClick={() => onOpenSearchResult(hit)}>
        <span className="qx-meta">{materialKindLabel(hit.materialKind)} · {searchLocator(hit)}</span><strong className="qx-card__title">{hit.title}</strong><span className="qx-card__body">{hit.excerpt}</span>
      </button>)}
    </section> : null}
    {empty ? <div className="ep-material-library__empty"><FilePlusIcon size={30} aria-hidden="true" /><h3 className="qx-card__title">还没有研究材料</h3><p>先加入一份论文、访谈转录或田野笔记，Agent 才能在本次研究中引用它。</p><p className="qx-meta">支持文档、MP3、M4A、WAV、MP4、WebM</p></div> : null}
    {!loading && !searchQuery.trim() && materials.length ? <ul className="ep-material-library__grid" aria-label="研究材料卡片">
      {materials.map(material => {
        const status = statusSummary(material)
        const busy = busyMaterialId === material.materialId
        return <li className="qx-card ep-material-library__card" key={material.materialId} data-status={material.status}>
          <button type="button" className="ep-material-library__open" aria-label={`查看材料：${material.filename}`} onClick={() => onOpenMaterial(material)}>
            <span className="ep-material-library__format qx-meta"><FileTextIcon size={18} aria-hidden="true" />{materialMediaLabel(material.mediaType, material.filename)}</span>
            <strong className="qx-card__title">{material.filename}</strong>
            <span className="qx-card__body">{material.materialKind ? materialKindLabel(material.materialKind) : '研究材料'}</span>
            <span className="ep-material-library__status qx-meta" data-tone={status.tone}>{status.icon}{status.text}</span>
          </button>
          <footer className="ep-material-library__footer"><span className="qx-meta">{formatMaterialSize(material.sizeBytes)}{formatUpdatedAt(material.updatedAt) ? ` · ${formatUpdatedAt(material.updatedAt)}` : ''}</span>
            <div className="ep-material-library__actions">
              <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={`材料档案：${material.filename}`} title="材料档案" onClick={() => onOpenArchive(material)}><IdentificationCardIcon size={16} aria-hidden="true" /></button>
              {material.status === 'failed' || material.ingestionStatus === 'failed' ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={`重新解析：${material.filename}`} title="重新解析" disabled={busy} onClick={() => onRetry(material)}><ArrowClockwiseIcon size={16} aria-hidden="true" /></button> : null}
              <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={`删除材料：${material.filename}`} title="删除材料" disabled={busy} onClick={() => onDelete(material)}><TrashIcon size={16} aria-hidden="true" /></button>
            </div>
          </footer>
        </li>
      })}
    </ul> : null}
  </section>
}
