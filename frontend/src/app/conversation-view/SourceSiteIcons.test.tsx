import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentCitation } from '../../modules/research-agent'
import { ConversationThread } from './ConversationThread'
import { ConversationSourcePanel } from './ConversationSourcePanel'
import { toolResultSiteUrl } from './toolResultSiteUrl'

afterEach(cleanup)
const citation: AgentCitation = { citation_id: 'web:https://townscapergame.com/page', label: 'Townscaper', kind: 'source', source_kind: 'web', source_id: 'https://townscapergame.com/page?private=1' }
it('renders final citation and right-panel list/detail icons without changing selection', () => {
  const select = vi.fn()
  render(<><ConversationThread turns={[{ id: 'turn', question: '问题', answer: '答案', citations: [citation] }]} onSelectCitation={select} /><ConversationSourcePanel citations={[citation]} onClose={() => {}} onSelectCitation={select} /></>)
  const final = screen.getByRole('button', { name: '查看证据：Townscaper' })
  expect(within(final).getByRole('img')).toHaveAttribute('src', 'https://townscapergame.com/favicon.ico')
  fireEvent.click(final)
  expect(select).toHaveBeenCalledWith(citation, null, 'turn')
  const row = screen.getByRole('button', { name: '1 Townscaper' })
  expect(within(row).getByRole('img')).toBeVisible()
  fireEvent.click(row)
  expect(select).toHaveBeenLastCalledWith(citation)
  cleanup()
  render(<ConversationSourcePanel detail={{ citation }} onClose={() => {}} />)
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://townscapergame.com/favicon.ico')
})
it('shows search-result logos in the workflow and opened activity', () => {
  const step = { id: 'search', tool: 'search_web', label: '搜索网页', status: 'completed' as const, output: { items: [{ title: 'Townscaper', url: citation.source_id }] }, resultItems: [{ id: 'result', title: 'Townscaper' }] }
  const view = render(<ConversationSourcePanel toolSteps={[step]} onSelectActivity={() => {}} onClose={() => {}} />)
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://townscapergame.com/favicon.ico')
  view.rerender(<ConversationSourcePanel activity={step} onClose={() => {}} />)
  const icon = screen.getByRole('img')
  fireEvent.error(icon)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('Townscaper')).toBeVisible()
})
it('does not request icons for deleted, non-web or invalid sources', () => {
  render(<ConversationSourcePanel citations={[{ ...citation, deleted: true }, { ...citation, citation_id: 'file', source_kind: 'research_material', kind: 'research_material' }, { ...citation, citation_id: 'invalid', source_id: 'javascript:alert(1)' }]} onSelectCitation={() => {}} onClose={() => {}} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
it('keeps result positions aligned with existing title rendering', () => {
  expect(toolResultSiteUrl({ items: [null, 'skip', { url: 'https://example.com/' }, { source_id: 'https://github.com/' }] }, 1)).toBe('https://github.com/')
  expect(toolResultSiteUrl([{ url: 'https://example.com/' }], 0)).toBe('https://example.com/')
  expect(toolResultSiteUrl(null, 0)).toBeNull()
})
