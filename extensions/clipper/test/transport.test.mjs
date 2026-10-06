import test from 'node:test'
import assert from 'node:assert/strict'
import { submitImport } from '../src/transport.mjs'

const origin = 'https://app.example.org'
const payload = { kind: 'bookmarks', value: '<DL><DT><A HREF="https://example.org">Example</A></DL>' }
const batch = { id: 'batch-1', status: 'processing', total: 1, finished: 0, imported: 0, duplicates: 0, failed: 0 }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function fixture(t, handler) {
  t.mock.method(globalThis, 'fetch', handler)
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { value: { origin }, configurable: true, writable: true })
  delete globalThis.__everplainImportRequests
  t.after(() => {
    delete globalThis.__everplainImportRequests
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation)
    else delete globalThis.location
  })
}

test('serializable isolated-world import uses session cookies and existing chrome file contract', async t => {
  const calls = []
  fixture(t, async (path, options) => {
    calls.push([path, options])
    return path === '/api/session' ? json({ user: { user_id: 'owner-1' } }) : json(batch, 202)
  })
  const serialized = (0, eval)(`(${submitImport.toString()})`)
  assert.deepEqual(await serialized(origin, payload, 'stable-key'), { batch })
  assert.deepEqual(calls.map(([path]) => path), ['/api/session', '/api/imports'])
  const request = calls[1][1]
  assert.equal(request.credentials, 'same-origin')
  assert.deepEqual(request.headers, { 'Idempotency-Key': 'stable-key' })
  assert.equal(request.body.get('source_type'), 'chrome')
  assert.equal(request.body.get('files').name, 'bookmarks.html')
  assert.equal(await request.body.get('files').text(), payload.value)
  assert.equal(request.body.get('user_id'), null)
  assert.equal(request.body.get('library_id'), null)
})

test('current-page capture keeps existing JSON endpoint', async t => {
  let submitted
  fixture(t, async (path, options) => {
    if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
    submitted = { path, ...options }; return json(batch, 202)
  })
  const value = { url: 'https://example.org', title: 'Example', html: '<p>Captured text</p>' }
  await submitImport(origin, { kind: 'clip', value }, 'clip-key')
  assert.equal(submitted.path, '/api/imports/clip')
  assert.equal(submitted.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(submitted.body), value)
})

test('login interruption never posts and can be retried after same-browser login', async t => {
  let loggedIn = false, posts = 0
  fixture(t, async path => {
    if (path === '/api/session') return loggedIn ? json({ user: { user_id: 'owner-1' } }) : json({}, 401)
    posts++; return json(batch, 202)
  })
  assert.equal((await submitImport(origin, payload, 'same-key')).login, true)
  assert.equal(posts, 0)
  loggedIn = true
  assert.deepEqual(await submitImport(origin, payload, 'same-key'), { batch })
  assert.equal(posts, 1)
})

test('concurrent/reopened popup requests reuse receipt and read latest progress without another post', async t => {
  let posts = 0, release
  const gate = new Promise(resolve => { release = resolve })
  fixture(t, async path => {
    if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
    if (path.startsWith('/api/imports/')) return json({ ...batch, status: 'completed', finished: 1, imported: 1 })
    posts++; await gate; return json(batch, 202)
  })
  const first = submitImport(origin, payload, 'same-key')
  const second = submitImport(origin, payload, 'same-key')
  await new Promise(resolve => setImmediate(resolve)); release()
  assert.deepEqual(await first, { batch })
  assert.deepEqual(await second, { batch })
  assert.equal(posts, 1)
  assert.equal((await submitImport(origin, payload, 'same-key')).batch.status, 'completed')
  assert.equal(posts, 1)
})

test('receipts are owner scoped so changing accounts never exposes the other account receipt', async t => {
  let owner = 'owner-1', posts = 0
  fixture(t, async path => {
    if (path === '/api/session') return json({ user: { user_id: owner } })
    posts++; return json({ ...batch, id: owner }, 202)
  })
  assert.equal((await submitImport(origin, payload, 'same-key')).batch.id, 'owner-1')
  owner = 'owner-2'
  assert.equal((await submitImport(origin, payload, 'same-key')).batch.id, 'owner-2')
  assert.equal(posts, 2)
})

