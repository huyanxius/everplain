import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const home = readFileSync(resolve('src/app/home/personal-home.css'), 'utf8')
const composer = readFileSync(resolve('src/app/conversation-view/conversation-composer.css'), 'utf8')
const layout = readFileSync(resolve('src/app/conversation-view/conversation-layout.css'), 'utf8')
const frame = readFileSync(resolve('src/app/application-frame/application-frame.css'), 'utf8')
const tokens = readFileSync(resolve('src/styles/tokens.css'), 'utf8')
const declarations = (css: string, selector: string) => css.split(`${selector} {`)[1]?.split('}')[0] ?? ''
const property = (css: string, name: string) => css.match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`))?.[1]?.trim() ?? ''
const px = (value: string) => {
  const variable = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  return Number.parseFloat(variable ? tokens.match(new RegExp(`${variable}:\\s*([\\d.]+)px`))?.[1] ?? 'NaN' : value)
}
function viewportBlocks(css: string, width: number) {
  return [...css.matchAll(/@media\s*\((min|max)-width:\s*(\d+)px\)\s*\{/g)].flatMap(match => {
    if (match[1] === 'min' ? width < Number(match[2]) : width > Number(match[2])) return []
    const start = match.index! + match[0].length
    let end = start, depth = 1
    while (end < css.length && depth) { if (css[end] === '{') depth++; if (css[end] === '}') depth--; end++ }
    return [css.slice(start, end - 1)]
  })
}
function deskColumnWidth(viewport: number, availableWidth: number) {
  // Resolve the real Home parent columns, spacing tokens and responsive rules.
  let desk = declarations(home, '.hm-desk')
  for (const block of viewportBlocks(home, viewport)) desk += `;${declarations(block, '.hm-desk')}`
  const last = (name: string) => [...desk.matchAll(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`, 'g'))].at(-1)?.[1].trim() ?? ''
  const columns = (last('grid-template-columns').match(/minmax\(/g) ?? []).length
  const padding = last('padding')
  const inlineToken = [...padding.matchAll(/var\((--qx-space-[\w-]+)\)/g)][1]?.[1]
  const inlinePadding = px(`var(${inlineToken})`)
  return (Math.min(availableWidth, px(last('max-width'))) - 2 * inlinePadding - (columns - 1) * px(last('column-gap'))) / columns
}
function containerGrid(_containerWidth: number) {
  return property(declarations(composer, '.cv-context-suggestions .cv-suggestions__cards'), 'grid-template-columns')
}
function homeSuggestionColumns(_viewport: number, containerWidth: number) {
  return containerGrid(containerWidth) === 'minmax(0, 1fr)' ? 1 : 0
}

function agentWidth(viewport: number, rail: 'classic' | 'collapsed' | 'split') {
  const shell = declarations(frame, '.application-frame')
  const railWidth = viewport <= 760 ? 0 : rail === 'classic' ? px(property(shell, '--application-sidebar-width'))
    : px(property(shell, '--application-sidebar-collapsed-width')) + (rail === 'split' ? px(property(shell, '--application-records-width')) : 0)
  const maximum = Number(property(declarations(layout, ".cv-layout[data-empty='true'] .cv-layout__compose"), 'width').match(/,\s*(\d+)px/)?.[1])
  let compose = declarations(layout, '.cv-layout__compose')
  for (const block of viewportBlocks(layout, viewport)) compose += `;${declarations(block, '.cv-layout__compose')}`
  const padding = [...compose.matchAll(/(?:^|;)\s*padding:\s*([^;]+)/g)].at(-1)?.[1] ?? ''
  const inline = [...padding.matchAll(/var\((--qx-space-[\w-]+)\)/g)][1]?.[1]
  const margin = property(declarations(composer, '.cv-research-suggestions'), 'margin')
  expect(margin).toBe('var(--qx-space-3) var(--qx-space-3) 0')
  return Math.min(viewport - railWidth, maximum) - 2 * px(`var(${inline})`) - 2 * px('var(--qx-space-3)')
}

