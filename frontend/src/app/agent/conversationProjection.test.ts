import { describe, expect, it } from 'vitest'
import type { AgentCitation, AgentConversation, AgentRunRecovery } from '../../modules/research-agent'
import { citationToRail, materialCitationFields, mergeOutputAttempts, persistedToolSteps, recoverTurnWithLocalOutput, researchStartHandoffFromSteps, resultItemsFromOutput, toActivity, tombstoneConversationMaterial, updateToolSteps } from './conversationProjection'
import { DELETED_MATERIAL_ANSWER, type StreamingTurn } from './conversationState'

const local: StreamingTurn = { runId: 'run-1', attemptId: 'attempt-1', question: 'question', answer: '完整未保存\n\n  原文 ', outputPersistenceFailed: true, citations: [], toolSteps: [], canvasPatches: [], startedAt: 10, interrupted: true }
const run: AgentRunRecovery = { run_id: 'run-1', idempotency_key: 'key', status: 'failed', request: { message: 'question' }, partial_answer: '已保存前缀', output_attempts: [{ attempt_id: 'attempt-1', ordinal: 1, created_at: '2026-01-01T00:00:00Z', answer: '已保存前缀', status: 'failed' }], updated_at: '2026-01-01T00:00:00Z', cancel_requested: false }
const saved = { turn: local, attempt: { question: 'question', idempotencyKey: 'key', conversationId: 'c', runId: 'run-1', materialIds: [] } }
const citation = { citation_id: 'c', kind: 'material', label: '材料', material_id: 'm', excerpt: 'private original', locator: null } as AgentCitation

describe('pure conversation projections', () => {
  it('replays duplicate tool events by call identity, retaining input and complete output', () => {
    const started = { type: 'tool_started' as const, tool: 'search_web', call_id: 'call-1', input: { query: 'exact query' } }
    const done = { type: 'tool_finished' as const, tool: 'search_web', call_id: 'call-1', output: { items: [{ id: 'result', title: 'title', excerpt: 'raw excerpt' }] } }
    const steps = [started, started, done, done].reduce(updateToolSteps, [])
    expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ id: 'call-1', status: 'completed', input: started.input, output: done.output })
    expect(toActivity(steps[0], 'en-US')).toMatchObject({ label: 'Search the web', resultItems: [{ id: 'result', title: 'title', excerpt: 'raw excerpt' }] })
  })
  it('keeps historic calls without IDs ordered and hides UI-only traces', () => {
    const steps = persistedToolSteps([{ tool: 'writing_ui_action', phase: 'finished', call_id: 'hidden' }, { tool: 'deep_research', phase: 'finished', call_id: 'hidden-2' }, { tool: 'search_web', phase: 'started', call_id: null }, { tool: 'search_web', phase: 'failed', call_id: null, detail: '失败', error: 'error' }])
    expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ status: 'failed', detail: '失败' })
  })
  it('retains material locator identities and citation display without modifying source text', () => {
    expect(materialCitationFields(citation)).toMatchObject({ materialId: 'm' })
    expect(citationToRail(citation, 'zh-CN')).toMatchObject({ id: 'c', title: '材料', excerpt: 'private original' })
    expect(resultItemsFromOutput({ results: [{ knowledge_id: 'k', name: 'name', content: 'full raw\ncontent' }] })).toEqual([{ id: 'k', title: 'name', excerpt: 'full raw\ncontent' }])
  })
  it('requires the explicit pending-confirmation handoff rather than inferring approval', () => {
    const step = { id: 'p', tool: 'propose_start_research', label: 'proposal', status: 'completed' as const, output: { requires_user_confirmation: true, status: 'pending_confirmation', proposal_id: 'p', conversation_id: 'c', knowledge_release_id: 'k', phenomenon: 'phenomenon' } }
    expect(researchStartHandoffFromSteps([step])).toMatchObject({ proposalId: 'p' })
    expect(researchStartHandoffFromSteps([{ ...step, output: { ...step.output, requires_user_confirmation: false } }])).toBeNull()
  })
  it('preserves only the current run local unsaved archives while the server owns saved attempts', () => {
    const current = { ...local, outputAttempts: [{ attempt_id: 'unsaved:x', ordinal: 1, created_at: '2026-01-01T00:00:00Z', status: 'unsaved', answer: 'local' }, { attempt_id: 'saved-old', ordinal: 1, created_at: '2026-01-01T00:00:00Z', status: 'failed', answer: 'old saved' }] }
    expect(mergeOutputAttempts(current, 'other', run.output_attempts)).toEqual(run.output_attempts)
    expect(mergeOutputAttempts(current, 'run-1', run.output_attempts)).toEqual([...run.output_attempts!, current.outputAttempts[0]])
    expect(mergeOutputAttempts(current, 'run-1', run.output_attempts, true).every(v => v.answer === DELETED_MATERIAL_ANSWER)).toBe(true)
  })
  it('tombstones deleted material answers and archived outputs without mutating unrelated turns', () => {
    const original = { conversation_id: 'c', turns: [{ assistant: { content: 'private', citations: [citation] }, output_attempts: [{ answer: 'private archive' }] }, { assistant: { content: 'unrelated', citations: [] } }] } as AgentConversation
    const next = tombstoneConversationMaterial(original, 'm')
    expect(next.turns[0].assistant).toMatchObject({ content: DELETED_MATERIAL_ANSWER, citations: [{ deleted: true, excerpt: null }] })
    expect(next.turns[0].output_attempts?.[0].answer).toBe(DELETED_MATERIAL_ANSWER)
    expect(next.turns[1]).toBe(original.turns[1]); expect(original.turns[0].assistant.content).toBe('private')
  })
})

