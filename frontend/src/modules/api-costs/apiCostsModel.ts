export type ApiCostGroup = 'day' | 'model' | 'provider_host' | 'endpoint_id' | 'user_id'

export type ApiCostFilters = {
  startDate: string
  endDate: string
  model: string
  providerHost: string
  endpointId: string
  userId: string
  groupBy: ApiCostGroup
  limit: number
}

export type ApiCostQuery = ApiCostFilters & { cursor: number }

export type ApiCostMetrics = {
  attemptCount: number
  confirmedUsageAttempts: number
  confirmedTokenAttempts: number
  unpricedAttempts: number
  unknownUsageAttempts: number
  notSentAttempts: number
  activeReservedAttempts: number
  pendingUnknownAttempts: number
  missingTokenAttempts: number
  unverifiedProcurementAttempts: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
  cacheReadReportedAttempts: number
  cacheWriteReportedAttempts: number
  reasoningReportedAttempts: number
  referenceCostPico: string
  activeReservedCostPico: string
  pendingUnknownCostPico: string
  actualProcurementCostPico: null
}

export type ApiCostReport = {
  startDate: string
  endDate: string
  groupBy: ApiCostGroup
  summary: ApiCostMetrics
  items: Array<ApiCostMetrics & { groupValue: string | null }>
  totalGroups: number
  nextCursor: number | null
  generatedAt: string
}

export type ApiCostsApi = {
  read(query: ApiCostQuery, signal?: AbortSignal): Promise<ApiCostReport>
}

export class ApiCostsRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiCostsRequestError'
    this.status = status
  }
}

export function defaultApiCostFilters(now = new Date()): ApiCostFilters {
  const endDate = now.toISOString().slice(0, 10)
  const start = new Date(`${endDate}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  return { startDate: start.toISOString().slice(0, 10), endDate, model: '', providerHost: '', endpointId: '', userId: '', groupBy: 'model', limit: 25 }
}

export function validateApiCostDates(start: string, end: string): string | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith('0000-')
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!valid(start) || !valid(end)) return '请选择有效的开始与结束日期。'
  if (start > end) return '开始日期不能晚于结束日期。'
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 >= 366) return '一次最多查询 366 天（含开始与结束日期）。'
  return null
}

/** Keep the ledger's exact pico-USD value; never coerce money through Number. */
export function formatPicoUsd(value: string): string {
  if (!/^\d+$/.test(value)) return '金额不可用'
  const digits = value.replace(/^0+(?=\d)/, '').padStart(13, '0')
  const dollars = digits.slice(0, -12).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = digits.slice(-12).replace(/0+$/, '')
  return `USD ${dollars}${fraction ? `.${fraction}` : ''}`
}
