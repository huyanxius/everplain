import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readAgentProfile, type PersonalAgentProfile } from '../../modules/agent-profile'
import { UserAvatar } from '../../modules/user-avatar'
import './home-companion.css'

type Avatar = NonNullable<PersonalAgentProfile['user_avatar']>

/** Owner-scoped profile; an absent user avatar never falls back to the product mascot. */
export function HomeCompanion({ active, userId = null }: { active: boolean; userId?: string | null }) {
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), staleTime: 30_000 })
  return <UserAvatarPresence key={userId} active={active} avatar={userId ? profile.data?.user_avatar ?? null : null} />
}

/** Retains the old person for the full departure before mounting the latest selection. */
export function UserAvatarPresence({ active, avatar }: { active: boolean; avatar: Avatar | null }) {
  const [shown, setShown] = useState<Avatar | null>(active ? avatar : null)
  const [away, setAway] = useState(false)
  const [cycle, setCycle] = useState(0)
  const [skipEntryDelay, setSkipEntryDelay] = useState(false)
  const shownRef = useRef(shown)
  const target = useRef<Avatar | null>(null)
  const timer = useRef<number | null>(null)
  const previousActive = useRef(active)
  useEffect(() => {
    target.current = active ? avatar : null
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const display = (value: Avatar | null, replay = false, instant = false) => {
      shownRef.current = value
      setShown(value)
      setAway(false)
      if (replay) { setCycle(value => value + 1); setSkipEntryDelay(instant) }
      else if (!value) setSkipEntryDelay(false)
    }
    const cancel = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
    const next = target.current
    if (reduced) { cancel(); display(next); previousActive.current = active; return }
    if (next && shownRef.current?.id === next.id) {
      cancel(); display(next, !previousActive.current); previousActive.current = active; return
    }
    if (!shownRef.current) { cancel(); display(next, Boolean(next)); previousActive.current = active; return }
    setAway(true)
    if (timer.current === null) timer.current = window.setTimeout(() => {
      timer.current = null
      const next = target.current
      const changedPerson = Boolean(next && shownRef.current && next.id !== shownRef.current.id)
      display(next, Boolean(next), changedPerson)
    }, 450)
    previousActive.current = active
  }, [active, avatar])
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  if (!shown) return null
  return <div key={cycle} className="hm-companion" data-away={away} data-swapped={skipEntryDelay} aria-hidden={!active} inert={!active}>
    <UserAvatar id={shown.id} custom={shown} variant="resting" size={150} />
  </div>
}
