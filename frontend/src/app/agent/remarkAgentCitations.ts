import type { Literal, Nodes, PhrasingContent, Root } from 'mdast'
import type { Position } from 'unist'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Extension as MicromarkExtension, Tokenizer } from 'micromark-util-types'
import type { Processor } from 'unified'
import type {} from 'remark-parse'

import { parseCitationText, type AgentCitation } from '../../modules/research-agent'

type CitationMarker = Literal & { type: 'agentCitationMarker'; value: string }

declare module 'mdast' {
  interface PhrasingContentMap { agentCitationMarker: CitationMarker }
  interface RootContentMap { agentCitationMarker: CitationMarker }
}
declare module 'micromark-util-types' {
  interface TokenTypeMap { agentCitationMarker: 'agentCitationMarker' }
}

// Recognize only the existing marker grammar in Markdown phrasing, before GFM
// turns a URL alias (and its Chinese closing punctuation) into a literal link.
// Inline/fenced code, destinations and HTML never enter this text construct.
const markerBody = /^(?:citation_id|knowledge|source|material|web):[^\s[\]【】]+$/
const unfinishedBody = /^(?:citation_id|knowledge|source|material|web):[^\s[\]【】]*$/
const tokenizeCitation: Tokenizer = function (effects, ok, nok) {
  const defined = this.parser.defined
  let closing = 0
  let body = ''
  return start

  function start(code: number | null) {
    if (code !== 91 && code !== 12304) return nok(code)
    closing = code === 91 ? 93 : 12305
    effects.enter('agentCitationMarker')
    effects.consume(code)
    return inside
  }

  function inside(code: number | null): ReturnType<Tokenizer> {
    if (code === closing && markerBody.test(body)) {
      effects.consume(code)
      effects.exit('agentCitationMarker')
      return after
    }
    if ((code === null || (code >= -5 && code <= -3)) && unfinishedBody.test(body)) {
      effects.exit('agentCitationMarker')
      return ok(code)
    }
    if (code === null || code <= 32 || [91, 93, 12304, 12305].includes(code)) return nok(code)
    body += String.fromCodePoint(code)
    effects.consume(code)
    return inside
  }

  function after(code: number | null) {
    // Preserve explicit Markdown links and full/collapsed reference labels.
    if (closing === 93 && (code === 40 || code === 91 || defined.includes(body.toLowerCase().toUpperCase()))) return nok(code)
    return ok(code)
  }
}

const citationSyntax: MicromarkExtension = {
  text: { 91: { tokenize: tokenizeCitation }, 12304: { tokenize: tokenizeCitation } },
}
const citationFromMarkdown: FromMarkdownExtension = {
  enter: {
    agentCitationMarker(token) {
      this.enter({ type: 'agentCitationMarker', value: this.sliceSerialize(token) }, token)
    },
  },
  exit: { agentCitationMarker(token) { this.exit(token) } },
}

export function remarkAgentCitations(this: Processor<Root>, { citations }: { citations: readonly AgentCitation[] }) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(citationSyntax)
  ;(data.fromMarkdownExtensions ??= []).push(citationFromMarkdown)

  const citationNodes = (value: string, position?: Position): PhrasingContent[] => {
    let cursor = 0
    const parts = parseCitationText(value, citations)
    if (parts.length === 1 && parts[0].type === 'text' && parts[0].value === value) return [{ type: 'text', value, position }]
    return parts.map(part => {
      if (part.type !== 'text') return { type: 'link', position, url: `#everplain-source-${part.index + 1}`, children: [{ type: 'text', value: `[${part.index + 1}]` }] }
      const start = Math.max(cursor, value.indexOf(part.value, cursor))
      cursor = start + part.value.length
      const point = (relative: number) => {
        const prefix = value.slice(0, relative), lines = prefix.split('\n')
        return { line: position!.start.line + lines.length - 1, column: lines.length > 1 ? lines.at(-1)!.length + 1 : position!.start.column + relative, offset: position!.start.offset === undefined ? undefined : position!.start.offset + relative }
      }
      return { type: 'text', value: part.value, position: position ? { start: point(start), end: point(cursor) } : undefined }
    })
  }

  return (tree: Root) => {
    function visit(node: Nodes, inLink = false) {
      if (!('children' in node)) return
      const protectedLabel = inLink || node.type === 'link' || node.type === 'linkReference'
      node.children = node.children.flatMap((child) => {
        if (child.type === 'agentCitationMarker') {
          return protectedLabel ? [{ type: 'text', value: child.value, position: child.position } as const] : citationNodes(child.value, child.position)
        }
        if (child.type === 'text') return protectedLabel ? [child] : citationNodes(child.value, child.position)
        visit(child, protectedLabel)
        return [child]
      }) as typeof node.children
    }
    visit(tree)
  }
}
