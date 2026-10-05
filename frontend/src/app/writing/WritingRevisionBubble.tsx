import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'

/** Prove the source boundary against the live PM document without moving selection. */
export function revisionAnchor(editor: Editor, markdown: string, offset: number): number | null {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(markdown)?.[0] ?? ''
  const body = markdown.slice(frontmatter.length), at = offset - frontmatter.length
  if (!editor.markdown || at < 0 || at > body.length) return null
  try {
    if (!editor.schema.nodeFromJSON(editor.markdown.parse(body)).eq(editor.state.doc)) return null
    if (at === 0) return 1
    let marker = '\uE000EverplainRevisionAnchor\uE001'
    while (body.includes(marker)) marker += '\uE002'
    const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(body.slice(0, at) + marker + body.slice(at)))
    let position: number | null = null
    parsed.descendants((node, pos) => { if (node.isText && node.text?.includes(marker)) position = pos + node.text.indexOf(marker) })
    if (position == null || !parsed.replace(position, position + marker.length, Slice.empty).eq(editor.state.doc)) return null
    return position
  } catch { return null }
}

export function WritingRevisionBubble({ editor, markdown, offset, children }: { editor: Editor | null; markdown: string; offset: number; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [point, setPoint] = useState({ top: 12, left: 12 })
  useEffect(() => {
    const place = () => {
      const host = ref.current?.parentElement
      if (!host || !editor || editor.isDestroyed) return
      const bounds = host.getBoundingClientRect(), source = host.querySelector<HTMLTextAreaElement>('.se-source')
      let top = 12, left = 12
      if (source) {
        const box = source.getBoundingClientRect(), style = getComputedStyle(source)
        const line = Math.max(16, parseFloat(style.lineHeight) || 24)
        top = box.top - bounds.top + markdown.slice(0, offset).split('\n').length * line - source.scrollTop
      } else {
        const position = revisionAnchor(editor, markdown, offset)
        if (position != null) try { const coords = editor.view.coordsAtPos(position); top = coords.bottom - bounds.top + 8; left = coords.left - bounds.left } catch { /* The safe diff remains available while geometry initializes. */ }
      }
      setPoint({ top: Math.max(12, Math.min(top, Math.max(12, host.clientHeight - 120))), left: Math.max(12, Math.min(left, Math.max(12, host.clientWidth - 372))) })
    }
    place(); window.addEventListener('resize', place); document.addEventListener('scroll', place, true); editor?.on('transaction', place)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); editor?.off('transaction', place) }
  }, [editor, markdown, offset])
  return <section ref={ref} aria-label="待定修订预览" className="writing-revision-bubble" style={point}>{children}</section>
}
