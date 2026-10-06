import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/app/conversation-view/conversation-composer.css'), 'utf8')
const declarations = (selector: string) => css.split(`${selector} {`)[1]?.split('}')[0] ?? ''

describe('suggestion layout CSS contracts (not browser layout verification)', () => {
  it('keeps three equal desktop columns even when only one or two real cards exist', () => {
    expect(declarations('.cv-suggestions__cards')).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).not.toContain('repeat(auto-fit')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card')).toContain('width: 100%')
  })
  it('uses a single column in narrow containers without a more specific override', () => {
    expect(css).toContain('@container conversation-suggestions (max-width: 560px) { .cv-suggestions__cards { grid-template-columns: minmax(0, 1fr); } }')
    expect(css).not.toContain('.cv-context-suggestions .cv-suggestions__cards')
    expect(declarations('.cv-suggestions__card')).toContain('min-width: 0')
    expect(declarations('.cv-suggestions__card')).toContain('overflow-wrap: anywhere')
  })
  it('keeps source controls compact, focusable and panels within the card width', () => {
    expect(declarations('.cv-context-suggestions__source-toggle')).toContain('position: absolute')
    expect(declarations('.cv-context-suggestions__source-toggle:focus-visible')).toContain('outline: 2px solid var(--qx-color-accent)')
    expect(declarations('.cv-context-suggestions__sources')).toContain('inset-inline: 0')
    expect(declarations('.cv-context-suggestions__sources')).toContain('overflow-y: auto')
    expect(declarations('.cv-context-suggestions__sources li')).toContain('overflow-wrap: anywhere')
  })
  it('keeps card summaries compact without truncating the accessible text', () => {
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card > span')).toContain('-webkit-line-clamp: 2')
    expect(declarations('.cv-context-suggestions__item .cv-suggestions__card > span')).toContain('overflow: hidden')
  })
})
