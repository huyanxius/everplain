import type { NavigationType } from 'react-router'
import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'

export function ResearchAgentPage({
  userId = null,
  introSessionId = null,
  entryNavigationType,
}: {
  userId?: string | null
  introSessionId?: string | null
  entryNavigationType?: NavigationType
}) {
  return <ResearchAgentConversationPage userId={userId} introSessionId={introSessionId} entryNavigationType={entryNavigationType} />
}
