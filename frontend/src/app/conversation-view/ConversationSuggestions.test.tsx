import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationSuggestions } from './ConversationSuggestions'
import { buildConversationSuggestions } from './conversationSuggestionsModel'
import type { AgentConversationSummary } from '../../modules/research-agent'
import type { ResearchMaterial } from '../../modules/research-materials'
const conversation = (title: string, task_id: string | null, updated_at = '2026-10-03'): AgentConversationSummary => ({ title, task_id, updated_at, turn_count: 2, conversation_id: title })
const material = (filename: string, status: ResearchMaterial['status'] = 'ready'): ResearchMaterial => ({ filename, status, materialId: filename, taskId: 'r1', mediaType: 'text/plain', sizeBytes: 12, version: 1, parseVersion: 1, segmentCount: 1, updatedAt: '', errorCode: null })
afterEach(cleanup)
describe('ConversationSuggestions', () => {
  it('shows exactly three useful general cards by default', () => {
    render(<ConversationSuggestions mode="research" onSelect={vi.fn()} />)
    expect(screen.getByRole('region', { name: '通用起步建议' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /缩小研究问题/ })).toBeVisible()
    expect(document.querySelector('details')).toBeNull()
  })
  it('selects a complete prompt only after a click, without submitting', () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn()
    render(<form onSubmit={onSubmit}><ConversationSuggestions mode="research" attachedMaterials={[material('访谈整理.txt')]} onSelect={onSelect} /></form>)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /提炼关键证据/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('「访谈整理.txt」'))
    expect(onSelect.mock.calls[0][0]).toContain('原文位置')
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('keeps ordinary Chat separate from research projects, conversations and files', () => {
    const result = buildConversationSuggestions({ mode: 'chat', projects: [{ task_id: 'r1', project_title: '机密研究', status: 'active' }], conversations: [conversation('机密研究对话', 'r1'), conversation('挑选电脑', null)], attachedMaterials: [material('研究文献.pdf')] }, 'zh-CN')
    expect(JSON.stringify(result)).toContain('挑选电脑')
    expect(JSON.stringify(result)).not.toMatch(/机密研究|研究文献/)
    expect(result.cards.every(card => card.prompt.includes('只把标题当作主题线索'))).toBe(true)
  })
  it('excludes a newer private-library conversation from ordinary Chat suggestions', () => {
    const result = buildConversationSuggestions({ mode: 'chat', conversations: [
      conversation('公开演讲准备', null, '2026-10-01'),
      { ...conversation('私库客户保密问答', null, '2026-10-03'), reference_knowledge_base_id: 'private-library-1' },
    ] }, 'zh-CN')
    expect(result.cards.every(card => card.prompt.includes('公开演讲准备'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('私库客户保密问答')
  })
  it('uses general Chat suggestions when only private-library history is available', () => {
    const result = buildConversationSuggestions({ mode: 'chat', conversations: [
      { ...conversation('私库中的医疗记录', null), reference_knowledge_base_id: 'private-library-2' },
    ] }, 'zh-CN')
    expect(result.label).toBe('通用起步建议')
    expect(JSON.stringify(result)).not.toContain('私库中的医疗记录')
  })
  it('uses the current project and does not leak another project conversation', () => {
    const result = buildConversationSuggestions({ mode: 'research', taskId: 'r2', projects: [{ task_id: 'r1', project_title: '其他项目', status: 'active' }, { task_id: 'r2', project_title: '城市交通', status: 'active' }], conversations: [conversation('隔离会话甲', 'r1')] }, 'zh-CN')
    expect(result.cards).toHaveLength(3)
    expect(JSON.stringify(result)).toContain('城市交通')
    expect(JSON.stringify(result)).not.toMatch(/其他项目|隔离会话甲/)
  })
  it('falls back honestly when data is missing, empty or a file is unavailable', () => {
    const result = buildConversationSuggestions({ mode: 'research', attachedMaterials: [material('已删除.pdf', 'deleted'), material('解析中.pdf', 'processing')], conversations: [conversation('普通Chat', null)] }, 'zh-CN')
    expect(result.label).toBe('通用起步建议')
    expect(JSON.stringify(result)).not.toMatch(/已删除|解析中|普通Chat/)
    expect(result.cards.every(card => card.prompt.includes('先'))).toBe(true)
  })
  it('supports English and long filenames without changing the underlying prompt', () => {
    const filename = `${'a'.repeat(120)}.pdf`
    const result = buildConversationSuggestions({ mode: 'research', attachedMaterials: [material(filename)] }, 'en-US')
    expect(result.label).toBe('From your attached materials')
    expect(result.cards[0].description).toContain('…')
    expect(result.cards[0].prompt).toContain(filename)
    expect(result.cards[0].prompt).toContain('source locations')
  })
  it('stays deterministic and does not reorder the input history', () => {
    const conversations = [conversation('较早话题', null, '2026-10-01'), conversation('最近话题', null, '2026-10-03')]
    const context = { mode: 'chat' as const, conversations }
    expect(buildConversationSuggestions(context, 'zh-CN')).toEqual(buildConversationSuggestions(context, 'zh-CN'))
    expect(buildConversationSuggestions(context, 'zh-CN').cards[0].prompt).toContain('最近话题')
    expect(conversations[0].title).toBe('较早话题')
  })
})
