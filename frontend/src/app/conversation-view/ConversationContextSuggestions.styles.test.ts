import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/app/conversation-view/conversation-composer.css'), 'utf8')
const declarations = (selector: string) => css.split(`${selector} {`)[1]?.split('}')[0] ?? ''

describe('conversation context layout CSS contracts (not browser layout verification)', () => {
  it('lets a single card fill the row and wraps extra cards based on the available width', () => {
    expect(declarations('.cv-context-suggestions .cv-suggestions__cards')).toContain('repeat(auto-fit, minmax(min(100%, 260px), 1fr))')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card')).toContain('width: 100%')
    expect(declarations('.cv-context-suggestions__header')).toContain('flex-wrap: wrap')
  })
  it('constrains the disclosure focus box to its label and preserves a visible focus ring', () => {
    expect(declarations('.cv-context-suggestions__source-toggle')).toContain('width: fit-content')
    expect(declarations('.cv-context-suggestions__source-toggle')).toContain('max-width: 100%')
    expect(declarations('.cv-context-suggestions__source-toggle:focus-visible')).toContain('outline: 2px solid var(--qx-color-accent)')
  })
  it('wraps long source text and preserves original quote line breaks', () => {
    expect(declarations('.cv-context-suggestions__sources li')).toContain('overflow-wrap: anywhere')
    expect(declarations('.cv-context-suggestions__quote')).toContain('white-space: pre-wrap')
  })
})
