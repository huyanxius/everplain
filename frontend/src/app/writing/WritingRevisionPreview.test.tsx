import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WritingRevisionComparison, WritingRevisionPreview } from './WritingRevisionPreview'
import { pairRevisionBlocks, revisionDocuments } from './revisionPreviewModel'

const editors: Editor[] = []
function create(markdown: string) { const editor = new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown' }); editors.push(editor); return editor }
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('reversible rich revision view', () => {
  it('keeps the exact proposal and comparison visible as inert source when rich parsing fails', () => {
    const before = '# 借伞\n\n原文\n', after = '# 借伞\n\n**未闭合\n<script>alert(1)</script>\n![图片](https://example.test/image.png)\n', editor = create(before)
    const state = editor.state
    vi.spyOn(editor.markdown!, 'parse').mockImplementation(() => { throw new Error('parser unavailable') })
    const view = render(<><WritingRevisionPreview editor={editor} before={before} after={after} /><WritingRevisionComparison editor={editor} before={before} after={after} onClose={vi.fn()} /></>)
    expect(screen.getByLabelText('正文修改预览（Markdown 源码）').textContent).toBe(after)
    expect(screen.getByLabelText('原文 Markdown 源码').textContent).toBe(before)
    expect(screen.getByLabelText('修改后 Markdown 源码').textContent).toBe(after)
    expect(view.container.querySelector('script, img, a')).not.toBeInTheDocument()
    expect(editor.state).toBe(state)
  })
  it('shows the rich proposal in place without touching source, selection, transactions, or history', () => {
    const before = '**前半😀后半**\n\n保留重复\n\n保留重复', after = '**前半😀新句**\n\n保留重复\n\n保留重复', editor = create(before)
    editor.commands.setTextSelection({ from: 2, to: 5 })
    const state = editor.state, transaction = vi.fn()
    editor.on('transaction', transaction)
    const view = render(<WritingRevisionPreview editor={editor} before={before} after={after} />)
    expect(view.container.querySelector('strong')).toHaveTextContent('前半😀新句')
    expect(view.container.querySelector('del')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-phase="sweeping"]')).not.toBeInTheDocument()
    expect(editor.state).toBe(state); expect(transaction).not.toHaveBeenCalled()
    view.unmount(); expect(editor.state).toBe(state); expect(editor.getMarkdown()).toBe(before)
  })
  it('plays original sweep/reveal and a deleted-word widget only for an accepted change', () => {
    const editor = create('原文内容')
    const view = render(<WritingRevisionPreview editor={editor} before="原文内容" after="建议内容" animate />)
    expect(view.container.querySelector('[data-phase="sweeping"]')).toBeInTheDocument()
    expect(view.container.querySelector('del')).toHaveTextContent('原文')
    expect(view.container.querySelector('.wr-ins')).toHaveTextContent('建议')
    expect(editor.getText()).toBe('原文内容')
  })
  it('renders deletion only, including the whole article, without losing the confirmed target', () => {
    const editor = create('第一段\n\n删去段落\n\n末段')
    const view = render(<WritingRevisionPreview editor={editor} before="第一段\n\n删去段落\n\n末段" after="第一段\n\n末段" animate />)
    expect(view.container.querySelector('del')).toHaveTextContent('删去段落')
    view.rerender(<WritingRevisionPreview editor={editor} before="第一段\n\n删去段落\n\n末段" after="" animate />)
    expect(view.container.querySelector('del')).toHaveTextContent('第一段')
    expect(editor.getText()).toContain('删去段落')
  })
  it('respects reduced motion without transparent inserted text or removed-text widgets', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const editor = create('原文')
    const view = render(<WritingRevisionPreview editor={editor} before="原文" after="新文" animate />)
    expect(view.container).toHaveTextContent('新文')
    expect(view.container.querySelector('del, [data-phase="sweeping"]')).not.toBeInTheDocument()
  })
})

describe('paired paragraph comparison', () => {
  it('aligns an inserted paragraph without shifting later unchanged paragraphs', () => {
    const editor = create('第一段\n\n重复😀\n\n尾段'), docs = revisionDocuments(editor, '第一段\n\n重复😀\n\n尾段', '第一段\n\n新增段\n\n重复😀\n\n尾段')
    expect(pairRevisionBlocks(docs!.before, docs!.after).map(row => [row.before?.textContent ?? null, row.after?.textContent ?? null])).toEqual([['第一段', '第一段'], [null, '新增段'], ['重复😀', '重复😀'], ['尾段', '尾段']])
  })
  it('aligns deletion and repeated occurrences in source order', () => {
    const editor = create('重复\n\n删除\n\n重复'), docs = revisionDocuments(editor, '重复\n\n删除\n\n重复', '重复\n\n重复')
    expect(pairRevisionBlocks(docs!.before, docs!.after).map(row => [row.before?.textContent ?? null, row.after?.textContent ?? null])).toEqual([['重复', '重复'], ['删除', null], ['重复', '重复']])
  })
  it('shows frontmatter, rich paired content and Escape close without changing the live editor', () => {
    const before = '---\ntitle: 原题\n---\n\n**原文**', after = '---\ntitle: 新题\n---\n\n**新文**', editor = create('**原文**'), onClose = vi.fn()
    const state = editor.state, view = render(<WritingRevisionComparison editor={editor} before={before} after={after} onClose={onClose} />)
    expect(screen.getByRole('region', { name: '原文与修改稿对照' })).toHaveTextContent('title: 原题')
    expect(view.container.querySelectorAll('strong')).toHaveLength(4)
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(1); expect(editor.state).toBe(state)
  })
})

it('never loads proposed external images or exposes clickable links before agreement', () => {
  const before = '原文', after = '![图](https://example.com/private?q=secret) [链接](https://example.com)', editor = create(before)
  const view = render(<WritingRevisionPreview editor={editor} before={before} after={after} />)
  expect(view.container.querySelector('img, a[href]')).not.toBeInTheDocument()
  view.rerender(<WritingRevisionComparison editor={editor} before={before} after={after} onClose={() => {}} />)
  expect(view.container.querySelector('img, a[href]')).not.toBeInTheDocument()
})
