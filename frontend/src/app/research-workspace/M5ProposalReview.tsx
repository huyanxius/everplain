import { CheckIcon, CircleNotchIcon, XIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

import './m5-research-delivery.css'

export type M5Proposal = Readonly<{
  proposalId: string
  status: 'pending' | 'accepted' | 'rejected' | 'aborted'
  kind: 'create' | 'revise_section'
  targetLabel: string
  before: string | null
  after: string
  rationale: string
  decisionReason?: string | null
  provenance: Readonly<{
    releaseLabel: string
    modelLabel: string
    agentRunLabel: string
  }>
}>

type Props = {
  proposal: M5Proposal
  onAccept: (proposalId: string) => Promise<void>
  onReject: (proposalId: string, reason: string) => Promise<void>
}

export function M5ProposalReview({ proposal, onAccept, onReject }: Props) {
  const [busyAction, setBusyAction] = useState<'accept' | 'reject' | null>(null)
  const [result, setResult] = useState<'accepted' | 'rejected' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lockRef = useRef(false)
  const finalStatus = result ?? proposal.status
  const pending = finalStatus === 'pending'

  async function decide(action: 'accept' | 'reject') {
    if (!pending || lockRef.current) return
    const rejectionReason = reason.trim()
    if (action === 'reject' && !rejectionReason) {
      setError('请填写拒绝理由。')
      return
    }
    lockRef.current = true
    setBusyAction(action)
    setError(null)
    try {
      if (action === 'accept') await onAccept(proposal.proposalId)
      else await onReject(proposal.proposalId, rejectionReason)
      setResult(action === 'accept' ? 'accepted' : 'rejected')
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : '处理建议失败，请重试。')
    } finally {
      lockRef.current = false
      setBusyAction(null)
    }
  }

  return <article className="qx-card ep-delivery-proposal" aria-label={`${proposal.targetLabel}修改建议`} aria-busy={busyAction !== null}>
    <header className="ep-delivery-section-head"><div><p className="qx-group-label">Agent 建议 · {proposal.kind === 'create' ? '创建草稿' : '局部修改'}</p><h3 className="qx-card__title">{proposal.targetLabel}</h3></div><span className="qx-tag" data-status={finalStatus}>{{ pending: '等待决定', accepted: '已接受', rejected: '已拒绝', aborted: '生成已中止' }[finalStatus]}</span></header>
    <p className="ep-delivery-proposal__rationale">{proposal.rationale}</p>
    <div className="ep-delivery-proposal__versions"><section aria-label="修改前"><h4 className="qx-group-label">修改前</h4><p>{proposal.before?.trim() || '新建内容，无既有正文。'}</p></section><section aria-label="建议稿"><h4 className="qx-group-label">建议稿</h4><p>{proposal.after}</p></section></div>
    <dl className="ep-delivery-proposal__sources"><div><dt>知识</dt><dd>{proposal.provenance.releaseLabel}</dd></div><div><dt>模型</dt><dd>{proposal.provenance.modelLabel}</dd></div><div><dt>运行</dt><dd>{proposal.provenance.agentRunLabel}</dd></div></dl>
    {pending ? <label className="ep-delivery-proposal__reason"><span className="qx-meta">拒绝理由（必填，将写入审阅记录）</span><textarea className="qx-textarea" required value={reason} onChange={event => setReason(event.target.value)} rows={2} /></label> : null}
    <footer className="ep-delivery-actions"><button type="button" className="qx-btn qx-btn--secondary" disabled={!pending || busyAction !== null || !reason.trim()} onClick={() => void decide('reject')}>{busyAction === 'reject' ? <CircleNotchIcon className="ep-delivery-spin" aria-hidden="true" /> : <XIcon aria-hidden="true" />}拒绝建议</button><button type="button" className="qx-btn qx-btn--primary" disabled={!pending || busyAction !== null} onClick={() => void decide('accept')}>{busyAction === 'accept' ? <CircleNotchIcon className="ep-delivery-spin" aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}接受建议</button></footer>
    <p className="ep-delivery-message" data-error={Boolean(error)} role="status" aria-live="polite">{error ?? (finalStatus === 'accepted' ? '建议已接受，正式文档已生成新版本。' : finalStatus === 'rejected' ? '建议已拒绝，正式文档没有被修改。' : finalStatus === 'aborted' ? proposal.decisionReason || '本次生成未完成，正式文档没有被修改。' : '')}</p>
  </article>
}
