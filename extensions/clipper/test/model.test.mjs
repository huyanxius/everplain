import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceOrigin, bookmarksHtml } from '../src/model.mjs'
test('only explicit HTTPS or local development origins',()=>{assert.equal(serviceOrigin('https://app.example.org/app'),'https://app.example.org');assert.equal(serviceOrigin('http://localhost:5196'),'http://localhost:5196');assert.throws(()=>serviceOrigin('http://remote.example.org'));assert.throws(()=>serviceOrigin('https://user:pass@app.example.org'))})
test('bookmark export preserves HTTP URLs and escapes labels',()=>{const out=bookmarksHtml([{title:'Folder',children:[{title:'<hello>',url:'https://example.org/?x=1&y=2'},{url:'chrome://settings'},{title:'Nested',children:[{title:'Note',url:'http://example.net'}]}]}]);assert.equal(out.count,2);assert.match(out.html,/&lt;hello&gt;/);assert.match(out.html,/x=1&amp;y=2/);assert.doesNotMatch(out.html,/chrome:\/\//)})
