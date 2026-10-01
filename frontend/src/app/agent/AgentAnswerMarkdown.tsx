import type { Nodes, PhrasingContent, Root } from 'mdast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { parseCitationText, type AgentCitation } from '../../modules/research-agent'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { remarkProgressParagraphs } from './remarkProgressParagraphs'

function remarkAgentCitations({ citations }: { citations: readonly AgentCitation[] }) {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text') {
          visit(child)
          return [child]
        }
        return parseCitationText(child.value, citations).map((part): PhrasingContent => part.type === 'text'
          ? { type: 'text', value: part.value }
          : { type: 'link', url: `#everplain-source-${part.index + 1}`, children: [{ type: 'text', value: `[${part.index + 1}]` }] })
      }) as typeof node.children
    }
    visit(tree)
  }
}

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
  const { text } = useAppLocale()
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, ...(progress ? [remarkProgressParagraphs] : []), [remarkAgentCitations, { citations }]]}
    components={{
      a: ({ href, children: label, ...props }) => {
        const match = href?.match(/^#everplain-source-(\d+)$/)
        const index = match ? Number(match[1]) - 1 : -1
        const citation = citations[index]
        if (match && citation && !citation.deleted) {
          return <button
            type="button"
            className="new-research__citation-chip"
            aria-label={text(`查看来源 ${index + 1}：${citation.label}`, `View source ${index + 1}: ${citation.label}`)}
            onClick={() => onSelectCitation(citation)}
          >[{index + 1}]</button>
        }
        return <a href={href} title={props.title}>{label}</a>
      },
    }}
  >{children}</ReactMarkdown>
}
