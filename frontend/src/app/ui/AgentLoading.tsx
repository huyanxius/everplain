import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgentAvatar, agentAvatarPresets, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile, type PersonalAgentProfile } from '../../modules/agent-profile'
import { useAccount } from '../../modules/account'
import './agent-loading.css'

export type LoadingPersona = Pick<PersonalAgentProfile, 'avatar_id' | 'color'>
export type PersonaLoadingProps = {
  message: string
  profile?: LoadingPersona | null
  state?: 'think' | 'work'
  compact?: boolean
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** A real pending state. Unknown identity stays text-only; there is no synthetic progress. */
export function PersonaLoading({ message, profile, state = 'think', compact = false }: PersonaLoadingProps) {
  const reduced = useReducedMotion()
  const avatar = profile && agentAvatarPresets.find(preset => preset.id === profile.avatar_id)?.id
  return <div className="agent-loading" data-compact={compact} data-reduced-motion={reduced} role="status" aria-live="polite" aria-busy="true">
    {avatar && <AgentAvatar avatar={avatar as AgentAvatarId} color={profile!.color} state={state} size={compact ? 40 : 72} playing={!reduced} />}
    <p>{message}</p>
  </div>
}

function ProfileAgentLoading({ userId, ...props }: Omit<PersonaLoadingProps, 'profile'> & { userId: string }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, staleTime: 30_000, retry: false })
  return <PersonaLoading {...props} profile={profile.data} />
}

/** Authenticated application adapter. Reuses the same per-user profile cache as settings. */
export function AgentLoading(props: PersonaLoadingProps) {
  const account = useAccount()
  if (props.profile !== undefined) return <PersonaLoading {...props} />
  if (account.sessionState.status !== 'authenticated') return <PersonaLoading {...props} />
  const userId = account.sessionState.session.user.userId
  return <ProfileAgentLoading key={userId} {...props} userId={userId} />
}
