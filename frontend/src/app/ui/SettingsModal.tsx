import { XIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import './settings-modal.css'

/** Native focus boundary around the Mock's header-and-content dialog surface. */
export function SettingsModal({ children, onClose, userId, accountName }: {
  children: ReactNode
  onClose(): void
  userId?: string
  accountName?: string
}) {
  const boundary = useRef<HTMLDialogElement>(null)
  const { text } = useAppLocale()
  useEffect(() => {
    const dialog = boundary.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog?.showModal()
    dialog?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  function dismiss() {
    if (!boundary.current?.querySelector('[role="dialog"][aria-modal="true"]')) onClose()
  }

  return <dialog
    className="ep-settings-dialog"
    ref={boundary}
    tabIndex={-1}
    aria-label={text('账户设置', 'Account settings')}
    onCancel={event => { event.preventDefault(); dismiss() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dismiss()
    }}
  >
    <div className="qx-modal ep-settings-dialog__surface">
      <header className="ep-settings-dialog__heading">
        {userId ? <SettingsIdentity userId={userId} accountName={accountName} /> : <span className="qx-heading">{accountName || text('账户', 'Account')}</span>}
        <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('关闭账户设置', 'Close account settings')} onClick={dismiss}><XIcon aria-hidden="true" /></button>
      </header>
      <div className="ep-settings-dialog__content">{children}</div>
    </div>
  </dialog>
}

function SettingsIdentity({ userId, accountName }: { userId: string; accountName?: string }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, staleTime: 30_000 })
  const avatar = agentAvatarPresets.find(preset => preset.id === profile.data?.avatar_id) ?? agentAvatarPresets[0]
  const name = profile.data?.name.trim() || accountName || 'Agent'
  return <div className="ep-settings-dialog__identity">
    <AgentAvatar avatar={avatar.id} color={profile.data?.color} size={40} state="idle" />
    <div><strong>{name}</strong>{accountName && accountName !== name ? <small className="qx-meta">{accountName}</small> : null}</div>
  </div>
}
