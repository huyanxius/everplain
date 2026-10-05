import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { AvatarPalette } from './AvatarPalette'
import { UserAvatar } from './UserAvatar'
import type { UserAvatarCustom, UserAvatarId } from './avatar-data'
import './avatar-palette.css'

export type AvatarCustomizerProps = {
  id: UserAvatarId
  custom?: UserAvatarCustom
  onChange(custom: UserAvatarCustom): void
  onClose(): void
}

/** Full-screen edition of the prototype palette; every change applies immediately. */
export function AvatarCustomizer({ id, custom, onChange, onClose }: AvatarCustomizerProps) {
  const { text } = useAppLocale()
  const titleId = useId()
  const reducedMotion = useReducedMotion()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const figureRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const pending = useRef(false)
  const [closing, setClosing] = useState(false)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog?.showModal()
    dialog?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!closing) return
    if (reducedMotion) { closeRef.current(); return }
    const timer = window.setTimeout(() => closeRef.current(), 380)
    return () => window.clearTimeout(timer)
  }, [closing, reducedMotion])

  const dismiss = useCallback(() => {
    if (pending.current) return
    pending.current = true
    if (reducedMotion) closeRef.current()
    else setClosing(true)
  }, [reducedMotion])

  function pulse() {
    if (reducedMotion) return
    const figure = figureRef.current
    if (!figure) return
    figure.classList.remove('pulse')
    void figure.offsetWidth
    figure.classList.add('pulse')
  }

  return createPortal(<dialog
    ref={dialogRef}
    className={`cz${closing ? ' out' : ''}`}
    tabIndex={-1}
    aria-labelledby={titleId}
    aria-modal="true"
    inert={closing}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss() }}
    onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }}
  >
    <div className="cz-stage"><div className="cz-halo" aria-hidden="true" /><div className="cz-fig" ref={figureRef}>
      <UserAvatar id={id} custom={custom} variant="resting" size={380} />
    </div></div>
    <aside className="cz-panel">
      <h2 className="cz-title" id={titleId}>{text('定制外观', 'Customize appearance')}</h2>
      <AvatarPalette id={id} custom={custom} onChange={onChange} disabled={closing} onCommit={pulse} />
      <div className="cz-actions">
        <button type="button" className="qx-btn qx-btn--ghost" disabled={closing} onClick={() => { onChange({}); pulse() }}>{text('恢复原样', 'Restore original')}</button>
        <button type="button" className="qx-btn qx-btn--primary qx-btn--lg" disabled={closing} onClick={dismiss}>{text('好了', 'Done')}</button>
      </div>
    </aside>
  </dialog>, document.body)
}
