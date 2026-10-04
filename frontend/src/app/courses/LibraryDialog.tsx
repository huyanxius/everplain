import { useEffect, useId, useRef, type ReactNode } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { useAnimatedDismiss } from '../../ui/usePresence'

export function LibraryDialog({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const motion = useAnimatedDismiss(ref, onClose)
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.showModal()
    return () => { if (trigger?.isConnected && trigger !== document.body) trigger.focus(); else document.querySelector<HTMLButtonElement>('[aria-label^="切换知识库"]')?.focus() }
  }, [])
  return <dialog ref={ref} className="qx-modal ep-library__dialog" data-motion-surface="modal" {...motion.props} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) motion.dismiss() }}>
    <header className="ep-library__dialog-head"><h2 id={titleId} className="qx-section-title">{title}</h2><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`关闭${title}`} disabled={busy} onClick={motion.dismiss}><XIcon /></button></header>
    {children}
  </dialog>
}
