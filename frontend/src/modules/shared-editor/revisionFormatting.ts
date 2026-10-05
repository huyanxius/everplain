import type { Editor } from '@tiptap/core'
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { splitMarkdown } from './markdownSource'

const unverifiable = '这条修订的 Markdown 边界无法可靠校验，已阻止接受。请重新生成完整、闭合的 Markdown 修订。'
const outsideChanged = '修订会改变选区外的文字、格式或链接，已阻止接受。请重新优化，并保留选区外内容。'

export type RevisionSelectionBounds = { start: number; end: number }

/** Compare the persisted AUTHORIZED scope, never guess it from a minimal diff. */
export function revisionFormattingError(editor: Editor, before: string, after: string, bounds?: RevisionSelectionBounds | null): string | null {
  // Whole-document requests and legacy revisions do not imply a selected scope.
  if (!bounds || before === after) return null
  if (!Number.isInteger(bounds.start) || !Number.isInteger(bounds.end) || bounds.start < 0 || bounds.end < bounds.start || bounds.end > before.length) return unverifiable
  const afterEnd = bounds.end + after.length - before.length
  if (afterEnd < bounds.start || afterEnd > after.length || before.slice(0, bounds.start) !== after.slice(0, bounds.start) || before.slice(bounds.end) !== after.slice(afterEnd)) return outsideChanged
  if (bounds.start === 0 && bounds.end === before.length) return null
  if (!editor.markdown) return unverifiable
  const original = splitMarkdown(before), proposed = splitMarkdown(after)
  const left = original.body, right = proposed.body
  const start = Math.max(0, bounds.start - original.frontmatter.length), end = Math.max(0, bounds.end - original.frontmatter.length)
  const nextStart = Math.max(0, bounds.start - proposed.frontmatter.length), nextEnd = Math.max(0, afterEnd - proposed.frontmatter.length)
  try {
    const oldDoc = editor.schema.nodeFromJSON(editor.markdown.parse(left)), newDoc = editor.schema.nodeFromJSON(editor.markdown.parse(right))
    let marker = '\uE000EverplainRevisionBoundary\uE001'
    while (left.includes(marker) || right.includes(marker)) marker += '\uE002'
    function position(source: string, doc: ProseMirrorNode, offset: number) {
      if (offset === 0) return 0
      if (offset === source.length) return doc.content.size
      const marked = editor.schema.nodeFromJSON(editor.markdown!.parse(source.slice(0, offset) + marker + source.slice(offset)))
      let found = -1
      marked.descendants((node, pos) => { const index = node.isText ? node.text!.indexOf(marker) : -1; if (index >= 0) found = pos + index })
      return found >= 0 && marked.replace(found, found + marker.length, Slice.empty).eq(doc) ? found : null
    }
    const oldStart = position(left, oldDoc, start), newStart = position(right, newDoc, nextStart)
    const oldEnd = position(left, oldDoc, Math.min(end, left.length)), newEnd = position(right, newDoc, Math.min(nextEnd, right.length))
    if (oldStart == null || newStart == null || oldEnd == null || newEnd == null) {
      // Source mode can explicitly select an attribute, such as a link URL.
      // Both boundaries must be inside the SAME attribute value(s), and masking
      // just that authorized value segment must leave the entire PM doc equal.
      const open = marker + 'Start', close = marker + 'End', mask = marker + 'AuthorizedAttribute'
      function attributeMask(source: string, doc: ProseMirrorNode, from: number, to: number) {
        const json = editor.markdown!.parse(source.slice(0, from) + open + source.slice(from, to) + close + source.slice(to))
        const clean = editor.schema.nodeFromJSON(JSON.parse(JSON.stringify(json).replaceAll(open, '').replaceAll(close, '')))
        if (!clean.eq(doc)) return null
        let found = 0, invalid = false
        function visit(value: unknown, attribute = false): unknown {
          if (typeof value === 'string') {
            const a = value.indexOf(open), b = value.indexOf(close)
            if (a < 0 && b < 0) return value
            if (!attribute || a < 0 || b < a + open.length) { invalid = true; return value }
            found++; return value.slice(0, a) + mask + value.slice(b + close.length)
          }
          if (Array.isArray(value)) return value.map(item => visit(item, attribute))
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, attribute || key === 'attrs')]))
          return value
        }
        const masked = visit(json)
        return found && !invalid ? editor.schema.nodeFromJSON(masked) : null
      }
      const maskedOld = attributeMask(left, oldDoc, start, Math.min(end, left.length)), maskedNew = attributeMask(right, newDoc, nextStart, Math.min(nextEnd, right.length))
      return maskedOld && maskedNew ? maskedOld.eq(maskedNew) ? null : outsideChanged : unverifiable
    }
    return oldDoc.cut(0, oldStart).eq(newDoc.cut(0, newStart)) && oldDoc.cut(oldEnd).eq(newDoc.cut(newEnd)) ? null : outsideChanged
  } catch { return unverifiable }
}
