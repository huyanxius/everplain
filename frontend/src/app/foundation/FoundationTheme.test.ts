import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve('src/app/foundation/everplain-website.css'), 'utf8')
const page = readFileSync(resolve('src/app/foundation/FoundationPage.tsx'), 'utf8')

describe('landing system theme contract', () => {
  it('maps every landing surface, ink, line and font to the global tokens', () => {
    expect(css).not.toMatch(/color-scheme\s*:\s*light\s*;/)
    for (const [name, token] of [
      ['--ep-paper', '--qx-color-canvas'], ['--ep-card', '--qx-color-surface'], ['--ep-ink', '--qx-color-ink'],
      ['--ep-muted', '--qx-color-muted'], ['--ep-line', '--qx-color-rule'], ['--ep-on-ink', '--qx-color-on-accent'],
      ['--ep-accent', '--qx-color-warning'], ['--ep-serif', '--qx-font-reading'], ['--ep-sans', '--qx-font-ui'],
    ]) {
      expect(css).toMatch(new RegExp(`${name}:\\s*var\\(${token}\\)`))
    }
  })

  it('does not hard-code surface or foreground colors outside the brand palette', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).not.toMatch(/#[\da-f]{3,8}\b/i)
    expect(css).toContain('color: var(--ep-on-ink)')
    expect(css).toContain('color: var(--ep-on-accent)')
  })

  it('keeps both brand marks decorative and colored with the current ink', () => {
    expect(page.match(/className="ep-brand-mark" aria-hidden="true"/g)).toHaveLength(2)
    expect(css).toMatch(/\.ep-brand-mark\s*\{[^}]*background:\s*currentColor;[^}]*mask:/)
    expect(page).not.toContain('src={brandMark}')
  })
})

// CSSOM 的真实模式切换另由浏览器验收；这里守住语义 token 的基本文字对比度。
const tokens = readFileSync(resolve('src/styles/tokens.css'), 'utf8')
function palette(token: string) {
  const match = tokens.match(new RegExp(`${token}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`))
  if (!match) throw new Error(`Missing theme pair: ${token}`)
  return match.slice(1)
}
function luminance(hex: string) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
it.each([0, 1])('keeps main text, metadata, actions and citation text readable in theme %i', mode => {
  const paper = palette('--qx-color-canvas')[mode]
  const card = palette('--qx-color-surface')[mode]
  const ink = palette('--qx-color-ink')[mode]
  const muted = palette('--qx-color-muted')[mode]
  const onInk = palette('--qx-color-on-accent')[mode]
  const accent = palette('--qx-color-warning')[mode]
  for (const [foreground, background] of [[ink, paper], [muted, paper], [muted, card], [onInk, ink], [accent, card]]) {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  }
})
