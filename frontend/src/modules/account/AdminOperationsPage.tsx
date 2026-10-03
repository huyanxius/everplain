import { useEffect, useRef, useState } from 'react'
import { Select } from '../../ui/Select'
import { accountManagementApi } from './accountManagementApi'
import './admin-operations.css'

const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function AdminOperationsPage({ onForbidden, onSessionExpired }: { onForbidden?(): void; onSessionExpired?(): void }) {
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('high')
  const [providerBaseUrl, setProviderBaseUrl] = useState('')
  const [status, setStatus] = useState('正在读取服务器配置…')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    let active = true
    if (!accountManagementApi.getRuntimeSettings) { setStatus('当前版本未接入真实配置接口'); return }
    accountManagementApi.getRuntimeSettings().then(settings => {
      if (!active) return
      setModel(settings.model); setReasoningEffort(settings.reasoningEffort); setProviderBaseUrl(settings.providerBaseUrl); setStatus('配置来自当前服务')
    }).catch((error: unknown) => {
      if (!active) return
      if (typeof error === 'object' && error && 'status' in error) { if (error.status === 401) onSessionExpired?.(); if (error.status === 403) onForbidden?.() }
      setFailed(true); setStatus('无法读取服务器配置')
    })
    return () => { active = false }
  }, [onForbidden, onSessionExpired])

  async function save() {
    if (!accountManagementApi.updateRuntimeSettings || savingRef.current) return
    savingRef.current = true; setSaving(true); setFailed(false); setStatus('正在写入配置并重载服务…')
    try {
      await accountManagementApi.updateRuntimeSettings({ model: model.trim(), reasoningEffort })
      setStatus('已写入服务器配置，服务正在重载')
    } catch (error) {
      if (typeof error === 'object' && error && 'status' in error) { if (error.status === 401) onSessionExpired?.(); if (error.status === 403) onForbidden?.() }
      setFailed(true); setStatus('写入失败，服务器配置未改变')
    } finally { savingRef.current = false; setSaving(false) }
  }

  return <article className="ep-runtime-settings">
    <header className="ep-runtime-settings__head"><h1 className="qx-section-title">模型调用配置</h1><p className="qx-meta">修改当前 Everplain 服务实际使用的模型与思考强度。</p></header>
    <section aria-labelledby="runtime-config-title">
      <header className="ep-runtime-settings__section-head"><h2 className="qx-heading" id="runtime-config-title">当前服务器配置</h2></header>
      <form className="qx-card ep-runtime-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="ep-runtime-row"><span className="ep-runtime-row__label">调用地址</span><div className="ep-runtime-row__control"><p className="ep-runtime-address">{providerBaseUrl || '读取中…'}</p><p className="qx-meta">由服务端提供，此处只读。</p></div></div>
        <label className="ep-runtime-row"><span className="ep-runtime-row__label">切换模型 ID</span><div className="ep-runtime-row__control"><input className="qx-input" value={model} onChange={event => setModel(event.target.value)} placeholder="例如 gpt-5.6-sol" required /><p className="qx-meta">填写服务提供方支持的完整模型 ID。</p></div></label>
        <label className="ep-runtime-row"><span className="ep-runtime-row__label">思考强度</span><div className="ep-runtime-row__control"><Select aria-label="思考强度" value={reasoningEffort} onChange={setReasoningEffort} options={efforts.map(effort => ({ value: effort, label: effort }))} /></div></label>
        <footer className="ep-runtime-form__footer"><p className="qx-meta">保存后将重新加载服务配置。下一次请求将使用新配置。</p><button className="qx-btn qx-btn--primary" type="submit" disabled={saving || !model.trim()}>{saving ? '正在应用…' : '应用并重载服务'}</button></footer>
      </form>
      <p className={failed ? 'qx-notice qx-notice--danger' : 'qx-meta ep-runtime-status'} role={failed ? 'alert' : 'status'}>{status}</p>
    </section>
  </article>
}
