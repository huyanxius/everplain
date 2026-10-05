import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedEditor } from './SharedEditor'
import { splitMarkdown, joinMarkdown, canEditProperties } from './markdownSource'

function cleanupEditorFixtures() {
  // Tiptap defers editor.destroy() on unmount. Run that real destruction while
  // jsdom still exists, without changing the behavioral tests' real timers.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    cleanup()
    act(() => { vi.runOnlyPendingTimers() })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
}

afterEach(cleanupEditorFixtures)
// BubbleMenu positioning uses DOM Range geometry, absent from jsdom.
Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
const source = '---\ntitle: "保留格式"\ntags:\n  - 一个\n  - 两个\n---\n\n# 标题\n\n[[笔记|别名]] ==高亮==\n\n> [!note] 提示\n> 内容\n\n- [x] 任务\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = 1\n```\n\n![图片](https://example.com/image.png)\n'
describe('shared reference editor production persistence', () => {
  it('destroys the real editor and drains deferred timers during fixture cleanup', () => {
    const onReady = vi.fn()
    render(<SharedEditor markdown="原文" onReady={onReady} />)
    expect(onReady).toHaveBeenCalled()
    const editor = onReady.mock.calls[0][0]
    const onDestroy = vi.fn()
    editor.on('destroy', onDestroy)
    expect(editor.isDestroyed).toBe(false)

    cleanupEditorFixtures()

    expect(editor.isDestroyed).toBe(true)
    expect(onDestroy).toHaveBeenCalledOnce()
    expect(vi.isFakeTimers()).toBe(false)
  })
  it('never flattens nested YAML through scalar property controls', () => { expect(canEditProperties(splitMarkdown(source).frontmatter)).toBe(false); expect(canEditProperties('---\ntitle: plain\n---\n')).toBe(true) })
  it('separates and rejoins frontmatter without rewriting YAML', () => { const parts = splitMarkdown(source); expect(joinMarkdown(parts.frontmatter, parts.body)).toBe(source); expect(parts.frontmatter).toContain('  - 两个') })
  it('preserves source bytes through rich/source mode switches and reports no fake save', async () => {
    const onChange = vi.fn(); render(<SharedEditor markdown={source} onChange={onChange} saveState="dirty" />)
    const sourceButton = await screen.findByRole('tab', { name: '源码' }); fireEvent.click(sourceButton)
    expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(source)
    expect(screen.getByText('尚未保存')).toBeInTheDocument(); expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: '编辑' })); fireEvent.click(screen.getByRole('tab', { name: '源码' }))
    expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(source); expect(onChange).not.toHaveBeenCalled()
  })
  it('reports exact user source edits, including trailing newlines', async () => { const onChange = vi.fn(); render(<SharedEditor markdown="原文" onChange={onChange} />); fireEvent.click(await screen.findByRole('tab', { name: '源码' })); fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码' }), { target: { value: source } }); expect(onChange).toHaveBeenLastCalledWith(source) })
  it('takes a server-accepted update without manufacturing an edit event', async () => { const onChange = vi.fn(); const view = render(<SharedEditor markdown="原文" onChange={onChange} />); fireEvent.click(await screen.findByRole('tab', { name: '源码' })); view.rerender(<SharedEditor markdown={'已接受的新正文\n'} onChange={onChange} />); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('已接受的新正文\n')); expect(onChange).not.toHaveBeenCalled() })
})

it('reports exact UTF-16 source selection even for repeated text and emoji', async () => {
  const selected = vi.fn()
  render(<SharedEditor markdown="😀重复 重复" onSelectionChange={selected} />)
  fireEvent.click(await screen.findByRole('tab', { name: '源码' }))
  const input = screen.getByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
  input.focus()
  input.setSelectionRange(5, 7)
  fireEvent.select(input)
  expect(selected).toHaveBeenLastCalledWith({ start: 5, end: 7, text: '重复' })
  input.setSelectionRange(7, 7)
  fireEvent.select(input)
  expect(selected).toHaveBeenLastCalledWith(null)
})

