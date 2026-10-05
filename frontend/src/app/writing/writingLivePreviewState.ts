import { parseWritingPreview, type WritingPreviewEvent } from '../../modules/research-agent'

export type WritingLiveDraft = WritingPreviewEvent & { original_markdown: string; incomplete?: boolean; revealedAt: number[] }
export function writingPreviewKey(event: Pick<WritingPreviewEvent, 'run_id' | 'call_id' | 'attempt_id'>) { return JSON.stringify([event.run_id, event.attempt_id ?? '', event.call_id]) }
function boundary(source: string, offset: number) { return offset >= 0 && offset <= source.length && !(offset > 0 && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset] ?? '')) }

export function applyWritingPreview(current: WritingLiveDraft | null, event: WritingPreviewEvent, base: { document_id: string; version: number; markdown: string }, now: number): WritingLiveDraft | null {
  const sameCall = current && writingPreviewKey(current) === writingPreviewKey(event)
  if (sameCall && event.state === 'invalidated' && event.sequence > current.sequence) return { ...current, ...event, revision_id: undefined, replacement_text: '', revealedAt: [] }
  if (event.document_id !== base.document_id || event.base_version !== base.version || !boundary(base.markdown, event.selection_start) || !boundary(base.markdown, event.selection_end)) return current
  if (sameCall && (event.sequence <= current.sequence || event.selection_start !== current.selection_start || event.selection_end !== current.selection_end || event.base_version !== current.base_version || event.document_id !== current.document_id || current.state === 'invalidated')) return current
  if (sameCall && current.state === 'ready' && event.state === 'streaming') return current
  if (sameCall && event.state !== 'invalidated' && !event.replacement_text.startsWith(current.replacement_text)) return { ...current, state: 'invalidated', replacement_text: '', revealedAt: [], error_code: 'preview_rebind' }
  const old = sameCall ? current.replacement_text : ''
  const prefix = event.replacement_text.startsWith(old) ? old.length : 0
  const revealedAt = sameCall && prefix ? current.revealedAt.slice(0, prefix) : []
  for (let i = prefix; i < event.replacement_text.length; i++) revealedAt[i] = now
  return { ...event, original_markdown: base.markdown, revealedAt }
}

export function liveWritingMarkdown(draft: WritingLiveDraft) { return draft.original_markdown.slice(0, draft.selection_start) + draft.replacement_text + draft.original_markdown.slice(draft.selection_end) }

export function readLiveWritingDraft(key: string, base: { document_id: string; version: number; markdown: string }): WritingLiveDraft | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Record<string, unknown> | null
    if (!data || data.original_markdown !== base.markdown) { sessionStorage.removeItem(key); return null }
    const event = parseWritingPreview(data)
    if (!event || event.state === 'invalidated') { sessionStorage.removeItem(key); return null }
    const draft = event ? applyWritingPreview(null, event, base, performance.now()) : null
    if (!draft) { sessionStorage.removeItem(key); return null }
    return { ...draft, revealedAt: [], incomplete: true }
  } catch { try { sessionStorage.removeItem(key) } catch { /* Storage may be unavailable. */ } return null }
}
