import './research-analysis-view.css'
import { useState } from 'react'

import type { AnalysisRecordStatus } from './researchAnalysisModel'

export type ResearchAnalysisDecision = Exclude<AnalysisRecordStatus, 'candidate'>

type ResearchAnalysisCandidateCardProps = {
  readonly kindLabel: string
  readonly title: string
  readonly detail: string
  readonly rationale?: string | null
  readonly version: number
  readonly onDecide: (
    decision: ResearchAnalysisDecision,
    reason: string,
    expectedVersion: number,
  ) => void | Promise<void>
}

export function ResearchAnalysisCandidateCard({
  kindLabel,
  title,
  detail,
  rationale = null,
  version,
  onDecide,
}: ResearchAnalysisCandidateCardProps) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<ResearchAnalysisDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const normalizedReason = reason.trim()

  async function decide(decision: ResearchAnalysisDecision) {
    if (!normalizedReason || pending) return
    setPending(decision)
    setError(null)
    try {
      await onDecide(decision, normalizedReason, version)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '候选判断未保存。')
    } finally {
      setPending(null)
    }
  }

  return <article className="qx-card ep-analysis-candidate" aria-label={`${kindLabel}：${title}`}>
    <div className="ep-analysis-candidate__meta"><span className="qx-meta">{kindLabel} · v{version}</span><span className="qx-badge">Agent 建议 · 待确认</span></div>
    <h4 className="qx-card__title">{title}</h4><p className="qx-card__body">{detail}</p>
    {rationale ? <p className="ep-analysis-candidate__rationale">{rationale}</p> : null}
    <form className="ep-analysis-form" onSubmit={event => { event.preventDefault(); void decide('confirmed') }}><label>判断依据<textarea className="qx-textarea" aria-label="判断依据" disabled={pending !== null} onChange={event => setReason(event.target.value)} placeholder="回到原文后，写下你保留或拒绝它的理由" rows={2} value={reason} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button className="qx-btn qx-btn--ghost" type="button" disabled={!normalizedReason || pending !== null} onClick={() => void decide('rejected')}>{pending === 'rejected' ? '正在拒绝' : `拒绝${kindLabel}`}</button><button className="qx-btn qx-btn--secondary" type="submit" disabled={!normalizedReason || pending !== null}>{pending === 'confirmed' ? '正在确认' : `确认${kindLabel}`}</button></footer>
    </form>
  </article>
}

export type { ResearchAnalysisCandidateCardProps }
