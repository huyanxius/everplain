import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentAnswerMarkdown } from './AgentAnswerMarkdown'
import type { AgentCitation } from '../../modules/research-agent'

afterEach(cleanup)

it('keeps source numbering stable across Markdown blocks and delegates the exact returned citation', () => {
  const citations: AgentCitation[] = [
    { citation_id: 'unused', label: '其他资料', kind: 'source' },
    { citation_id: 'material:document:segment', knowledge_base_id: 'library', material_id: 'document', segment_id: 'segment', label: '研究笔记', kind: 'research_material' },
  ]
  const select = vi.fn()
  render(<AgentAnswerMarkdown citations={citations} onSelectCitation={select}>{
    '**结论**【material:document:segment】\n\n- 核对来源[material:document:segment]\n\n[外部链接](https://example.com)\n\n`【material:document:segment】`'
  }</AgentAnswerMarkdown>)
  const chips = screen.getAllByRole('button', { name: '查看来源 2：研究笔记' })
  expect(chips).toHaveLength(2)
  expect(chips[0]).toHaveTextContent('[2]')
  fireEvent.click(chips[1])
  expect(select).toHaveBeenCalledWith(citations[1])
  expect(screen.getByRole('link', { name: '外部链接' })).toHaveAttribute('href', 'https://example.com')
  expect(screen.getByText('【material:document:segment】', { selector: 'code' })).toBeVisible()
})

it('waits for a matching source before rendering a chip and removes it when deleted', () => {
  const select = vi.fn()
  const citation: AgentCitation = { citation_id: 'material:document:segment', label: '研究笔记', kind: 'research_material' }
  const { rerender, container } = render(<AgentAnswerMarkdown citations={[]} onSelectCitation={select}>结论【material:document:segment】</AgentAnswerMarkdown>)
  expect(container).toHaveTextContent('结论')
  expect(container).not.toHaveTextContent('material:')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  rerender(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={select}>结论【material:document:segment】</AgentAnswerMarkdown>)
  expect(screen.getByRole('button', { name: '查看来源 1：研究笔记' })).toBeVisible()
  rerender(<AgentAnswerMarkdown citations={[{ ...citation, deleted: true }]} onSelectCitation={select}>结论【material:document:segment】</AgentAnswerMarkdown>)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
