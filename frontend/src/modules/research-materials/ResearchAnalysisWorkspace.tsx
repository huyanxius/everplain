import { Select } from '../../ui/Select'
import './research-analysis-view.css'
import { useMemo, useState } from 'react'

import type { AnalysisMemoKind, CreateAnalysisMemoInput, CreateCaseComparisonInput, ResearchAnalysisSnapshot } from './researchAnalysisModel'
import {
  ResearchAnalysisCandidateCard,
  type ResearchAnalysisDecision,
} from './ResearchAnalysisCandidateCard'
import {
  ResearchCaseComparison,
  type CaseComparisonDecision,
} from './ResearchCaseComparison'
import { formatMaterialLocator } from './researchMaterialsModel'

type ResearchAnalysisWorkspaceProps = {
  readonly snapshot: ResearchAnalysisSnapshot
  readonly selectedMaterialId: string | null
  readonly materialNames?: Readonly<Record<string, string>>
  readonly onCreateMemo: (body: CreateAnalysisMemoInput) => void | Promise<void>
  readonly onDecideMemo: (memoId: string, decision: ResearchAnalysisDecision, reason: string, expectedVersion: number) => void | Promise<void>
  readonly onCreateComparison?: (body: CreateCaseComparisonInput) => void | Promise<void>
  readonly onDecideComparison?: (comparisonId: string, decision: CaseComparisonDecision, reason: string, expectedVersion: number) => void | Promise<void>
}

const memoKindLabels: Record<AnalysisMemoKind, string> = {
  descriptive: '描述备忘',
  reflexive: '反思备忘',
  analytic: '分析备忘',
  methodological: '方法备忘',
}

