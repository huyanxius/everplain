import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapMarkdownSelection } from './markdownSelection'

const editors: Editor[] = []
function create(markdown: string) { const editor = new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown' }); editors.push(editor); return editor }
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('source-bound rich selection', () => {
  it('keeps partial-bold to plain selections precise without extending to unselected text', () => {
    const source = '**前半后半** 外面', editor = create(source)
    editor.commands.setTextSelection({ from: 3, to: 8 })
    expect(mapMarkdownSelection(editor, source)).toEqual({ start: 4, end: 11, text: '后半** 外面' })
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

  it('retains hard-break source syntax in partial bold/plain selections', () => {
    const source = '**保留第一行  \n第二行** 尾巴', editor = create(source)
    const bounds = { start: 4, end: source.length - 1 }
    editor.commands.setTextSelection({ from: 3, to: 12 })
    expect(mapMarkdownSelection(editor, source)).toEqual({ ...bounds, text: source.slice(bounds.start, bounds.end) })
  })
})
