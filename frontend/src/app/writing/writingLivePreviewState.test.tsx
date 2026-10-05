import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWritingPreview, type WritingPreviewEvent } from '../../modules/research-agent'
import { applyWritingPreview, liveWritingMarkdown, readLiveWritingDraft } from './writingLivePreviewState'
import { WritingLivePreview } from './WritingLivePreview'

const base = { document_id: 'doc', version: 1, markdown: '前文😀原文\n\n尾段' }
const event: WritingPreviewEvent = { type: 'writing_preview', run_id: 'run', call_id: 'call', document_id: 'doc', base_version: 1, selection_start: 4, selection_end: 6, sequence: 1, replacement_text: '新', state: 'streaming' }
beforeEach(() => sessionStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('actual document delta snapshots', () => {
  it('composes the exact UTF16 target and leaves the saved source unchanged', () => {
    const draft = applyWritingPreview(null, event, base, 100)!
    expect(liveWritingMarkdown(draft)).toBe('前文😀新\n\n尾段'); expect(base.markdown).toBe('前文😀原文\n\n尾段')
    expect(draft.revealedAt).toEqual([100])
  })
  it('deduplicates replay and rejects stale sequence without appending text twice', () => {
    const first = applyWritingPreview(null, event, base, 100)!
    expect(applyWritingPreview(first, event, base, 200)).toBe(first)
    const next = applyWritingPreview(first, { ...event, sequence: 2, replacement_text: '新😀' }, base, 200)!
    expect(next.replacement_text).toBe('新😀'); expect(next.revealedAt).toEqual([100, 200, 200])
    expect(applyWritingPreview(next, event, base, 300)).toBe(next)
  })
  it.each([{ document_id: 'other' }, { base_version: 2 }, { selection_start: 3 }, { selection_end: 100 }])('fails closed for wrong document/version/surrogate/anchor %j', change => {
    expect(applyWritingPreview(null, { ...event, ...change }, base, 100)).toBeNull()
  })
  it('invalidates a tool attempting to change its bound text prefix', () => {
    const first = applyWritingPreview(null, event, base, 100)!
    expect(applyWritingPreview(first, { ...event, sequence: 2, replacement_text: '别稿' }, base, 200)).toMatchObject({ state: 'invalidated', replacement_text: '' })
  })
  it('invalidated drafts cannot become ready or show held text again', () => {
    const first = applyWritingPreview(null, event, base, 100)!
    const invalid = applyWritingPreview(first, { ...event, sequence: 2, replacement_text: '', state: 'invalidated' }, base, 200)!
    expect(applyWritingPreview(invalid, { ...event, sequence: 3, state: 'ready', revision_id: 'rev' }, base, 300)).toBe(invalid)
  })
  it('restores an owner-scoped unsaved draft only against its exact base', () => {
    const draft = applyWritingPreview(null, event, base, 100)!
    sessionStorage.setItem('owner:doc', JSON.stringify(draft))
    expect(readLiveWritingDraft('owner:doc', base)).toMatchObject({ replacement_text: '新', incomplete: true, revealedAt: [] })
    expect(readLiveWritingDraft('other:doc', base)).toBeNull()
    expect(readLiveWritingDraft('owner:doc', { ...base, version: 2 })).toBeNull()
    expect(readLiveWritingDraft('owner:doc', { ...base, markdown: '另一稿' })).toBeNull()
  })
  it('displays the whole received network snapshot immediately and uses existing Agent reveal markup', () => {
    const draft = applyWritingPreview(null, event, base, performance.now())!
    const view = render(<WritingLivePreview draft={draft} />)
    expect(view.container).toHaveTextContent('前文😀新'); expect(view.container).toHaveTextContent('尾段')
    expect(view.container.querySelector('.stream-fresh')).toHaveTextContent('新')
    expect(view.container.querySelector('[data-streaming="true"]')).toBeInTheDocument()
  })
})

it('whitelists event fields and rejects unsafe or incomplete event metadata', () => {
  const safe = parseWritingPreview({ ...event, thinking: 'private', arguments: { secret: 'private' }, original_text: 'private' })!
  expect(safe).toEqual(event)
  expect(parseWritingPreview({ ...event, sequence: 1.5 })).toBeNull()
  expect(parseWritingPreview({ ...event, run_id: '' })).toBeNull()
  expect(parseWritingPreview({ ...event, state: 'ready' })).toBeNull()
  expect(parseWritingPreview({ ...event, state: 'invalidated' })).toBeNull()
  expect(parseWritingPreview({ ...event, replacement_text: '\uD83D' })).toBeNull()
})

it('allows a fresh model attempt to reuse a provider call ID without concatenating an old draft', () => {
  const old = applyWritingPreview(null, { ...event, attempt_id: 'old', replacement_text: '旧稿' }, base, 100)!
  const fresh = applyWritingPreview(old, { ...event, attempt_id: 'new', sequence: 100, replacement_text: '新' }, base, 200)!
  expect(fresh.replacement_text).toBe('新'); expect(fresh.revealedAt).toEqual([200])
})

it('scrubs a same-call invalidation even after the document version changes', () => {
  const draft = applyWritingPreview(null, event, base, 100)!
  expect(applyWritingPreview(draft, { ...event, sequence: 2, state: 'invalidated', replacement_text: '' }, { ...base, version: 2 }, 200)).toMatchObject({ state: 'invalidated', replacement_text: '', revealedAt: [], revision_id: undefined })
})

it('keeps links and external images inert while content is still only a streamed draft', () => {
  const draft = applyWritingPreview(null, { ...event, replacement_text: '![图](https://example.com/private?q=secret) [链接](https://example.com)' }, base, 100)!
  const view = render(<WritingLivePreview draft={draft} />)
  expect(view.container.querySelector('img, a[href]')).not.toBeInTheDocument()
  expect(view.container).toHaveTextContent('图'); expect(view.container).toHaveTextContent('链接')
})
