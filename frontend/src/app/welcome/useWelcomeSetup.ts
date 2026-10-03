import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { agentAvatarPresets, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile, type PersonalAgentProfileUpdate } from '../../modules/agent-profile'
import { importBilibili, importFiles, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'

export const speakingStyles = [
  { id: 'clear', title: '清晰直接', detail: '先说重点，清楚利落' },
  { id: 'warm', title: '温和自然', detail: '耐心倾听，一起想办法' },
  { id: 'rigorous', title: '严谨细致', detail: '重视依据，深入推敲' },
  { id: 'curious', title: '好奇开放', detail: '发现联系，探索可能' },
] as const
export const agentColors = ['#5d8fe6', '#ec8a52', '#3fae9c', '#e55f6f', '#de6aa5', '#9a80e0', '#eeb146', '#3d3d3a']
export const occupations = ['学生', '研究者', '产品经理', '老师', '创作者', '自由职业']
export const goalOptions = ['整理阅读笔记', '查找收藏资料', '研究一个问题', '辅助写作', '准备课程', '探索新领域']

type Draft = {
  name: string
  avatar: AgentAvatarId
  color: string
  style: typeof speakingStyles[number]['id']
  occupation: string
  industry: string
  goals: string[]
  interests: string
  additional: string
}
const initialDraft: Draft = { name: '', avatar: 'cheng', color: agentColors[0], style: 'clear', occupation: '', industry: '', goals: [], interests: '', additional: '' }
function draftFrom(profile: PersonalAgentProfile): Draft {
  return {
    name: profile.name === 'Everplain' ? '' : profile.name,
    avatar: agentAvatarPresets.some(preset => preset.id === profile.avatar_id) ? profile.avatar_id as AgentAvatarId : 'cheng',
    color: profile.color,
    style: speakingStyles.some(item => item.id === profile.speaking_style) ? profile.speaking_style as Draft['style'] : 'clear',
    occupation: profile.questionnaire.occupation ?? '', industry: profile.questionnaire.industry ?? '',
    goals: profile.questionnaire.goals ?? [], interests: (profile.questionnaire.interests ?? []).join('、'),
    additional: profile.questionnaire.additional ?? '',
  }
}
const failureMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function useWelcomeSetup(userId: string | null) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile })
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: query => query.state.data?.some(batch => batch.status === 'processing') ? 1200 : false })
  const active = useRef(true)
  const lock = useRef(false)
  const hydratedUser = useRef<string | null | undefined>(undefined)
  const [draft, setDraft] = useState(initialDraft)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<'save' | 'import' | 'retry' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!profile.data || hydratedUser.current === userId) return
    hydratedUser.current = userId
    setDraft(draftFrom(profile.data))
    setStep(profile.data.setup_completed ? 0 : Math.max(0, Math.min(profile.data.setup_step, 3)))
  }, [profile.data, userId])

  const items = batches.data ?? []
  const total = items.reduce((sum, batch) => sum + batch.total, 0)
  const finished = items.reduce((sum, batch) => sum + batch.finished, 0)
  const failed = items.reduce((sum, batch) => sum + batch.failed, 0)
  const processing = items.some(batch => batch.status === 'processing')
  const patch = (values: Partial<Draft>) => setDraft(current => ({ ...current, ...values }))

  function begin(operation: NonNullable<typeof busy>) {
    if (lock.current) return false
    lock.current = true
    setBusy(operation)
    setError('')
    return true
  }
  function end() {
    lock.current = false
    if (active.current) setBusy(null)
  }
  async function change(next: number, skip = false) {
    if (!profile.data || !begin('save')) return
    const currentProfile = queryClient.getQueryData<PersonalAgentProfile>(['agent-profile', userId]) ?? profile.data
    const update: PersonalAgentProfileUpdate = { expected_version: currentProfile.version, setup_step: next, setup_completed: next === 4 }
    if (!skip && step === 1) Object.assign(update, { name: draft.name.trim() || 'Everplain', avatar_id: draft.avatar, color: draft.color, speaking_style: draft.style })
    if (!skip && step === 2) update.questionnaire = {
      occupation: draft.occupation, industry: draft.industry, goals: draft.goals,
      interests: draft.interests.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean), additional: draft.additional,
    }
    try {
      const saved = await saveAgentProfile(update)
      queryClient.setQueryData(['agent-profile', userId], saved)
      if (!active.current) return
      setDraft(draftFrom(saved))
      if (next === 4) navigate('/my/graph')
      else setStep(next)
    } catch (failure) {
      if (active.current) setError(failureMessage(failure, '暂时无法保存'))
    } finally { end() }
  }
  async function runImport(operation: () => Promise<unknown>, kind: 'import' | 'retry') {
    if (!begin(kind)) return
    try {
      await operation()
      await batches.refetch()
    } catch (failure) {
      if (active.current) setError(failureMessage(failure, '导入暂时未完成，请重试'))
    } finally { end() }
  }
  function upload(source: ImportSourceType, files: FileList | null) {
    if (!files?.length) return
    return runImport(() => importFiles(source, Array.from(files)), 'import')
  }
  function importFavorites(uid: string) {
    if (!/^\d+$/.test(uid.trim())) {
      setError('请输入有效的 B 站 UID。')
      return
    }
    return runImport(() => importBilibili(uid.trim()), 'import')
  }
  const retry = (batchId: string, itemId: string) => runImport(() => retryImport(batchId, itemId), 'retry')
  return { profile, batches, draft, patch, step, busy, error, items, total, finished, failed, processing, change, upload, importFavorites, retry }
}