export function ResearchAnalysisWorkspace({
  snapshot,
  selectedMaterialId,
  materialNames,
  onCreateMemo,
  onDecideMemo,
  onCreateComparison,
  onDecideComparison,
}: ResearchAnalysisWorkspaceProps) {
  const [scope, setScope] = useState<'material' | 'task'>(selectedMaterialId ? 'material' : 'task')
  const [composer, setComposer] = useState<'memo' | null>(null)
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([])
  const [memoTitle, setMemoTitle] = useState('')
  const [memoContent, setMemoContent] = useState('')
  const [memoKind, setMemoKind] = useState<AnalysisMemoKind>('analytic')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleAnnotations = useMemo(() => (
    scope === 'material' && selectedMaterialId
      ? snapshot.annotations.filter((annotation) => annotation.material_id === selectedMaterialId)
      : snapshot.annotations
  ), [scope, selectedMaterialId, snapshot.annotations])
  const confirmedMemos = snapshot.memos.filter((memo) => memo.status === 'confirmed')
  const candidateMemos = snapshot.memos.filter((memo) => memo.status === 'candidate' && memo.source === 'agent')

  function toggle(values: string[], value: string, setValues: (next: string[]) => void) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  function resetComposer() {
    setComposer(null)
    setSelectedAnnotationIds([])
    setMemoTitle('')
    setMemoContent('')
    setMemoKind('analytic')
    setError(null)
  }

  async function submitMemo() {
    if (!memoTitle.trim() || !memoContent.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      await onCreateMemo({
        title: memoTitle.trim(),
        content: memoContent.trim(),
        memo_kind: memoKind,
        annotation_ids: selectedAnnotationIds,
      })
      resetComposer()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '分析备忘未保存。')
    } finally {
      setPending(false)
    }
  }

  return <section className="ep-analysis" role="region" aria-label="研究分析">
    <header className="ep-analysis__bar"><p className="qx-meta">{snapshot.annotations.length} 处标记 · {confirmedMemos.length} 则备忘 · {snapshot.comparisons.filter(item => item.status === 'confirmed').length} 组比较</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => { resetComposer(); setComposer('memo') }}>写分析备忘</button></header>
    {composer ? <form className="ep-analysis-form qx-card" aria-label="写分析备忘" onSubmit={event => { event.preventDefault(); void submitMemo() }}>
      <h3 className="qx-heading">写分析备忘</h3>
      <label>备忘标题<input className="qx-input" aria-label="备忘标题" value={memoTitle} onChange={event => setMemoTitle(event.target.value)} /></label>
      <label>备忘类型<Select className="qx-input" aria-label="备忘类型" value={memoKind} onChange={nextValue => setMemoKind(nextValue as AnalysisMemoKind)} options={Object.entries(memoKindLabels).map(([value, label]) => ({ value: value, label: label }))} /></label>
      <label>备忘内容<textarea className="qx-textarea" aria-label="备忘内容" value={memoContent} onChange={event => setMemoContent(event.target.value)} rows={5} /></label>
      <fieldset><legend>关联原文标记（可选）</legend>{visibleAnnotations.map(annotation => <label className="ep-analysis-form__check" key={annotation.annotation_id}><input type="checkbox" checked={selectedAnnotationIds.includes(annotation.annotation_id)} onChange={() => toggle(selectedAnnotationIds, annotation.annotation_id, setSelectedAnnotationIds)} /><span>{annotation.quote}</span></label>)}</fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button className="qx-btn qx-btn--ghost" type="button" disabled={pending} onClick={resetComposer}>取消</button><button className="qx-btn qx-btn--primary" type="submit" disabled={pending || !memoTitle.trim() || !memoContent.trim()}>{pending ? '正在保存' : '保存备忘'}</button></footer>
    </form> : null}
    {candidateMemos.length ? <section className="ep-analysis__group" aria-label="待确认的 Agent 建议"><h3 className="qx-heading">待你判断</h3>{candidateMemos.map(memo => <ResearchAnalysisCandidateCard key={memo.memo_id} kindLabel="备忘草稿" title={memo.title} detail={memo.content} version={memo.version} onDecide={(decision, reason, version) => onDecideMemo(memo.memo_id, decision, reason, version)} />)}</section> : null}
    <section className="ep-analysis__group" aria-label="原文标记">
      <div className="ep-analysis__group-head"><h3 className="qx-heading">原文标记</h3><div className="qx-segmented" aria-label="分析范围">{selectedMaterialId ? <button type="button" aria-pressed={scope === 'material'} onClick={() => setScope('material')}>当前材料</button> : null}<button type="button" aria-pressed={scope === 'task'} onClick={() => setScope('task')}>全部研究</button></div></div>
      {visibleAnnotations.map(annotation => <article className="ep-analysis__annotation" key={annotation.annotation_id}><blockquote>{annotation.quote}</blockquote><p>{annotation.note}</p>{annotation.reflection ? <p className="ep-analysis__reflection"><strong>研究者反思</strong>{annotation.reflection}</p> : null}<p className="qx-meta">{[materialNames?.[annotation.material_id], annotation.case_label, annotation.observed_at, formatMaterialLocator({ page: annotation.locator.page, headingPath: annotation.locator.section_path, paragraph: annotation.locator.paragraph, lineStart: annotation.locator.line_start, lineEnd: annotation.locator.line_end, charStart: annotation.locator.char_start, charEnd: annotation.locator.char_end })].filter(Boolean).join(' · ')}</p></article>)}
      {!visibleAnnotations.length ? <p className="ep-analysis__empty">先在材料原文中拖选关键片段。原文证据会在这里逐步形成批注、分析备忘与案例比较。</p> : null}
    </section>
    <section className="ep-analysis__group" aria-label="已确认分析"><h3 className="qx-heading">分析备忘</h3>{confirmedMemos.map(memo => <article className="qx-card ep-analysis__memo" key={memo.memo_id}><span className="qx-meta">研究者确认 · {memoKindLabels[memo.memo_kind]}</span><h4 className="qx-card__title">{memo.title}</h4><p className="qx-card__body">{memo.content}</p></article>)}{!confirmedMemos.length ? <p className="ep-analysis__empty">把观察和判断写成备忘，保留你思考的过程。</p> : null}</section>
    <ResearchCaseComparison annotations={snapshot.annotations} comparisons={snapshot.comparisons} materialNames={materialNames} onCreate={onCreateComparison} onDecide={onDecideComparison} />
  </section>
}

export type { ResearchAnalysisWorkspaceProps }