test('unknown network outcome is recovered with the same key and then keeps the successful receipt', async t => {
  let posts = 0
  const keys = []
  fixture(t, async (path, options) => {
    if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
    if (path === '/api/imports/batch-1') return json(batch)
    keys.push(options.headers['Idempotency-Key'])
    if (++posts === 1) throw new Error('connection lost after submission')
    return json(batch, 202)
  })
  assert.equal((await submitImport(origin, payload, 'same-key')).uncertain, true)
  assert.deepEqual(await submitImport(origin, payload, 'same-key'), { batch })
  assert.deepEqual(keys, ['same-key', 'same-key'])
  assert.deepEqual(await submitImport(origin, payload, 'same-key'), { batch })
  assert.equal(posts, 2)
})

test('unavailable retry still reports unknown and never changes the request key', async t => {
  const keys = []
  fixture(t, async (path, options) => {
    if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
    keys.push(options.headers['Idempotency-Key'])
    throw new Error('network remains unavailable')
  })
  assert.equal((await submitImport(origin, payload, 'same-key')).uncertain, true)
  assert.equal((await submitImport(origin, payload, 'same-key')).uncertain, true)
  assert.deepEqual(keys, ['same-key', 'same-key'])
})

test('server errors and malformed acceptance keep unknown-outcome guard', async t => {
  fixture(t, async path => path === '/api/session' ? json({ user: { user_id: 'owner-1' } }) : json({}, 503))
  assert.equal((await submitImport(origin, payload, 'server-key')).uncertain, true)
  delete globalThis.__everplainImportRequests
  t.mock.method(globalThis, 'fetch', async path => path === '/api/session' ? json({ user: { user_id: 'owner-1' } }) : json({}, 202))
  assert.equal((await submitImport(origin, payload, 'invalid-key')).uncertain, true)
})

test('explicit rejection allows retry with the same intent key', async t => {
  let rejected = true, keys = []
  fixture(t, async (path, options) => {
    if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
    keys.push(options.headers['Idempotency-Key'])
    return rejected ? json({ detail: 'validation failed' }, 422) : json(batch, 202)
  })
  assert.equal((await submitImport(origin, payload, 'same-key')).error, 'validation failed')
  rejected = false
  assert.deepEqual(await submitImport(origin, payload, 'same-key'), { batch })
  assert.deepEqual(keys, ['same-key', 'same-key'])
})

test('tab navigation aborts before any session or payload fetch', async t => {
  fixture(t, () => { throw new Error('must not fetch') })
  globalThis.location.origin = 'https://other.example.org'
  assert.match((await submitImport(origin, payload, 'same-key')).error, /目标页面已切换/)
})

for (const [label, response, expected] of [
  ['standard error envelope', { error: { code: 'invalid_import', message: '文件类型不支持' } }, '文件类型不支持'],
  ['legacy detail', { detail: 'validation failed' }, 'validation failed'],
  ['standard before legacy', { error: { message: '标准错误' }, detail: '旧错误' }, '标准错误'],
  ['malformed message', { error: { message: { unsafe: true } } }, '未能提交，请在 Everplain 查看状态后重试'],
  ['null response', null, '未能提交，请在 Everplain 查看状态后重试'],
]) {
  test(`serialized submitImport displays ${label} and preserves same-key retry`, async t => {
    let rejected = true
    const keys = []
    fixture(t, async (path, options) => {
      if (path === '/api/session') return json({ user: { user_id: 'owner-1' } })
      keys.push(options.headers['Idempotency-Key'])
      return rejected ? json(response, 422) : json(batch, 202)
    })
    const serialized = (0, eval)(`(${submitImport.toString()})`)
    assert.deepEqual(await serialized(origin, payload, 'same-key'), { error: expected })
    rejected = false
    assert.deepEqual(await serialized(origin, payload, 'same-key'), { batch })
    assert.deepEqual(keys, ['same-key', 'same-key'])
  })
}
