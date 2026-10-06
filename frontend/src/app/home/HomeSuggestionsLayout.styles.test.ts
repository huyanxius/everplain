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
function containerGrid(containerWidth: number) {
  let grid = property(declarations(composer, '.cv-suggestions__cards'), 'grid-template-columns')
  const fallback = composer.match(/@container conversation-suggestions \(max-width:\s*(\d+)px\) \{ ([^}]+)\}/)
  if (fallback && containerWidth <= Number(fallback[1])) grid = property(declarations(fallback[2], '.cv-suggestions__cards'), 'grid-template-columns')
  return grid
}
function homeSuggestionColumns(viewport: number, containerWidth: number) {
  let grid = containerGrid(containerWidth)
  // A two-class Home selector outranks the one-class generic container rule,
  // independent of which stylesheet was imported first.
  for (const block of viewportBlocks(home, viewport)) {
    grid = property(declarations(block, '.hm-me .cv-suggestions__cards'), 'grid-template-columns') || grid
  }
  return grid.match(/repeat\((\d+),/) ? Number(grid.match(/repeat\((\d+),/)![1]) : (grid.match(/minmax\(/g) ?? []).length
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
  const marginInline = [...margin.matchAll(/var\((--qx-space-[\w-]+)\)/g)][1]?.[1]
  return Math.min(viewport - railWidth, maximum) - 2 * px(`var(${inline})`) - 2 * px(`var(${marginInline})`)
}

describe('Home parent-width and suggestion breakpoint contracts (not browser geometry)', () => {
  it.each([[1440, 1200, 488], [1280, 1040, 448], [1101, 861, 358.5]])('keeps desktop Home in three columns at viewport %i and page width %i', (viewport, available, expected) => {
    expect(available).toBe(viewport - px(property(declarations(frame, '.application-frame'), '--application-sidebar-width')))
    const width = deskColumnWidth(viewport, available)
    expect(width).toBe(expected)
    expect(width).toBeLessThan(560)
    expect(homeSuggestionColumns(viewport, width)).toBe(3)
  })
  it.each([[1100, 844], [900, 644], [768, 512], [641, 641]])('keeps the single-desk tablet layout horizontally grouped at viewport %i', (viewport, available) => {
    const width = deskColumnWidth(viewport, available)
    expect(homeSuggestionColumns(viewport, width)).toBe(3)
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
  ] as const)('keeps Agent desktop three-column at %i with %s rail', (viewport, rail, expected) => {
    const width = agentWidth(viewport, rail)
    expect(width).toBe(expected)
    expect(width).toBeGreaterThan(560)
    expect(containerGrid(width)).toBe('repeat(3, minmax(0, 1fr))')
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
