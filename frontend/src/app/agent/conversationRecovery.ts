import type { AgentOutputAttempt, AgentCitation, AgentRunRecovery, AgentRuntimeMode } from '../../modules/research-agent'
import type { ResearchCanvasStreamingTurn } from '../../modules/research-workspace'
import { contextCardAdditionalText, readContextCard } from '../conversation-view/contextCard'
import { MAX_AGENT_MESSAGE_LENGTH, objectRecord, type PendingTurnAttempt, type ResearchToolStep, type StreamingTurn } from './conversationState'

const DRAFT_STORAGE_KEY = 'everplain.agent.composer-draft.v2'
const PENDING_TURN_STORAGE_KEY = 'everplain.agent.pending-turn.v2'
const INTERRUPTED_TURN_STORAGE_KEY = 'everplain.agent.interrupted-turn.v2'
export const KNOWLEDGE_RELEASE_STORAGE_KEY = 'everplain.agent.knowledge-releases.v1'
export const AGENT_RUNTIME_STORAGE_KEY = 'everplain.agent.runtime-modes.v1'

export function pendingAttemptDraft(attempt: PendingTurnAttempt | null) {
  if (!attempt) return ''
  return attempt.contextCard ? contextCardAdditionalText(attempt.question, attempt.contextCard) : attempt.question
}


export function conversationStorageScope(userId: string | null, conversationId: string | null, taskId: string | null, workspace: string) {
  return userId ? `${encodeURIComponent(userId)}.${conversationId ? `conversation.${encodeURIComponent(conversationId)}` : `draft.${workspace}.${encodeURIComponent(taskId ?? 'independent')}`}` : null
}

export function scopedSessionKey(base: string, userId: string | null) {
  return userId ? `${base}.${userId}` : null
}

export function readStoredDraft(userId: string | null) {
  if (typeof window === 'undefined') return ''
  try {
    const storageKey = scopedSessionKey(DRAFT_STORAGE_KEY, userId)
    return storageKey
      ? window.localStorage.getItem(storageKey)?.slice(0, MAX_AGENT_MESSAGE_LENGTH) ?? ''
      : ''
  } catch {
    return ''
  }
}

export function persistDraft(userId: string | null, value: string) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(DRAFT_STORAGE_KEY, userId)
    if (!storageKey) return
    if (value) window.localStorage.setItem(storageKey, value)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Storage recovery is optional; the controlled composer remains usable.
  }
}

/** Persist a recoverable draft. This alone never authorizes sending it. */
export function seedAgentDraft(userId: string, value: string) {
  persistDraft(conversationStorageScope(userId, null, null, 'agent'), value.slice(0, MAX_AGENT_MESSAGE_LENGTH))
}

export function readPendingTurnAttempt(userId: string | null): PendingTurnAttempt | null {
  if (typeof window === 'undefined') return null
  try {
    const storageKey = scopedSessionKey(PENDING_TURN_STORAGE_KEY, userId)
    return storageKey ? decodePendingTurnAttempt(window.localStorage.getItem(storageKey)) : null
  } catch {
    return null
  }
}

/** Decode stored data only; this never starts or resumes a request. */
export function decodePendingTurnAttempt(raw: string | null): PendingTurnAttempt | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingTurnAttempt>
    if (
      typeof value.question !== 'string'
      || !value.question.trim()
      || value.question.length > MAX_AGENT_MESSAGE_LENGTH
      || typeof value.idempotencyKey !== 'string'
      || !value.idempotencyKey
      || (value.conversationId !== null && typeof value.conversationId !== 'string')
    ) return null
    return {
      question: value.question,
      contextCard: readContextCard(value.contextCard),
      idempotencyKey: value.idempotencyKey,
      conversationId: value.conversationId ?? null,
      runId: typeof value.runId === 'string' && value.runId ? value.runId : null,
      // Keep the original request, including model_id/reasoning_effort; never reselect on recovery.
      request: value.request && typeof value.request.message === 'string' ? value.request : undefined,
      materialIds: Array.isArray(value.materialIds)
        ? value.materialIds.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
    }
  } catch {
    return null
  }
}

export function encodePendingTurnAttempt(value: PendingTurnAttempt | null): string | null {
  return value === null ? null : JSON.stringify(value)
}

