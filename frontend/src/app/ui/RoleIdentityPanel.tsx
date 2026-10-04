import { FingerprintIcon, BrainIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { AgentSoulEditor, settingsAgentColors, settingsSpeakingStyles, useAgentSettingsController } from '../../modules/account'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { ResearchMemoryPanel } from '../research/ResearchMemoryPanel'
import { usePresence } from '../../ui/usePresence'
import './role-identity-panel.css'

export type RoleIdentityTab = 'identity' | 'memory'
export interface RoleIdentityPanelProps {
  open: boolean
  onClose(): void
  userId: string
  accountName?: string
  initialTab?: RoleIdentityTab
}

/** Keep mounted in the shell: dismissed drawers retain unsaved edits. */
export function RoleIdentityPanel(props: RoleIdentityPanelProps) {
  const [visited, setVisited] = useState(props.open)
  useEffect(() => { if (props.open) setVisited(true) }, [props.open])
  return visited || props.open ? <RoleIdentityPanelContent key={props.userId} {...props} /> : null
}

function RoleIdentityPanelContent({ open, onClose, userId, accountName, initialTab = 'identity' }: RoleIdentityPanelProps) {
  const { text } = useAppLocale()
  const flow = useAgentSettingsController(userId, text)
  const { draft } = flow
  const [tab, setTab] = useState<RoleIdentityTab>(initialTab)
  const [memoryVisited, setMemoryVisited] = useState(initialTab === 'memory')
  const boundary = useRef<HTMLDialogElement>(null)
  const motion = usePresence(open, boundary)
  const id = useId()

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    if (initialTab === 'memory') setMemoryVisited(true)
  }, [open, initialTab])

  useEffect(() => {
    if (!motion.present) return
    const dialog = boundary.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    if (dialog && !dialog.open) dialog.showModal()
    dialog?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [motion.present])

  function selectTab(next: RoleIdentityTab) {
    setTab(next)
    if (next === 'memory') setMemoryVisited(true)
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'identity' : event.key === 'End' ? 'memory' : tab === 'identity' ? 'memory' : 'identity'
    selectTab(next)
    document.getElementById(`${id}-${next}-tab`)?.focus()
  }

  const avatar = draft?.avatar ?? agentAvatarPresets.find(preset => preset.id === flow.profile.data?.avatar_id)?.id ?? 'cheng'
  const displayName = draft?.name.trim() || flow.profile.data?.name || text('我的 AI 伙伴', 'My AI companion')
  return <dialog ref={boundary} className="ep-role-panel" data-motion-surface="drawer" {...motion.props} aria-label={text('AI 伙伴', 'AI companion')} tabIndex={-1}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <div className="ep-role-panel__surface">
      <header className="ep-role-panel__top"><span>{text('我的 AI 伙伴', 'My AI companion')}</span><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={text('关闭角色面板', 'Close companion panel')} onClick={onClose}><XIcon aria-hidden="true" /></button></header>
      <div className="ep-role-panel__identity">
        <div className="ep-role-panel__portrait"><AgentAvatar avatar={avatar} color={draft?.color ?? flow.profile.data?.color} size={56} state="greet" playing={open} label={text('角色预览', 'Character preview')} /></div>
        <h2>{displayName}</h2>
        <p>{accountName ? text(`${accountName} 的 AI 伙伴`, `${accountName}’s AI companion`) : text('为你整理知识，一起探索想法', 'Organize knowledge and explore ideas together')}</p>
      </div>
      <div className="ep-role-panel__tabs" role="tablist" aria-label={text('伙伴设置', 'Companion settings')}>
        {(['identity', 'memory'] as const).map(value => <button key={value} id={`${id}-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={tabKey}>{value === 'identity' ? <FingerprintIcon aria-hidden="true" /> : <BrainIcon aria-hidden="true" />}{value === 'identity' ? text('Soul · 人格', 'Soul') : text('Memory · 记忆', 'Memory')}</button>)}
      </div>
      <div className="ep-role-panel__body">
        <section id={`${id}-identity-panel`} role="tabpanel" aria-labelledby={`${id}-identity-tab`} hidden={tab !== 'identity'}>
          {!draft ? flow.profile.isError ? <div role="alert"><p>{text('暂时无法读取角色身份。', 'Could not load your companion.')}</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => void flow.profile.refetch()}>{text('重试', 'Try again')}</button></div> : <p role="status">{text('正在读取角色身份…', 'Loading your companion…')}</p> : <form id={`${id}-form`} className="ep-role-panel__form" noValidate onSubmit={event => void flow.save(event)}>
            <fieldset disabled={flow.pending} className="ep-role-panel__field"><legend>{text('角色形象', 'Character')}</legend><div className="ep-role-panel__avatars">
              {agentAvatarPresets.map(preset => <button className="ep-role-panel__avatar" key={preset.id} type="button" aria-label={preset.name} aria-pressed={draft.avatar === preset.id} onClick={() => flow.patch({ avatar: preset.id, color: preset.color })}><AgentAvatar avatar={preset.id} color={draft.avatar === preset.id ? draft.color : preset.color} size={36} playing={false} /><span>{preset.name}</span></button>)}
            </div></fieldset>
            <fieldset disabled={flow.pending} className="ep-role-panel__field"><legend>{text('角色颜色', 'Color')}</legend><div className="ep-role-panel__colors">
              {settingsAgentColors.map(color => <button key={color} type="button" aria-label={`${text('颜色', 'Color')} ${color}`} aria-pressed={draft.color.toLowerCase() === color.toLowerCase()} onClick={() => flow.patch({ color })}><span aria-hidden="true" style={{ background: color }} /></button>)}
            </div></fieldset>
            <label className="ep-role-panel__field"><span>{text('名字', 'Name')}</span><input className="qx-input" value={draft.name} maxLength={40} disabled={flow.pending} onChange={event => flow.patch({ name: event.target.value })} /></label>
            <fieldset disabled={flow.pending} className="ep-role-panel__field"><legend>{text('说话方式', 'Speaking style')}</legend><div className="ep-role-panel__styles">
              {settingsSpeakingStyles.map(style => <button className="qx-btn qx-btn--secondary" key={style.id} type="button" aria-pressed={draft.style === style.id} onClick={() => flow.patch({ style: style.id })}>{text(style.zh, style.en)}</button>)}
            </div></fieldset>
            <AgentSoulEditor flow={flow} text={text} />
            {flow.error ? <p className="qx-notice qx-notice--danger" role="alert">{flow.error}</p> : null}
          </form>}
        </section>
        <section id={`${id}-memory-panel`} role="tabpanel" aria-labelledby={`${id}-memory-tab`} hidden={tab !== 'memory'}>{memoryVisited ? <ResearchMemoryPanel taskId={null} /> : null}</section>
      </div>
      {tab === 'identity' && draft ? <footer className="ep-role-panel__save"><span className="qx-meta" role={flow.saved ? 'status' : undefined}>{flow.saved ? text('已保存', 'Saved') : text('关闭后保留草稿', 'Draft stays when closed')}</span><button className="qx-btn qx-btn--primary" type="submit" form={`${id}-form`} disabled={flow.pending || !!flow.conflict}>{flow.pending ? text('正在保存…', 'Saving…') : text('保存角色', 'Save identity')}</button></footer> : null}
    </div>
  </dialog>
}
