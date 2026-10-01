import type { AgentCitation } from './model'

export type CitationTextPart = { type: 'text'; value: string } | { type: 'citation'; index: number }

const markerBody = '(?:citation_id:[^\\s\\[\\]【】]+|(?:knowledge|source|material|web):[^\\s\\[\\]【】]+)'
const citationMarkers = new RegExp(`\\[(${markerBody})\\]|【(${markerBody})】`, 'g')
const unfinishedMarker = /(?:\[|【)(?:citation_id|knowledge|source|material|web):[^\s\[\]【】]*$/

export function stripCitationMarkers(value: string) {
  return value.replace(citationMarkers, '').replace(unfinishedMarker, '')
}

/** Numbered links always resolve to a source returned for this answer, never to model-supplied IDs alone. */
export function parseCitationText(value: string, citations: readonly AgentCitation[]): CitationTextPart[] {
  const aliases = new Map<string, number | null>()
  citations.forEach((citation, index) => {
    const keys = [citation.citation_id.replace(/^citation_id:/, '')]
    if (citation.material_id && citation.segment_id) keys.push(`material:${citation.material_id}:${citation.segment_id}`)
    if (citation.knowledge_id) keys.push(`knowledge:${citation.knowledge_id}`)
    if (citation.source_id) keys.push(`${citation.source_kind === 'web' ? 'web' : 'source'}:${citation.source_id}`)
    for (const key of new Set(keys)) {
      aliases.set(key, aliases.has(key) ? null : citation.deleted ? null : index)
    }
  })
  const parts: CitationTextPart[] = []
  const text = value.replace(unfinishedMarker, '')
  let cursor = 0
  for (const match of text.matchAll(citationMarkers)) {
    if (match.index > cursor) parts.push({ type: 'text', value: text.slice(cursor, match.index) })
    const key = (match[1] ?? match[2]).replace(/^citation_id:/, '')
    const index = aliases.get(key)
    if (index !== null && index !== undefined) parts.push({ type: 'citation', index })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) })
  return parts
}

export function citationGroup(citation: AgentCitation): 'knowledge' | 'web' | 'material' {
  if (citation.knowledge_base_id || citation.source_kind === 'shared_material' || citation.source_kind === 'personal_knowledge') return 'knowledge'
  if (citation.source_kind === 'web') return 'web'
  if (citation.kind === 'material' || citation.kind === 'research_material') return 'material'
  return 'knowledge'
}