describe('server recovery and explicitly unsaved local output', () => {
  it('does not replace a same-run same-attempt unsaved tail with the saved prefix', () => {
    const recovered = recoverTurnWithLocalOutput(run, 'zh-CN', saved)
    expect(recovered.answer).toBe(local.answer); expect(recovered.outputPersistenceFailed).toBe(true)
    expect(recovered.outputAttempts).toContainEqual(expect.objectContaining({ attempt_id: 'unsaved:attempt-1', answer: local.answer, status: 'unsaved' }))
    expect(recoverTurnWithLocalOutput(run, 'zh-CN', { ...saved, turn: recovered }).outputAttempts).toEqual(recovered.outputAttempts)
  })
  it('archives the older unsaved attempt alongside the newer authoritative server attempt', () => {
    const newer = { ...run, output_attempts: [{ attempt_id: 'attempt-2', ordinal: 2, created_at: '2026-01-01T00:00:00Z', answer: 'new server answer', status: 'active' }] }
    const recovered = recoverTurnWithLocalOutput(newer, 'en-US', saved)
    expect(recovered.answer).toBe('new server answer'); expect(recovered.outputPersistenceFailed).toBe(false)
    expect(recovered.outputAttempts?.at(-1)).toMatchObject({ status: 'unsaved', answer: local.answer })
  })
  it('never merges an unrelated run and never resurrects a deletion tombstone', () => {
    expect(recoverTurnWithLocalOutput({ ...run, run_id: 'other' }, 'zh-CN', saved).answer).toBe('已保存前缀')
    for (const deleted of [{ ...run, partial_answer: DELETED_MATERIAL_ANSWER }, { ...run, output_attempts: run.output_attempts?.map(v => ({ ...v, answer: DELETED_MATERIAL_ANSWER })) }]) {
      const recovered = recoverTurnWithLocalOutput(deleted, 'zh-CN', saved)
      expect(recovered.answer).toBe(DELETED_MATERIAL_ANSWER)
      expect(recovered.outputAttempts?.every(v => v.answer === DELETED_MATERIAL_ANSWER)).toBe(true)
    }
  })
  it('preserves writing-action echo suppression and visible failure wording', () => {
    const writing = { ...run, idempotency_key: 'writing-ui:action', request: { ...run.request, writing_context: { document_id: 'doc', document_version: 1 } } }
    expect(recoverTurnWithLocalOutput(writing, 'en-US', null)).toMatchObject({ question: '', failure: 'This answer did not finish. Retry from the saved state.' })
  })
})

it('does not replace saved server text with an empty local persistence-failure view', () => {
  const recovered = recoverTurnWithLocalOutput(run, 'zh-CN', { ...saved, turn: { ...local, answer: '' } })
  expect(recovered.answer).toBe('已保存前缀')
  expect(recovered.outputPersistenceFailed).toBe(false)
})
