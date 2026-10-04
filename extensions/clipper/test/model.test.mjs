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
