import { useEffect, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import { pairRevisionBlocks, revisionChanges, revisionDocuments, splitRevisionMarkdown } from './revisionPreviewModel'

/** Render the proposal in place without dispatching anything to the real editor. */
export function WritingRevisionPreview({ editor, before, after, animate = false }: { editor: Editor; before: string; after: string; animate?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const documents = useMemo(() => revisionDocuments(editor, before, after), [editor, before, after])
  useEffect(() => {
    if (!host.current || editor.isDestroyed || !documents) return
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
    const view = new EditorView(host.current, { state: EditorState.create({ schema: editor.schema, doc: documents.after }), editable: () => false, nodeViews: { image: node => { const dom = window.document.createElement('span'); dom.textContent = `图片：${node.attrs.alt || '待确认'}`; return { dom } } }, markViews: { link: () => { const dom = window.document.createElement('span'); return { dom, contentDOM: dom } } }, attributes: { class: 'se-prose writing-revision-prose', 'aria-label': animate ? '已同意的修改动画' : '正文修改预览' }, decorations: () => set, dispatchTransaction: () => {} })
    for (const control of view.dom.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = true
    for (const element of view.dom.querySelectorAll<HTMLElement>('.writing-revision-deleted')) { const box = element.getBoundingClientRect(); element.style.maxWidth = `${box.width}px`; element.style.maxHeight = `${box.height}px` }
    return () => view.destroy()
  }, [editor, documents, animate])
  if (!documents) return <div className="writing-inline-preview"><pre className="writing-raw" aria-label="正文修改预览（Markdown 源码）">{after}</pre></div>
  return <div className="writing-inline-preview" data-animate={animate}>{splitRevisionMarkdown(after).frontmatter && <pre className="writing-raw">{splitRevisionMarkdown(after).frontmatter}</pre>}<div ref={host} /></div>
}

function RevisionBlock({ editor, node }: { editor: Editor; node: ProseMirrorNode | null }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const serializer = DOMSerializer.fromSchema(editor.schema)
    const inert = new DOMSerializer({ ...serializer.nodes, image: image => ['span', `图片：${image.attrs.alt || '待确认'}`] }, { ...serializer.marks, link: () => ['span', 0] })
    host.current.replaceChildren(node ? inert.serializeFragment(Fragment.from(node)) : window.document.createTextNode('此处无段落'))
    for (const control of host.current.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = true
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
  const rows = useMemo(() => { const docs = revisionDocuments(editor, before, after); return docs ? pairRevisionBlocks(docs.before, docs.after) : null }, [editor, before, after])
  const original = splitRevisionMarkdown(before), proposed = splitRevisionMarkdown(after)
  return <section className="writing-comparison" aria-label="原文与修改稿对照">
    <header><span className="qx-meta">按段落对照</span><button ref={close} type="button" className="qx-btn qx-btn--ghost" onClick={onClose}>关闭对照</button></header>
    <div className="writing-comparison__scroll">
      <div className="writing-comparison__labels"><strong>原文</strong><strong>修改后</strong></div>
      {rows && (original.frontmatter || proposed.frontmatter) && <div className="writing-comparison__row"><pre className="writing-raw">{original.frontmatter || '无文稿属性'}</pre><pre className="writing-raw">{proposed.frontmatter || '无文稿属性'}</pre></div>}
      {rows ? rows.map((row, index) => <div className="writing-comparison__row" data-changed={!row.before?.eq(row.after ?? row.before) || !row.before || !row.after} key={index}><RevisionBlock editor={editor} node={row.before} /><RevisionBlock editor={editor} node={row.after} /></div>) : <div className="writing-comparison__row"><pre className="writing-raw" aria-label="原文 Markdown 源码">{before}</pre><pre className="writing-raw" aria-label="修改后 Markdown 源码">{after}</pre></div>}
    </div>
  </section>
}
