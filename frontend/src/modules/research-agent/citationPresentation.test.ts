import { describe, expect, it } from 'vitest'
import type { AgentCitation } from './model'
import { citationGroup, parseCitationText } from './citationPresentation'
import { collectReferences, displayAgentText } from './researchReportContent'

const citation: AgentCitation = {
  citation_id: 'known-citation',
  label: '产品研究.pdf',
  kind: 'research_material',
  source_kind: 'research_material',
  knowledge_base_id: 'library-1',
  material_id: 'document-1',
  segment_id: 'segment-1',
}

describe('citation presentation', () => {
  it('resolves Chinese and ASCII markers to the existing source number', () => {
    expect(parseCitationText('结论【material:document-1:segment-1】。[citation_id:known-citation]', [citation])).toEqual([
      { type: 'text', value: '结论' },
      { type: 'citation', index: 0 },
      { type: 'text', value: '。' },
      { type: 'citation', index: 0 },
    ])
  })

  it('never fabricates sources for unknown, ambiguous or deleted markers', () => {
    expect(parseCitationText('结论【material:document-1:other-segment】', [citation])).toEqual([{ type: 'text', value: '结论' }])
    expect(parseCitationText('【material:document-1:segment-1】', [{ ...citation, deleted: true }])).toEqual([])
    expect(parseCitationText('【material:document-1:segment-1】', [citation, { ...citation, citation_id: 'another', knowledge_base_id: 'other-library' }])).toEqual([])
  })

  it('hides incomplete streaming markers and strips internal markers from copy and export text', () => {
    expect(parseCitationText('结论【material:document-1:', [citation])).toEqual([{ type: 'text', value: '结论' }])
    expect(displayAgentText('结论【material:document-1:segment-1】。[source:source-1]')).toBe('结论。')
  })

  it('classifies a document in a personal library separately from standalone uploads', () => {
    expect(citationGroup(citation)).toBe('knowledge')
    expect(citationGroup({ ...citation, knowledge_base_id: null })).toBe('material')
    expect(citationGroup({ ...citation, source_kind: 'shared_material', knowledge_base_id: null })).toBe('knowledge')
    expect(collectReferences([citation])[0]).toMatchObject({ group: 'knowledge', title: '产品研究.pdf', detail: null })
  })
})
