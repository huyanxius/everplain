import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRunStopResult } from '../../modules/research-agent'
import { AgentTurnController } from './agentTurnController'
import type { PendingTurnAttempt } from './conversationState'

const attempt: PendingTurnAttempt = { question: 'original\nquestion', idempotencyKey: 'key-1', conversationId: 'conversation-1', runId: 'run-1', materialIds: ['m'], request: { message: 'original\nquestion', model_id: 'fixed-model', reasoning_effort: 'high', writing_context: { document_id: 'doc', document_version: 4 } } }
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
function harness() {
  const streams: Array<{ event: (e: AgentEvent) => void; signal?: AbortSignal; pending: ReturnType<typeof deferred<void>> }> = []
  const stream = vi.fn((_request, event: (e: AgentEvent) => void, signal?: AbortSignal, _resume?) => {
    const pending = deferred<void>(); streams.push({ event, signal, pending }); return pending.promise
  })
  const stop = vi.fn(async (_runId: string): Promise<AgentRunStopResult> => ({ run_id: 'run-1', status: 'interrupted', cancel_requested: true }))
  return { controller: new AgentTurnController(null, { stream, stop }), streams, stream, stop }
}

describe('AgentTurnController execution identity and observation', () => {
  it('passes the original request and exact GET resume cursor through the existing transport', async () => {
    const { controller, stream, streams } = harness(); const event = vi.fn()
    controller.prepare(attempt); const ticket = controller.beginSubscription()
    const request = { ...attempt.request!, idempotencyKey: attempt.idempotencyKey }
    const resume = { runId: 'run-1', after: 79 }
    const pending = controller.resumeSubscription(ticket, request, resume, event)
    expect(stream.mock.calls[0][0]).toBe(request)
    expect(stream.mock.calls[0][3]).toBe(resume)
    const output: AgentEvent = { type: 'assistant_delta', delta: ' 原样\n\n `x` ' }
    streams[0].event(output); expect(event).toHaveBeenCalledExactlyOnceWith(output)
    streams[0].pending.resolve(); await pending
    expect(controller.finishSubscription(ticket)).toBe(true)
    streams[0].event(output); expect(event).toHaveBeenCalledTimes(1)
  })
  it('detaches without sending stop and fences late events before a new owner/conversation lease', async () => {
    const { controller, stop, streams } = harness(); const old = vi.fn(); const next = vi.fn()
    controller.prepare(attempt); const a = controller.beginSubscription()
    const pa = controller.startCommand(a, { ...attempt.request!, idempotencyKey: 'key-1' }, old)
    controller.detach(); controller.restore(null)
    const b = controller.beginSubscription(); const pb = controller.startCommand(b, { message: 'new', idempotencyKey: 'new' }, next)
    streams[0].event({ type: 'assistant_delta', delta: 'private old answer' })
    expect(old).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(a.signal.aborted).toBe(true)
    expect(controller.finishSubscription(a)).toBe(false); expect(controller.isSubscribed).toBe(true)
    streams[1].event({ type: 'assistant_delta', delta: 'new answer' }); expect(next).toHaveBeenCalledTimes(1)
    streams.forEach(s => s.pending.resolve()); await Promise.all([pa, pb])
  })
  it('does not begin two simultaneous subscriptions', () => {
    const { controller } = harness(); controller.beginSubscription()
    expect(() => controller.beginSubscription()).toThrow('already active')
  })
  it('owns active, failed, recovered and completed identities without changing the request', () => {
    const { controller, stream, stop } = harness()
    controller.restore(attempt, 'running'); expect(controller.activeAttempt).toBe(attempt)
    controller.fail(attempt); expect(controller.activeAttempt).toBeNull(); expect(controller.failedAttempt).toBe(attempt)
    controller.prepare(attempt); expect(controller.failedAttempt).toBeNull()
    const bound = { ...attempt, runId: 'run-2' }; controller.bindRun(bound)
    expect(controller.interrupt()).toBe(bound); expect(controller.failedAttempt).toBe(bound)
    controller.restore(attempt, 'awaiting_plan_confirmation'); expect(controller.activeAttempt).toBe(attempt)
    controller.complete(); expect(controller.activeAttempt).toBeNull(); expect(controller.failedAttempt).toBeNull()
    expect(stream).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled()
  })
  it('does not confuse disposal with confirmed stop and retries a failed stop without losing the lease', async () => {
    const { controller, stop } = harness(); controller.prepare(attempt); const ticket = controller.beginSubscription()
    stop.mockRejectedValueOnce(new Error('stop not acknowledged'))
    await expect(controller.stop()).rejects.toThrow('not acknowledged')
    expect(controller.pausePending).toBe(false); expect(controller.isCurrent(ticket)).toBe(true)
    expect(controller.activeAttempt).toBe(attempt)
    await expect(controller.stop()).resolves.toBe('stopped')
    expect(ticket.signal.aborted).toBe(true); expect(controller.isSubscribed).toBe(false)
    expect(controller.interrupt()).toBe(attempt); expect(controller.failedAttempt).toBe(attempt)
    expect(stop).toHaveBeenCalledTimes(2)
  })
  it('deduplicates repeated pause clicks while preserving server confirmation', async () => {
    const { controller, stop } = harness(); const result = deferred<AgentRunStopResult>()
    stop.mockReturnValue(result.promise); controller.prepare(attempt); const ticket = controller.beginSubscription()
    const first = controller.stop(); const second = controller.stop()
    expect(stop).toHaveBeenCalledTimes(1); expect(controller.pausePending).toBe(true); expect(ticket.signal.aborted).toBe(false)
    result.resolve({ run_id: 'run-1', status: 'interrupted', cancel_requested: true })
    expect(await first).toBe('stopped'); expect(await second).toBe('stopped')
  })
  it.each(['success', 'failure'] as const)('ignores a late stop %s after scope replacement', async outcome => {
    const { controller, stop } = harness(); const result = deferred<AgentRunStopResult>()
    stop.mockReturnValue(result.promise); controller.prepare(attempt); controller.beginSubscription()
    const pending = controller.stop(); controller.detach(); controller.restore(null)
    const next = controller.beginSubscription()
    if (outcome === 'success') result.resolve({ run_id: 'run-1', status: 'interrupted', cancel_requested: true })
    else result.reject(new Error('old stop failure'))
    expect(await pending).toBe('stale'); expect(controller.isCurrent(next)).toBe(true); expect(controller.pausePending).toBe(false)
  })
  it.each(['success', 'failure'] as const)('preserves terminal completion when a pending stop returns %s', async outcome => {
    const { controller, stop } = harness(); const result = deferred<AgentRunStopResult>()
    stop.mockReturnValue(result.promise); controller.prepare(attempt); controller.beginSubscription()
    const pending = controller.stop(); controller.complete()
    if (outcome === 'success') result.resolve({ run_id: 'run-1', status: 'interrupted', cancel_requested: true })
    else result.reject(new Error('old stop failure'))
    expect(await pending).toBe('completed'); expect(controller.failedAttempt).toBeNull()
  })
  it('reports a server-completed stop without converting the completed turn into a retry', async () => {
    const { controller, stop } = harness(); controller.prepare(attempt); const ticket = controller.beginSubscription()
    stop.mockResolvedValue({ run_id: 'run-1', status: 'completed', cancel_requested: false })
    expect(await controller.stop()).toBe('completed'); expect(ticket.signal.aborted).toBe(false)
  })
})

it('replaces preparation ownership without letting an old finally release a newer document save', () => {
  const { controller } = harness()
  const old = controller.beginPreparation()
  expect(controller.isPreparing).toBe(true)
  expect(() => controller.beginPreparation()).toThrow('already active')
  controller.detach()
  expect(controller.isPreparing).toBe(false)
  const current = controller.beginPreparation()
  expect(controller.isCurrentPreparation(old)).toBe(false)
  expect(controller.finishPreparation(old)).toBe(false)
  expect(controller.isPreparing).toBe(true)
  expect(controller.finishPreparation(current)).toBe(true)
  expect(controller.isPreparing).toBe(false)
})

it('gives terminal delivery and an acknowledged stop only one preview-end notification', async () => {
  const { controller } = harness()
  controller.prepare(attempt); controller.beginSubscription()
  expect(controller.takePreviewCompletion()).toBe(true)
  await controller.stop()
  expect(controller.takePreviewCompletion()).toBe(false)
  controller.beginSubscription()
  await controller.stop()
  expect(controller.takePreviewCompletion()).toBe(true)
  expect(controller.takePreviewCompletion()).toBe(false)
})
