import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceOrigin, bookmarksHtml } from '../src/model.mjs'
test('only explicit HTTPS or local development origins',()=>{assert.equal(serviceOrigin('https://app.example.org/app'),'https://app.example.org');assert.equal(serviceOrigin('http://localhost:5196'),'http://localhost:5196');assert.throws(()=>serviceOrigin('http://remote.example.org'));assert.throws(()=>serviceOrigin('https://user:pass@app.example.org'))})
test('bookmark export preserves HTTP URLs and escapes labels',()=>{const out=bookmarksHtml([{title:'Folder',children:[{title:'<hello>',url:'https://example.org/?x=1&y=2'},{url:'chrome://settings'},{title:'Nested',children:[{title:'Note',url:'http://example.net'}]}]}]);assert.equal(out.count,2);assert.match(out.html,/&lt;hello&gt;/);assert.match(out.html,/x=1&amp;y=2/);assert.doesNotMatch(out.html,/chrome:\/\//)})

test('official site is the default without changing an existing saved origin', async () => {
  const { DEFAULT_SERVICE_ORIGIN } = await import('../src/model.mjs')
  assert.equal(DEFAULT_SERVICE_ORIGIN, 'https://e.qunxue.xyz')
  const { readFile } = await import('node:fs/promises')
  const popup = await readFile(new URL('../src/popup.js', import.meta.url), 'utf8')
  assert.match(popup, /stored\.everplainOrigin \|\| DEFAULT_SERVICE_ORIGIN/)
})

test('popup uses Web tokens without private color or typography values', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../popup.css', import.meta.url), 'utf8')
  const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8')
  assert.match(build, /frontend\/src\/styles\/tokens\.css/)
  assert.match(css, /var\(--qx-color-surface\)/)
  assert.match(css, /var\(--qx-radius-pill\)/)
  assert.match(css, /var\(--qx-text-meta\)/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i)
})

test('single-line address field keeps Web input typography and pill geometry', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../popup.css', import.meta.url), 'utf8')
  const input = css.match(/^input \{([^}]+)\}/m)?.[1]
  assert.ok(input, 'address input styles must be present')
  assert.match(input, /border-radius: var\(--qx-radius-pill\)/)
  assert.match(input, /font-family: var\(--qx-font-ui\)/)
  assert.match(input, /font-size: var\(--qx-text-body\)/)
  assert.match(input, /line-height: var\(--qx-text-body--line-height\)/)
  assert.doesNotMatch(input, /font:\s*inherit|--qx-radius-field/)
})
