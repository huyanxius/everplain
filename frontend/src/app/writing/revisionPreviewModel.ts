import type { Editor } from '@tiptap/core'
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import { ChangeSet } from 'prosemirror-changeset'

export function splitRevisionMarkdown(markdown: string) {
  const frontmatter = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n(?:\r?\n)?)?)/.exec(markdown)?.[0] ?? ''
  return { frontmatter, body: markdown.slice(frontmatter.length) }
}

export function revisionDocuments(editor: Editor, before: string, after: string) {
  if (!editor.markdown) throw new Error('编辑器尚未准备好。')
  return { before: editor.schema.nodeFromJSON(editor.markdown.parse(splitRevisionMarkdown(before).body)), after: editor.schema.nodeFromJSON(editor.markdown.parse(splitRevisionMarkdown(after).body)) }
}

export function revisionChanges(before: ProseMirrorNode, after: ProseMirrorNode) {
  const step = new ReplaceStep(0, before.content.size, new Slice(after.content, 0, 0))
  return ChangeSet.create(before).addSteps(after, [step.getMap()], null).changes
}

export type RevisionBlockPair = { before: ProseMirrorNode | null; after: ProseMirrorNode | null }

/** Equal blocks are anchors; pair only the changed gaps so an insertion cannot shift every later paragraph. */
export function pairRevisionBlocks(before: ProseMirrorNode, after: ProseMirrorNode): RevisionBlockPair[] {
  const left: ProseMirrorNode[] = [], right: ProseMirrorNode[] = []
  before.forEach(node => left.push(node)); after.forEach(node => right.push(node))
  const pairs: RevisionBlockPair[] = []
  let a = 0, b = 0
  while (a < left.length || b < right.length) {
    if (left[a] && right[b] && left[a].eq(right[b])) { pairs.push({ before: left[a++], after: right[b++] }); continue }
    // Bound the search for long documents. Repeated equal paragraphs keep their relative order.
    let nextA = -1, nextB = -1, distance = Infinity
    for (let i = a; i < Math.min(left.length, a + 100); i++) for (let j = b; j < Math.min(right.length, b + 100); j++) {
      if (i - a + j - b < distance && left[i].eq(right[j])) { nextA = i; nextB = j; distance = i - a + j - b }
    }
    const endA = nextA < 0 ? left.length : nextA, endB = nextB < 0 ? right.length : nextB
    while (a < endA || b < endB) pairs.push({ before: a < endA ? left[a++] : null, after: b < endB ? right[b++] : null })
  }
  return pairs
}
