import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const origin = 'https://app.example.org'
const batch = { id: 'batch-1', status: 'processing', total: 1, finished: 0, imported: 0, duplicates: 0, failed: 0 }
const bookmarks = [{ id: '0', title: '', children: [{ id: 'folder', title: 'Work', children: [
  { id: 'a', title: 'Alpha', url: 'https://example.org/alpha' },
  { id: 'nested', title: 'Nested', children: [{ id: 'b', title: 'Beta', url: 'https://example.org/beta' }] },
  { id: 'internal', title: 'Settings', url: 'chrome://settings' },
] }] }]
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })
let fixtureNumber = 0
async function fixture(t, options = {}) {
  const { document, window } = parseHTML(await readFile(new URL('../popup.html', import.meta.url), 'utf8'))
  const permissions = [], submissions = [], injections = []
  const local = { everplainOrigin: origin }, session = {}
  let treeReads = 0, loggedIn = options.loggedIn ?? true
  const event = { addListener() {}, removeListener() {} }
  const chrome = {
    storage: {
      local: { async get() { return local }, async set(value) { Object.assign(local, value) } },
      session: { async get() { return session }, async set(value) { Object.assign(session, value) } },
    },
    permissions: { async request(value) { permissions.push(value); return options.permission ?? true } },
    bookmarks: { async getTree() { treeReads++; return options.tree ?? bookmarks } },
    tabs: {
      async query(value) { return value.active ? [{ id: 1, url: options.pageUrl ?? 'https://example.org/current' }] : [{ id: 2, status: 'complete' }] },
      async create() { return { id: 2, status: 'complete' } }, onUpdated: event, onRemoved: event,
    },
    scripting: { async executeScript(value) {
      injections.push(value)
      if (value.files) return []
      if (value.target.tabId === 1) return [{ result: { title: 'Current', url: 'https://example.org/current', html: '<p>Captured page</p>' } }]
      return [{ result: await value.func(...value.args) }]
    } },
  }
  const globals = { document, chrome, location: { origin } }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  delete globalThis.__everplainImportRequests
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    if (path === '/api/session') return loggedIn ? json({ user: { user_id: 'owner-1' } }) : json({}, 401)
    if (path.startsWith('/api/imports/')) {
      if (path !== '/api/imports/clip') return json(batch)
    }
    submissions.push({ path, init })
    if (options.failFirstSubmission && submissions.length === 1) throw new Error('response lost after submission')
    return json({ ...batch, total: options.total ?? 1 }, 202)
  })
  t.after(() => {
    delete globalThis.__everplainImportRequests
    for (const key of Object.keys(globals)) previous[key] ? Object.defineProperty(globalThis, key, previous[key]) : delete globalThis[key]
  })
  await import(`../src/popup.js?fixture=${++fixtureNumber}`)
  const get = id => document.querySelector('#' + id)
  const dispatch = (id, type = 'click') => get(id).dispatchEvent(new window.Event(type, { bubbles: true }))
  const settle = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(1)
      if (!get('bookmarks').disabled) return
    }
    throw new Error('popup action did not settle')
  }
  const change = (title, checked) => {
    const label = [...document.querySelectorAll('.bookmark-choice')].find(node => node.querySelector('span')?.firstChild?.textContent === title)
    assert.ok(label, `choice ${title} exists`)
    const input = label.querySelector('input'); input.checked = checked
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  return { get, document, dispatch, settle, change, permissions, submissions, injections, session, treeReads: () => treeReads, login: () => { loggedIn = true } }
}

