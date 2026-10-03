import { ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { AgentAvatar, agentAvatarPresets } from '../agent-avatar'
import { settingsAgentColors, settingsSpeakingStyles, useAgentSettingsController } from './useAgentSettingsController'

export function AgentSettingsPanel({ userId, active, text, onResetAgent }: {
  userId: string
  active: boolean
  text(zh: string, en: string): string
  onResetAgent?(): void
}) {
  const flow = useAgentSettingsController(userId, text)
  const { draft } = flow

  if (!draft) return <div hidden={!active} className="ep-settings-agent-load">
    {flow.profile.isError ? <div className="qx-notice qx-notice--danger" role="alert">
      <p>{text('暂时无法读取 Agent 设置。', 'Could not load Agent settings.')}</p>
      <button className="qx-btn qx-btn--secondary" type="button" onClick={() => void flow.profile.refetch()}>{text('重试', 'Try again')}</button>
    </div> : <p className="qx-meta" role="status">{text('正在读取 Agent 设置…', 'Loading Agent settings…')}</p>}
  </div>

  return <div hidden={!active}>
    <form className="ep-settings-agent" onSubmit={event => void flow.save(event)} noValidate>
      <div className="ep-settings-agent__visuals">
        <AgentAvatar avatar={draft.avatar} color={draft.color} size={80} state="greet" playing={active} label={text('Agent 预览', 'Agent preview')} />
        <div className="ep-settings-agent__choices">
          <div className="ep-settings-agent__avatars" role="group" aria-label={text('角色', 'Character')}>
            {agentAvatarPresets.map(preset => <button
              className="qx-btn qx-btn--ghost"
              key={preset.id}
              type="button"
              aria-label={preset.name}
              aria-pressed={draft.avatar === preset.id}
              disabled={flow.pending}
              onClick={() => flow.patch({ avatar: preset.id, color: preset.color })}
            ><AgentAvatar avatar={preset.id} color={draft.avatar === preset.id ? draft.color : preset.color} size={32} playing={false} /></button>)}
          </div>
          <div className="ep-settings-agent__colors" role="group" aria-label={text('颜色', 'Color')}>
            {settingsAgentColors.map(color => <button
              className="qx-btn qx-btn--ghost"
              key={color}
              type="button"
              aria-label={`${text('颜色', 'Color')} ${color}`}
              aria-pressed={draft.color.toLowerCase() === color.toLowerCase()}
              disabled={flow.pending}
              onClick={() => flow.patch({ color })}
            ><span aria-hidden="true" style={{ background: color }} /></button>)}
          </div>
        </div>
      </div>
      <label className="ep-settings-agent__field">
        <span>{text('名字', 'Name')}</span>
        <input className="qx-input" value={draft.name} maxLength={40} disabled={flow.pending} onChange={event => flow.patch({ name: event.target.value })} />
      </label>
      <div className="ep-settings-agent__field ep-settings-agent__style">
        <span>{text('说话方式', 'Speaking style')}</span>
        <div className="qx-segmented" role="group" aria-label={text('说话方式', 'Speaking style')}>
          {settingsSpeakingStyles.map(style => <button type="button" key={style.id} aria-pressed={draft.style === style.id} disabled={flow.pending} onClick={() => flow.patch({ style: style.id })}>{text(style.zh, style.en)}</button>)}
        </div>
      </div>
      {flow.error ? <p className="qx-notice qx-notice--danger" role="alert">{flow.error}</p> : null}
      <div className="ep-settings-agent__actions">
        {onResetAgent ? <button className="qx-btn qx-btn--ghost" type="button" disabled={flow.pending} aria-label={text('重新设置我的 AI 伙伴', 'Set up my AI companion again')} onClick={onResetAgent}><ArrowsClockwiseIcon aria-hidden="true" />{text('重新走一遍', 'Repeat setup')}</button> : null}
        {flow.saved ? <span className="qx-meta" role="status">{text('已保存', 'Saved')}</span> : null}
        <button className="qx-btn qx-btn--primary" type="submit" disabled={flow.pending}>{flow.pending ? text('正在保存…', 'Saving…') : text('保存 Agent', 'Save Agent')}</button>
      </div>
    </form>
  </div>
}
