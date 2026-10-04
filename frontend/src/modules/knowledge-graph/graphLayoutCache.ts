import type { Core, ElementDefinition } from 'cytoscape'
import type { KnowledgeGraphProjection } from './types'

// Increment when layout semantics change. Persist geometry only, never labels/content.
const PREFIX = 'everplain:graph-layout:v2:'
const LIMIT = 12
export type Positions = Record<string, { x: number; y: number }>
export function layoutCacheKey(projection: KnowledgeGraphProjection, scope: string) {
  const topology = JSON.stringify([scope, projection.releaseId,
    projection.nodes.map(n => [n.id, n.nodeType, n.level]).sort(),
    projection.edges.map(e => [e.id, e.source, e.target]).sort()])
  let hash = 2166136261
  for (let i = 0; i < topology.length; i++) hash = Math.imul(hash ^ topology.charCodeAt(i), 16777619)
  return PREFIX + (hash >>> 0).toString(36)
}
export function readLayout(key: string, ids: readonly string[]): Positions | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as { positions?: Positions } | null
    const positions = parsed?.positions
    if (!positions || Object.keys(positions).length !== ids.length) return
    if (!ids.every(id => Object.hasOwn(positions, id) && Number.isFinite(positions[id].x) && Number.isFinite(positions[id].y))) return
    return positions
  } catch { return undefined }
}
export function saveLayout(key: string, graph: Core) {
  try {
    const positions: Positions = Object.fromEntries(graph.nodes().map(n => [n.id(), { ...n.position() }]))
    if (!Object.values(positions).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return
    localStorage.setItem(key, JSON.stringify({ positions }))
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX))
    for (const old of keys.filter(k => k !== key).slice(0, Math.max(0, keys.length - LIMIT))) localStorage.removeItem(old)
  } catch { /* Storage may be disabled/full. Layout remains usable. */ }
}
export function positionedElements(elements: ElementDefinition[], saved?: Positions): ElementDefinition[] {
  let index = 0
  return [...elements].sort((a, b) => String(a.data.id).localeCompare(String(b.data.id))).map(element => {
    if (element.data.source !== undefined) return element
    const i = index++
    const angle = i * Math.PI * (3 - Math.sqrt(5))
    const radius = 36 * Math.sqrt(i + 1)
    return { ...element, position: saved?.[String(element.data.id)] ?? { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius } }
  })
}
