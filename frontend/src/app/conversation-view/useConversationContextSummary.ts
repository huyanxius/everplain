import { useQuery } from '@tanstack/react-query'
import { getConversationContextSummary } from '../../modules/research-agent'

export const conversationContextSummaryKey = (userId: string | null) => ['conversation-context-summary', userId] as const

// Both the home desk and a new Chat observe the same user-scoped server cache.
// Only an awaited background result/retry is polled. Reads never dispatch a model.
export function useConversationContextSummary(userId: string | null) {
  return useQuery({
    queryKey: conversationContextSummaryKey(userId),
    queryFn: ({ signal }) => getConversationContextSummary(signal),
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
    refetchInterval: query => {
      if (query.state.status === 'error') return false
      const data = query.state.data
      if (data?.status === 'pending') return 15_000
      if (data?.status !== 'failed' || !data.retry_at) return false
      const retryAt = Date.parse(data.retry_at)
      return Number.isFinite(retryAt) ? Math.max(15_000, Math.min(900_000, retryAt - Date.now())) : false
    },
    refetchIntervalInBackground: false,
  })
}
