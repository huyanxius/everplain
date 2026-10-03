import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApplicationMobileHeader } from '../application-frame/useApplicationMobileHeader'
import './conversation-layout.css'

type ConversationLayoutProps = {
  embedded: boolean
  empty: boolean
  research: boolean
  runtimeMode: string
  sourceOpen: boolean
  title: string
  label: string
  modes: ReactNode
  actions: ReactNode
  pet: ReactNode
  companionBar?: ReactNode
  prompt: string
  thread: ReactNode
  composer: ReactNode
  source?: ReactNode
  dialogs?: ReactNode
  history?: ReactNode
}

export function ConversationLayout(props: ConversationLayoutProps) {
  const headerTarget = useApplicationMobileHeader()
  const mobileHeader = !props.embedded ? headerTarget : null
  return <section className="cv-layout" data-runtime-mode={props.runtimeMode} data-empty={props.empty} data-embedded={props.embedded} data-research={props.research} data-source={props.sourceOpen} aria-label={props.label} role={props.embedded ? 'complementary' : undefined}>
    <div className="cv-layout__main">
      {mobileHeader ? createPortal(<><div className="cv-layout__mobile-modes">{props.modes}</div><div className="cv-layout__mobile-actions">{props.history}{props.actions}</div></>, mobileHeader) : <header className="cv-layout__top">
        <div className="cv-layout__identity">{!props.empty && <h1 className="qx-chat-title">{props.title}</h1>}{props.history}</div>
        {props.modes}
        <div className="cv-layout__actions">{props.actions}</div>
      </header>}
      {mobileHeader && !props.empty ? <h1 className="cv-visually-hidden">{props.title}</h1> : null}
      {!props.research && !props.empty && !props.embedded ? <div className="cv-layout__companion">{props.companionBar}</div> : null}
      <div className="cv-layout__body">
        <div className="cv-layout__scroll" role={props.empty ? undefined : 'log'} aria-label={props.empty ? undefined : '对话内容'}>
          {props.empty ? <div className="cv-layout__greeting">{!props.research ? props.pet : null}<h1 className="qx-display">{props.prompt}</h1></div> : props.thread}
        </div>
        <div className="cv-layout__compose">{props.composer}</div>
      </div>
    </div>
    {props.sourceOpen && <div className="cv-layout__source">{props.source}</div>}
    {props.dialogs}
  </section>
}
