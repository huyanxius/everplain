import type { Element, Nodes, Root, RootContent, Text } from 'hast'
import type { VFile } from 'vfile'
import type { StreamReveal } from './useStreamPacer'

const LIGHT_MS = 1100
/** Markdown positions refer to the original source, not the length of rendered text. */
export function rehypeStreamReveal({ revealedAt, now }: StreamReveal) {
  return (tree: Root, file: VFile) => {
    const source = String(file.value)
    const ageAt = (offset: number | undefined) => {
      if (offset === undefined) return null
      const t = revealedAt[offset]
      return Number.isFinite(t) && now - t < LIGHT_MS ? Math.max(0, now - t) : null
    }
    function decorateText(node: Text): RootContent[] {
      let offset = node.position?.start.offset
      if (offset === undefined) return [node]
      const end = node.position?.end.offset ?? offset + node.value.length
      const parts: RootContent[] = []
      let plain = ''
      const flush = () => { if (plain) { parts.push({ type: 'text', value: plain }); plain = '' } }
      for (const char of Array.from(node.value)) {
        // Escapes and entities occupy more source bytes than their rendered character.
        if (source[offset] === '\\' && source.slice(offset + 1, offset + 1 + char.length) === char) offset++
        const entity = source[offset] === '&' ? source.slice(offset, end).match(/^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][\dA-Za-z]+);/)?.[0] : undefined
        const age = ageAt(offset)
        if (age === null) plain += char
        else {
          flush()
          parts.push({ type: 'element', tagName: 'span', properties: { className: ['stream-fresh'], style: `--age:-${age.toFixed(1)}ms` }, children: [{ type: 'text', value: char }] })
        }
        offset += entity?.length ?? char.length
      }
      flush()
      return parts
    }
    function visit(node: Nodes) {
      if (!('children' in node)) return
      const el = node as Element
      if (el.tagName === 'a' && /^#everplain-source-\d+$/.test(String(el.properties?.href ?? ''))) {
        // The custom React renderer will turn this whole link into the citation button.
        const age = ageAt((el.position?.end.offset ?? 0) - 1)
        if (age !== null) {
          el.properties.className = ['stream-fresh-cite']
          el.properties.style = `--age:-${age.toFixed(1)}ms`
        }
        return
      }
      node.children = node.children.flatMap(child => {
        if (child.type === 'text') return decorateText(child)
        visit(child)
        return [child]
      }) as typeof node.children
    }
    visit(tree)
  }
}
