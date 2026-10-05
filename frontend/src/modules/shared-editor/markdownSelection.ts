import { decodeHtmlEntities, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { splitMarkdown } from './markdownSource'

export type MarkdownRange = { start: number; end: number; text: string }
export type MarkdownSelection = MarkdownRange | { error: string } | null
export const selectionMappingError = '这一选区无法准确定位到 Markdown。请在源码模式重新选择范围，或清除选区后再操作。'

type SourceView = { text: string; boundaries: (number | null)[] }
type Mapping = { markdown: string; positions: Map<string, number | null>; compatible: boolean }
const mappings = new WeakMap<ProseMirrorNode, Mapping>()
const maxBoundaryParses = 4

/** Keep UTF-16 source boundaries when the parser decodes escapes/entities or CRLF. */
function sourceView(source: string, decode: boolean): SourceView {
  let text = ''; const boundaries: (number | null)[] = [0]
  for (let i = 0; i < source.length;) {
    const tail = source.slice(i)
    const match = /^(\r\n)/.exec(tail) ?? (decode ? /^(\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:lt|gt|quot|amp);)/.exec(tail) : null)
    const raw = match?.[0] ?? source[i]
    const value = raw === '\r\n' ? '\n' : decode && raw.startsWith('\\') ? raw.slice(1) : decodeHtmlEntities(raw)
    text += value
    for (let unit = 1; unit <= value.length; unit++) boundaries.push(unit === value.length ? i + raw.length : null)
    i += raw.length
  }
  return { text, boundaries }
}

function outsideMarks(doc: ProseMirrorNode, item: { node: ProseMirrorNode; pos: number }, from: number, to: number) {
  const resolved = doc.resolve(item.pos), siblings: { node: ProseMirrorNode; pos: number }[] = []
  resolved.parent.forEach((node, offset) => siblings.push({ node, pos: resolved.start() + offset }))
  const index = siblings.findIndex(sibling => sibling.pos === item.pos)
  return item.node.marks.filter(mark => {
    let start = index, end = index
    while (start > 0 && mark.isInSet(siblings[start - 1].node.marks)) start--
    while (end + 1 < siblings.length && mark.isInSet(siblings[end + 1].node.marks)) end++
    return from > siblings[start].pos || to < siblings[end].pos + siblings[end].node.nodeSize
  })
}

function wrapperOffsets(body: string, offset: number, side: 'start' | 'end') {
  const result = [offset]
  while (result.length <= 8) {
    let match = side === 'start'
      ? /(\*+|_+|~~|==|`+|\[|<[^>]+>|<)$/.exec(body.slice(Math.max(0, offset - 256), offset))
      : /^(\*+|_+|~~|==|`+|\](?:\([^\n]*?\)|\[[^\n]*?\])|<\/[^>]+>|>)/.exec(body.slice(offset, offset + 2048))
    if (side === 'end' && body.startsWith('](', offset)) {
      let depth = 0; match = null
      for (let i = offset + 1; i < Math.min(body.length, offset + 2048) && body[i] !== '\n'; i++) {
        if (body[i] === '\\') { i++; continue }
        if (body[i] === '(') depth++
        if (body[i] === ')' && --depth === 0) { match = [body.slice(offset, i + 1)] as RegExpExecArray; break }
      }
    }
    if (!match) break
    offset += (side === 'start' ? -1 : 1) * match[0].length; result.push(offset)
  }
  return result
}

/**
 * Resolve a rich-editor position against the ORIGINAL source, never a normalized
 * serializer copy. A temporary plain-text marker is parsed with the editor's
 * own Markdown extensions. Removing it must reproduce the entire current PM
 * document (including marks/attributes), and its UTF-16 PM position must match.
 * Thus repeated text, link destinations and Markdown syntax cannot be mistaken
 * for the selected occurrence. The live editor/document is never mutated.
 */
