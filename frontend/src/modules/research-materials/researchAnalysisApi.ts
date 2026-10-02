import { apiClient } from '../../api/client'
import { createResearchAnalysisAnnotation, createResearchAnalysisMemo, createResearchCaseComparison, decideResearchAnalysisMemo, decideResearchCaseComparison, getResearchAnalysis, getResearchCycle } from '../../api/generated'
import type { AnalysisAnnotation, AnalysisMemo, CaseComparison, CreateAnalysisAnnotationInput, CreateAnalysisMemoInput, CreateCaseComparisonInput, DecideAnalysisRecordInput, ResearchAnalysisSnapshot } from './researchAnalysisModel'
import type { ResearchCycleSnapshot } from './researchCycleModel'

export class ResearchAnalysisApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ResearchAnalysisApiError'
    this.status = status
  }
}

type GeneratedResult<T> = {
  readonly data?: T
  readonly error?: unknown
  readonly response?: Response
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function errorMessage(error: unknown, fallback: string): string {
  const raw = record(error)
  const nested = record(raw.error)
  if (typeof nested.message === 'string' && nested.message.trim()) return nested.message
  if (typeof raw.message === 'string' && raw.message.trim()) return raw.message
  return fallback
}

function requireData<T>(result: GeneratedResult<T>, fallback: string): T {
  if (result.error !== undefined && result.error !== null) {
    if (record(result.error).name === 'AbortError') throw result.error
    throw new ResearchAnalysisApiError(
      errorMessage(result.error, fallback),
      result.response?.status ?? 0,
    )
  }
  if (result.data === undefined || result.data === null) {
    throw new ResearchAnalysisApiError(fallback, result.response?.status ?? 0)
  }
  return result.data
}

function idempotencyKey(): string {
  const token = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`
  return `research-analysis:${token}`
}

export async function getAnalysisSnapshot(
  taskId: string,
  signal?: AbortSignal,
): Promise<ResearchAnalysisSnapshot> {
  const result = await getResearchAnalysis({
    client: apiClient,
    path: { task_id: taskId },
    signal,
  })
  return requireData(result, '研究分析记录暂时无法加载。')
}

export async function getResearchCycleSnapshot(
  taskId: string,
  signal?: AbortSignal,
): Promise<ResearchCycleSnapshot> {
  const result = await getResearchCycle({
    client: apiClient,
    path: { task_id: taskId },
    signal,
  })
  const snapshot = requireData(result, '研究循环暂时无法加载。')
  if (snapshot.schema_version !== 'research-cycle-v1') {
    throw new ResearchAnalysisApiError(
      '研究循环返回了不受支持的版本。',
      result.response?.status ?? 0,
    )
  }
  return snapshot
}

export async function createAnalysisAnnotation(
  taskId: string,
  body: CreateAnalysisAnnotationInput,
  signal?: AbortSignal,
): Promise<AnalysisAnnotation> {
  const result = await createResearchAnalysisAnnotation({
    client: apiClient,
    path: { task_id: taskId },
    headers: { 'Idempotency-Key': idempotencyKey() },
    body,
    signal,
  })
  return requireData(result, '片段标记未保存。')
}

export async function createAnalysisMemo(
  taskId: string,
  body: CreateAnalysisMemoInput,
  signal?: AbortSignal,
): Promise<AnalysisMemo> {
  const result = await createResearchAnalysisMemo({
    client: apiClient,
    path: { task_id: taskId },
    headers: { 'Idempotency-Key': idempotencyKey() },
    body,
    signal,
  })
  return requireData(result, '分析备忘未保存。')
}

export async function decideAnalysisMemo(
  taskId: string,
  memoId: string,
  body: DecideAnalysisRecordInput,
  signal?: AbortSignal,
): Promise<AnalysisMemo> {
  const result = await decideResearchAnalysisMemo({
    client: apiClient,
    path: { task_id: taskId, memo_id: memoId },
    headers: { 'Idempotency-Key': idempotencyKey() },
    body,
    signal,
  })
  return requireData(result, '备忘草稿判断未保存。')
}

export async function createCaseComparison(
  taskId: string,
  body: CreateCaseComparisonInput,
  signal?: AbortSignal,
): Promise<CaseComparison> {
  const result = await createResearchCaseComparison({
    client: apiClient,
    path: { task_id: taskId },
    headers: { 'Idempotency-Key': idempotencyKey() },
    body,
    signal,
  })
  return requireData(result, '案例比较未保存。')
}

export async function decideCaseComparison(
  taskId: string,
  comparisonId: string,
  body: DecideAnalysisRecordInput,
  signal?: AbortSignal,
): Promise<CaseComparison> {
  const result = await decideResearchCaseComparison({
    client: apiClient,
    path: { task_id: taskId, comparison_id: comparisonId },
    headers: { 'Idempotency-Key': idempotencyKey() },
    body,
    signal,
  })
  return requireData(result, '案例比较判断未保存。')
}
