import type { AgentCitation } from '../../modules/research-agent'
import { SiteIcon } from '../ui/SiteIcon'

export function CitationSiteIcon({ citation }: { citation: AgentCitation }) {
  if (citation.deleted || citation.source_kind !== 'web') return null
  return <SiteIcon url={citation.source_id} />
}
