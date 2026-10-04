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
  expect(chips[0]).toHaveTextContent(/^2$/)
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


it('retains citation buttons across updates and dispatches to the latest handler', () => {
  const citation: AgentCitation = { citation_id: 'material:document:segment', label: '研究笔记', kind: 'research_material' }
  const first = vi.fn()
  const latest = vi.fn()
  const { rerender } = render(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={first}>结论【material:document:segment】</AgentAnswerMarkdown>)
  const trigger = screen.getByRole('button', { name: '查看来源 1：研究笔记' })
  trigger.focus()
  rerender(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={latest}>结论【material:document:segment】</AgentAnswerMarkdown>)
  expect(screen.getByRole('button', { name: '查看来源 1：研究笔记' })).toBe(trigger)
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  expect(latest).toHaveBeenCalledWith(citation)
  expect(first).not.toHaveBeenCalled()
})

it('renders URL citation aliases before GFM can swallow their Chinese punctuation', () => {
  const citation: AgentCitation = {
    citation_id: 'web:https://example.invalid/qa-source-36', label: '网页资料',
    kind: 'source', source_kind: 'web', source_id: 'https://example.invalid/qa-source-36',
  }
  const select = vi.fn()
  const { container } = render(<AgentAnswerMarkdown citations={[{ citation_id: 'unused', label: '其他资料', kind: 'source' }, citation]} onSelectCitation={select}>{
    '结论【web:https://example.invalid/qa-source-36】。后一句，再次【web:https://example.invalid/qa-source-36】；也见[web:https://example.invalid/qa-source-36]。'
  }</AgentAnswerMarkdown>)
  const chips = screen.getAllByRole('button', { name: '查看来源 2：网页资料' })
  expect(chips).toHaveLength(3)
  expect(container).toHaveTextContent('结论2。后一句，再次2；也见2。')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  fireEvent.click(chips[1])
  expect(select).toHaveBeenCalledWith(citation)
})

it('preserves ordinary links and literal citation syntax inside code', () => {
  const citation: AgentCitation = {
    citation_id: 'web:https://example.invalid/qa-source-36', label: '网页资料',
    kind: 'source', source_kind: 'web', source_id: 'https://example.invalid/qa-source-36',
  }
  render(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={vi.fn()}>{[
    'https://example.invalid/plain',
    '[网页](https://example.invalid/page)',
    '[web:https://example.invalid/qa-source-36](https://example.invalid/explicit)',
    '[引用【web:https://example.invalid/qa-source-36】](https://example.invalid/label)',
    '[web:https://example.invalid/qa-source-36][reference]',
    '[reference]: https://example.invalid/reference',
    '`【web:https://example.invalid/qa-source-36】`',
    '```text\n【web:https://example.invalid/qa-source-36】\n```',
  ].join('\n\n')}</AgentAnswerMarkdown>)
  expect(screen.getByRole('link', { name: 'https://example.invalid/plain' })).toHaveAttribute('href', 'https://example.invalid/plain')
  expect(screen.getByRole('link', { name: '网页' })).toHaveAttribute('href', 'https://example.invalid/page')
  expect(screen.getAllByRole('link', { name: 'web:https://example.invalid/qa-source-36' })[0]).toHaveAttribute('href', 'https://example.invalid/explicit')
  expect(screen.getByRole('link', { name: '引用【web:https://example.invalid/qa-source-36】' })).toHaveAttribute('href', 'https://example.invalid/label')
  expect(screen.getAllByRole('link', { name: 'web:https://example.invalid/qa-source-36' })).toHaveLength(2)
  expect(screen.getAllByText('【web:https://example.invalid/qa-source-36】', { selector: 'code' })).toHaveLength(2)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})


