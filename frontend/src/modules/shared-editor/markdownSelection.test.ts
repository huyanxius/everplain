import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapMarkdownSelection } from './markdownSelection'
import { revisionFormattingError } from './revisionFormatting'

const editors: Editor[] = []
function create(markdown: string) { const editor = new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown' }); editors.push(editor); return editor }
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('source-bound rich selection', () => {
  it('keeps partial-bold to plain selections precise without extending to unselected text', () => {
    const source = '**前半后半** 外面', editor = create(source)
    editor.commands.setTextSelection({ from: 3, to: 8 })
    expect(mapMarkdownSelection(editor, source)).toEqual({ start: 4, end: 11, text: '后半** 外面' })
    expect(revisionFormattingError(editor, source, '**前半优化** 外面新版', { start: 4, end: 11 })).toBeNull()
    expect(revisionFormattingError(editor, source, '**前半优化 外面新版', { start: 4, end: 11 })).toContain('选区外')
  })

  it('protects unselected link attributes, even when visible text is unchanged', () => {
    const source = '[保留前缀选择](https://old.test) 后文', editor = create(source)
    expect(revisionFormattingError(editor, source, '[保留前缀改写](https://old.test) 后文新', { start: 5, end: source.length })).toBeNull()
    expect(revisionFormattingError(editor, source, '[保留前缀改写](https://new.test) 后文新', { start: 5, end: source.length })).toContain('选区外')
  })

  it('allows requested whole-document and fully selected link URL changes, including legacy revisions', () => {
    const source = '前 [文](https://old.test) 后', after = '前 [文](https://new.test) 后', editor = create(source)
    expect(revisionFormattingError(editor, source, after)).toBeNull()
    expect(revisionFormattingError(editor, source, after, null)).toBeNull()
    expect(revisionFormattingError(editor, source, after, { start: 2, end: source.length - 2 })).toBeNull()
    expect(revisionFormattingError(editor, source, after, { start: source.indexOf('https://'), end: source.indexOf(')') })).toBeNull()
    expect(revisionFormattingError(editor, source, after, { start: source.indexOf('old'), end: source.indexOf('old') + 3 })).toBeNull()
    expect(revisionFormattingError(editor, '', '新文稿', { start: 0, end: 0 })).toBeNull()
  })

  it('maps a 200k draft with repeated text and matching link destinations in bounded parses', () => {
    const row = `**a** [a](https://x.test/a) ${'正文'.repeat(60)}`
    const source = Array(1400).fill(row).join('\n\n'), editor = create(source)
    expect(source.length).toBeGreaterThan(200_000)
    let pos = 0; editor.state.doc.descendants((node, at) => { if (node.text === 'a' && node.marks.some(mark => mark.type.name === 'bold')) pos = at })
    editor.commands.setTextSelection({ from: pos, to: pos + 1 })
    const parse = vi.spyOn(editor.markdown!, 'parse'), before = performance.now()
    expect(mapMarkdownSelection(editor, source)).toEqual({ start: source.lastIndexOf('**a**'), end: source.lastIndexOf('**a**') + 5, text: '**a**' })
    const elapsed = performance.now() - before
    expect(parse.mock.calls.length).toBeLessThanOrEqual(3) // compatibility + one verified parse per boundary, even with matching URLs
    console.info(`200k repeated Markdown selection: ${elapsed.toFixed(0)}ms, ${parse.mock.calls.length} parses`)
    expect(elapsed).toBeLessThan(4000) // loaded CI machines still have a deterministic parse-count bound
    parse.mockClear()
    expect(mapMarkdownSelection(editor, source)).toHaveProperty('start', source.lastIndexOf('**a**'))
    expect(parse).not.toHaveBeenCalled()
    editor.commands.setTextSelection(pos + 1)
    const collapsed = performance.now()
    expect(mapMarkdownSelection(editor, source)).toBeNull()
    expect(performance.now() - collapsed).toBeLessThan(50)
    expect(parse).not.toHaveBeenCalled() // subsequent collapsed typing never reparses
  })

  it('rejects unmappable atomic ranges explicitly', () => {
    const source = '第一段\n\n---\n\n第二段', editor = create(source)
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
    expect(mapMarkdownSelection(editor, source)).toHaveProperty('error')
  })

  it('retains hard-break source syntax and protects outside bold/plain formatting', () => {
    const source = '**保留第一行  \n第二行** 尾巴', editor = create(source)
    const bounds = { start: 4, end: source.length - 1 }
    editor.commands.setTextSelection({ from: 3, to: 12 })
    expect(mapMarkdownSelection(editor, source)).toEqual({ ...bounds, text: source.slice(bounds.start, bounds.end) })
    expect(revisionFormattingError(editor, source, '**保留优化一行  \n优化二行** 尾新版巴', bounds)).toBeNull()
    expect(revisionFormattingError(editor, source, '**保留优化一行  \n优化二行 尾新版巴', bounds)).toContain('选区外')
  })
})