export function persistPendingTurnAttempt(userId: string | null, value: PendingTurnAttempt | null) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(PENDING_TURN_STORAGE_KEY, userId)
    if (!storageKey) return
    const encoded = encodePendingTurnAttempt(value)
    if (encoded !== null) window.localStorage.setItem(storageKey, encoded)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // The in-memory idempotency key still protects the active retry.
  }
}

export function readInterruptedTurn(userId: string | null): StreamingTurn | null {
  if (typeof window === 'undefined') return null
  try {
    const storageKey = scopedSessionKey(INTERRUPTED_TURN_STORAGE_KEY, userId)
    return storageKey ? decodeInterruptedTurn(window.localStorage.getItem(storageKey)) : null
  } catch {
    return null
  }
}

/** Decode stored data only; this never starts or resumes a request. */
export function decodeInterruptedTurn(raw: string | null, now = Date.now()): StreamingTurn | null {
  if (!raw) return null
  try {
    const value = objectRecord(JSON.parse(raw))
    if (
      !value
      || typeof value.question !== 'string'
      || (!value.question.trim() && !(value.question === '' && typeof value.runId === 'string' && Boolean(value.runId)))
      || value.question.length > MAX_AGENT_MESSAGE_LENGTH
      || typeof value.answer !== 'string'
      || value.interrupted !== true
      || !Array.isArray(value.citations)
      || !Array.isArray(value.toolSteps)
      || !Array.isArray(value.canvasPatches)
    ) return null
    const toolSteps = value.toolSteps.filter((item): item is ResearchToolStep => {
      const step = objectRecord(item)
      return Boolean(
        step
        && typeof step.id === 'string'
        && typeof step.tool === 'string'
        && typeof step.label === 'string'
        && (step.status === 'running' || step.status === 'completed' || step.status === 'failed'),
      )
    })
    return {
      runId: typeof value.runId === 'string' ? value.runId : null,
      question: value.question,
      contextCard: readContextCard(value.contextCard),
      answer: value.answer,
      attemptId: typeof value.attemptId === 'string' ? value.attemptId : null,
      outputPersistenceFailed: value.outputPersistenceFailed === true,
      outputAttempts: Array.isArray(value.outputAttempts)
        ? value.outputAttempts.filter((item): item is AgentOutputAttempt => Boolean(
          item && typeof item === 'object' && typeof item.attempt_id === 'string'
          && typeof item.answer === 'string' && typeof item.ordinal === 'number',
        )) : [],
      citations: value.citations as AgentCitation[],
      toolSteps,
      canvasPatches: value.canvasPatches as ResearchCanvasStreamingTurn['canvasPatches'],
      startedAt: typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : now,
      interrupted: true,
      failure: typeof value.failure === 'string' && value.failure ? value.failure : undefined,
    }
  } catch {
    return null
  }
}

export function encodeInterruptedTurn(value: StreamingTurn | null): string | null {
  return value === null ? null : JSON.stringify(value)
}

export function persistInterruptedTurn(userId: string | null, value: StreamingTurn | null) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(INTERRUPTED_TURN_STORAGE_KEY, userId)
    if (!storageKey) return
    const encoded = encodeInterruptedTurn(value)
    if (encoded !== null) window.localStorage.setItem(storageKey, encoded)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // The stopped turn remains visible in memory when storage is unavailable.
  }
}

export function readStringMap(userId: string | null, base: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const storageKey = scopedSessionKey(base, userId)
    if (!storageKey) return {}
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => (
          Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
        ))
        .slice(-100),
    )
  } catch {
    return {}
  }
}

export function persistStringMap(userId: string | null, base: string, values: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    const storageKey = scopedSessionKey(base, userId)
    if (storageKey) window.sessionStorage.setItem(storageKey, JSON.stringify(values))
  } catch {
    // URL state and persisted turns remain authoritative when storage is disabled.
  }
}

export function readStoredRuntimeModes(userId: string | null): Record<string, AgentRuntimeMode> {
  const stored = readStringMap(userId, AGENT_RUNTIME_STORAGE_KEY)
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, AgentRuntimeMode] => (
      entry[1] === 'mock' || entry[1] === 'base' || entry[1] === 'sft'
    )),
  )
}


export function recoveryAttempt(run: AgentRunRecovery): PendingTurnAttempt {
  return {
    question: run.request.message,
    contextCard: run.context_card,
    idempotencyKey: run.idempotency_key,
    conversationId: run.request.conversation_id ?? null,
    runId: run.run_id,
    materialIds: run.request.material_ids ?? [],
    request: run.request,
  }
}

