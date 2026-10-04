import { Extension, Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  tableEditing,
} from '@tiptap/pm/tables'

/*
 * 共享编辑器在 StarterKit / TaskList / Markdown 之外补的扩展。每个都带 Markdown 的解析和输出，
 * 保证「源码模式」来回切换不丢内容——Obsidian 用户的笔记就是 Markdown 文件，这是底线。
 *
 *   Highlight   ==高亮==
 *   WikiLink    [[笔记名]] 或 [[笔记名|显示文字]]，行内原子节点，点击跳转
 *   TagDecor    #标签 着色（只是装饰，不改文档结构）
 *   Callout     > [!note] 标题  —— Obsidian 的提示块语法
 *   Table*      GFM 表格，基于 prosemirror-tables，可增删行列、Tab 跳格、拖动列宽
 *   Search      查找 / 替换的高亮层
 *
 * 真实落地时：表格建议换成官方 @tiptap/extension-table（需要加依赖），语义与这里一致。
 */

/* ---------------- 高亮 ---------------- */
export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', mergeAttributes(HTMLAttributes, { class: 'se-mark' }), 0],
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) }
  },
  markdownTokenName: 'highlight',
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('=='),
    tokenize(src, _tokens, lexer) {
      const m = /^==([^=\n]+)==/.exec(src)
      if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) }
    },
  },
  parseMarkdown: (token, h) => h.applyMark('highlight', h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `==${h.renderChildren(node)}==`,
})

/* ---------------- 双链 ---------------- */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ target: { default: '' }, alias: { default: null } }),
  parseHTML: () => [{ tag: 'a[data-wiki]', getAttrs: (el) => ({ target: (el as HTMLElement).dataset.wiki, alias: (el as HTMLElement).dataset.alias || null }) }],
  renderHTML: ({ node }) => ['a', { 'data-wiki': node.attrs.target, 'data-alias': node.attrs.alias ?? '', class: 'se-wiki', href: '#' }, node.attrs.alias || node.attrs.target],
  renderText: ({ node }) => `[[${node.attrs.target}${node.attrs.alias ? `|${node.attrs.alias}` : ''}]]`,
  markdownTokenName: 'wikiLink',
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src) {
      const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src)
      if (m) return { type: 'wikiLink', raw: m[0], target: m[1].trim(), alias: m[2]?.trim() }
    },
  },
  parseMarkdown: (token, h) => h.createNode('wikiLink', { target: token.target, alias: token.alias ?? null }),
  renderMarkdown: (node: JSONContent) => `[[${node.attrs?.target}${node.attrs?.alias ? `|${node.attrs.alias}` : ''}]]`,
})

/* ---------------- #标签 着色 ---------------- */
export const TagDecor = Extension.create({
  name: 'tagDecor',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tagDecor'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos, parent) => {
              if (!node.isText || parent?.type.name === 'codeBlock' || node.marks.some((m) => m.type.name === 'code')) return
              const re = /(^|[^\p{L}\p{N}_/#&])(#[\p{L}\p{N}_/-]+)/gu
              let m: RegExpExecArray | null
              while ((m = re.exec(node.text ?? ''))) {
                const from = pos + m.index + m[1].length
                decos.push(Decoration.inline(from, from + m[2].length, { class: 'se-tag' }))
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

/* ---------------- 提示块 ---------------- */
export const calloutKinds = { note: '笔记', tip: '提示', warning: '注意', quote: '引述' } as const
export type CalloutKind = keyof typeof calloutKinds

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ kind: { default: 'note' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'aside[data-callout]', getAttrs: (el) => ({ kind: (el as HTMLElement).dataset.callout, title: (el as HTMLElement).dataset.title ?? '' }) }],
  renderHTML: ({ node }) => ['aside', { 'data-callout': node.attrs.kind, 'data-title': node.attrs.title || calloutKinds[node.attrs.kind as CalloutKind] || node.attrs.kind, class: 'se-callout' }, 0],
  markdownTokenName: 'callout',
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => src.indexOf('> [!'),
    tokenize(src, _tokens, lexer) {
      const m = /^> \[!(\w+)\][ \t]*([^\n]*)\n?((?:>[^\n]*(?:\n|$))*)/.exec(src)
      if (!m) return
      const body = m[3].split('\n').map((l) => l.replace(/^> ?/, '')).join('\n').trim()
      return { type: 'callout', raw: m[0], kind: m[1].toLowerCase(), title: m[2].trim(), tokens: lexer.blockTokens(body || ' ') }
    },
  },
  parseMarkdown: (token, h) => h.createNode('callout', { kind: token.kind, title: token.title }, h.parseChildren(token.tokens || [])),
  renderMarkdown: (node, h) => {
    const head = `> [!${node.attrs?.kind ?? 'note'}]${node.attrs?.title ? ` ${node.attrs.title}` : ''}`
    const body = h.renderChildren(node.content ?? [], '\n\n').split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n')
    return `${head}\n${body}`
  },
})

/* ---------------- 表格 ---------------- */
/* prosemirror-tables 靠节点上的 tableRole 认表格结构，Tiptap 不认这个字段，用一个小扩展把它写进 schema。 */
const TableRole = Extension.create({
  name: 'tableRole',
  extendNodeSchema(extension) {
    const role = (extension.config as { tableRole?: string }).tableRole
    return role ? { tableRole: role } : {}
  },
})

const cellAttrs = () => ({ colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } })

