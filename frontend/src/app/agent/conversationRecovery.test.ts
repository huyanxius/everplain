import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationStorageScope, decodeInterruptedTurn, decodePendingTurnAttempt, encodeInterruptedTurn, encodePendingTurnAttempt, pendingAttemptDraft, persistDraft, persistInterruptedTurn, persistPendingTurnAttempt, readInterruptedTurn, readPendingTurnAttempt, readStoredDraft, readStoredRuntimeModes, readStringMap, recoveryAttempt, seedAgentDraft, AGENT_RUNTIME_STORAGE_KEY } from './conversationRecovery'
import { MAX_AGENT_MESSAGE_LENGTH, type PendingTurnAttempt, type StreamingTurn } from './conversationState'

const attempt: PendingTurnAttempt = {
  question: '原始问题\n  `a  b`', idempotencyKey: 'key-1', conversationId: 'conversation-1', runId: 'run-1', materialIds: ['material-1'],
  request: { message: '原始问题\n  `a  b`', model_id: 'model-pinned', reasoning_effort: 'high', conversation_id: 'conversation-1', material_ids: ['material-1'], writing_context: { document_id: 'document-1', document_version: 7, selection_start: 1, selection_end: 3 }, workspace: 'agent', web_search: false },
}
const turn: StreamingTurn = { question: attempt.question, runId: 'run-1', answer: '未保存原文\n\n  精确保留 ', attemptId: 'attempt-1', outputPersistenceFailed: true, outputAttempts: [{ attempt_id: 'unsaved:previous', ordinal: 1, created_at: '2026-01-01T00:00:00Z', status: 'unsaved', answer: '旧原文' }], citations: [], toolSteps: [], canvasPatches: [], startedAt: 100, interrupted: true }

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

describe('conversation recovery codecs', () => {
  it('round trips the exact request, idempotency identity and received text without making a request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(decodePendingTurnAttempt(encodePendingTurnAttempt(attempt))).toMatchObject(attempt)
    expect(decodeInterruptedTurn(encodeInterruptedTurn(turn))).toMatchObject(turn)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([null, '', '{', 'null', '[]', '{}', '{"question":9}', JSON.stringify({ ...attempt, idempotencyKey: '' }), JSON.stringify({ ...attempt, question: ' '.repeat(5) }), JSON.stringify({ ...attempt, question: 'x'.repeat(MAX_AGENT_MESSAGE_LENGTH + 1) })])('rejects malformed pending data: %s', raw => {
    expect(decodePendingTurnAttempt(raw)).toBeNull()
  })
  it.each([null, '', '{', 'null', '[]', '{}', JSON.stringify({ ...turn, interrupted: false }), JSON.stringify({ ...turn, question: ' ', runId: null }), JSON.stringify({ ...turn, citations: null })])('rejects malformed interrupted data: %s', raw => {
    expect(decodeInterruptedTurn(raw)).toBeNull()
  })
  it('keeps the hidden automatic writing echo empty while recovering its received body', () => {
    const automatic = { ...turn, question: '' }
    expect(decodeInterruptedTurn(encodeInterruptedTurn(automatic))).toMatchObject(automatic)
    expect(decodeInterruptedTurn(encodeInterruptedTurn({ ...automatic, runId: null }))).toBeNull()
  })
  it('filters malformed tool entries and output attempts and injects time only for invalid saved time', () => {
    expect(decodeInterruptedTurn(JSON.stringify({ ...turn, startedAt: null, toolSteps: [null, { id: 's', tool: 'search_web', label: '搜索', status: 'running' }], outputAttempts: [null, { attempt_id: 'a', answer: 'raw', ordinal: 1 }] }), 123)).toMatchObject({ startedAt: 123, toolSteps: [{ id: 's' }], outputAttempts: [{ attempt_id: 'a' }] })
  })
  it('does not recover a context card as editable hidden text', () => {
    expect(pendingAttemptDraft(null)).toBe('')
    expect(pendingAttemptDraft({ ...attempt, question: 'question', contextCard: { title: 'title', description: 'description' } })).toBe('question')
  })
  it('preserves server recovery request identity', () => {
    expect(recoveryAttempt({ run_id: 'r', idempotency_key: 'k', status: 'interrupted', request: attempt.request!, partial_answer: '', updated_at: '', cancel_requested: true })).toMatchObject({ runId: 'r', idempotencyKey: 'k', request: attempt.request, materialIds: ['material-1'] })
  })
})

describe('scoped recovery storage', () => {
  it('retains the exact v2 keys and isolates owner, conversation, task and writing document scopes', () => {
    const scopes = [conversationStorageScope('a', 'c', null, 'agent'), conversationStorageScope('b', 'c', null, 'agent'), conversationStorageScope('a', 'd', null, 'agent'), conversationStorageScope('a', null, 'task', 'research'), conversationStorageScope('a', null, null, 'writing:a'), conversationStorageScope('a', null, null, 'writing:b')]
    expect(new Set(scopes).size).toBe(6)
    expect(scopes[0]).toBe('a.conversation.c')
    persistDraft(scopes[0], 'draft')
    persistPendingTurnAttempt(scopes[0], attempt)
    persistInterruptedTurn(scopes[0], turn)
    expect(localStorage.getItem('everplain.agent.composer-draft.v2.a.conversation.c')).toBe('draft')
    for (const scope of scopes.slice(1)) {
      expect(readStoredDraft(scope)).toBe('')
      expect(readPendingTurnAttempt(scope)).toBeNull()
      expect(readInterruptedTurn(scope)).toBeNull()
    }
    expect(readPendingTurnAttempt(scopes[0])).toMatchObject(attempt)
    expect(readInterruptedTurn(scopes[0])).toMatchObject(turn)
    persistPendingTurnAttempt(scopes[0], null); persistInterruptedTurn(scopes[0], null); persistDraft(scopes[0], '')
    expect(localStorage.length).toBe(0)
  })
  it('does not persist anonymous state and bounds seeded composer text', () => {
    persistDraft(null, 'private'); persistPendingTurnAttempt(null, attempt); persistInterruptedTurn(null, turn)
    expect(localStorage.length).toBe(0)
    seedAgentDraft('owner/@', 'x'.repeat(MAX_AGENT_MESSAGE_LENGTH + 1))
    expect(readStoredDraft(conversationStorageScope('owner/@', null, null, 'agent'))).toHaveLength(MAX_AGENT_MESSAGE_LENGTH)
  })
  it('remains usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
    expect(readStoredDraft('owner')).toBe(''); expect(readPendingTurnAttempt('owner')).toBeNull(); expect(readInterruptedTurn('owner')).toBeNull()
    expect(() => persistDraft('owner', 'draft')).not.toThrow()
    expect(() => persistPendingTurnAttempt('owner', attempt)).not.toThrow()
    expect(() => persistInterruptedTurn('owner', turn)).not.toThrow()
  })
  it('filters stored maps and keeps the last 100 valid entries and supported runtime modes', () => {
    sessionStorage.setItem('map.owner', JSON.stringify(Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`c${i}`, `value${i}`]))))
    expect(Object.keys(readStringMap('owner', 'map'))).toHaveLength(100)
    sessionStorage.setItem(`${AGENT_RUNTIME_STORAGE_KEY}.owner`, JSON.stringify({ a: 'mock', b: 'base', c: 'sft', d: 'unknown', e: 4 }))
    expect(readStoredRuntimeModes('owner')).toEqual({ a: 'mock', b: 'base', c: 'sft' })
  })
})
