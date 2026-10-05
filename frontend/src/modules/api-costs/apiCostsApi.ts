import { apiClient } from '../../api/client'
import { getAdminApiCosts } from '../../api/generated'
import { ApiCostsRequestError, type ApiCostMetrics, type ApiCostsApi } from './apiCostsModel'

type ApiCostResponse = NonNullable<Awaited<ReturnType<typeof getAdminApiCosts>>['data']>

function metrics(value: ApiCostResponse['summary']): ApiCostMetrics {
  return {
    attemptCount: value.attempt_count,
    confirmedUsageAttempts: value.confirmed_usage_attempts,
    confirmedTokenAttempts: value.confirmed_token_attempts,
    unpricedAttempts: value.unpriced_attempts,
    unknownUsageAttempts: value.unknown_usage_attempts,
    notSentAttempts: value.not_sent_attempts,
    activeReservedAttempts: value.active_reserved_attempts,
    pendingUnknownAttempts: value.pending_unknown_attempts,
    missingTokenAttempts: value.missing_token_attempts,
    unverifiedProcurementAttempts: value.unverified_procurement_attempts,
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    cacheReadTokens: value.cache_read_tokens,
    cacheWriteTokens: value.cache_write_tokens,
    reasoningTokens: value.reasoning_tokens,
    cacheReadReportedAttempts: value.cache_read_reported_attempts,
    cacheWriteReportedAttempts: value.cache_write_reported_attempts,
    reasoningReportedAttempts: value.reasoning_reported_attempts,
    referenceCostPico: value.reference_cost_pico,
    activeReservedCostPico: value.active_reserved_cost_pico,
    pendingUnknownCostPico: value.pending_unknown_cost_pico,
    actualProcurementCostPico: value.actual_procurement_cost_pico ?? null,
  }
}

export const apiCostsApi: ApiCostsApi = {
  async read(query, signal) {
    const result = await getAdminApiCosts({
      client: apiClient,
      signal,
      query: {
        start_date: query.startDate,
        end_date: query.endDate,
        group_by: query.groupBy,
        model: query.model || undefined,
        provider_host: query.providerHost || undefined,
        endpoint_id: query.endpointId || undefined,
        user_id: query.userId || undefined,
        cursor: query.cursor,
        limit: query.limit,
      },
    })
    if (!result.data) {
      throw new ApiCostsRequestError(
        result.response?.status === 401 ? '登录已过期，请重新登录。'
          : result.response?.status === 403 ? '仅管理员可以查看 API 成本统计。'
            : result.response?.status === 422 ? '筛选条件无效，请检查日期范围与筛选值。'
              : '暂时无法读取 API 成本统计，请重试。',
        result.response?.status,
      )
    }
    const value = result.data
    return {
      startDate: value.start_date,
      endDate: value.end_date,
      groupBy: value.group_by,
      summary: metrics(value.summary),
      items: value.items.map(item => ({ groupValue: item.group_value, ...metrics(item) })),
      totalGroups: value.total_groups,
      nextCursor: value.next_cursor,
      generatedAt: value.generated_at,
    }
  },
}
