import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revisionAnchor } from './WritingRevisionBubble'

const editors: Editor[] = []
function create(body: string) {
  const editor = new Editor({ extensions: [StarterKit, Markdown], content: body, contentType: 'markdown' })
  editors.push(editor)
  return editor
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('revision bubble source anchors', () => {
  it('distinguishes repeated paragraphs using the original source occurrence', () => {
    const markdown = '重复😀段\n\n重复😀段\n\n重复😀段', editor = create(markdown)
    expect(revisionAnchor(editor, markdown, 0)).toBe(1)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('重复😀段', 1))).toBe(8)
    expect(revisionAnchor(editor, markdown, markdown.lastIndexOf('重复😀段'))).toBe(15)
    expect(revisionAnchor(editor, markdown, markdown.length)).toBe(20)
  })

  it('uses UTF-16 offsets after emoji rather than visible character counts', () => {
    const markdown = '😀前文 😀后文', editor = create(markdown)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('前文'))).toBe(3)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('后文'))).toBe(8)
  })

  it('anchors inside a bold span without selecting its entire wrapper', () => {
    const markdown = '**前半后半** 外面', editor = create(markdown)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('后半'))).toBe(3)
    expect(revisionAnchor(editor, markdown, markdown.indexOf(' 外面'))).toBe(5)
    expect(editor.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe('bold')
  })

  it('retains original emphasis spelling instead of mapping serialized Markdown', () => {
    const markdown = '__前半😀后半__  外面', editor = create(markdown)
    expect(editor.getMarkdown()).not.toBe(markdown)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('后半'))).toBe(5)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('外面'))).toBe(9)
  })

  it('counts hard breaks as document nodes and preserves their source syntax', () => {
    const markdown = '**保留第一行  \n第二行** 尾巴', editor = create(markdown)
    expect(editor.state.doc.firstChild?.child(1).type.name).toBe('hardBreak')
    expect(revisionAnchor(editor, markdown, markdown.indexOf('第二行'))).toBe(7)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('尾巴'))).toBe(11)
  })

  it('accounts for frontmatter when locating repeated body text', () => {
    const markdown = '---\r\ntitle: 😀原题\r\n---\r\n\r\n重复\r\n\r\n重复', editor = create('重复\r\n\r\n重复')
    expect(revisionAnchor(editor, markdown, markdown.indexOf('重复'))).toBe(1)
    expect(revisionAnchor(editor, markdown, markdown.lastIndexOf('重复'))).toBe(5)
    expect(revisionAnchor(editor, markdown, markdown.indexOf('原题'))).toBeNull()
  })

  it('does not move the live selection or dispatch editor transactions', () => {
    const markdown = '😀前 **重复**\n\n重复', editor = create(markdown)
    editor.commands.setTextSelection({ from: 3, to: 7 })
    const state = editor.state, selection = state.selection, doc = state.doc
    const transaction = vi.fn(), selectionUpdate = vi.fn()
    editor.on('transaction', transaction)
    editor.on('selectionUpdate', selectionUpdate)
    expect(revisionAnchor(editor, markdown, markdown.lastIndexOf('重复'))).toBe(9)
    expect(editor.state).toBe(state)
    expect(editor.state.selection).toBe(selection)
    expect(editor.state.doc).toBe(doc)
    expect(transaction).not.toHaveBeenCalled()
    expect(selectionUpdate).not.toHaveBeenCalled()
  })

  it('fails closed when the live document differs in text or formatting', () => {
    const markdown = '**原文**\n\n重复', editor = create(markdown)
    expect(revisionAnchor(editor, '原文\n\n重复', 0)).toBeNull()
    expect(revisionAnchor(editor, '**改文**\n\n重复', 0)).toBeNull()
    editor.commands.setContent('**修改后的原文**\n\n重复', { contentType: 'markdown' })
    expect(revisionAnchor(editor, markdown, markdown.lastIndexOf('重复'))).toBeNull()
  })

  it('rejects out-of-range or unprovable syntax boundaries', () => {
    const markdown = '**原文**', editor = create(markdown)
    expect(revisionAnchor(editor, markdown, -1)).toBeNull()
    expect(revisionAnchor(editor, markdown, markdown.length + 1)).toBeNull()
    expect(revisionAnchor(editor, markdown, 1)).toBeNull()
  })
})