it('keeps the existing hidden-marker contract for unmatched, deleted and partial URL citations', () => {
  const citation: AgentCitation = { citation_id: 'web:https://example.invalid/qa-source-36', label: '网页资料', kind: 'source', source_kind: 'web', source_id: 'https://example.invalid/qa-source-36' }
  const select = vi.fn()
  const { container, rerender } = render(<AgentAnswerMarkdown citations={[]} onSelectCitation={select}>结论【web:https://example.invalid/qa-source-36】。普通【未知标注】。</AgentAnswerMarkdown>)
  expect(container).toHaveTextContent('结论。普通【未知标注】。')
  expect(container).not.toHaveTextContent('example.invalid')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  rerender(<AgentAnswerMarkdown citations={[{ ...citation, deleted: true }]} onSelectCitation={select}>结论【web:https://example.invalid/qa-source-36】。</AgentAnswerMarkdown>)
  expect(container).toHaveTextContent('结论。')
  expect(container).not.toHaveTextContent('example.invalid')
  rerender(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={select}>结论【web:https://example.invalid/qa-source-</AgentAnswerMarkdown>)
  expect(container).toHaveTextContent(/^结论$/)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('leaves a citation-shaped shortcut reference as an authored Markdown link', () => {
  const citation: AgentCitation = { citation_id: 'source:known', label: '来源', kind: 'source' }
  render(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={vi.fn()}>{
    '[source:known]\n\n[source:known]: https://example.invalid/reference'
  }</AgentAnswerMarkdown>)
  expect(screen.getByRole('link', { name: 'source:known' })).toHaveAttribute('href', 'https://example.invalid/reference')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('maps stream color to source offsets through Markdown, escapes, entities and a whole citation', () => {
  const source = '**粗体** 后文 &amp; 结论【source:known】。'
  const citation: AgentCitation = { citation_id: 'source:known', label: '真实资料', kind: 'source' }
  const times = Array.from({ length: source.length }, (_, i) => 100 + i * 10)
  const { container, rerender } = render(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 700 }}>{source}</AgentAnswerMarkdown>)
  expect(container.querySelector('strong')).toHaveTextContent('粗体')
  expect(container.querySelector('strong span')!.getAttribute('style')).toBe('--age: -580.0ms;')
  const chip = screen.getByRole('button', { name: '查看来源 1：真实资料' })
  expect(chip).toHaveClass('stream-fresh-cite'); expect(chip.querySelector('span')).toBeNull()
  expect(chip.getAttribute('style')).toContain(`--age: -${(700 - times[source.indexOf('】')]).toFixed(1)}ms`)
  expect(container).toHaveTextContent('粗体 后文 & 结论1。')
  chip.focus()
  rerender(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 1000 }}>{source}</AgentAnswerMarkdown>)
  expect(screen.getByRole('button', { name: '查看来源 1：真实资料' })).toBe(chip)
  expect(chip).toHaveFocus()
  rerender(<AgentAnswerMarkdown citations={[citation]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 2200 }}>{source}</AgentAnswerMarkdown>)
  expect(container.querySelectorAll('.stream-fresh, .stream-fresh-cite')).toHaveLength(0)
  expect(container).toHaveTextContent('粗体 后文 & 结论1。')
})

it('keeps progress sentence offsets and does not restart characters when Markdown closes', () => {
  const source = '第一句。  第二句。'
  const times = Array.from({ length: source.length }, (_, i) => i * 10)
  const { container, rerender } = render(<AgentAnswerMarkdown progress citations={[]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 500 }}>{source}</AgentAnswerMarkdown>)
  expect(container.querySelectorAll('p')).toHaveLength(2)
  expect(container.querySelectorAll('p')[1].querySelector('span')!.getAttribute('style')).toBe('--age: -440.0ms;')
  rerender(<AgentAnswerMarkdown citations={[]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 600 }}>{'**粗'}</AgentAnswerMarkdown>)
  rerender(<AgentAnswerMarkdown citations={[]} onSelectCitation={vi.fn()} reveal={{ revealedAt: times, now: 800 }}>{'**粗**'}</AgentAnswerMarkdown>)
  expect(container.querySelector('strong span')!.getAttribute('style')).toBe('--age: -780.0ms;')
})
