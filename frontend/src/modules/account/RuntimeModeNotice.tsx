import { useEffect, useState } from 'react'
import { getAccountSystemHealth } from './accountManagementApi'
import './runtime-mode-notice.css'

/** Public runtime metadata only; this never changes the account session. */
export function RuntimeModeNotice() {
  const [mode, setMode] = useState<'checking' | 'mock' | 'live' | 'unknown'>('checking')

  useEffect(() => {
    let active = true
    void getAccountSystemHealth().then(
      health => { if (active) setMode(health.runtimeMode === 'mock' ? 'mock' : 'live') },
      () => { if (active) setMode('unknown') },
    )
    return () => { active = false }
  }, [])

  if (mode === 'live') return null
  return <aside className="runtime-mode-notice" role="status" aria-live="polite">
    {mode === 'mock'
      ? <><strong>模型 API 未配置 · 模型响应为模拟</strong><span>只有模型响应为模拟；账号、知识库、文件和业务数据真实保存。未配置的联网搜索不可用，不会生成虚构结果。注册、登录与邮箱验证仍走真实流程；邮件未接通时无法注册。</span></>
      : <span>{mode === 'checking' ? '正在确认模型运行状态…' : '暂时无法确认模型运行状态，请勿将输出视为已验证的真实结果。'}</span>}
  </aside>
}
