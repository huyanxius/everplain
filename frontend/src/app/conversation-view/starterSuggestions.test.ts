import { describe, expect, it } from 'vitest'
import { getStarterSuggestions, starterSuggestionPool } from './starterSuggestions'

describe('generic starter suggestions', () => {
  it.each(['zh-CN', 'en-US'] as const)('has twenty distinct visible starters with typed actions in %s', locale => {
    const pool = starterSuggestionPool(locale)
    expect(pool).toHaveLength(20)
    expect(new Set(pool.map(card => card.id)).size).toBe(20)
    expect(new Set(pool.map(card => card.title)).size).toBe(20)
    for (const card of pool) {
      expect(card.title.trim()).toBeTruthy()
      expect(card.description.trim()).toBeTruthy()
      expect(card.description).not.toBe(card.title)
      expect(card.title).not.toMatch(/什么东西|placeholder/i)
      expect(card).not.toHaveProperty('prompt')
      expect(card).not.toHaveProperty('card_id')
      expect(card).not.toHaveProperty('version')
      expect(card).not.toHaveProperty('sources')
    }
  })
  it('targets real existing import selectors and read-only function entry routes', () => {
    const navigation = Object.fromEntries(starterSuggestionPool('zh-CN').filter(card => card.kind === 'navigate').map(card => [card.id, card.to]))
    expect(navigation).toEqual({ import: '/library?add=file', webpage: '/library?add=extension', obsidian: '/library?add=obsidian', bookmarks: '/library?add=chrome', library: '/library', browse: '/library', research: '/research/new', investigate: '/research/new', writing: '/writing', outline: '/writing' })
  })
  it('selects three distinct stable cards across Home and Chat, including actual feature actions', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 120; index++) {
      const user = `reader-${index}`
      const cards = getStarterSuggestions('zh-CN', user)
      expect(cards).toEqual(getStarterSuggestions('zh-CN', user))
      expect(cards).toHaveLength(3)
      expect(new Set(cards.map(card => card.id)).size).toBe(3)
      expect(cards.map(card => card.kind)).toEqual(['draft', 'navigate', 'navigate'])
      cards.forEach(card => seen.add(card.id))
    }
    expect(seen.size).toBe(20)
  })
})


it.each(['zh-CN', 'en-US'] as const)('fills only missing slots with distinct stable generic choices in %s', locale => {
  const originals = getStarterSuggestions(locale, 'reader-1')
  for (const count of [0, 1, 2, 3]) {
    const excludedTitles = originals.map(card => card.title)
    const cards = getStarterSuggestions(locale, 'reader-1', { count, excludedTitles })
    expect(cards).toHaveLength(count)
    expect(new Set(cards.map(card => card.id)).size).toBe(count)
    expect(cards.every(card => !excludedTitles.includes(card.title))).toBe(true)
    expect(cards).toEqual(getStarterSuggestions(locale, 'reader-1', { count, excludedTitles }))
  }
  expect(getStarterSuggestions(locale, 'reader-1', { count: 2 })).toEqual(originals.slice(0, 2))
})

it('keeps fallback identity locale-independent and excludes whitespace/case-equivalent titles', () => {
  const first = getStarterSuggestions('en-US', 'reader-1')[0]
  const cards = getStarterSuggestions('en-US', 'reader-1', { count: 3, excludedTitles: [`  ${first.title.toUpperCase().replaceAll(' ', '  ')}  `] })
  expect(cards).toHaveLength(3)
  expect(cards.some(card => card.id === first.id)).toBe(false)
  expect(getStarterSuggestions('en-US', 'reader-1').map(card => card.id)).toEqual(getStarterSuggestions('zh-CN', 'reader-1').map(card => card.id))
})