const inlineOf = (node: JSONContent, h: { renderChildren: (n: JSONContent | JSONContent[]) => string }) =>
  (node.content ?? []).map((p) => h.renderChildren(p.content ?? [])).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export const TableCell = Node.create({ name: 'tableCell', content: 'paragraph+', isolating: true, tableRole: 'cell', addAttributes: cellAttrs, parseHTML: () => [{ tag: 'td' }], renderHTML: ({ HTMLAttributes }) => ['td', HTMLAttributes, 0] } as Parameters<typeof Node.create>[0])
export const TableHeader = Node.create({ name: 'tableHeader', content: 'paragraph+', isolating: true, tableRole: 'header_cell', addAttributes: cellAttrs, parseHTML: () => [{ tag: 'th' }], renderHTML: ({ HTMLAttributes }) => ['th', HTMLAttributes, 0] } as Parameters<typeof Node.create>[0])
export const TableRow = Node.create({ name: 'tableRow', content: '(tableCell | tableHeader)*', tableRole: 'row', parseHTML: () => [{ tag: 'tr' }], renderHTML: () => ['tr', 0] } as Parameters<typeof Node.create>[0])

export const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  tableRole: 'table',
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: () => ['div', { class: 'se-table-wrap' }, ['table', { class: 'se-table' }, ['tbody', 0]]],
  addExtensions: () => [TableRole],
  addProseMirrorPlugins: () => [columnResizing({ cellMinWidth: 80 }), tableEditing()],
  addKeyboardShortcuts() {
    return {
      Tab: () => goToNextCell(1)(this.editor.state, this.editor.view.dispatch),
      'Shift-Tab': () => goToNextCell(-1)(this.editor.state, this.editor.view.dispatch),
    }
  },
  markdownTokenName: 'table',
  parseMarkdown: (token, h) => {
    const cell = (c: { tokens?: unknown[] }, type: string) => h.createNode(type, {}, [h.createNode('paragraph', {}, h.parseInline((c.tokens as never[]) || []))])
    const header = h.createNode('tableRow', {}, (token.header as { tokens?: unknown[] }[]).map((c) => cell(c, 'tableHeader')))
    const rows = (token.rows as { tokens?: unknown[] }[][]).map((r) => h.createNode('tableRow', {}, r.map((c) => cell(c, 'tableCell'))))
    return h.createNode('table', {}, [header, ...rows])
  },
  renderMarkdown: (node, h) => {
    const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => inlineOf(c, h)))
    if (!rows.length) return ''
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`
    return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n')
  },
} as Parameters<typeof Node.create>[0])

/* 表格命令：直接包 prosemirror-tables 的命令，工具栏和右键菜单都调这里。 */
export const tableCommands = {
  addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, deleteTable,
}

export function tableJSON(rows = 3, cols = 3): JSONContent {
  const cell = (type: string, text = '') => ({ type, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, (_, c) => cell(r === 0 ? 'tableHeader' : 'tableCell', r === 0 ? `列 ${c + 1}` : '')),
    })),
  }
}

/* ---------------- 查找 / 替换 ---------------- */
export const searchKey = new PluginKey<{ term: string; index: number; caseSensitive: boolean }>('search')

export function findMatches(doc: import('@tiptap/pm/model').Node, term: string, caseSensitive: boolean) {
  const out: { from: number; to: number }[] = []
  if (!term) return out
  const needle = caseSensitive ? term : term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = caseSensitive ? node.text! : node.text!.toLowerCase()
    let i = text.indexOf(needle)
    while (i >= 0) {
      out.push({ from: pos + i, to: pos + i + term.length })
      i = text.indexOf(needle, i + needle.length)
    }
  })
  return out
}

export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: () => ({ term: '', index: 0, caseSensitive: false }),
          apply: (tr, value) => tr.getMeta(searchKey) ?? value,
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state)
            if (!s?.term) return null
            const matches = findMatches(state.doc, s.term, s.caseSensitive)
            return DecorationSet.create(state.doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? 'se-find se-find--current' : 'se-find' })))
          },
        },
      }),
    ]
  },
})

/* ---------------- 图片 ---------------- */
/* ![说明](地址)。小图片使用持久化 data URL；已有 Markdown 图片地址保持不变。 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: '' }, alt: { default: '' } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['figure', { class: 'se-figure' }, ['img', HTMLAttributes], ['figcaption', {}, HTMLAttributes.alt || '']],
  markdownTokenName: 'image',
  parseMarkdown: (token, h) => h.createNode('image', { src: token.href, alt: token.text ?? '' }),
  renderMarkdown: (node: JSONContent) => `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})`,
})
