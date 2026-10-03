import { ArrowLeftIcon, FileTextIcon, GlobeIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { citationGroup } from '../../modules/research-agent'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { ConversationToolDetail, ConversationToolStatus } from './ConversationActivity'
import { ConversationActionControl } from './ConversationHandoff'
import type { ConversationSourcePanelProps } from './types'
import './conversation-view.css'

export function ConversationSourcePanel({ detail, activity, citations = [], toolSteps = [], onClose, onBack, onSelectCitation, onSelectActivity }: ConversationSourcePanelProps) {
  const { text } = useAppLocale()
  const panelRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 760px)').matches))
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)')
    if (!media) return
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!mobile) return
    const dialog = dialogRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal?.()
    panelRef.current?.querySelector<HTMLElement>('[data-source-detail], button')?.focus({ preventScroll: true })
    return () => { dialog?.close?.(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [mobile])
  const lastSourceId = useRef<string | null>(null)
  const selectedId = detail?.citation.citation_id
  useEffect(() => {
    if (selectedId) {
      lastSourceId.current = selectedId
      panelRef.current?.querySelector<HTMLElement>('[data-source-detail]')?.focus({ preventScroll: true })
    } else if (!activity && lastSourceId.current) {
      const trigger = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-citation-id]') ?? []).find(node => node.dataset.citationId === lastSourceId.current)
      trigger?.scrollIntoView?.({ block: 'nearest' })
      trigger?.focus({ preventScroll: true })
    }
  }, [selectedId, activity])
  const group = detail ? citationGroup(detail.citation) : null
  const kindLabel = detail?.kindLabel || (group === 'web' ? text('网页', 'Web page') : group === 'material' ? text('上传', 'Upload') : text('知识库资料', 'Library material'))
  const label = detail ? text('引用来源', 'Citation source') : activity ? text('工具活动', 'Tool activity') : text('研究面板', 'Research panel')
  const content = <aside className="qx-panel cv-source-panel" aria-label={label} ref={panelRef} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <header className="cv-source-panel__head">
      <div>
        {(detail || activity) && onBack ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('依据', 'Basis')} title={text('返回研究面板', 'Back to research panel')} onClick={onBack}><ArrowLeftIcon /></button> : null}
        {detail ? <span className="qx-tag">{group === 'web' ? <GlobeIcon /> : <FileTextIcon />}{kindLabel}</span> : <h2 className="qx-heading">{label}</h2>}
      </div>
      <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('关闭研究面板', 'Close research panel')} onClick={onClose}><XIcon /></button>
    </header>
    {detail ? <div className="cv-source-panel__detail" data-source-detail tabIndex={-1} role="region" aria-label={text('依据', 'Basis')}>
      <h2 className="qx-card__title">{detail.citation.label}</h2>
      {detail.topicLabel ? <span className="qx-tag qx-tag--outline cv-source-panel__topic"><i aria-hidden="true" />{detail.topicLabel}</span> : null}
      <blockquote className="cv-source-panel__quote"><p>{detail.citation.deleted ? text('这份研究材料已删除，原文不再可访问。', 'This research material was deleted and its source text is no longer available.') : detail.citation.excerpt || text('本轮 Agent 没有返回可展开的证据摘录。', 'The Agent returned no expandable evidence excerpt for this turn.')}</p></blockquote>
      {detail.unavailableReason ? <p className="qx-meta" role="status">{detail.unavailableReason}</p> : null}
      {detail.locatorLabel ? <p className="qx-meta">{text('引用位置：', 'Source location: ')}{detail.locatorLabel}</p> : null}
      {!detail.citation.deleted && detail.actions?.length ? <div className="cv-source-panel__actions">{detail.actions.map(action => <ConversationActionControl key={action.id} action={action} />)}</div> : null}
    </div> : activity ? <div className="cv-source-panel__activity" role="region" aria-label={text('依据', 'Basis')}>
      <h2 className="qx-card__title">{activity.label}</h2><ConversationToolStatus step={activity} /><ConversationToolDetail step={activity} />
    </div> : <div className="cv-source-panel__list" role="region" aria-label={text('研究面板', 'Research panel')}>
      {(['knowledge', 'web', 'material'] as const).map(kind => {
        const items = citations.filter(citation => citationGroup(citation) === kind)
        const title = kind === 'knowledge' ? text('知识库', 'Knowledge base') : kind === 'web' ? text('网页', 'Web pages') : text('用户文件', 'Your files')
        return <section key={kind} role="group" aria-label={title}><h3>{title}<span>{items.length}</span></h3>{items.length ? <ol className="cv-source-panel__rows">{items.map(citation => <li key={citation.citation_id}>{onSelectCitation ? <button className="qx-btn qx-btn--ghost" type="button" data-citation-id={citation.citation_id} aria-label={`${citations.indexOf(citation) + 1} ${citation.label}`} onClick={() => onSelectCitation(citation)}><span className="cv-source-number">{citations.indexOf(citation) + 1}</span><span>{citation.label}<span className="qx-meta cv-source-panel__result">{kind === 'knowledge' ? text('知识库资料', 'Library material') : kind === 'material' ? text('研究材料', 'Research material') : text('网页', 'Web page')}</span></span></button> : <span>{citation.label}</span>}</li>)}</ol> : <p className="qx-meta">{text('本轮暂无来源。', 'No sources for this turn yet.')}</p>}</section>
      })}
      <section role="group" aria-label={text('工作流程', 'Workflow')}><h3>{text('工作流程', 'Workflow')}<span>{toolSteps.length}</span></h3>{toolSteps.length ? <ol className="cv-source-panel__rows">{toolSteps.map(step => <li key={step.id}>{onSelectActivity ? <button className="qx-btn qx-btn--ghost" type="button" onClick={() => onSelectActivity(step)}><span>{step.label}{step.detail && step.detail.length <= 160 ? <span className="qx-meta cv-source-panel__result">{step.detail}</span> : null}{step.resultItems?.map(item => <span className="cv-source-panel__result" key={item.id}>{item.title}</span>)}</span><ConversationToolStatus step={step} /></button> : <div><strong>{step.label}</strong><ConversationToolStatus step={step} /></div>}</li>)}</ol> : <p className="qx-meta">{text('实际工具步骤会出现在这里。', 'Actual tool steps will appear here.')}</p>}</section>
    </div>}
  </aside>
  return mobile ? <dialog ref={dialogRef} className="cv-source-sheet" aria-label={label} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>{content}</dialog> : content
}