describe('Home parent-width and suggestion breakpoint contracts (not browser geometry)', () => {
  it.each([[1440, 1200, 488], [1280, 1040, 448], [1101, 861, 358.5]])('uses full-width suggestion rows in desktop Home half-columns at viewport %i and page width %i', (viewport, available, expected) => {
    expect(available).toBe(viewport - px(property(declarations(frame, '.application-frame'), '--application-sidebar-width')))
    const width = deskColumnWidth(viewport, available)
    expect(width).toBe(expected)
    expect(width).toBeLessThan(560)
    expect(homeSuggestionColumns(viewport, width)).toBe(1)
  })
  it.each([[1100, 844], [900, 644], [768, 512], [641, 641]])('uses full-width suggestion rows in the single-desk tablet layout at viewport %i', (viewport, available) => {
    const width = deskColumnWidth(viewport, available)
    expect(homeSuggestionColumns(viewport, width)).toBe(1)
  })
  it.each([640, 560, 390, 320])('uses one safe full-width card column at narrow viewport %i', viewport => {
    const width = deskColumnWidth(viewport, viewport)
    expect(width).toBe(viewport - 32)
    expect(homeSuggestionColumns(viewport, width)).toBe(1)
  })
  it('does not remove the independent narrow research-container protection', () => {
    expect(property(declarations(frame, ".application-frame__main[data-wide='true']"), 'padding')).toBe('0')
    expect(property(declarations(frame, ".application-frame__main[data-workspace='true']"), 'padding')).toBe('0')
    expect(composer).toContain('@container conversation-suggestions (max-width: 560px)')
    expect(declarations(composer, '.cv-suggestions__card')).toContain('min-width: 0')
    expect(declarations(composer, '.cv-suggestions__card')).toContain('overflow-wrap: anywhere')
  })
})


describe('Agent empty-state widths through the real sidebar and composer constraints', () => {
  it.each([
    [1440, 'classic', 696], [1280, 'split', 696], [1024, 'classic', 696],
    [1024, 'split', 688], [900, 'classic', 588], [900, 'split', 564], [900, 'collapsed', 696],
  ] as const)('keeps Agent suggestions as wide rows at %i with %s rail', (viewport, rail, expected) => {
    const width = agentWidth(viewport, rail)
    expect(width).toBe(expected)
    expect(width).toBeGreaterThan(560)
    expect(containerGrid(width)).toBe('minmax(0, 1fr)')
  })
  it.each([[390, 342], [320, 272]] as const)('stacks cards safely at actual narrow Agent viewport %i', (viewport, expected) => {
    const width = agentWidth(viewport, 'classic')
    expect(width).toBe(expected)
    expect(containerGrid(width)).toBe('minmax(0, 1fr)')
  })
  it('preserves one column in a genuinely constrained desktop side panel', () => {
    expect(containerGrid(360)).toBe('minmax(0, 1fr)')
  })
})

// CSS-derived dimensions only, not real browser measurements.
describe('consistent suggestion rows at every width', () => {
  it.each([840, 960, 1120])('keeps the same quiet full-width row even in a %ipx container', width => {
    const columns = homeSuggestionColumns(width, width)
    expect(columns).toBe(1)
  })
  it('does not let the Home viewport override its actual container width', () => {
    expect(declarations(home, '.hm-me .cv-context-suggestions .cv-suggestions__cards')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(containerGrid(839)).toBe('minmax(0, 1fr)')
  })
})

it('keeps all Home and composer layout outside the recommendation rows at the exact baseline', () => {
  expect(declarations(home, '.hm-me .conversation-composer').trim()).toBe('width: 100%;')
  expect(declarations(home, ".hm-me .conversation-composer[data-layout='chat'] .conversation-composer__row")).toBe('')
  expect(declarations(home, ".hm-me .conversation-composer[data-layout='chat'] .conversation-composer__model")).toBe('')
  expect(home).not.toContain('.hm-me > .cv-context-suggestions')
  expect(declarations(composer, '.cv-research-suggestions')).toContain('margin: var(--qx-space-3) var(--qx-space-3) 0')
})

it('keeps only the empty Home chat placeholder on one line without affecting real drafts', () => {
  const hint = declarations(home, ".hm-me .conversation-composer[data-layout='chat'] .conversation-composer__row > textarea:placeholder-shown")
  expect(hint).toContain('white-space: nowrap')
  expect(hint).toContain('overflow: hidden')
  expect(hint).toContain('text-overflow: ellipsis')
  expect(hint).not.toContain('height:')
  expect(declarations(home, ".hm-me .conversation-composer[data-layout='chat'] .conversation-composer__row > textarea")).toBe('')
  expect(declarations(composer, '.conversation-composer__row > textarea')).not.toContain('white-space: nowrap')
})
