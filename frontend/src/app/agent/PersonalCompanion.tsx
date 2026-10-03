import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { useAppLocale } from '../i18n/AppLocaleProvider'

export function PersonalCompanion({ userId, fallback, compact = false, thinking = false, working = false }: { userId: string | null; fallback: ReactNode; compact?: boolean; thinking?: boolean; working?: boolean }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), staleTime: 30_000 })
  if (!profile.data) return fallback
  const p = profile.data
  const avatar = <AgentAvatar avatar={p.avatar_id as AgentAvatarId} color={p.color} size={compact ? 32 : 96} state={working ? 'work' : thinking ? 'think' : compact ? 'idle' : 'greet'} label={p.name.trim() || 'Everplain'} />
  return compact ? avatar : <div className="cv-companion">{avatar}</div>
}


export function CompanionStatusBar({ userId, status }: { userId: string | null; status: string }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), staleTime: 30_000 })
  const { text } = useAppLocale()
  const busy = ['thinking', 'retrieving', 'answering', 'pausing'].includes(status)
  const labels: Record<string, string> = { idle: text('等待消息', 'Ready'), loading: text('读取对话', 'Loading'), thinking: text('正在思考', 'Thinking'), retrieving: text('查找资料', 'Finding sources'), answering: text('正在回复', 'Writing'), pausing: text('正在暂停', 'Pausing'), 'pause-failed': text('暂停待重试', 'Pause needs retry'), error: text('需要重试', 'Needs retry') }
  return <div className="cv-companion-status" aria-label="Agent 状态">
    <AgentAvatar avatar={(profile.data?.avatar_id ?? 'shi') as AgentAvatarId} color={profile.data?.color} size={40} state={busy ? 'work' : 'idle'} />
    <div><strong>{profile.data?.name?.trim() || 'Everplain'}</strong><span className="qx-meta" role="status">{labels[status] ?? '等待消息'}</span></div>
  </div>
}
