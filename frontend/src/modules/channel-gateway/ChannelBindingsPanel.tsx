import { PageLoading } from '../../ui/PageLoading'
import { useRef, useState } from 'react'
import { Select } from '../../ui/Select'
import type { ChannelBinding, ChannelGatewayApi } from './channelGatewayApi'
import { useChannelBindings } from './useChannelBindings'
import './channel-bindings.css'

type Props = { userId: string; text(zh: string, en: string): string; api?: ChannelGatewayApi }

export function ChannelBindingsPanel(props: Props) {
  return <OwnerChannelBindingsPanel key={props.userId} {...props} />
}

function OwnerChannelBindingsPanel({ userId, text, api }: Props) {
  const c = useChannelBindings(userId, api)
  const [confirm, setConfirm] = useState<ChannelBinding | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const target = c.gateways.find(item => item.gateway_id === c.selected)
  function closeConfirmation() { setConfirm(null); trigger.current?.focus() }
  const errors = {
    load: text('暂时无法读取聊天平台，请重试。', 'Chat platforms could not be loaded. Try again.'),
    session: text('登录已过期，请重新登录。', 'Your session expired. Sign in again.'),
    mutation: text('操作结果尚未确认。请刷新绑定状态后再操作。', 'The result is not confirmed. Refresh binding status before trying again.'),
    clipboard: text('未能写入剪贴板，请手动选中并复制下面的命令。', 'Clipboard access failed. Select and copy the command below.'),
  }
  const messages = {
    bound: text('已确认绑定成功，可以去平台私聊了。', 'Binding confirmed. You can now chat privately on the platform.'),
    revoked: text('已解除绑定，尚未发送的私人回复将停止投递。', 'Binding revoked. Pending private replies will be stopped.'),
    cancelled: text('绑定码已作废。', 'The binding code has been cancelled.'),
    copied: text('命令已复制。只发送给你选择的机器人私聊。', 'Command copied. Send it only to your selected bot in a private chat.'),
    expired: text('绑定码已过期，请重新生成。', 'The binding code expired. Generate a new one.'),
  }
  if (c.loading) return <PageLoading message={text('正在读取聊天平台…', 'Loading chat platforms…')} />
  return <div className="ep-channel-bindings">
    <p className="qx-meta">{text('在飞书或 Telegram 私聊中使用你的 Everplain Agent。群聊和附件暂未开放。', 'Use your Everplain Agent in Feishu or Telegram private chats. Groups and attachments are not supported yet.')}</p>
    {c.error ? <p className="qx-notice qx-notice--danger" role="alert">{errors[c.error]}</p> : null}
    {c.feedback ? <p className="qx-notice" role="status">{messages[c.feedback]}</p> : null}
    {c.gateways.length ? <section className="ep-channel-bindings__connect" aria-label={text('绑定聊天平台', 'Connect a chat platform')}>
      <label className="ep-channel-bindings__field"><span>{text('选择机器人', 'Choose a bot')}</span><Select aria-label={text('选择机器人', 'Choose a bot')} value={c.selected} disabled={Boolean(c.pending)} options={c.gateways.map(item => ({ value: item.gateway_id, label: item.name }))} onChange={c.choose} /></label>
      {target ? <p className="qx-meta ep-channel-bindings__identity">{target.gateway_id}</p> : null}
      <label className="ep-channel-bindings__consent"><input type="checkbox" checked={c.consent} disabled={Boolean(c.pending)} onChange={event => c.setConsent(event.target.checked)} /><span>{text('我理解私聊可能使用我的个人记忆与有权限的资料，回答会发送到所选平台，并按现有 Everplain 用量计费。', 'I understand private chats may use my personal memory and authorized sources, send answers to the selected platform, and count toward my existing Everplain usage.')}</span></label>
      {c.grant ? <div className="ep-channel-bindings__grant">
        <label className="ep-channel-bindings__field"><span>{text('在机器人私聊发送这条命令', 'Send this command in the bot’s private chat')}</span><input className="qx-input" aria-label={text('一次性绑定命令', 'One-time binding command')} value={`/bind ${c.grant.code}`} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
        <p className="qx-meta">{text(`剩余 ${Math.floor(c.remaining / 60)} 分 ${c.remaining % 60} 秒，只可使用一次。不要转发给他人。`, `${Math.floor(c.remaining / 60)}m ${c.remaining % 60}s remaining. Single use only. Do not share it.`)}</p>
        <div className="ep-channel-bindings__actions"><button className="qx-btn qx-btn--secondary" type="button" onClick={() => { void c.copyCode() }} disabled={Boolean(c.pending)}>{text('复制命令', 'Copy command')}</button>{target?.bot_url ? <a className="qx-btn qx-btn--secondary" href={target.bot_url} target="_blank" rel="noopener noreferrer">{text('打开机器人私聊', 'Open bot private chat')}</a> : null}<button className="qx-btn qx-btn--ghost" type="button" onClick={c.cancelCode} disabled={Boolean(c.pending)}>{c.pending === 'cancel' ? text('正在作废…', 'Cancelling…') : text('作废绑定码', 'Cancel code')}</button></div>
        {!target?.bot_url ? <p className="qx-meta">{text('管理员还没有设置机器人入口，请在平台中打开上述机器人；不要把绑定码发到群里。', 'An administrator has not set the bot link. Open the bot shown above on the platform; never send the code in a group.')}</p> : null}
        <p className="qx-meta">{text('此页会自动确认绑定状态。关闭页面只隐藏命令；需要立即失效时，请点“作废绑定码”。', 'This page checks binding status automatically. Closing it only hides the command; use “Cancel code” to invalidate it immediately.')}</p>
      </div> : <button className="qx-btn qx-btn--primary" type="button" disabled={!c.consent || Boolean(c.pending) || c.error === 'session'} onClick={c.generate}>{c.pending === 'generate' ? text('正在生成…', 'Generating…') : text('生成一次性绑定码', 'Generate one-time code')}</button>}
    </section> : !c.error ? <p className="qx-notice">{text('聊天平台尚未启用。管理员配置官方机器人后，入口会显示在这里。', 'Chat platforms are not enabled yet. Configured official bots will appear here.')}</p> : null}
    <section aria-label={text('已绑定账号', 'Linked accounts')} className="ep-channel-bindings__connected">
      <header className="ep-channel-bindings__actions"><h3 className="qx-heading">{text('已绑定账号', 'Linked accounts')}</h3><button className="qx-btn qx-btn--ghost" type="button" disabled={Boolean(c.pending)} onClick={c.refresh}>{text('刷新状态', 'Refresh status')}</button></header>
      {!c.bindings.length ? <p className="qx-meta">{text('还没有绑定的聊天账号。', 'No chat accounts are linked.')}</p> : <ul className="ep-channel-bindings__list">{c.bindings.map(binding => <li key={binding.binding_id}>
        <div><strong>{c.gateways.find(item => item.gateway_id === binding.gateway_id)?.name ?? binding.gateway_id}</strong><p className="qx-meta">{text('平台账号', 'Platform account')}: {binding.subject_id}</p><time className="qx-meta" dateTime={new Date(binding.created_at * 1000).toISOString()}>{new Date(binding.created_at * 1000).toLocaleString()}</time></div>
        <button className="qx-btn qx-btn--secondary" type="button" disabled={Boolean(c.pending)} aria-expanded={confirm?.binding_id === binding.binding_id} onClick={event => { trigger.current = event.currentTarget; setConfirm(binding) }}>{text('解除绑定', 'Unlink')}</button>
        {confirm?.binding_id === binding.binding_id ? <div className="ep-channel-bindings__confirm" role="group" aria-label={text('确认解除绑定', 'Confirm unlink')} onKeyDown={event => { if (event.key === 'Escape' && !c.pending) { event.stopPropagation(); closeConfirmation() } }}><p className="qx-meta">{text('解除后此账号不能继续使用你的 Agent，该平台未使用的绑定码也会作废。已发送的内容不会撤回。', 'This account will lose access to your Agent and unused codes for this bot will expire. Already sent messages cannot be recalled.')}</p><div className="ep-channel-bindings__actions"><button className="qx-btn qx-btn--secondary" type="button" disabled={Boolean(c.pending)} onClick={closeConfirmation}>{text('取消', 'Cancel')}</button><button className="qx-btn qx-btn--danger" type="button" disabled={Boolean(c.pending)} onClick={() => c.revoke(binding.binding_id, () => setConfirm(null))}>{c.pending === 'revoke' ? text('正在解除…', 'Unlinking…') : text('确认解除', 'Confirm unlink')}</button></div></div> : null}
      </li>)}</ul>}
    </section>
  </div>
}
