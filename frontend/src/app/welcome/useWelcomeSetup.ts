import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { flushSync } from 'react-dom'
import { agentAvatarPresets, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile, type PersonalAgentProfileUpdate } from '../../modules/agent-profile'
import { importBilibili, importFiles, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'
import { createCourse, getCourse, listCourses, readKnowledgeStorage, retryCourseDocument, uploadCourseDocument, type SharedDocument } from '../../modules/shared-knowledge'
import type { UserAvatarCustom, UserAvatarId } from '../../modules/user-avatar'
import { libraryImportSources, type SourceId } from '../imports/importSources'

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
  userAvatar: ({ id: UserAvatarId } & UserAvatarCustom) | null
}
const initialDraft: Draft = { name: '', avatar: 'cheng', color: agentColors[0], style: 'clear', occupation: '', industry: '', goals: [], interests: '', additional: '', userAvatar: null }
function draftFrom(profile: PersonalAgentProfile): Draft {
  return {
    name: profile.name === 'Everplain' ? '' : profile.name,
    avatar: agentAvatarPresets.some(preset => preset.id === profile.avatar_id) ? profile.avatar_id as AgentAvatarId : 'cheng',
    // A fresh, unsaved profile uses the prototype's first blue partner.
    color: profile.version === 0 ? agentColors[0] : profile.color,
    style: speakingStyles.some(item => item.id === profile.speaking_style) ? profile.speaking_style as Draft['style'] : 'clear',
    occupation: profile.questionnaire.occupation ?? '', industry: profile.questionnaire.industry ?? '',
    goals: profile.questionnaire.goals ?? [], interests: (profile.questionnaire.interests ?? []).join('、'),
    additional: profile.questionnaire.additional ?? '',
    userAvatar: profile.user_avatar ?? null,
  }
}
const failureMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function useWelcomeSetup(userId: string | null) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile })
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: query => query.state.data?.some(batch => batch.status === 'processing') ? 1200 : false })
  const fileLibrary = useQuery({ queryKey: ['setup-file-library', userId], enabled: Boolean(userId),
    queryFn: async () => {
      const entry = (await listCourses()).find(library => library.access === 'owner' && library.name === '我的资料')
      if (!entry) return null
      const library = await getCourse(entry.id)
      if (library.access !== 'owner') throw new Error('此知识库为只读，不能上传资料。')
      return library
    },
    refetchInterval: query => query.state.data?.documents.some(documentProcessing) ? 1200 : false })
  const active = useRef(true)
  const lock = useRef(false)
  const hydratedUser = useRef<string | null | undefined>(undefined)
  const [draft, setDraft] = useState(initialDraft)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<'save' | 'import' | 'retry' | null>(null)
  const [error, setError] = useState('')
  const [uploadFailures, setUploadFailures] = useState<Array<{ id: string; file: File; error: string }>>([])
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!profile.data || hydratedUser.current === userId) return
    hydratedUser.current = userId
    setDraft(draftFrom(profile.data))
    setStep(profile.data.setup_completed ? 0 : Math.max(0, Math.min(profile.data.setup_step, 5)))
  }, [profile.data, userId])

  const items = batches.data ?? []
  const importedIds = new Set(items.flatMap(batch => batch.items.map(item => item.document_id).filter(Boolean)))
  const documents = (fileLibrary.data?.documents ?? []).filter(document => !importedIds.has(document.id))
  const total = items.reduce((sum, batch) => sum + batch.total, 0) + documents.length
  const finished = items.reduce((sum, batch) => sum + batch.finished, 0) + documents.filter(document => !documentProcessing(document)).length
  const failed = items.reduce((sum, batch) => sum + batch.failed, 0) + documents.filter(documentFailed).length
  const processing = items.some(batch => batch.status === 'processing') || documents.some(documentProcessing)
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
  async function change(next: number, skip = false, choices?: Partial<Draft>) {
    if (!profile.data || !begin('save')) return
    const currentProfile = queryClient.getQueryData<PersonalAgentProfile>(['agent-profile', userId]) ?? profile.data
    const currentDraft = { ...draft, ...choices }
    const update: PersonalAgentProfileUpdate = { expected_version: currentProfile.version, setup_step: next, setup_completed: next === 6 }
    if (!skip && step === 0) Object.assign(update, { avatar_id: currentDraft.avatar, color: currentDraft.color })
    if (!skip && step === 1) Object.assign(update, { name: draft.name.trim() || 'Everplain', avatar_id: draft.avatar, color: draft.color, speaking_style: draft.style })
    if (step === 2 && next > step) update.user_avatar = skip ? null : draft.userAvatar
    if (!skip && step === 4) update.questionnaire = {
      occupation: draft.occupation, industry: draft.industry, goals: draft.goals,
      interests: draft.interests.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean), additional: draft.additional,
    }
    try {
      const saved = await saveAgentProfile(update)
      queryClient.setQueryData(['agent-profile', userId], saved)
      if (!active.current) return
      // Navigation must not discard another stage's unsaved choices.
      setDraft(current => ({ ...current, ...choices, ...(step === 2 && skip && next > step ? { userAvatar: null } : {}) }))
      if (next === 6) navigate('/my/graph')
      else if (document.startViewTransition && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => flushSync(() => setStep(next)))
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
  function upload(source: Exclude<SourceId, 'bilibili'>, files: FileList | File[] | null) {
    if (!files?.length) return
    if (source === 'file') return uploadDocuments(Array.from(files))
    return runImport(async () => {
      const selected = libraryImportSources.find(item => item.id === source)!
      const values = Array.from(files)
      if (values.some(file => !(source === 'obsidian' && file.webkitRelativePath) && !accepts(selected.accept, file))) throw new Error(`请选择${selected.formats}文件。`)
      if (values.some(file => file.size > 16 * 1024 * 1024)) throw new Error('单个导入文件最多 16 MB，请缩小文件后重试。')
      if (values.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) throw new Error('每批导入文件最多 64 MB，请分批导入。')
      const limits = await readKnowledgeStorage()
      if (!active.current) return
      if (limits.used_bytes >= limits.max_bytes) throw new Error('存储空间已满，请先整理资料。')
      return importFiles(source as ImportSourceType, values)
    }, 'import')
  }
  async function uploadDocuments(files: File[], failureId?: string) {
    return runImport(async () => {
      const limits = await readKnowledgeStorage()
      if (!active.current) return
      const descriptor = libraryImportSources.find(source => source.id === 'file')!
      if (files.some(file => !accepts(descriptor.accept, file))) throw new Error('请选择 PDF、DOCX、PPTX、Markdown 或 TXT 文件。')
      if (files.some(file => file.size > limits.max_file_bytes)) throw new Error('文件超过单份上传大小限制，请缩小后重试。')
      if (limits.used_bytes + files.reduce((sum, file) => sum + file.size, 0) > limits.max_bytes) throw new Error('存储空间不足，请先整理资料。')
      const result = await fileLibrary.refetch()
      if (!active.current) return
      if (result.error) throw result.error
      let library = result.data
      if (!library) {
        if (limits.library_count >= limits.max_libraries) throw new Error('知识库数量已达上限，请先整理已有知识库。')
        library = await createCourse({ name: '我的资料', description: '' })
        queryClient.setQueryData(['setup-file-library', userId], library)
      }
      if (!active.current) return
      const latest = await getCourse(library.id)
      if (!active.current) return
      if (latest.access !== 'owner') throw new Error('此知识库为只读，不能上传资料。')
      if (latest.documents.length + files.length > limits.max_documents_per_library) throw new Error('当前知识库剩余位置不足，请先整理已有资料。')
      for (const file of files) {
        if (!active.current) break
        try {
          await uploadCourseDocument(library.id, file)
          if (active.current && failureId) setUploadFailures(current => current.filter(item => item.id !== failureId))
        } catch (failure) {
          if (active.current) setUploadFailures(current => [...current.filter(item => item.id !== failureId), { id: failureId ?? crypto.randomUUID(), file, error: failureMessage(failure, '上传暂时未完成，请重试') }])
        }
      }
      if (active.current) {
        await fileLibrary.refetch()
        void queryClient.invalidateQueries({ queryKey: ['shared-knowledge', userId] })
        void queryClient.invalidateQueries({ queryKey: ['knowledge-storage', userId] })
      }
    }, 'import')
  }
  function importFavorites(uid: string) {
    if (!/^\d+$/.test(uid.trim())) {
      setError('请输入有效的 B 站 UID。')
      return
    }
    return runImport(async () => {
      const limits = await readKnowledgeStorage()
      if (!active.current) return
      if (limits.used_bytes >= limits.max_bytes) throw new Error('存储空间已满，请先整理资料。')
      return importBilibili(uid.trim())
    }, 'import')
  }
  const retry = (batchId: string, itemId: string) => runImport(() => retryImport(batchId, itemId), 'retry')
  const retryDocument = (documentId: string) => runImport(async () => {
    if (!fileLibrary.data) throw new Error('知识库暂时无法访问，请重新读取。')
    await retryCourseDocument(fileLibrary.data.id, documentId)
    await fileLibrary.refetch()
  }, 'retry')
  const retryUpload = (id: string) => {
    const failure = uploadFailures.find(item => item.id === id)
    if (failure) return uploadDocuments([failure.file], id)
  }
  return { profile, batches, fileLibrary, documents, uploadFailures, draft, patch, step, busy, error, items, total, finished, failed, processing, change, upload, importFavorites, retry, retryDocument, retryUpload }
}

function accepts(accept: string, file: File) {
  return accept.split(',').some(pattern => pattern.startsWith('.') ? file.name.toLowerCase().endsWith(pattern) : file.type === pattern || ({ 'image/png': '.png', 'image/jpeg': '.jpg,.jpeg', 'image/webp': '.webp', 'image/gif': '.gif' }[pattern] ?? '').split(',').filter(Boolean).some(extension => file.name.toLowerCase().endsWith(extension)))
}
export function documentFailed(document: SharedDocument) { return document.status === 'failed' || document.knowledgeStatus === 'failed' || document.indexStatus === 'failed' }
export function documentProcessing(document: SharedDocument) { return !documentFailed(document) && (document.status === 'processing' || document.knowledgeStatus === 'queued' || document.knowledgeStatus === 'running' || document.indexStatus === 'queued' || document.indexStatus === 'running') }
