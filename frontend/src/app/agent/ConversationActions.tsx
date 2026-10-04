import { usePresence } from '../../ui/usePresence'
import { DotsThreeIcon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** 标题栏仅保留一个入口；业务动作和权限仍由调用页提供。 */
export function ConversationActions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const motion = usePresence(open, panel)
  const id = useId()
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <div className="cv-actions" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <button type="button" ref={trigger} className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><DotsThreeIcon aria-hidden="true" /></button>
    {motion.present && <div data-motion-surface="popover" {...motion.props} id={id} ref={panel} className="qx-menu cv-actions__menu" role="group" aria-label={label} onClick={event => {
      if ((event.target as Element).closest('button,a')) setOpen(false)
    }}>{children}</div>}
  </div>
}
