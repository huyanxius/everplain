import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedEditor } from './SharedEditor'
import { splitMarkdown, joinMarkdown, canEditProperties } from './markdownSource'
afterEach(cleanup)
const source = '---\ntitle: "保留格式"\ntags:\n  - 一个\n  - 两个\n---\n\n# 标题\n\n[[笔记|别名]] ==高亮==\n\n> [!note] 提示\n> 内容\n\n- [x] 任务\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = 1\n```\n\n![图片](https://example.com/image.png)\n'
describe('shared reference editor production persistence', () => {
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
