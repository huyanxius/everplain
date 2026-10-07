import { stopAgentRun, streamAgentTurn, type AgentEvent, type AgentStreamResume, type AgentTurnRequest } from '../../modules/research-agent'
import type { PendingTurnAttempt } from './conversationState'

type TurnTransport = {
  stream: typeof streamAgentTurn
  stop: typeof stopAgentRun
}

/** One observation lease. Its generation fences callbacks after navigation or stop. */
export type TurnSubscription = {
  readonly generation: number
  readonly signal: AbortSignal
}

/**
 * Owns execution identity and observation lifetime, independently of React rendering.
 * Detaching is read-only: only stop() may send the explicit server stop command.
 * The existing transport remains the sole SSE sequence/cursor and reconnect owner.
 * It receives the exact original request/key and optional read-only resume cursor.
 */
export class AgentTurnController {
  private transport: TurnTransport
  private subscription: { ticket: TurnSubscription; abort: AbortController } | null = null
  private revision = 0
  private preparation: { generation: number } | null = null
  private current: PendingTurnAttempt | null = null
  private failed: PendingTurnAttempt | null
  private runningId: string | null = null
  private pausing = false
  private previewCompletionPending = false
  private completedRevision = -1
  private stopRequest: { generation: number; promise: Promise<'stopped' | 'completed' | 'stale'> } | null = null

  constructor(failed: PendingTurnAttempt | null = null, transport: TurnTransport = { stream: streamAgentTurn, stop: stopAgentRun }) {
    this.failed = failed
    this.transport = transport
  }

  get generation() { return this.revision }
  get isPreparing() { return this.preparation !== null }
  get isSubscribed() { return this.subscription !== null }
  get activeAttempt() { return this.current }
  get failedAttempt() { return this.failed }
  get pausePending() { return this.pausing }

  beginPreparation() {
    if (this.preparation) throw new Error('A writing preparation is already active')
    const ticket = { generation: this.revision }
    this.preparation = ticket
    return ticket
  }

  isCurrentPreparation(ticket: { generation: number }) {
    return this.preparation === ticket && ticket.generation === this.revision
  }

  finishPreparation(ticket: { generation: number }) {
    if (!this.isCurrentPreparation(ticket)) return false
    this.preparation = null
    return true
  }

  rememberFailure(attempt: PendingTurnAttempt | null) { this.failed = attempt }

  restore(attempt: PendingTurnAttempt | null, status?: string) {
    this.failed = attempt
    this.current = status === 'running' || status?.startsWith('awaiting_') ? attempt : null
    this.runningId = status === 'running' ? attempt?.runId ?? null : null
  }

  prepare(attempt: PendingTurnAttempt) {
    this.current = attempt
    this.failed = null
  }

  bindRun(attempt: PendingTurnAttempt, running = true) {
    this.current = attempt
    this.runningId = running ? attempt.runId ?? null : null
  }

  complete() {
    this.completedRevision = this.revision
    this.runningId = null
    this.pausing = false
    this.current = null
    this.failed = null
  }

  fail(attempt: PendingTurnAttempt) {
    this.runningId = null
    this.pausing = false
    this.failed = attempt
    this.current = null
  }

  interrupt(resumable = true) {
    const attempt = this.current
    if (attempt) {
      this.failed = resumable ? attempt : null
      this.current = null
    }
    this.runningId = null
    this.pausing = false
    return attempt
  }

  beginSubscription(): TurnSubscription {
    if (this.subscription) throw new Error('A turn subscription is already active')
    const abort = new AbortController()
    const ticket = { generation: ++this.revision, signal: abort.signal }
    this.subscription = { ticket, abort }
    this.previewCompletionPending = true
    this.pausing = false
    return ticket
  }

  isCurrent(ticket: TurnSubscription) {
    return ticket.generation === this.revision && !ticket.signal.aborted
  }

  /** Starts or explicitly retries execution using the original idempotency key (POST). */
  startCommand(ticket: TurnSubscription, request: AgentTurnRequest & { idempotencyKey: string }, onEvent: (event: AgentEvent) => void) {
    return this.observe(ticket, request, onEvent)
  }

  /** Reattaches only to saved execution output (GET); never recreates a paid command. */
  resumeSubscription(ticket: TurnSubscription, request: AgentTurnRequest & { idempotencyKey: string }, resume: AgentStreamResume, onEvent: (event: AgentEvent) => void) {
    return this.observe(ticket, request, onEvent, resume)
  }

  private async observe(ticket: TurnSubscription, request: AgentTurnRequest & { idempotencyKey: string }, onEvent: (event: AgentEvent) => void, resume?: AgentStreamResume) {
    if (!this.isCurrent(ticket)) return
    await this.transport.stream(request, event => {
      if (this.subscription?.ticket === ticket && this.isCurrent(ticket)) onEvent(event)
    }, ticket.signal, resume)
  }

  /** Terminal stream and explicit stop share one preview-ended notification. */
  takePreviewCompletion() {
    if (!this.previewCompletionPending) return false
    this.previewCompletionPending = false
    return true
  }

  finishSubscription(ticket: TurnSubscription) {
    if (this.subscription?.ticket !== ticket) return false
    this.subscription = null
    return true
  }

  /** Navigation/backgrounding closes only this subscription, never execution. */
  detach() {
    this.runningId = null
    this.pausing = false
    this.revision += 1
    this.preparation = null
    this.subscription?.abort.abort()
    this.subscription = null
  }

  /** Stop is acknowledged by the server before the local stream is detached. */
  stop(): Promise<'stopped' | 'completed' | 'stale'> {
    if (this.stopRequest?.generation === this.revision) return this.stopRequest.promise
    const pending = { generation: this.revision, promise: this.stopExecution() }
    this.stopRequest = pending
    void pending.promise.finally(() => {
      if (this.stopRequest === pending) this.stopRequest = null
    }).catch(() => { /* The caller owns the visible error and explicit retry. */ })
    return pending.promise
  }

  private async stopExecution(): Promise<'stopped' | 'completed' | 'stale'> {
    const generation = this.revision
    const runId = this.runningId ?? this.current?.runId ?? this.failed?.runId
    this.pausing = true
    if (runId) {
      try {
        const result = await this.transport.stop(runId)
        if (generation !== this.revision) return 'stale'
        if (result.status === 'completed' || this.completedRevision === generation) {
          this.runningId = null
          return 'completed'
        }
      } catch (cause) {
        if (generation !== this.revision) return 'stale'
        if (this.completedRevision === generation) return 'completed'
        this.pausing = false
        throw cause
      }
    }
    this.detach()
    return 'stopped'
  }
}
