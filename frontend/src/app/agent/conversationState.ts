import type { AgentCitation, AgentContextCard, AgentDeliveryState, AgentEvent, AgentOutputAttempt, AgentToolStep, AgentTurnRequest } from '../../modules/research-agent'
import type { ResearchCanvasStreamingTurn } from '../../modules/research-workspace'

export const MAX_AGENT_MESSAGE_LENGTH = 12_000
export const DELETED_MATERIAL_ANSWER = '该回答引用的个人研究材料已删除，原回答内容已隐藏。'

export type AgentToolEvent = Extract<AgentEvent, { type: 'tool_started' | 'tool_finished' | 'tool_failed' }>
export type ResearchToolStep = AgentToolStep & { interrupted?: boolean }
export type StreamingTurn = {
  contextCard?: AgentContextCard | null
  runId?: string | null
  attemptId?: string | null
  outputAttempts?: AgentOutputAttempt[]
  outputPersistenceFailed?: boolean
  deliveryState?: AgentDeliveryState
  progressEnd?: number
  question: string
  answer: string
  citations: AgentCitation[]
  toolSteps: ResearchToolStep[]
  canvasPatches: ResearchCanvasStreamingTurn['canvasPatches']
  startedAt: number
  interrupted?: boolean
  failure?: string
}
export type PendingTurnAttempt = Readonly<{
  contextCard?: AgentContextCard | null
  question: string
  idempotencyKey: string
  conversationId: string | null
  runId?: string | null
  materialIds: string[]
  request?: AgentTurnRequest
}>


export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

