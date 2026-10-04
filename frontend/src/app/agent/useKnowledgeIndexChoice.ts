import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { isKnowledgeIndexStatus, readKnowledgeIndexStatus, repairKnowledgeIndex, type AgentTurnRequest, type KnowledgeIndexStatus } from '../../modules/research-agent'
import type { ReadinessDocument } from '../ui/KnowledgeReadinessChoice'

type PendingChoice = { status: KnowledgeIndexStatus; request: AgentTurnRequest; waiting: boolean; repairKey?: string; idempotencyKey?: string }
const keyFor = (scope: string | null) => scope ? `everplain.agent.index-choice.v1.${scope}` : null
function restore(scope: string | null): PendingChoice | null {
  try {
    const raw = keyFor(scope) && localStorage.getItem(keyFor(scope)!)
    const value = raw ? JSON.parse(raw) as PendingChoice : null
    return value && isKnowledgeIndexStatus(value.status) && typeof value.request?.message === 'string' ? value : null
  } catch { return null }
}
export function knowledgeReadinessDocuments(status: KnowledgeIndexStatus): ReadinessDocument[] {
  return [
    ...status.ready_documents.map(document => ({ id: document.document_id, title: document.filename, state: 'ready' as const })),
    ...status.missing_documents.map(document => ({
      id: document.document_id, title: document.filename,
      state: document.index_status === 'failed' ? 'failed' as const
        : ['pending', 'queued', 'running', 'processing'].includes(document.index_status) ? 'processing' as const : 'missing' as const,
      reason: document.index_error || document.reason,
    })),
  ]
}
export function useKnowledgeIndexChoice(scope: string | null, onResume: (request: AgentTurnRequest, idempotencyKey?: string) => boolean, canResume = true) {
  const [choice, setChoice] = useState<PendingChoice | null>(() => restore(scope))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(choice)
  const generation = useRef(0)
  const lock = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const resume = useEffectEvent(onResume)
  const save = useCallback((value: PendingChoice | null, targetScope: string | null = scope) => {
    current.current = value
    setChoice(value)
    try {
      const key = keyFor(targetScope)
      if (key) { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key) }
    } catch { /* Current-page decisions remain usable if storage is unavailable. */ }
  }, [scope])
  useLayoutEffect(() => {
    generation.current += 1
    controller.current?.abort()
    lock.current = false
    setBusy(false)
    setError(null)
    const value = restore(scope)
    current.current = value
    setChoice(value)
    return () => { generation.current += 1; controller.current?.abort() }
  }, [scope])
  const finish = useEffectEvent((value: PendingChoice, skip: boolean) => {
    if (!canResume) return
    const accepted = resume({ ...value.request, knowledge_index_action: skip ? 'skip_missing' : null }, value.request.deep_research_run_id ? value.idempotencyKey : undefined)
    if (accepted) { save(null); setError(null) }
  })
  useEffect(() => {
    if (choice?.waiting && choice.status.state === 'ready' && canResume) finish(choice, false)
  }, [choice, canResume])
  useEffect(() => {
    if (!choice?.waiting || choice.status.state === 'ready') return
    const expected = generation.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    async function poll() {
      try {
        const status = await readKnowledgeIndexStatus(choice!.request.reference_knowledge_base_id, abort.signal)
        if (cancelled || generation.current !== expected || !current.current?.waiting) return
        const next = { ...current.current, status }
        if (status.state === 'ready') { save(next); return }
        if (!status.processing_count) {
          save({ ...next, waiting: false, repairKey: undefined })
          setError(status.failed_count ? '部分资料整理失败，请查看原因。可以只使用已就绪资料，或修复后重新补齐。' : '整理仍未完成，当前没有正在运行的任务。请检查资料状态后再补齐。')
          return
        }
        save(next)
        timer = setTimeout(() => void poll(), 2500)
      } catch (cause) {
        if (cancelled || generation.current !== expected) return
        save(current.current ? { ...current.current, waiting: false } : null)
        setError(cause instanceof Error ? cause.message : '无法检查整理进度。')
      }
    }
    void poll()
    return () => { cancelled = true; abort.abort(); clearTimeout(timer) }
    // Snapshot updates do not restart or duplicate this single poll loop.
  }, [choice?.waiting, choice?.status.state, choice?.request.reference_knowledge_base_id, scope, save])
  function cancel() {
    generation.current += 1
    controller.current?.abort()
    lock.current = false
    setBusy(false)
    setError(null)
    save(null)
  }
  async function repair() {
    const value = current.current
    if (!value || lock.current || value.waiting) return
    lock.current = true
    setBusy(true)
    setError(null)
    const expected = generation.current
    const abort = new AbortController()
    controller.current = abort
    // Retain the same key if confirmation is lost or the page is refreshed.
    const repairKey = value.repairKey ?? crypto.randomUUID()
    save({ ...value, repairKey })
    try {
      const status = await repairKnowledgeIndex({
        documents: value.status.missing_documents.map(document => ({ knowledge_base_id: document.knowledge_base_id, document_id: document.document_id, parse_id: document.parse_id })),
        reference_knowledge_base_id: value.request.reference_knowledge_base_id,
      }, repairKey, abort.signal)
      if (generation.current !== expected) return
      save({ ...value, status, repairKey, waiting: true })
    } catch (cause) {
      if (generation.current === expected) setError(cause instanceof Error ? cause.message : '补齐任务未能确认。')
    } finally {
      if (generation.current === expected) { lock.current = false; setBusy(false) }
    }
  }
  return {
    choice, busy, error,
    present(status: KnowledgeIndexStatus, request: AgentTurnRequest, targetScope: string | null = scope, idempotencyKey?: string) { cancel(); save({ status, request, waiting: false, idempotencyKey }, targetScope) },
    cancel, repair,
    async refresh() {
      const value = current.current
      if (!value || lock.current || value.waiting) return
      lock.current = true
      setBusy(true)
      const expected = generation.current
      const abort = new AbortController()
      controller.current = abort
      try {
        const status = await readKnowledgeIndexStatus(value.request.reference_knowledge_base_id, abort.signal)
        if (expected !== generation.current) return
        save({ ...value, status, repairKey: undefined })
        setError(null)
      } catch (cause) {
        if (expected === generation.current) setError(cause instanceof Error ? cause.message : '无法检查资料状态。')
      } finally {
        if (expected === generation.current) { lock.current = false; setBusy(false) }
      }
    },
    skip() {
      const value = current.current
      if (!value || lock.current || !value.status.ready_count || !canResume) return
      const accepted = onResume({ ...value.request, knowledge_index_action: 'skip_missing' }, value.request.deep_research_run_id ? value.idempotencyKey : undefined)
      if (accepted) cancel()
    },
  }
}
