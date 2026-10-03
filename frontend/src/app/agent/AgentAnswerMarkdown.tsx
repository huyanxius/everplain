import { createContext, useContext, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { AgentCitation } from '../../modules/research-agent'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { remarkProgressParagraphs } from './remarkProgressParagraphs'
import { remarkAgentCitations } from './remarkAgentCitations'

type CitationContextValue = {
  citations: readonly AgentCitation[]
  onSelectCitation: (citation: AgentCitation) => void
}

const CitationContext = createContext<CitationContextValue | null>(null)

// Keep the renderer identity stable. Recreating it inside the answer component
// remounts citation buttons on every update and loses the drawer return target.
function CitationLink({ href, children: label, title }: ComponentProps<'a'>) {
  const context = useContext(CitationContext)
  const { text } = useAppLocale()
  const match = href?.match(/^#everplain-source-(\d+)$/)
  const index = match ? Number(match[1]) - 1 : -1
  const citation = context?.citations[index]
  if (match && citation && !citation.deleted) {
    return <button
      type="button"
      className="qx-cite new-research__citation-chip"
      aria-label={text(`查看来源 ${index + 1}：${citation.label}`, `View source ${index + 1}: ${citation.label}`)}
      onClick={() => context?.onSelectCitation(citation)}
    >{index + 1}</button>
  }
  return <a href={href} title={title}>{label}</a>
}

const markdownComponents = { a: CitationLink }

export function AgentAnswerMarkdown({
  children,
  citations,
  onSelectCitation,
  progress = false,
}: {
  children: string
  citations: readonly AgentCitation[]
  onSelectCitation: (citation: AgentCitation) => void
  progress?: boolean
}) {
  return <CitationContext.Provider value={{ citations, onSelectCitation }}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, ...(progress ? [remarkProgressParagraphs] : []), [remarkAgentCitations, { citations }]]}
      components={markdownComponents}
    >{children}</ReactMarkdown>
  </CitationContext.Provider>
}
