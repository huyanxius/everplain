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
  soul: string
  avatar: AgentAvatarId
  color: string
  style: typeof settingsSpeakingStyles[number]['id']
}

type RetainedAgentDraft = { draft: AgentDraft; base: PersonalAgentProfile }

function draftFrom(profile: PersonalAgentProfile): AgentDraft {
  return {
    name: profile.name,
    soul: profile.soul_text ?? '',
    avatar: agentAvatarPresets.find(preset => preset.id === profile.avatar_id)?.id ?? 'cheng',
    color: profile.color,
    style: settingsSpeakingStyles.find(style => style.id === profile.speaking_style)?.id ?? 'clear',
  }
}

export function useAgentSettingsController(userId: string, text: (zh: string, en: string) => string) {
  const queryClient = useQueryClient()
  const key = ['agent-profile', userId] as const
  const draftKey = ['agent-profile-draft', userId] as const
  const retained = queryClient.getQueryData<RetainedAgentDraft>(draftKey)
  const profile = useQuery({ queryKey: key, queryFn: readAgentProfile, staleTime: 30_000 })
  const [draft, setDraft] = useState<AgentDraft | null>(() => retained?.draft ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [base, setBase] = useState<PersonalAgentProfile | null>(() => retained?.base ?? null)
  const [cancelRequested, setCancelRequested] = useState(false)
  const dirty = useRef(!!retained)
  const lock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    // Keep drafts in this page's memory across settings route unmounts, scoped by user.
    queryClient.setQueryDefaults(['agent-profile-draft', userId], { gcTime: Infinity })
    mounted.current = true
    return () => { mounted.current = false }
  }, [queryClient, userId])
  useEffect(() => {
    // Shared profile saves refresh pristine forms, never an in-progress draft.
    if (profile.data && !dirty.current) {
      setDraft(draftFrom(profile.data))
      setBase(profile.data)
    }
  }, [profile.data])

  useEffect(() => {
    function protectUnload(event: BeforeUnloadEvent) {
      if (!dirty.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectUnload)
    return () => window.removeEventListener('beforeunload', protectUnload)
  }, [])

  const conflict = dirty.current && base && profile.data && base.version !== profile.data.version ? profile.data : null

  function discard() {
    const latest = queryClient.getQueryData<PersonalAgentProfile>(key) ?? profile.data
    if (!latest || lock.current) return
    dirty.current = false
    queryClient.removeQueries({ queryKey: draftKey, exact: true })
    setBase(latest)
    setDraft(draftFrom(latest))
    setError('')
    setSaved(false)
    setCancelRequested(false)
  }

  function keepDraft() {
    if (!conflict || !draft || !base || lock.current) return
    // Only locally edited fields override the explicitly reviewed latest version.
    const old = draftFrom(base)
    const merged = draftFrom(conflict)
    for (const field of ['name', 'avatar', 'color', 'style', 'soul'] as const) {
      if (draft[field] !== old[field]) Object.assign(merged, { [field]: draft[field] })
    }
    queryClient.setQueryData<RetainedAgentDraft>(draftKey, { base: conflict, draft: merged })
    setBase(conflict)
    setDraft(merged)
    setError('')
  }

  function patch(value: Partial<AgentDraft>) {
    if (!draft || !base || lock.current) return
    dirty.current = true
    const next = { ...draft, ...value }
    queryClient.setQueryData<RetainedAgentDraft>(draftKey, { base, draft: next })
    setDraft(next)
    setError('')
    setSaved(false)
    setCancelRequested(false)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || lock.current) return
    const current = base
    if (!current) return
    const latest = queryClient.getQueryData<PersonalAgentProfile>(key) ?? profile.data
    if (latest?.version !== current.version) {
      setError(text('档案已更新，请先查看最新版本。草稿已保留。', 'Profile changed. Review the latest version; your draft is retained.'))
      return
    }
    const name = draft.name.trim()
    if (!name || name.length > 40) {
      setError(text('名字需要 1–40 个字符。', 'Use a name between 1 and 40 characters.'))
      return
    }
    if (draft.soul.length > 8000) {
      setError(text('人格描述最多 8000 个字符。', 'Soul description allows up to 8000 characters.'))
      return
    }
    const update: PersonalAgentProfileUpdate = {
      expected_version: current.version,
      name,
      avatar_id: draft.avatar,
      color: draft.color,
      speaking_style: draft.style,
      ...(draft.soul !== (current.soul_text ?? '') ? { soul_text: draft.soul } : {}),
    }
    lock.current = true
    setPending(true)
    setError('')
    setSaved(false)
    try {
      const result = await saveAgentProfile(update)
      dirty.current = false
      queryClient.removeQueries({ queryKey: draftKey, exact: true })
      queryClient.setQueryData(key, result)
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
      if (mounted.current) {
        setBase(result)
        setDraft(draftFrom(result))
        setSaved(true)
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : text('暂时无法保存，请重试。', 'Could not save. Please try again.'))
      // Refresh for explicit conflict review; never silently rebase a dirty draft.
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    } finally {
      lock.current = false
      if (mounted.current) setPending(false)
    }
  }

  return { profile, draft, pending, error, saved, patch, save, conflict, keepDraft, discard, cancelRequested,
    requestCancel: () => setCancelRequested(true), resumeEditing: () => setCancelRequested(false) }
}
