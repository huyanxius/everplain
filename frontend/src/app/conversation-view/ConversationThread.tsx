import { ArrowClockwiseIcon, BookmarkSimpleIcon, CaretRightIcon, CheckIcon, CircleNotchIcon, CopyIcon, PencilSimpleLineIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { AgentAvatar } from '../../modules/agent-avatar'
import { citationGroup, displayAgentText } from '../../modules/research-agent'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { AgentAnswerMarkdown } from '../agent/AgentAnswerMarkdown'
import { ConversationActivity } from './ConversationActivity'
import { ConversationHandoffCard } from './ConversationHandoff'
import type { ConversationThreadProps, ConversationTurnView } from './types'
import './conversation-view.css'

function TurnActions({ turn }: { turn: ConversationTurnView }) {
  const { text } = useAppLocale()
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current) } }, [])
  async function copy() {
    if (!turn.onCopy || copyState === 'copying') return
    setCopyState('copying')
    try { await turn.onCopy(displayAgentText(turn.answer)); if (mounted.current) setCopyState('copied') } catch { if (mounted.current) setCopyState('failed') }
    if (!mounted.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 1600)
  }
  if (turn.streaming || !turn.answer || ![turn.onCopy, turn.onRegenerate, turn.onSaveNote, turn.onContinueResearch].some(Boolean)) return null
  const copyLabel = copyState === 'copied' ? text('已复制', 'Copied') : copyState === 'failed' ? text('复制失败', 'Copy failed') : text('复制回答', 'Copy answer')
  return <div className="cv-turn__actions">
    {turn.onCopy ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={copyLabel} title={copyLabel} disabled={turn.actionsDisabled || copyState === 'copying'} onClick={() => { void copy() }}>{copyState === 'copied' ? <CheckIcon /> : copyState === 'failed' ? <XCircleIcon /> : <CopyIcon />}</button> : null}
    {turn.onRegenerate && !turn.interrupted && !turn.failure ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('重新生成', 'Regenerate')} title={text('重新生成', 'Regenerate')} disabled={turn.actionsDisabled} onClick={turn.onRegenerate}><ArrowClockwiseIcon /></button> : null}
    {turn.onSaveNote ? <button className="qx-btn qx-btn--ghost" type="button" disabled={turn.actionsDisabled} onClick={turn.onSaveNote}><BookmarkSimpleIcon />{text('存为笔记', 'Save as note')}</button> : null}
    {turn.onContinueResearch ? <button className="qx-btn qx-btn--ghost" type="button" disabled={turn.actionsDisabled || turn.researchBusy} onClick={turn.onContinueResearch}>{turn.researchBusy ? <CircleNotchIcon className="cv-spin" /> : <PencilSimpleLineIcon />}{text('放进研究', 'Add to research')}</button> : null}
  </div>
}

