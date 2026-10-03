import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { agentAvatarPresets, type AgentAvatarId } from '../agent-avatar'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile, type PersonalAgentProfileUpdate } from '../agent-profile'

// Match the welcome flow's persisted choices, using the shared avatar registry.
export const settingsAgentColors = [...agentAvatarPresets.map(preset => preset.color), '#3d3d3a']
export const settingsSpeakingStyles = [
  { id: 'clear', zh: '清晰直接', en: 'Clear & direct' },
  { id: 'warm', zh: '温和自然', en: 'Warm & natural' },
  { id: 'rigorous', zh: '严谨细致', en: 'Careful & thorough' },
  { id: 'curious', zh: '好奇开放', en: 'Curious & open' },
] as const

type AgentDraft = {
  name: string
  avatar: AgentAvatarId
  color: string
  style: typeof settingsSpeakingStyles[number]['id']
}

function draftFrom(profile: PersonalAgentProfile): AgentDraft {
  return {
    name: profile.name,
    avatar: agentAvatarPresets.find(preset => preset.id === profile.avatar_id)?.id ?? 'cheng',
    color: profile.color,
    style: settingsSpeakingStyles.find(style => style.id === profile.speaking_style)?.id ?? 'clear',
  }
}

export function useAgentSettingsController(userId: string, text: (zh: string, en: string) => string) {
  const queryClient = useQueryClient()
  const key = ['agent-profile', userId] as const
  const profile = useQuery({ queryKey: key, queryFn: readAgentProfile, staleTime: 30_000 })
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const dirty = useRef(false)
  const lock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    // Shared profile saves refresh pristine forms, never an in-progress draft.
    if (profile.data) setDraft(current => current && dirty.current ? current : draftFrom(profile.data))
  }, [profile.data])

  function patch(value: Partial<AgentDraft>) {
    dirty.current = true
    setDraft(current => current ? { ...current, ...value } : current)
    setError('')
    setSaved(false)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || lock.current) return
    const current = queryClient.getQueryData<PersonalAgentProfile>(key) ?? profile.data
    if (!current) return
    const name = draft.name.trim()
    if (!name || name.length > 40) {
      setError(text('名字需要 1–40 个字符。', 'Use a name between 1 and 40 characters.'))
      return
    }
    const update: PersonalAgentProfileUpdate = {
      expected_version: current.version,
      name,
      avatar_id: draft.avatar,
      color: draft.color,
      speaking_style: draft.style,
    }
    lock.current = true
    setPending(true)
    setError('')
    setSaved(false)
    try {
      const result = await saveAgentProfile(update)
      dirty.current = false
      queryClient.setQueryData(key, result)
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
      if (mounted.current) {
        setDraft(draftFrom(result))
        setSaved(true)
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : text('暂时无法保存，请重试。', 'Could not save. Please try again.'))
      // Obtain a fresh CAS version for a retry without clearing the user's choices.
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    } finally {
      lock.current = false
      if (mounted.current) setPending(false)
    }
  }

  return { profile, draft, pending, error, saved, patch, save }
}
