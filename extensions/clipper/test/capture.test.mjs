import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { parseHTML } from 'linkedom'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

// Execute the actual bundled capture entry, using inert synthetic DOM content.
// GHSA-jg4p-g6xj-4qmf concerns extractor-produced HTML, not fetch DNS policy.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/capture.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', target: 'chrome120',
})
const source = compiled.outputFiles[0].text

function capture(attributes) {
  const { document } = parseHTML(`<!doctype html><html><head><title>Fixture</title></head><body>
    <section data-testid="twitterArticleReadView">
      <aside data-testid="tweetPhoto"><img></aside>
      <article data-testid="twitterArticleRichTextView">
        <h1 data-testid="twitter-article-title">A synthetic article</h1>
        <div class="public-DraftStyleDefault-block">A harmless paragraph to keep.</div>
      </article>
    </section></body></html>`)
  for (const [name, value] of Object.entries(attributes)) document.querySelector('img').setAttribute(name, value)
  document.URL = 'https://x.com/fixture/article/123456789'
  document.styleSheets = []
  document.defaultView.getComputedStyle = () => ({ display: '' })
  const scope = { document, location: { href: document.URL }, URL, console }
  runInNewContext(source, scope)
  return scope.__everplainCapture
}

function assertInert(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      assert.ok(!/^on/i.test(attribute.name), `executable attribute: ${attribute.name}`)
      if (/^(src|href)$/i.test(attribute.name)) {
        assert.ok(!/^javascript:/i.test(attribute.value.replace(/\s/g, '')), 'executable URL')
      }
    }
  }
}

test('capture keeps normal article text and source identity', () => {
  const captured = capture({ src: 'https://example.test/photo.png', alt: 'A normal photograph' })
  assert.match(captured.html, /A harmless paragraph to keep/)
  assert.match(captured.html, /A normal photograph/)
  assert.equal(captured.url, 'https://x.com/fixture/article/123456789')
  assertInert(captured.html)
})

test('capture does not promote quoted image text into event handlers', () => {
  const captured = capture({ src: 'https://example.test/photo.png', alt: 'photo" onerror="throw 1' })
  assertInert(captured.html)
})

test('capture removes executable image URLs from extractor output', () => {
  assertInert(capture({ src: 'javascript:throw(1)', alt: 'A normal photograph' }).html)
})
