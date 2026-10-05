import { describe, expect, it } from 'vitest'
import type { SharedDocument } from '../../modules/shared-knowledge'
import { documentKind, documentTitle, siteIconUrl } from './libraryMaterials'

const document = { filename: 'bookmark-59.md', mediaType: 'text/markdown', knowledge: null } as SharedDocument

describe('web material metadata', () => {
  it('classifies Markdown bookmarks using their source URL', () => {
    expect(documentKind(document, { url: 'https://example.com/article' })).toBe('网页')
    expect(documentKind(document)).toBe('笔记')
    expect(documentKind({ ...document, mediaType: 'image/png' }, { url: 'https://example.com/' })).toBe('图片')
    expect(documentKind({ ...document, mediaType: 'application/pdf' }, { url: 'https://example.com/' })).toBe('PDF')
    expect(documentKind(document, { url: 'javascript:alert(1)' })).toBe('笔记')
  })
  it('uses the original page title and preserves meaningful filenames', () => {
    const source = { url: 'https://example.com/article', title: 'Townscaper' }
    expect(documentTitle(document, source)).toBe('Townscaper')
    expect(documentTitle({ ...document, filename: '我的城镇设计.md' }, source)).toBe('我的城镇设计.md')
  })
  it('extracts a meaningful title from saved knowledge without new requests', () => {
    expect(documentTitle({ ...document, knowledge: { summary: 'Townscaper 是一款自由建造游戏。玩家可以创造城镇。', topics: [], relations: [] } }, { url: 'https://townscapergame.com/', title: 'bookmark-31' })).toBe('Townscaper 是一款自由建造游戏')
    expect(documentTitle(document, { url: 'https://www.example.com/private?token=secret' })).toBe('example.com')
  })
  it('only requests same-origin site icons without paths, credentials or tracking', () => {
    expect(siteIconUrl({ url: 'https://townscapergame.com/private?token=secret' })).toBe('https://townscapergame.com/favicon.ico')
    for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'file:///tmp/private']) expect(siteIconUrl({ url })).toBeNull()
  })
})
