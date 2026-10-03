import './agent-soul-editor.css'
import { agentAvatarPresets } from '../agent-avatar'
import { settingsSpeakingStyles, useAgentSettingsController } from './useAgentSettingsController'

export function AgentSoulEditor({ flow, text }: {
  flow: ReturnType<typeof useAgentSettingsController>
  text(zh: string, en: string): string
}) {
  if (!flow.draft) return null
  const latestStyle = settingsSpeakingStyles.find(style => style.id === flow.conflict?.speaking_style)
  const latestAvatar = agentAvatarPresets.find(avatar => avatar.id === flow.conflict?.avatar_id)
  return <div className="ep-soul-editor">
    <label className="ep-soul-editor__field"><span>{text('人格描述（Markdown）', 'Soul description (Markdown)')}</span>
      <textarea className="qx-textarea" rows={7} maxLength={8000} disabled={flow.pending} value={flow.draft.soul}
        placeholder={text('例如：你是我的阅读伙伴。先听我说完，再提出不同解释；有疑问时坦诚说明。', 'For example: Be my reading companion. Listen first, offer alternative explanations, and be honest about uncertainty.')}
        onChange={event => flow.patch({ soul: event.target.value })} />
    </label>
    <p className="qx-meta">{text('用自己的话写身份、交流方式、偏好与边界。支持 Markdown；上面的风格只是起点。', 'Describe identity, communication, preferences and boundaries in your own words. Markdown is supported; styles above are starting points.')}</p>
    {flow.conflict ? <div role="alert" className="qx-notice">
      <p>{text('另一处已保存了新版本。你的草稿仍在编辑框内，先核对下面的最新档案。', 'A new version was saved elsewhere. Your draft remains in the editor; review the latest profile below.')}</p>
      <dl><dt>{text('最新身份与风格', 'Latest identity and style')}</dt><dd>{flow.conflict.name} · {latestAvatar?.name} · {flow.conflict.color} · {latestStyle ? text(latestStyle.zh, latestStyle.en) : ''}</dd>
        <dt>{text('最新人格描述', 'Latest Soul description')}</dt><dd className="ep-soul-editor__latest">{flow.conflict.soul_text || text('未填写', 'Empty')}</dd></dl>
      <button className="qx-btn qx-btn--secondary" type="button" disabled={flow.pending} onClick={flow.keepDraft}>{text('保留我的修改继续编辑', 'Keep my edits and continue')}</button>
      <button className="qx-btn qx-btn--ghost" type="button" disabled={flow.pending} onClick={flow.requestCancel}>{text('采用最新版本', 'Use latest version')}</button>
    </div> : null}
    {flow.cancelRequested ? <div className="qx-notice">
      <p>{text('放弃当前未保存的修改，恢复已保存的档案？', 'Discard unsaved edits and restore the saved profile?')}</p>
      <button className="qx-btn qx-btn--secondary" type="button" onClick={flow.discard}>{text('放弃未保存的修改', 'Discard unsaved edits')}</button>
      <button className="qx-btn qx-btn--ghost" type="button" onClick={flow.resumeEditing}>{text('继续编辑', 'Keep editing')}</button>
    </div> : <button className="qx-btn qx-btn--ghost" type="button" disabled={flow.pending} onClick={flow.requestCancel}>{text('取消修改', 'Cancel edits')}</button>}
  </div>
}
