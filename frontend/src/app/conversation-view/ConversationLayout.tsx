import { useRef, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useApplicationMobileHeader } from '../application-frame/useApplicationMobileHeader'
import { useComposerDock } from './useComposerDock'
import type { ComposerOrigin } from './homeSubmission'
import './conversation-layout.css'

type ConversationLayoutProps = {
  embedded: boolean
  empty: boolean
  composerOrigin?: ComposerOrigin
  research: boolean
  runtimeMode: string
  sourceOpen: boolean
  sourceClosing?: boolean
  sourceMotionRef?: Ref<HTMLDivElement>
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
  const composerRef = useRef<HTMLDivElement>(null)
  useComposerDock(composerRef, props.empty, props.composerOrigin)
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
        <div ref={composerRef} className="cv-layout__compose">{props.composer}</div>
      </div>
    </div>
    {props.sourceOpen && <div ref={props.sourceMotionRef} className="cv-layout__source" data-motion-surface="drawer" data-presence={props.sourceClosing ? 'closing' : 'open'} inert={props.sourceClosing} aria-hidden={props.sourceClosing || undefined}>{props.source}</div>}
    {props.dialogs}
  </section>
}
