import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentKnowledgeEditor } from './DocumentKnowledgeEditor'
import type { SharedSource } from '../../modules/shared-knowledge'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const source: SharedSource = {
  knowledgeBaseId: 'kb-1', knowledgeBaseName: 'Personal research',
  document: { id: 'doc-1', filename: 'notes.txt', mediaType: 'text/plain', sizeBytes: 20, parseId: 'p1', status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '', knowledge: { summary: 'Summary', topics: [{ title: 'Topic', summary: 'Evidence', segmentIds: ['s1'] }], relations: [] } },
  segments: [{ id: 's1', parseId: 'p1', ordinal: 0, kind: 'paragraph', text: 'Original evidence', location: { page: null, headingPath: [], paragraph: 1, lineStart: null, lineEnd: null, charStart: null, charEnd: null, blockIndex: null } }],
}

it('saves edited knowledge with original source anchors through the generated API', async () => {
  let submitted: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.url).toContain('/kb-1/documents/doc-1/knowledge')
    expect(request.method).toBe('PUT')
    submitted = await request.json()
    return new Response(JSON.stringify({ id: 'doc-1', filename: 'notes.txt', status: 'ready', knowledge_status: 'ready', knowledge: submitted }), { headers: { 'Content-Type': 'application/json' } })
  })
  const saved = vi.fn()
  render(<DocumentKnowledgeEditor source={source} onSaved={saved} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('资料摘要'), { target: { value: 'Updated summary' } })
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(submitted).toEqual({ summary: 'Updated summary', topics: [{ title: 'Topic', summary: 'Evidence', segment_ids: ['s1'] }], relations: [] })
  expect(saved.mock.calls[0][0].knowledge.topics[0].segmentIds).toEqual(['s1'])
})

it('keeps changes available when source validation refuses the update', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: '原文已删除，请重新选择来源。' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
  render(<DocumentKnowledgeEditor source={source} onSaved={() => {}} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('资料摘要'), { target: { value: 'Unsaved summary' } })
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('原文已删除')
  expect(screen.getByLabelText('资料摘要')).toHaveValue('Unsaved summary')
})
