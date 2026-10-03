import { ArrowRightIcon, DownloadSimpleIcon, FilePdfIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { formatElapsed } from '../../modules/research-agent'
import { ConversationActivity } from './ConversationActivity'
import type { ConversationResearchFlowProps } from './types'
import './conversation-view.css'

export function ConversationResearchFlow({ label: suppliedLabel, confirmLabel, stage, question, options = [], toolSteps = [], elapsedSeconds, progressPercent, phaseSteps, currentPhase, conclusion, knowledgeCount, webCount, busy, error, exportState = 'idle', onChooseIntent, onSkip, onConfirmPlan, onEdit, onExport, onContinueResearch }: ConversationResearchFlowProps) {
  const { text } = useAppLocale()
  const [custom, setCustom] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => { setChosen(null); setCustom(''); setCustomOpen(false) }, [stage, question])
  useEffect(() => { if (error) setChosen(null) }, [error])
  const choose = (value: string) => { if (!onChooseIntent || busy || chosen !== null) return; setChosen(value); onChooseIntent(value) }
  const label = stage === 'clarifying' ? text('确认研究意图', 'Confirm research intent') : stage === 'planning' ? text('研究计划', 'Research plan') : stage === 'completed' ? text('研究结论', 'Research findings') : text('研究进度', 'Research progress')
  return <section className="cv-research-flow" aria-label={suppliedLabel || label}>
    <h2 className="qx-card__title">{question.trim() || label}</h2>
    {stage === 'clarifying' ? <>
      <div className="cv-research-flow__options" role="radiogroup" aria-label={text('研究角度', 'Research angle')}>{options.filter(option => option !== '更多自定义').map(option => onChooseIntent ? <button key={option} className="qx-btn qx-btn--ghost" type="button" role="radio" aria-checked={chosen === option} disabled={busy || chosen !== null} onClick={() => choose(option)}>{option}</button> : <p key={option}>{option}</p>)}</div>
      {onChooseIntent && chosen === null ? <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => setCustomOpen(open => !open)}>{text('更多自定义', 'Add your own')}</button> : null}
      {customOpen && onChooseIntent && chosen === null ? <form className="cv-research-flow__custom" onSubmit={event => { event.preventDefault(); if (custom.trim()) choose(custom.trim()) }}><label>{text('补充方向', 'Add a direction')}<input className="qx-input" value={custom} onChange={event => setCustom(event.target.value)} disabled={busy} /></label><button className="qx-btn qx-btn--primary" type="submit" disabled={busy || !custom.trim()}>{text('继续', 'Continue')}</button></form> : null}
      {onSkip && chosen === null ? <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={() => { setChosen('skip'); onSkip() }}>{text('跳过', 'Skip')}</button> : null}
      {chosen ? <p className="qx-meta" role="status">{text('正在根据你的选择继续讨论。', 'Continuing from your selection.')}</p> : null}
    </> : null}
    {stage === 'planning' ? <><ol className="cv-research-flow__plan">{options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}</ol><div className="cv-research-flow__actions">{onConfirmPlan ? <button className="qx-btn qx-btn--primary" type="button" disabled={busy} onClick={onConfirmPlan}>{confirmLabel || text('开始深入研究', 'Start deep research')}</button> : null}{onEdit ? <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={onEdit}>{text('返回修改', 'Return to edit')}</button> : null}</div></> : null}
    {stage === 'researching' || stage === 'completed' ? <>
      {elapsedSeconds != null ? <p className="qx-meta">{text('用时', 'Elapsed')} {formatElapsed(elapsedSeconds)}</p> : null}
      {progressPercent != null ? <progress className="cv-research-flow__progress" max={100} value={Math.max(0, Math.min(100, progressPercent))} aria-label={text('研究进度', 'Research progress')} /> : null}
      {stage === 'researching' && phaseSteps?.length ? <ol className="cv-research-flow__plan" aria-label={text('研究阶段', 'Research stages')}>{phaseSteps.map((step, index) => <li key={step} aria-current={index === currentPhase ? 'step' : undefined}>{step}</li>)}</ol> : null}
      <ConversationActivity steps={toolSteps} />
      {stage === 'completed' ? <><p className="qx-prose">{conclusion || text('本轮没有可摘录的结论，完整回答见对话正文。', 'No excerpted conclusion was returned; see the full answer in the conversation.')}</p><p className="qx-meta">{knowledgeCount != null ? text(`知识库 ${knowledgeCount} 条`, `${knowledgeCount} library sources`) : null}{knowledgeCount != null && webCount != null ? ' · ' : null}{webCount != null ? text(`网页资料 ${webCount} 条`, `${webCount} web sources`) : null}</p><div className="cv-research-flow__actions">{onExport ? <><button className="qx-btn qx-btn--ghost" type="button" disabled={busy || exportState !== 'idle'} onClick={() => onExport('docx')}><DownloadSimpleIcon />{exportState === 'docx' ? text('正在生成 Word…', 'Generating Word…') : text('下载 Word', 'Download Word')}</button><button className="qx-btn qx-btn--ghost" type="button" disabled={busy || exportState !== 'idle'} onClick={() => onExport('pdf')}><FilePdfIcon />{exportState === 'pdf' ? text('正在生成 PDF…', 'Generating PDF…') : text('下载 PDF', 'Download PDF')}</button></> : null}{onContinueResearch ? <button className="qx-btn qx-btn--primary" type="button" disabled={busy} onClick={onContinueResearch}>{text('继续形成研究', 'Continue into research')}<ArrowRightIcon /></button> : null}</div></> : null}
    </> : null}
    {error ? <p className="cv-turn__notice" data-tone="danger" role="alert">{error}</p> : null}
  </section>
}