export function mapMarkdownSelection(editor: Editor, markdown: string): MarkdownSelection {
  const { doc, selection } = editor.state
  if (selection.empty) return null
  const manager = editor.markdown
  if (!manager) return { error: selectionMappingError }
  const { body, frontmatter } = splitMarkdown(markdown)
  let mapping = mappings.get(doc)
  if (!mapping || mapping.markdown !== markdown) {
    let compatible = false
    try { compatible = editor.schema.nodeFromJSON(manager.parse(body)).eq(doc) } catch { /* Fail closed below. */ }
    mapping = { markdown, positions: new Map(), compatible }; mappings.set(doc, mapping)
  }
  if (!mapping.compatible) return { error: selectionMappingError }
  const nodes: { node: ProseMirrorNode; pos: number }[] = [], breaks = new Map<number, ProseMirrorNode>(); let unsupported = false
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.isText) nodes.push({ node, pos })
    else if (node.type.name === 'hardBreak') breaks.set(pos, node)
    else if (node.isLeaf && node.type.name !== 'hardBreak') unsupported = true
  })
  if (unsupported) return { error: selectionMappingError }
  let first = nodes[0], last = nodes[nodes.length - 1]
  const firstBreak = breaks.get(selection.from), lastBreak = [...breaks].find(([pos, node]) => pos + node.nodeSize === selection.to)?.[1]
  const beforeBreak = firstBreak ? doc.resolve(selection.from).nodeBefore : null, afterBreak = lastBreak ? doc.resolve(selection.to).nodeAfter : null
  if (beforeBreak?.isText) first = { node: beforeBreak, pos: selection.from - beforeBreak.nodeSize }
  if (afterBreak?.isText) last = { node: afterBreak, pos: selection.to }
  if (!first || !last) return { error: selectionMappingError }
  let prefix = '\uE000EverplainSelection'
  while (body.includes(prefix) || JSON.stringify(doc.toJSON()).includes(prefix)) prefix += '\uE002'
  const markerPattern = new RegExp(`${prefix}(\\d{8})\uE001`, 'g')
  const markerLength = prefix.length + 9
  function cleanAttributes(node: JSONContent): JSONContent {
    const clean = (attrs: JSONContent['attrs']) => attrs ? JSON.parse(JSON.stringify(attrs).replace(markerPattern, '')) : attrs
    return { ...node, attrs: clean(node.attrs), marks: node.marks?.map(mark => ({ ...mark, attrs: clean(mark.attrs) })), content: node.content?.map(cleanAttributes) }
  }
  function stripMarkers(node: ProseMirrorNode): ProseMirrorNode | null {
    if (node.isText) { const text = node.text!.replace(markerPattern, ''); return text ? editor.schema.text(text, node.marks) : null }
    const children: ProseMirrorNode[] = []
    node.forEach(child => { const clean = stripMarkers(child); if (clean) children.push(clean) })
    return node.copy(Fragment.fromArray(children))
  }
  const views = [sourceView(body, false), sourceView(body, true)]
  function boundary(item: typeof nodes[number], position: number, side: 'start' | 'end', edge?: ProseMirrorNode) {
    const carried = edge ? edge.marks : outsideMarks(doc, item, selection.from, selection.to)
    const signature = JSON.stringify(carried.map(mark => mark.toJSON()))
    const key = `${position}:${side}:${signature}`
    if (mapping!.positions.has(key)) return mapping!.positions.get(key)!
    const offset = Math.max(0, Math.min(item.node.text!.length, position - item.pos))
    const checked = new Set<number>(), preferred = new Set<number>()
    const direct = views.filter(view => view.text.includes(item.node.text!))
    for (const view of direct.length ? direct : views) {
      let pattern = item.node.text!, relative = offset
      // A text node can merge across redundant inline markup or quoted soft
      // lines. The parser proof still anchors a local UTF-16 boundary exactly.
      if (!view.text.includes(pattern)) { relative = offset > 0 ? 1 : 0; pattern = offset > 0 ? pattern.slice(offset - 1, offset) : pattern.slice(0, 1) }
      for (let hit = view.text.indexOf(pattern); hit >= 0; hit = view.text.indexOf(pattern, hit + 1)) {
        const sourceOffset = view.boundaries[hit + relative]
        if (sourceOffset != null) {
          const wrappers = wrapperOffsets(body, sourceOffset, edge ? side === 'start' ? 'end' : 'start' : side)
          for (const candidate of wrappers) checked.add(candidate)
          preferred.add(carried.length === item.node.marks.length ? sourceOffset : wrappers[wrappers.length - 1])
        }
      }
    }
    const offsets = [...checked].sort((a, b) => a - b)
    function verify(candidates: number[]) {
      try {
        let cursor = 0; const parts: string[] = []
        for (const [index, candidate] of candidates.entries()) { parts.push(body.slice(cursor, candidate), `${prefix}${String(index).padStart(8, '0')}\uE001`); cursor = candidate }
        parts.push(body.slice(cursor))
        let parsed = editor.schema.nodeFromJSON(cleanAttributes(manager!.parse(parts.join(''))))
        const positions: { pos: number; candidate: number; marks: readonly Mark[] }[] = []
        parsed.descendants((node, pos) => {
          if (!node.isText) return
          for (const match of node.text!.matchAll(markerPattern)) positions.push({ pos: pos + match.index!, candidate: Number(match[1]), marks: node.marks })
        })
        if (!stripMarkers(parsed)?.eq(doc)) return null
        for (const [i, anchor] of positions.entries()) {
          if (!Mark.sameSet(anchor.marks, carried)) continue
          const anchorKey = `${anchor.pos - i * markerLength}:${side}:${signature}`
          const current = mapping!.positions.get(anchorKey), source = candidates[anchor.candidate]
          if (current == null || (side === 'start' ? source < current : source > current)) mapping!.positions.set(anchorKey, source)
        }
        return mapping!.positions.get(key) ?? null
      } catch { return null /* Syntax/attribute occurrences are not valid source anchors. */ }
    }
    // Try the nearest source anchor first, but accept it ONLY after exact PM
    // verification. This avoids expanding thousands of markers in long drafts.
    const estimated = position / doc.content.size * body.length
    const nearest = [...preferred].sort((a, b) => Math.abs(a - estimated) - Math.abs(b - estimated))[0]
    if (nearest != null) { const found = verify([nearest]); if (found != null) return found }
    // Text and attribute occurrences are disambiguated in one batch. Limit
    // probes if inserting into syntax changes its meaning: never O(matches)
    // full-document parses on a 200k-character draft.
    if (offsets.length > 1) { const found = verify(offsets); if (found != null) return found }
    const probes = offsets.filter(candidate => candidate !== nearest).sort((a, b) => Math.abs(a - estimated) - Math.abs(b - estimated)).slice(0, maxBoundaryParses - 1 - (offsets.length > 1 ? 1 : 0))
    for (const candidate of probes) { const found = verify([candidate]); if (found != null) return found }
    mapping!.positions.set(key, null); return null
  }
  const start = boundary(first, Math.max(selection.from, first.pos), 'start', beforeBreak?.isText ? firstBreak : undefined)
  const end = boundary(last, Math.min(selection.to, last.pos + last.node.nodeSize), 'end', afterBreak?.isText ? lastBreak : undefined)
  if (start == null || end == null || start >= end) return { error: selectionMappingError }
  return { start: frontmatter.length + start, end: frontmatter.length + end, text: body.slice(start, end) }
}
