import { useEffect, useRef } from 'react'
import { useAnimatedDismiss } from '../../ui/usePresence'
import { XIcon } from '@phosphor-icons/react'

import { formatMaterialLocator } from './researchMaterialsModel'
import type { ResearchMaterialSelectionDraft } from './researchMaterialSelection'
import './material-views.css'

type AnnotationKind = 'descriptive' | 'researcher_reflection'

const KIND_OPTIONS: ReadonlyArray<{ readonly value: AnnotationKind; readonly label: string; readonly hint: string }> = [
  { value: 'descriptive', label: '描述性材料', hint: '记录材料里发生了什么' },
  { value: 'researcher_reflection', label: '研究者反思', hint: '记录我对它的判断和警觉' },
]

type MaterialAnnotationDrawerProps = {
  readonly draft: ResearchMaterialSelectionDraft
  readonly kind: AnnotationKind
  readonly note: string
  readonly reflection: string
  readonly caseLabel: string
  readonly observedAt: string
  readonly saving: boolean
  readonly onKindChange: (kind: AnnotationKind) => void
  readonly onNoteChange: (value: string) => void
  readonly onReflectionChange: (value: string) => void
  readonly onCaseLabelChange: (value: string) => void
  readonly onObservedAtChange: (value: string) => void
  readonly onCancel: () => void
  readonly onSave: () => void
}

/**
 * 片段标记抽屉：把划中的一句原文变成一条证据。
 *
 * 字段顺序照研究者的思路排——先看清引了什么，再定这是描述还是反思，然后写，最后补背景。
 * 反思两种类型下都留着：描述性材料也允许附一句反思，只是不强制；标反思却不写反思才是没写完。
 * 抽屉从右侧滑出而不是接在正文下面：正文接一段表单会把阅读位置整个推走，回头找不到自己
 * 划的是哪句。抽屉会盖住部分正文，所以引文和定位符原样留在抽屉头部。
 */
export function MaterialAnnotationDrawer({
  draft,
  kind,
  note,
  reflection,
  caseLabel,
  observedAt,
  saving,
  onKindChange,
  onNoteChange,
  onReflectionChange,
  onCaseLabelChange,
  onObservedAtChange,
  onCancel,
  onSave,
}: MaterialAnnotationDrawerProps) {
  const surface = useRef<HTMLElement>(null)
  const motion = useAnimatedDismiss(surface, onCancel)
  const cancelDismiss = motion.cancel
  useEffect(() => cancelDismiss(), [draft, cancelDismiss])
  const reflectionRequired = kind === 'researcher_reflection'
  const canSave = Boolean(note.trim()) && (!reflectionRequired || Boolean(reflection.trim())) && !saving

  return <aside ref={surface} data-motion-surface="drawer" {...motion.props} className="ep-annotation" role="region" aria-label="片段标记">
    <header className="ep-annotation__header"><h2 className="qx-card__title">片段标记</h2><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="取消片段标记" onClick={motion.dismiss}><XIcon size={18} aria-hidden="true" /></button></header>
    <figure className="ep-annotation__source"><blockquote>{draft.quote}</blockquote><figcaption className="qx-meta">{formatMaterialLocator(draft.locator)}</figcaption></figure>
    <form className="ep-annotation__form" onSubmit={event => { event.preventDefault(); if (canSave) onSave() }}>
      <fieldset className="ep-annotation__kinds"><legend className="qx-group-label">标记类型</legend><div className="qx-segmented" role="radiogroup" aria-label="标记类型" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'descriptive' : event.key === 'End' ? 'researcher_reflection' : kind === 'descriptive' ? 'researcher_reflection' : 'descriptive'
        onKindChange(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus()
      }}>
        {KIND_OPTIONS.map(option => <button type="button" key={option.value} role="radio" aria-checked={kind === option.value} tabIndex={kind === option.value ? 0 : -1} data-kind={option.value} title={option.hint} onClick={() => onKindChange(option.value)}>{option.label}</button>)}
      </div></fieldset>
      <label className="ep-material-field"><span>材料描述</span><textarea className="qx-textarea" aria-label="材料描述" value={note} rows={3} placeholder="这段原文在说什么" onChange={event => onNoteChange(event.target.value)} /></label>
      <label className="ep-material-field"><span>研究者反思 <small className="qx-meta">{reflectionRequired ? '必填' : '可选'}</small></span><textarea className="qx-textarea" aria-label="研究者反思" value={reflection} rows={3} placeholder="我从这里读出了什么，又该警惕什么" onChange={event => onReflectionChange(event.target.value)} /></label>
      <fieldset className="ep-annotation__context"><legend className="qx-group-label">补充背景 · 可选</legend><label className="ep-material-field"><span>案例</span><input className="qx-input" aria-label="案例" value={caseLabel} placeholder="如：家庭 A" onChange={event => onCaseLabelChange(event.target.value)} /></label><label className="ep-material-field"><span>时间</span><input className="qx-input" aria-label="时间" value={observedAt} placeholder="如：迁移后" onChange={event => onObservedAtChange(event.target.value)} /></label></fieldset>
      <footer className="ep-annotation__footer"><button type="button" className="qx-btn qx-btn--secondary" onClick={motion.dismiss}>取消</button><button type="submit" className="qx-btn qx-btn--primary" disabled={!canSave}>{saving ? '正在保存' : '保存片段标记'}</button></footer>
    </form>
  </aside>
}

export type { AnnotationKind }
