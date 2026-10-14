import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/app/conversation-view/conversation-composer.css'), 'utf8')
const declarations = (selector: string) => css.split(`${selector} {`)[1]?.split('}')[0] ?? ''

describe('suggestion row CSS contracts (not browser layout verification)', () => {
  it('uses the same full-width rows at every container size', () => {
    expect(declarations('.cv-context-suggestions .cv-suggestions__cards')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(css).not.toContain('max-width: 839px')
    expect(css).not.toContain('repeat(auto-fit')
    expect(declarations('.cv-suggestions__card')).toContain('min-width: 0')
    expect(declarations('.cv-suggestions__card')).toContain('overflow-wrap: anywhere')
  })
  it('uses a shared item surface and one constrained title', () => {
    const row = declarations('.cv-context-suggestions__item .cv-suggestions__card')
    expect(row).toContain('grid-template-columns: var(--qx-space-4) minmax(0, 1fr)')
    expect(row).toContain('height: auto')
    expect(row).toContain('background: transparent')
    expect(row).toContain('box-shadow: none')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__title')).toContain('-webkit-line-clamp: 2')
  })
  it('changes only the image within the existing icon track, leaving the row height unchanged', () => {
    const icon = declarations('.cv-context-suggestions__item .cv-suggestions__icon')
    expect(icon).toContain('width: var(--qx-space-5)')
    expect(icon).toContain('height: var(--qx-space-5)')
    expect(icon).toContain('object-fit: contain')
    const row = declarations('.cv-context-suggestions__item .cv-suggestions__card')
    expect(row).toContain('grid-template-columns: var(--qx-space-4) minmax(0, 1fr)')
    expect(row).toContain('min-height: var(--qx-action-height)')
    expect(row).toContain('padding: var(--qx-space-3)')
  })
  it('reserves room for an independent textual source action in both locales', () => {
    expect(declarations('.cv-context-suggestions__source-toggle')).toContain('position: absolute')
    expect(declarations('.cv-context-suggestions__source-toggle:focus-visible')).toContain('outline: 2px solid var(--qx-color-accent)')
    expect(declarations('.cv-context-suggestions__sources')).toContain('inset-inline: 0')
    expect(declarations('.cv-context-suggestions__sources')).toContain('overflow-y: auto')
    expect(declarations('.cv-context-suggestions__item[data-has-sources="true"] .cv-suggestions__card')).toContain('padding-inline-end: calc(4em + var(--qx-space-3))')
  })
  it('preserves focus and disabled affordances without decorative elevation', () => {
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card:focus-visible')).toContain('outline: 2px solid var(--qx-color-accent)')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card:disabled')).toContain('cursor: not-allowed')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card:hover:not(:disabled)')).not.toContain('box-shadow')
  })
  it('leaves the separate generic research suggestions layout intact', () => {
    expect(declarations('.cv-suggestions__cards')).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).toContain('@container conversation-suggestions (max-width: 560px) { .cv-suggestions__cards { grid-template-columns: minmax(0, 1fr); } }')
    expect(declarations('.cv-suggestions__card.qx-btn')).toContain('background: var(--qx-color-surface-muted)')
  })
})
