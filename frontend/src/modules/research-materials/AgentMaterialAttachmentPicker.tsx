import { useAnimatedDismiss } from '../../ui/usePresence'
import { XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import type { ResearchMaterial } from './researchMaterialsModel'
import './agent-material-attachment-picker.css'

type AgentMaterialAttachmentPickerProps = {
  inline?: boolean
  loading?: boolean
  materials: ResearchMaterial[]
  selectedIds: ReadonlySet<string>
  onToggle: (material: ResearchMaterial) => void
  onClose: () => void
  locale?: 'zh-CN' | 'en-US'
}

function unavailableReason(material: ResearchMaterial, locale: 'zh-CN' | 'en-US') {
  if (material.unavailableReason === 'ocr_required') {
    return locale === 'en-US' ? 'OCR is required but not configured' : '需要 OCR，当前未配置，暂不可检索'
  }
  if (material.unavailableReason === 'transcription_unavailable') {
    return locale === 'en-US' ? 'Transcription is not configured' : '转写服务未配置，暂不可检索'
  }
  if (material.unavailableReason === 'transcription_required') {
    return locale === 'en-US' ? 'Transcription is required first' : '需要先完成转写'
  }
  if (material.ingestionStatus === 'queued') {
    return locale === 'en-US' ? 'Queued for parsing; cannot attach yet' : '等待解析，暂时不能附加'
  }
  if (material.status === 'processing' || material.status === 'uploaded') {
    return locale === 'en-US' ? 'Still processing; cannot attach yet' : '正在解析，暂时不能附加'
  }
  if (material.status === 'failed') {
    return locale === 'en-US' ? 'Processing failed; retry it in the library' : '解析失败，请先在材料库重试'
  }
  return locale === 'en-US' ? 'Unavailable' : '当前不可附加'
}

export function AgentMaterialAttachmentPicker({
  materials,
  inline = false,
  loading = false,
  selectedIds,
  onToggle,
  onClose,
  locale = 'zh-CN',
}: AgentMaterialAttachmentPickerProps) {
  const [query, setQuery] = useState('')
  const surface = useRef<HTMLElement>(null)
  const motion = useAnimatedDismiss(surface, onClose)
  const dismiss = motion.dismiss
  const visibleMaterials = materials.filter((material) => material.filename.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); dismiss() }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [dismiss])

  return <div className="turn-material-picker" data-inline={inline} role="presentation" onMouseDown={event => { if (!inline && event.target === event.currentTarget) dismiss() }}>
    <section ref={surface} data-motion-surface={inline ? 'popover' : 'modal'} {...motion.props} className="turn-material-picker__panel" role="dialog" aria-modal={inline ? undefined : true} aria-label={locale === 'en-US' ? 'Choose materials for this turn' : '选择本轮材料'}>
      <header><h2 className="qx-card__title">{locale === 'en-US' ? 'Choose research materials' : '选择研究材料'}</h2><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={locale === 'en-US' ? 'Close' : '关闭'} onClick={motion.dismiss}><XIcon /></button></header>
      <input className="qx-input" type="search" aria-label={locale === 'en-US' ? 'Search files' : '搜索文件'} placeholder={locale === 'en-US' ? 'Search files' : '搜索文件名'} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="turn-material-picker__list" aria-busy={loading}>
        {visibleMaterials.length ? visibleMaterials.map(material => {
          const ready = material.status === 'ready'
          return <label className="turn-material-picker__row" key={material.materialId} data-disabled={!ready}>
            <input type="checkbox" checked={selectedIds.has(material.materialId)} disabled={!ready} aria-label={`${material.filename}${ready ? '' : `，${unavailableReason(material, locale)}`}`} onChange={() => onToggle(material)} />
            <span><strong>{material.filename}</strong><span className="qx-meta">{ready ? (locale === 'en-US' ? 'Ready to search' : '可检索') : unavailableReason(material, locale)}</span></span>
          </label>
        }) : <p className="qx-meta" role="status">{loading ? (locale === 'en-US' ? 'Loading files…' : '正在加载文件…') : query ? (locale === 'en-US' ? 'No matching files.' : '没有找到匹配的文件。') : (locale === 'en-US' ? 'No files yet. Upload one to get started.' : '还没有文件，可以直接上传。')}</p>}
      </div>
      <footer><span className="qx-meta">{locale === 'en-US' ? `${selectedIds.size} selected` : `已选择 ${selectedIds.size} 份`}</span><button className="qx-btn qx-btn--primary" type="button" onClick={motion.dismiss}>{locale === 'en-US' ? 'Done' : '完成'}</button></footer>
    </section>
  </div>
}