describe('rich selection Markdown ranges', () => {
  it.each([
    { name: 'formatted text', markdown: '前 **加粗** 与 *斜体* 后', from: 3, to: 10, expected: '**加粗** 与 *斜体*' },
    { name: 'second repeated paragraph', markdown: '重复段落\n\n重复段落', from: 7, to: 11, expected: '重复段落', start: 6 },
    { name: 'emoji UTF-16 offsets', markdown: '😀重复 重复', from: 6, to: 8, expected: '重复', start: 5 },
    { name: 'across paragraphs', markdown: '**第一段**\n\n*第二段*', from: 2, to: 7, expected: '一段**\n\n*第' },
    { name: 'linked label rather than matching URL', markdown: '[重复](https://example.com/重复) 重复', from: 1, to: 3, expected: '[重复](https://example.com/重复)', start: 0 },
    { name: 'preserved YAML and CRLF', markdown: '---\r\ntitle: 重复\r\n---\r\n\r\n**重复**\r\n\r\n重复\r\n', from: 5, to: 7, expected: '重复', start: 33 },
    { name: 'escaped punctuation', markdown: '前 \\*重复\\* 后', from: 3, to: 7, expected: '\\*重复\\*', start: 2 },
    { name: 'entity source boundaries', markdown: '前 &amp; 后', from: 3, to: 4, expected: '&amp;', start: 2 },
    { name: 'balanced nested URL parentheses', markdown: '前 [链接](https://example.com/(one)) 后', from: 3, to: 5, expected: '[链接](https://example.com/(one))', start: 2 },
    { name: 'full hard-break text', markdown: '第一行  \n第二行', from: 1, to: 8, expected: '第一行  \n第二行', start: 0 },
    { name: 'partial selection across a hard break', markdown: '第一行  \n第二行', from: 2, to: 7, expected: '一行  \n第二', start: 1 },
    { name: 'selection starting with a hard break', markdown: '第一行  \n第二行', from: 4, to: 7, expected: '  \n第二', start: 3 },
    { name: 'selection ending with a hard break', markdown: '第一行  \n第二行', from: 2, to: 5, expected: '一行  \n', start: 1 },
    { name: 'a hard break alone', markdown: '第一行  \n第二行', from: 4, to: 5, expected: '  \n', start: 3 },
    { name: 'a hard break between unselected different marks', markdown: '**第一行**  \n*第二行*', from: 4, to: 5, expected: '  \n', start: 7 },
  ])('reports exact source coordinates for $name', async ({ markdown, from, to, expected, start }) => {
    const selected = vi.fn(); let editor!: Editor
    render(<SharedEditor markdown={markdown} onReady={value => { editor = value }} onSelectionChange={selected} />)
    await waitFor(() => expect(editor).toBeDefined())
    act(() => { editor.commands.setTextSelection({ from, to }) })
    const offset = start ?? markdown.indexOf(expected)
    expect(selected).toHaveBeenLastCalledWith({ start: offset, end: offset + expected.length, text: expected })
  })

  it('uses the same verified range for selection actions and keeps source bytes intact', async () => {
    const run = vi.fn(), onChange = vi.fn(); let editor!: Editor
    render(<SharedEditor markdown={'**重复**\n\n重复'} onReady={value => { editor = value }} onChange={onChange} selectionActions={[{ id: 'rewrite', label: '优化选区', run }]} />)
    await waitFor(() => expect(editor).toBeDefined())
    act(() => { editor.commands.setTextSelection({ from: 5, to: 7 }) })
    fireEvent.click(await screen.findByRole('button', { name: '优化选区', hidden: true }))
    expect(run).toHaveBeenLastCalledWith(editor, '重复', { start: 8, end: 10, text: '重复' })
    fireEvent.click(screen.getByRole('tab', { name: '源码' }))
    expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('**重复**\n\n重复')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports a nonempty unmappable selection as an error and never as no selection', async () => {
    const selected = vi.fn(); let editor!: Editor
    render(<SharedEditor markdown="原文" onReady={value => { editor = value }} onSelectionChange={selected} />)
    await waitFor(() => expect(editor).toBeDefined())
    act(() => { editor.commands.setContent('不同正文', { contentType: 'markdown', emitUpdate: false }); editor.commands.setTextSelection({ from: 1, to: 3 }) })
    expect(selected).toHaveBeenLastCalledWith({ error: expect.stringContaining('无法准确定位') })
    expect(screen.getByRole('alert')).toHaveTextContent('源码模式重新选择')
  })
})
