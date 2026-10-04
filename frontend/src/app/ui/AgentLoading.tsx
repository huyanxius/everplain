import { useQuery } from '@tanstack/react-query'
import { AgentAvatar, AgentLiquid, agentAvatarPresets, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile, type PersonalAgentProfile } from '../../modules/agent-profile'
import { useAccount } from '../../modules/account'
import { useReducedMotion } from '../../ui/useReducedMotion'
import './agent-loading.css'

export type LoadingPersona = Pick<PersonalAgentProfile, 'avatar_id' | 'color'>
export type PersonaLoadingProps = {
  message: string
  profile?: LoadingPersona | null
  state?: 'think' | 'work'
  compact?: boolean
}

/** Real pending state: the liquid represents Everplain; compact avatars require a known identity. */
export function PersonaLoading({ message, profile, state = 'think', compact = false }: PersonaLoadingProps) {
  const reduced = useReducedMotion()
  const avatar: AgentAvatarId | undefined = agentAvatarPresets.find(preset => preset.id === profile?.avatar_id)?.id
  return <div className="agent-loading" data-compact={compact} data-reduced-motion={reduced} role="status" aria-live="polite" aria-busy="true">
    {!compact ? <AgentLiquid lead={avatar} color={profile?.color} /> : avatar && <AgentAvatar avatar={avatar} color={profile?.color} state={state} size={compact ? 40 : 72} playing={!reduced} />}
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
