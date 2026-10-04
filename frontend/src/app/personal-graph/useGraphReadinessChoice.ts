import { useCallback, useEffect, useRef, useState } from 'react'
import { readKnowledgeIndexStatus, repairKnowledgeIndex, type KnowledgeIndexStatus } from '../../modules/research-agent'
import { PersonalGraphReadinessError } from '../../modules/personal-graph'
import type { ReadinessDocument } from '../ui/KnowledgeReadinessChoice'

export function graphReadinessDocuments(status: KnowledgeIndexStatus): ReadinessDocument[] {
  return [
    ...status.ready_documents.map(d => ({ id: d.document_id, title: d.filename, state: 'ready' as const })),
    ...status.missing_documents.map(d => {
      const state = d.stage === 'knowledge' ? d.knowledge_status : d.index_status
      return { id: d.document_id, title: d.filename,
        state: state === 'failed' ? 'failed' as const : ['pending', 'queued', 'running', 'processing'].includes(state ?? '') ? 'processing' as const : 'missing' as const,
        reason: (d.stage === 'knowledge' ? d.knowledge_error : d.index_error) || d.reason }
    }),
  ]
}

/** Gate only an explicitly requested rebuild. Reading an existing graph stays available. */
export function useGraphReadinessChoice(userId: string | null, rebuild: (skip: boolean) => Promise<void>) {
  const [status, setStatus] = useState<KnowledgeIndexStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const lock = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const repairKey = useRef<string | undefined>(undefined)
  const rebuildRef = useRef(rebuild)
  rebuildRef.current = rebuild
  const cancel = useCallback(() => {
    generation.current += 1
    abortRef.current?.abort()
    lock.current = false
    repairKey.current = undefined
    setBusy(false); setWaiting(false); setStatus(null); setError(null)
  }, [])
  useEffect(() => { cancel(); return () => { generation.current += 1; abortRef.current?.abort() } }, [userId, cancel])
  async function run(skip: boolean) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    const expected = generation.current
    try {
      await rebuildRef.current(skip)
      if (expected === generation.current) { setStatus(null); setWaiting(false) }
    } catch (cause) {
      if (expected === generation.current) {
        if (cause instanceof PersonalGraphReadinessError) { setStatus(cause.status); setWaiting(false) }
        else setError(cause instanceof Error ? cause.message : '图谱未能更新，请重试。')
      }
    } finally { if (expected === generation.current) { lock.current = false; setBusy(false) } }
  }
  async function check(start = false) {
    if (lock.current || waiting) return
    lock.current = true; setBusy(true); setError(null)
    const expected = generation.current
    const abort = new AbortController(); abortRef.current = abort
    try {
      const value = await readKnowledgeIndexStatus(undefined, abort.signal, 'graph')
      if (expected !== generation.current) return
      if (start && value.state === 'ready') {
        lock.current = false
        await run(false)
      } else { setStatus(value); repairKey.current = undefined }
    } catch (cause) {
      if (expected === generation.current) setError(cause instanceof Error ? cause.message : '无法检查图谱整理进度。')
    } finally { if (expected === generation.current) { lock.current = false; setBusy(false) } }
  }
  async function repair() {
    if (!status || lock.current || waiting) return
    lock.current = true; setBusy(true); setError(null)
    const expected = generation.current
    const abort = new AbortController(); abortRef.current = abort
    repairKey.current ??= crypto.randomUUID()
    try {
      const value = await repairKnowledgeIndex({ purpose: 'graph', documents: status.missing_documents.map(d => ({ knowledge_base_id: d.knowledge_base_id, document_id: d.document_id, parse_id: d.parse_id })) }, repairKey.current, abort.signal)
      if (expected !== generation.current) return
      setStatus(value); setWaiting(true)
    } catch (cause) {
      if (expected === generation.current) setError(cause instanceof Error ? cause.message : '补齐任务未能确认，请重新检查状态。')
    } finally { if (expected === generation.current) { lock.current = false; setBusy(false) } }
  }
  useEffect(() => {
    if (!waiting) return
    const expected = generation.current
    const abort = new AbortController()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const value = await readKnowledgeIndexStatus(undefined, abort.signal, 'graph')
        if (cancelled || expected !== generation.current) return
        setStatus(value)
        if (value.state === 'ready') { setWaiting(false); await run(false); return }
        if (!value.processing_count) {
          setWaiting(false)
          setError(value.failed_count ? '部分资料整理失败。可查看原因后重试，或只使用已就绪资料。' : '整理尚未完成，当前没有正在运行的任务，请重新检查。')
          return
        }
        timer = setTimeout(() => void poll(), 2500)
      } catch (cause) {
        if (!cancelled && expected === generation.current) { setWaiting(false); setError(cause instanceof Error ? cause.message : '无法检查整理进度。') }
      }
    }
    void poll()
    return () => { cancelled = true; abort.abort(); clearTimeout(timer) }
  }, [waiting, userId])
  return { status, busy, waiting, error, cancel, repair, check: () => check(false), start: () => check(true),
    skip: () => status?.ready_count ? run(true) : Promise.resolve(),
  }
}
