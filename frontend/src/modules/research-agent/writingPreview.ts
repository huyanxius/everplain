export type WritingPreviewEvent = {
  type: 'writing_preview'
  run_id: string
  call_id: string
  attempt_id?: string
  document_id: string
  base_version: number
  selection_start: number
  selection_end: number
  sequence: number
  replacement_text: string
  state: 'streaming' | 'ready' | 'invalidated'
  revision_id?: string
  error_code?: string
}

/** Keep this narrow event separate from assistant text, thinking and general tool arguments. */
export function parseWritingPreview(payload: Record<string, unknown>): WritingPreviewEvent | null {
  if (!['run_id', 'call_id', 'document_id'].every(key => typeof payload[key] === 'string' && (payload[key] as string).length > 0)
    || !['base_version', 'selection_start', 'selection_end', 'sequence'].every(key => Number.isSafeInteger(payload[key]))
    || (payload.base_version as number) < 1 || (payload.sequence as number) < 1
    || (payload.selection_start as number) < 0 || (payload.selection_end as number) < (payload.selection_start as number)
    || typeof payload.replacement_text !== 'string' || payload.replacement_text.length > 2_000_000
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(payload.replacement_text)
    || !['streaming', 'ready', 'invalidated'].includes(String(payload.state))) return null
  if (payload.state === 'ready' && (typeof payload.revision_id !== 'string' || !payload.revision_id)) return null
  if (payload.state === 'invalidated' && payload.replacement_text !== '') return null
  return {
    type: 'writing_preview', run_id: payload.run_id as string, call_id: payload.call_id as string,
    document_id: payload.document_id as string, base_version: payload.base_version as number,
    selection_start: payload.selection_start as number, selection_end: payload.selection_end as number,
    sequence: payload.sequence as number, replacement_text: payload.replacement_text,
    state: payload.state as WritingPreviewEvent['state'],
    ...(typeof payload.attempt_id === 'string' && payload.attempt_id ? { attempt_id: payload.attempt_id } : {}),
    ...(payload.state === 'ready' ? { revision_id: payload.revision_id as string } : {}),
    ...(typeof payload.error_code === 'string' ? { error_code: payload.error_code } : {}),
  }
}

export function writingPreviewsFromSnapshot(payload: Record<string, unknown>): WritingPreviewEvent[] {
  const attempts = Array.isArray(payload.output_attempts) ? payload.output_attempts : []
  const latest = attempts.at(-1) as { attempt_id?: unknown } | undefined
  return Array.isArray(payload.writing_previews) ? payload.writing_previews.flatMap(value => {
    const preview = value && typeof value === 'object' ? parseWritingPreview(value as Record<string, unknown>) : null
    return preview && preview.run_id === payload.run_id && (!latest?.attempt_id || preview.attempt_id === latest.attempt_id) ? [preview] : []
  }) : []
}
