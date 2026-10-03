import { CircleNotchIcon } from '@phosphor-icons/react'
import { Link, useInRouterContext } from 'react-router'
import type { ConversationAction, ConversationHandoff as Handoff } from './types'

export function ConversationActionControl({ action }: { action: ConversationAction }) {
  const inRouter = useInRouterContext()
  const className = `qx-btn ${action.primary ? 'qx-btn--primary' : 'qx-btn--ghost'}`
  const content = <>{action.busy ? <CircleNotchIcon className="cv-spin" aria-hidden="true" /> : action.icon}{action.label}</>
  if (action.href !== undefined && !action.external && action.href.startsWith('/') && inRouter) return <Link className={className} to={action.href} aria-disabled={action.disabled || action.busy || undefined} onClick={event => { if (action.disabled || action.busy) event.preventDefault() }}>{content}</Link>
  if (action.href !== undefined) return <a className={className} href={action.disabled || action.busy ? undefined : action.href} aria-disabled={action.disabled || action.busy || undefined} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>{content}</a>
  return <button className={className} type="button" disabled={action.disabled || action.busy} onClick={action.onClick}>{content}</button>
}

export function ConversationHandoffCard({ handoff }: { handoff: Handoff }) {
  return <section className="cv-handoff" aria-label={handoff.label || handoff.eyebrow || handoff.title}>
    {handoff.eyebrow ? <p className="qx-meta">{handoff.eyebrow}</p> : null}
    <h2 className="qx-card__title">{handoff.title}</h2>
    {handoff.description ? <p>{handoff.description}</p> : null}
    {handoff.fields?.length ? <dl>{handoff.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl> : null}
    {handoff.actions?.length ? <div className="cv-handoff__actions">{handoff.actions.map(action => <ConversationActionControl key={action.id} action={action} />)}</div> : null}
  </section>
}
