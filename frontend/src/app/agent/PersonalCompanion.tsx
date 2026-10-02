import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'

export function PersonalCompanion({ userId, fallback }: { userId: string | null; fallback: ReactNode }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), staleTime: 30_000 })
  if (!profile.data) return fallback
  const p = profile.data
  return <div className="ep-chat-companion"><AgentAvatar avatar={p.avatar_id as AgentAvatarId} color={p.color} size={112} state="greet" /><p>{p.greeting}</p></div>
}
