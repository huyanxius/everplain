import { useEffect, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import { pairRevisionBlocks, revisionChanges, revisionDocuments, splitRevisionMarkdown } from './revisionPreviewModel'

/** Render the proposal in place without dispatching anything to the real editor. */
export function WritingRevisionPreview({ editor, before, after, animate = false }: { editor: Editor; before: string; after: string; animate?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current || editor.isDestroyed) return
    const documents = revisionDocuments(editor, before, after)
    const phase = animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'sweeping' : 'pending'
    const changes = revisionChanges(documents.before, documents.after)
    const decorations: Decoration[] = []
    documents.after.forEach((node, offset) => {
      if (changes.some(change => change.fromB <= offset + node.nodeSize && change.toB >= offset)) decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'wr-p-wrap', 'data-phase': phase, 'data-revision-changed': 'true' }))
    })
    for (const change of changes) {
      if (change.toB > change.fromB) decorations.push(Decoration.inline(change.fromB, change.toB, { class: 'wr-ins', 'data-phase': phase }))
      if (phase === 'sweeping' && change.toA > change.fromA) {
        const deleted = documents.before.textBetween(change.fromA, change.toA, '\n')
        if (deleted) decorations.push(Decoration.widget(Math.min(change.fromB, documents.after.content.size), () => {
          const element = window.document.createElement('del')
          element.className = 'wr-del writing-revision-deleted'
          element.setAttribute('aria-hidden', 'true')
          element.textContent = deleted
          return element
        }, { side: -1 }))
      }
    }
    const set = DecorationSet.create(documents.after, decorations)
    const view = new EditorView(host.current, { state: EditorState.create({ schema: editor.schema, doc: documents.after }), editable: () => false, attributes: { class: 'se-prose writing-revision-prose', 'aria-label': animate ? '已同意的修改动画' : '正文修改预览' }, decorations: () => set, dispatchTransaction: () => {} })
    for (const element of view.dom.querySelectorAll<HTMLElement>('.writing-revision-deleted')) { const box = element.getBoundingClientRect(); element.style.maxWidth = `${box.width}px`; element.style.maxHeight = `${box.height}px` }
    return () => view.destroy()
  }, [editor, before, after, animate])
  return <div className="writing-inline-preview" data-animate={animate}>{splitRevisionMarkdown(after).frontmatter && <pre className="writing-raw">{splitRevisionMarkdown(after).frontmatter}</pre>}<div ref={host} /></div>
}

function RevisionBlock({ editor, node }: { editor: Editor; node: ProseMirrorNode | null }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.replaceChildren(node ? DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(node)) : window.document.createTextNode('此处无段落'))
  }, [editor, node])
  return <div ref={host} className="se-prose writing-compare-prose" data-empty={!node} />
}

export function WritingRevisionComparison({ editor, before, after, onClose }: { editor: Editor; before: string; after: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null), closeCallback = useRef(onClose)
  closeCallback.current = onClose
  useEffect(() => {
    const previous = window.document.activeElement
    close.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeCallback.current() } }
    window.document.addEventListener('keydown', escape)
    return () => { window.document.removeEventListener('keydown', escape); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const rows = useMemo(() => { const docs = revisionDocuments(editor, before, after); return pairRevisionBlocks(docs.before, docs.after) }, [editor, before, after])
  const original = splitRevisionMarkdown(before), proposed = splitRevisionMarkdown(after)
  return <section className="writing-comparison" aria-label="原文与修改稿对照">
    <header><span className="qx-meta">按段落对照</span><button ref={close} type="button" className="qx-btn qx-btn--ghost" onClick={onClose}>关闭对照</button></header>
    <div className="writing-comparison__scroll">
      <div className="writing-comparison__labels"><strong>原文</strong><strong>修改后</strong></div>
      {(original.frontmatter || proposed.frontmatter) && <div className="writing-comparison__row"><pre className="writing-raw">{original.frontmatter || '无文稿属性'}</pre><pre className="writing-raw">{proposed.frontmatter || '无文稿属性'}</pre></div>}
      {rows.map((row, index) => <div className="writing-comparison__row" data-changed={!row.before?.eq(row.after ?? row.before) || !row.before || !row.after} key={index}><RevisionBlock editor={editor} node={row.before} /><RevisionBlock editor={editor} node={row.after} /></div>)}
    </div>
  </section>
}
