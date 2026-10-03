import { useEffect, useId, useRef, type MutableRefObject, type ReactNode } from 'react'

type ConfirmationProps = {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  pendingLabel?: string
  pending: boolean
  confirmDisabled?: boolean
  tone?: 'default' | 'danger'
  error?: string | null
  triggerRef: MutableRefObject<HTMLElement | null>
  children?: ReactNode
  onCancel(): void
  onConfirm(): void
}

/** Shared account confirmation, with its own keyboard boundary and trigger restoration. */
export function AccountConfirmationDialog({
  title, description, confirmLabel, cancelLabel = '取消', pendingLabel = '正在处理…',
  pending, confirmDisabled = false, tone = 'default', error, triggerRef, children,
  onCancel, onConfirm,
}: ConfirmationProps) {
  const titleId = useId()
  const descriptionId = useId()
  const surface = useRef<HTMLElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const interaction = useRef({ pending, onCancel })

  useEffect(() => { interaction.current = { pending, onCancel } }, [pending, onCancel])
  useEffect(() => {
    const trigger = triggerRef.current
    cancelButton.current?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!interaction.current.pending) interaction.current.onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) { event.preventDefault(); surface.current?.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (trigger?.isConnected) trigger.focus()
    }
  }, [triggerRef])

  return (
    <div className="ep-account-confirmation">
      <section className="qx-modal ep-account-confirmation__surface" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} ref={surface} tabIndex={-1}>
        <header><h2 className="qx-section-title" id={titleId}>{title}</h2></header>
        <div className="ep-account-confirmation__body">
          <p className="qx-meta" id={descriptionId}>{description}</p>
          {children}
          {error ? <p className="qx-notice qx-notice--danger" role="alert">{error}</p> : null}
        </div>
        <footer className="ep-settings-actions">
          <button className="qx-btn qx-btn--secondary" type="button" disabled={pending} ref={cancelButton} onClick={onCancel}>{cancelLabel}</button>
          <button className={`qx-btn ${tone === 'danger' ? 'qx-btn--danger' : 'qx-btn--primary'}`} type="button" disabled={pending || confirmDisabled} onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</button>
        </footer>
      </section>
    </div>
  )
}
