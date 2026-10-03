import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Inspect the shipped stylesheet, not jsdom's inline colorScheme (which cannot
// detect light-dark() lowering). These checks intentionally cover the compiler's
// fallback variables without coupling application code to their private names.
const assets = resolve(process.argv[2] ?? 'dist/assets')
const css = readdirSync(assets)
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(resolve(assets, name), 'utf8'))
  .join('\n')
assert.ok(css.includes('--qx-color-canvas:'), 'Missing production theme tokens')

function assertSwitch(declarations, scheme, important = false) {
  assert.ok(declarations, `Missing compiled ${scheme} appearance rule`)
  for (const candidate of ['light', 'dark']) {
    const value = candidate === scheme ? 'initial' : ''
    assert.match(
      declarations,
      new RegExp(`--lightningcss-${candidate}:\\s*${value}\\s*${important ? '!important' : ''}\\s*(?:;|$)`),
      `Compiled ${scheme} must select ${candidate === scheme ? 'its own' : 'not the other'} token branch`,
    )
  }
}

// Explicit attribute selectors outrank the generated OS :root selector in both
// directions. Returning to system removes those matches; no JS media listener
// or hard-coded token copies are needed.
for (const scheme of ['light', 'dark']) {
  const selector = `:root\\[data-color-scheme=["']?${scheme}["']?\\]`
  const declarations = css.match(new RegExp(`${selector}\\s*\\{([^{}]*)\\}`))?.[1]
  assertSwitch(declarations, scheme)
  assert.match(declarations, new RegExp(`color-scheme:\\s*${scheme}\\s*(?:;|$)`))
}

const defaultRoot = css.match(/:root\s*\{([^{}]*color-scheme:\s*light dark[^{}]*)\}/)?.[1]
assertSwitch(defaultRoot, 'light')
const systemDark = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^{}]*)\}/)?.[1]
assertSwitch(systemDark, 'dark')
const print = css.match(/@media\s+print\s*\{\s*:root\s*,\s*:root\[data-color-scheme\]\s*\{([^{}]*)\}/)?.[1]
assertSwitch(print, 'light', true)
assert.match(print, /color-scheme:\s*light\s*!important/)
assert.match(print, /--qx-graph-filter:\s*none\s*(?:;|$)/)
console.log('Built appearance: explicit light/dark, system defaults, and print fallback switches verified (not browser rendering)')