test('popup only reads bookmarks on explicit click; folders select descendants, search preserves selections, selected-only submission', async t => {
  const ui = await fixture(t)
  assert.equal(ui.treeReads(), 0)
  assert.equal(ui.get('bookmark-picker').hidden, true)
  ui.dispatch('bookmarks'); await ui.settle()
  assert.equal(ui.treeReads(), 1)
  assert.deepEqual(ui.permissions, [{ permissions: ['bookmarks'] }])
  assert.equal(ui.get('import-selected').disabled, true)
  assert.equal(ui.submissions.length, 0)
  assert.doesNotMatch(ui.get('bookmark-tree').textContent, /Settings/)
  ui.change('Work', true)
  assert.equal(ui.get('selection-count').textContent, '已选 2 条书签')
  ui.change('Alpha', false)
  const folder = ui.document.querySelector('summary input')
  assert.equal(folder.indeterminate, true)
  ui.get('bookmark-search').value = 'Alpha'; ui.dispatch('bookmark-search', 'input')
  assert.equal(ui.get('selection-count').textContent, '已选 1 条书签')
  ui.dispatch('import-selected'); ui.dispatch('import-selected'); await ui.settle()
  assert.equal(ui.submissions.length, 1)
  const file = ui.submissions[0].init.body.get('files')
  const html = await file.text()
  assert.match(html, /Work.*Nested/s)
  assert.match(html, /https:\/\/example.org\/beta/)
  assert.doesNotMatch(html, /https:\/\/example.org\/alpha|chrome:\/\//)
  assert.match(ui.get('status').textContent, /已提交 1 条资料/)
  assert.equal(ui.get('progress').getAttribute('href'), origin + '/imports?batch=batch-1')
  assert.match(ui.get('batch-id').textContent, /batch-1/)
  const firstKey = ui.submissions[0].init.headers['Idempotency-Key']
  assert.equal(ui.session.everplainImportIntent.completed, true)
  ui.dispatch('import-selected'); await ui.settle()
  assert.equal(ui.submissions.length, 2)
  assert.notEqual(ui.submissions[1].init.headers['Idempotency-Key'], firstKey)
  assert.equal(ui.session.everplainImportIntent.completed, true)
  assert.equal(typeof ui.session.everplainImportIntent.signature, 'string')
  assert.deepEqual(Object.keys(ui.session.everplainImportIntent).sort(), ['completed', 'key', 'signature'])
})

test('unknown submission retries keep the pending key; next confirmed deliberate refresh gets a fresh key', async t => {
  const ui = await fixture(t, { failFirstSubmission: true })
  ui.dispatch('bookmarks'); await ui.settle(); ui.change('Alpha', true)
  ui.dispatch('import-selected'); await ui.settle()
  const pendingKey = ui.submissions[0].init.headers['Idempotency-Key']
  assert.match(ui.get('status').textContent, /提交结果尚未确认/)
  assert.equal(ui.session.everplainImportIntent.completed, false)
  ui.dispatch('import-selected'); await ui.settle()
  assert.equal(ui.submissions[1].init.headers['Idempotency-Key'], pendingKey)
  assert.match(ui.get('status').textContent, /已提交/)
  assert.equal(ui.session.everplainImportIntent.completed, true)
  ui.dispatch('import-selected'); await ui.settle()
  assert.notEqual(ui.submissions[2].init.headers['Idempotency-Key'], pendingKey)
})

test('close/reopen retains selection and never submits; all and clear are explicit', async t => {
  const ui = await fixture(t)
  ui.dispatch('bookmarks'); await ui.settle()
  ui.change('Alpha', true)
  ui.dispatch('close-picker')
  assert.equal(ui.get('bookmark-picker').hidden, true)
  ui.dispatch('bookmarks'); await ui.settle()
  assert.equal(ui.get('bookmark-picker').hidden, false)
  assert.equal(ui.get('selection-count').textContent, '已选 1 条书签')
  assert.equal(ui.treeReads(), 1)
  ui.dispatch('select-all')
  assert.equal(ui.get('selection-count').textContent, '已选 2 条书签')
  ui.dispatch('clear-selection')
  assert.equal(ui.get('selection-count').textContent, '已选 0 条书签')
  assert.equal(ui.get('import-selected').disabled, true)
  assert.equal(ui.submissions.length, 0)
})

test('bookmark permission denial and empty bookmarks do not read or submit', async t => {
  const ui = await fixture(t, { permission: false })
  ui.dispatch('bookmarks'); await ui.settle()
  assert.equal(ui.treeReads(), 0)
  assert.equal(ui.submissions.length, 0)
  assert.match(ui.get('status').textContent, /未获得书签权限/)
  assert.equal(ui.get('bookmark-picker').hidden, true)
})

test('empty bookmark tree leaves selection disabled', async t => {
  const ui = await fixture(t, { tree: [] })
  ui.dispatch('bookmarks'); await ui.settle()
  assert.match(ui.get('bookmark-tree').textContent, /没有找到/)
  assert.equal(ui.get('import-selected').disabled, true)
  assert.equal(ui.submissions.length, 0)
})

test('login interruption retains selection and succeeds after the user logs in', async t => {
  const ui = await fixture(t, { loggedIn: false })
  ui.dispatch('bookmarks'); await ui.settle(); ui.change('Alpha', true)
  ui.dispatch('import-selected'); await ui.settle()
  assert.equal(ui.submissions.length, 0)
  assert.match(ui.get('status').textContent, /登录/)
  assert.equal(ui.get('selection-count').textContent, '已选 1 条书签')
  assert.equal(ui.get('progress').getAttribute('href'), origin + '/imports')
  ui.login(); ui.dispatch('import-selected'); await ui.settle()
  assert.equal(ui.submissions.length, 1)
  assert.match(ui.get('status').textContent, /已提交/)
})

test('current-page flow captures clicked page first and reports accepted batch rather than finished', async t => {
  const ui = await fixture(t)
  ui.dispatch('clip'); await ui.settle()
  assert.equal(ui.treeReads(), 0)
  assert.equal(ui.injections[0].target.tabId, 1)
  assert.deepEqual(ui.injections[0].files, ['capture.js'])
  assert.equal(ui.submissions[0].path, '/api/imports/clip')
  assert.match(ui.get('status').textContent, /已提交/)
  assert.doesNotMatch(ui.get('status').textContent, /已收藏/)
})