export function ConversationTurn({ turn, agent, renderAvatar, onSelectCitation, onOpenActivity }: Omit<ConversationThreadProps, 'turns' | 'children' | 'endRef'> & { turn: ConversationTurnView }) {
  const { text } = useAppLocale()
  const steps = turn.toolSteps ?? []
  const avatarState = !turn.streaming ? 'idle' : turn.answer || steps.some(step => step.status === 'running') ? 'work' : 'think'
  const progressEnd = Math.max(0, Math.min(turn.progressEnd ?? 0, turn.answer.length))
  const chooseCitation: Parameters<typeof AgentAnswerMarkdown>[0]['onSelectCitation'] = citation => onSelectCitation(citation, turn.knowledgeReleaseId ?? null, turn.id)
  const completedCount = steps.filter(step => step.status === 'completed').length
  const sources = [
    ['knowledge', text('知识库资料', 'Knowledge library')],
    ['material', text('你的研究材料', 'Your materials')],
    ['web', text('公开网页', 'Public web')],
  ].flatMap(([group, label]) => { const count = turn.citations.filter(citation => !citation.deleted && citationGroup(citation) === group).length; return count ? [`${label} ${count}`] : [] })
  return <article className="cv-turn" data-turn-id={turn.id} data-streaming={turn.streaming || undefined}>
    <div className="cv-turn__question" data-role="user-message"><div className="qx-bubble">{turn.question}</div></div>
    <div className="cv-turn__answer" data-role="assistant-response">
      <div className="cv-turn__avatar">{renderAvatar ? renderAvatar(avatarState, turn.id) : <AgentAvatar avatar={agent?.avatar ?? 'cheng'} color={agent?.color} size={32} state={avatarState} label={agent?.name ?? 'Everplain'} />}</div>
      <div className="cv-turn__body">
        {turn.streaming ? <p className="cv-turn__thinking" role="status">{turn.statusText || text('正在整理回答…', 'Preparing the answer…')}</p> : null}
        <ConversationActivity steps={steps} onOpen={onOpenActivity ? step => onOpenActivity(turn.id, step) : undefined} />
        {turn.answer ? <div className="qx-prose cv-turn__prose">
          {progressEnd ? <AgentAnswerMarkdown citations={turn.citations} onSelectCitation={chooseCitation} progress>{turn.answer.slice(0, progressEnd)}</AgentAnswerMarkdown> : null}
          <AgentAnswerMarkdown citations={turn.citations} onSelectCitation={chooseCitation}>{turn.answer.slice(progressEnd)}</AgentAnswerMarkdown>
        </div> : null}
        {turn.interrupted ? <p className="cv-turn__notice" role="status"><WarningCircleIcon />{turn.notice || text(`本轮已停止，已保留生成内容和 ${completedCount} 个已完成步骤。`, `This turn was stopped. Generated content and ${completedCount} completed steps were retained.`)}</p> : turn.notice ? <p className="cv-turn__notice" role="status">{turn.notice}</p> : null}
        {turn.failure ? <p className="cv-turn__notice" data-tone="danger"><XCircleIcon />{turn.failure}</p> : null}
        {turn.interrupted && !turn.failure && (turn.onResume || turn.onRegenerate) ? <div className="cv-turn__actions"><button className="qx-btn qx-btn--ghost" type="button" disabled={turn.actionsDisabled} onClick={turn.onResume || turn.onRegenerate}><CaretRightIcon />{text('继续研究', 'Continue research')}</button></div> : null}
        {turn.failure && turn.onRegenerate ? <div className="cv-turn__actions"><button className="qx-btn qx-btn--ghost" type="button" disabled={turn.actionsDisabled} onClick={turn.onRegenerate}><ArrowClockwiseIcon />{text('重试本轮', 'Retry this turn')}</button></div> : null}
        {turn.provenance ? <p className="cv-turn__provenance"><WarningCircleIcon />{turn.provenance}</p> : null}
        {sources.length ? <p className="cv-visually-hidden" role="status" aria-label={text('本轮证据来源', 'Evidence sources for this answer')}>{text('本轮引用', 'Cited this turn')} · {sources.join(' · ')}</p> : null}
        {turn.citations.length ? <div className="cv-turn__sources" aria-label={text('回答证据', 'Answer evidence')}>{turn.citations.map((citation, index) => <button className="qx-tag qx-tag--outline" type="button" key={citation.citation_id} aria-label={text(`查看证据：${citation.label}`, `View evidence: ${citation.label}`)} onClick={() => chooseCitation(citation)}><span className="cv-source-number">{index + 1}</span><span className="cv-source-label">{citation.label}</span>{citation.deleted ? <span className="cv-visually-hidden">{text('已删除', 'Deleted')}</span> : null}</button>)}</div> : null}
        {turn.handoffs?.map(handoff => <ConversationHandoffCard key={handoff.id} handoff={handoff} />)}
        <TurnActions turn={turn} />
      </div>
    </div>
  </article>
}

export function ConversationThread({ turns, children, endRef, ...props }: ConversationThreadProps) {
  return <div className="cv-thread">{turns.map(turn => <ConversationTurn key={turn.id} turn={turn} {...props} />)}{children}<div ref={endRef} /></div>
}
