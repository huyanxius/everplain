/** Read existing display result metadata without altering tool DTOs or requests. */
export function toolResultSiteUrl(output: unknown, resultIndex: number) {
  if (!output || typeof output !== 'object') return null
  const value = output as Record<string, unknown>
  const candidates = Array.isArray(output) ? output : ['items', 'results', 'entries', 'sources'].map(key => value[key]).find(Array.isArray) ?? []
  // The title renderer skips the same non-object entries; keep positions aligned.
  const item = candidates.filter(candidate => candidate && typeof candidate === 'object')[resultIndex] as Record<string, unknown> | undefined
  if (!item) return null
  return typeof item.url === 'string' ? item.url : typeof item.source_id === 'string' ? item.source_id : null
}
