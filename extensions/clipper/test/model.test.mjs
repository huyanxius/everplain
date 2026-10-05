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

test('picker excludes unsupported and empty folders and exposes exact folder descendants', async () => {
  const { bookmarkSelectionTree } = await import('../src/model.mjs')
  const choices = bookmarkSelectionTree([{ id: '0', title: '', children: [
    { id: '1', title: 'Work', children: [
      { id: 'a', title: 'A', url: 'https://example.org/a' },
      { id: '2', title: 'Nested', children: [{ id: 'b', title: 'B', url: 'http://example.org/b' }] },
      { id: 'c', url: 'chrome://settings' }, { id: 'd', url: 'https://' },
      { id: 'secret', url: 'https://user:password@example.org' },
    ] },
    { id: '3', title: 'Empty', children: [] },
  ] }])
  assert.equal(choices.length, 1)
  assert.equal(choices[0].title, 'Work')
  assert.deepEqual(choices[0].bookmarkIds, ['a', 'b'])
  assert.deepEqual(choices[0].children[1].bookmarkIds, ['b'])
})

test('credential-bearing and malformed links are never serialized into the import payload', () => {
  const out = bookmarksHtml([{ id: 'secret', url: 'https://user:password@example.org' }, { id: 'invalid', url: 'https://' }])
  assert.equal(out.count, 0)
  assert.doesNotMatch(out.html, /password|example.org/)
})

test('selected bookmark export preserves ancestry and never sends unselected siblings', () => {
  const tree = [{ id: '0', title: '', children: [{ id: '1', title: 'Folder & friends', children: [
    { id: 'a', title: 'Private unselected', url: 'https://example.org/private' },
    { id: '2', title: 'Nested', children: [{ id: 'b', title: 'Selected', url: 'https://example.org/selected' }] },
  ] }, { id: '3', title: 'Unselected folder', children: [{ id: 'c', url: 'https://example.org/other' }] }] }]
  const output = bookmarksHtml(tree, new Set(['b']))
  assert.equal(output.count, 1)
  assert.match(output.html, /Folder &amp; friends/)
  assert.match(output.html, /Nested/)
  assert.match(output.html, /https:\/\/example.org\/selected/)
  assert.doesNotMatch(output.html, /Private unselected|Unselected folder|\/private|\/other/)
  assert.equal(bookmarksHtml(tree, new Set()).count, 0)
  assert.doesNotMatch(bookmarksHtml(tree, new Set()).html, /<H3>/)
})

test('batch summaries distinguish queue acceptance, duplicates and failure from completion', async () => {
  const { importSummary, importProgressUrl } = await import('../src/model.mjs')
  const batch = { id: 'batch-1', total: 3, finished: 1, imported: 0, duplicates: 1, failed: 0, status: 'processing' }
  assert.match(importSummary(batch), /已提交 3 条资料.*1\/3/)
  assert.doesNotMatch(importSummary(batch), /已收藏|完成/)
  assert.match(importSummary({ ...batch, finished: 3, imported: 1, failed: 1, status: 'partial' }), /新增 1，更新 0，重复 1，失败 1.*重试/)
  assert.match(importSummary({ ...batch, finished: 3, imported: 1, updated: 1, status: 'completed' }), /新增 1，更新 1，重复 1，失败 0/)
  assert.match(importSummary({ ...batch, finished: 3, imported: 2, status: 'completed' }), /本批已处理 3\/3/)
  assert.throws(() => importSummary({ total: 3 }))
  assert.throws(() => importSummary({ ...batch, status: 'completed' }))
  assert.equal(importProgressUrl('https://app.example.org/app', 'batch&1'), 'https://app.example.org/imports?batch=batch%261')
})

test('bookmark access remains optional and no automatic content scripts or credential permission added', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage'])
  assert.deepEqual(manifest.optional_permissions, ['bookmarks'])
  assert.equal(manifest.content_scripts, undefined)
  assert.equal(manifest.background, undefined)
})
