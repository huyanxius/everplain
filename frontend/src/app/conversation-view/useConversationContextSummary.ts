import { useQuery } from '@tanstack/react-query'
import { getConversationContextSummary } from '../../modules/research-agent'

export const conversationContextSummaryKey = (userId: string | null) => ['conversation-context-summary', userId] as const

// Both the home desk and a new Chat observe the same user-scoped server cache.
// A ready, empty, failed or disabled response never starts a polling loop.
export function useConversationContextSummary(userId: string | null) {
  return useQuery({
    queryKey: conversationContextSummaryKey(userId),
    queryFn: ({ signal }) => getConversationContextSummary(signal),
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
    refetchInterval: query => query.state.status !== 'error' && query.state.data?.status === 'pending' ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}
