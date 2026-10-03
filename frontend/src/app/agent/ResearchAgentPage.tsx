import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'

export function ResearchAgentPage({
  userId = null,
  introSessionId = null,
}: {
  userId?: string | null
  introSessionId?: string | null
}) {
  return <ResearchAgentConversationPage userId={userId} introSessionId={introSessionId} />
}
