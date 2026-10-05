import { WarningCircleIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import './knowledge-readiness-choice.css'

export type ReadinessDocument = {
  id: string
  title: string
  state: 'ready' | 'processing' | 'failed' | 'missing'
  reason?: string | null
}

/** A choice at the requested operation, never a gate on ordinary conversation. */
export function KnowledgeReadinessChoice({
  purpose = 'search', totalCount, readyCount, documents, busy = false, waiting = false,
  error, onSkip, onRepair, onCancel, onRefresh, locale = 'zh-CN',
}: {
  purpose?: 'search' | 'graph'
  totalCount: number
  readyCount: number
  documents: readonly ReadinessDocument[]
  busy?: boolean
  waiting?: boolean
  error?: string | null
  onSkip(): void
  onRepair(): void
  onCancel(): void
  onRefresh?(): void
  locale?: 'zh-CN' | 'en-US'
}) {
  const titleId = useId()
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh
  const groups = [
    ['failed', text('失败', 'Failed')], ['processing', text('处理中', 'Processing')],
    ['missing', text('尚未整理', 'Not organized')], ['ready', text('已就绪', 'Ready')],
  ] as const
  return <section className="qx-panel ep-readiness-choice" role="region" aria-labelledby={titleId} aria-busy={busy}>
    <header><WarningCircleIcon size={24} aria-hidden="true" /><h2 id={titleId} className="qx-card__title">{text('知识库还未整理完全，确定现在开始吗？', 'Your knowledge base is not fully organized. Start now?')}</h2></header>
    <p>{purpose === 'graph'
      ? text('图谱需要资料的实体与关系整理完成。仅完成向量索引不代表图谱已就绪。', 'A graph needs extracted entities and relations. A vector index alone does not make it ready.')
      : text('本次检索只会使用已就绪的资料。尚未整理的资料不会被悄悄当作完整证据。', 'This search can only use ready documents. Unorganized documents will not be presented as complete evidence.')}</p>
    <p className="qx-notice" role="status">{text(`共 ${totalCount} 份资料，已就绪 ${readyCount} 份，尚未就绪 ${Math.max(0, totalCount - readyCount)} 份。`, `${readyCount} of ${totalCount} documents ready; ${Math.max(0, totalCount - readyCount)} not ready.`)}</p>
    <div className="ep-readiness-choice__documents">{groups.map(([state, label]) => {
      const items = documents.filter(document => document.state === state)
      if (!items.length) return null
      return <details key={state} open={state !== 'ready'}><summary>{label} · {items.length}</summary><ul>{items.map(document => <li key={document.id}><strong>{document.title}</strong>{document.reason && <span className="qx-meta">{document.reason}</span>}</li>)}</ul></details>
    })}</div>
    {waiting && <p role="status">{text('正在等待本次补齐。已就绪资料不会重算；失败会明确显示，不会自动反复重试。', 'Waiting for this repair. Ready documents are not recalculated; failures are shown without automatic retries.')}</p>}
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}
    <div className="ep-readiness-choice__actions">
      <button type="button" className="qx-btn qx-btn--secondary" disabled={busy || readyCount === 0} onClick={onSkip}>{text('直接开始，忽略未就绪资料', 'Start with ready documents')}</button>
      <button type="button" className="qx-btn qx-btn--primary" disabled={busy || waiting || readyCount === totalCount} onClick={onRepair}>{waiting ? text('正在等待整理完成…', 'Waiting for organization…') : text('补齐并等待整理完成', 'Repair and wait')}</button>
      {onRefresh && <button type="button" className="qx-btn qx-btn--ghost" disabled={busy || waiting} onClick={onRefresh}>{text('重新检查状态', 'Check status again')}</button>}
      <button type="button" className="qx-btn qx-btn--ghost" onClick={onCancel}>{text('取消', 'Cancel')}</button>
    </div>
    {readyCount === 0 && <p className="qx-meta">{text('目前没有可用于本次操作的已就绪资料。', 'No documents are ready for this operation yet.')}</p>}
  </section>
}
