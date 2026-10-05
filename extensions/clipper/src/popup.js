import { serviceOrigin, bookmarksHtml, bookmarkSelectionTree, isImportableWebUrl, importProgressUrl, importSummary, DEFAULT_SERVICE_ORIGIN } from './model.mjs'
import { submitImport } from './transport.mjs'

const originInput = document.querySelector('#origin')
const status = document.querySelector('#status')
const progress = document.querySelector('#progress')
const batchLabel = document.querySelector('#batch-id')
const picker = document.querySelector('#bookmark-picker')
const treeElement = document.querySelector('#bookmark-tree')
const searchInput = document.querySelector('#bookmark-search')
const submitButton = document.querySelector('#import-selected')
const stored = await chrome.storage.local.get('everplainOrigin')
originInput.value = stored.everplainOrigin || DEFAULT_SERVICE_ORIGIN
let working = false
let tree = []
let choices = []
const selected = new Set()
let rows = []
let bookmarksLoaded = false

function updateSelection() {
  for (const { input, node } of rows) {
    const count = node.bookmarkIds.filter(id => selected.has(id)).length
    input.checked = count === node.bookmarkIds.length
    input.indeterminate = count > 0 && count < node.bookmarkIds.length
  }
  document.querySelector('#selection-count').textContent = `已选 ${selected.size} 条书签`
  submitButton.disabled = working || !selected.size
}
function busy(value) {
  working = value
  for (const control of document.querySelectorAll('button, input')) control.disabled = value
  if (!value) updateSelection()
}
function showLink(origin, batchId = null) {
  progress.href = importProgressUrl(origin, batchId)
  progress.textContent = batchId ? '查看本批导入进度 ↗' : '打开 Everplain 登录或查看导入记录 ↗'
  progress.hidden = false
  batchLabel.hidden = !batchId
  batchLabel.textContent = batchId ? `批次：${batchId}` : ''
}
function showBatch(origin, batch) {
  showLink(origin, batch.id)
  status.textContent = importSummary(batch)
}
async function allowTarget() {
  const origin = serviceOrigin(originInput.value.trim())
  // Called synchronously from the user click, before any other await.
  if (!await chrome.permissions.request({ origins: [`${origin}/*`] })) throw new Error('未获得 Everplain 站点权限，还没有提交资料')
  await chrome.storage.local.set({ everplainOrigin: origin })
  return origin
}
async function target(origin) {
  const matches = await chrome.tabs.query({ url: [`${origin}/*`] })
  const tab = matches[0] || await chrome.tabs.create({ url: origin + '/imports', active: false })
  if (tab.status !== 'complete') {
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); chrome.tabs.onRemoved.removeListener(removed); error ? reject(error) : resolve() }
      const timer = setTimeout(() => finish(new Error('Everplain 页面还没打开，请先登录后重试')), 15000)
      function listener(id, info) { if (id === tab.id && info.status === 'complete') finish() }
      function removed(id) { if (id === tab.id) finish(new Error('Everplain 标签页已关闭，请重新打开后重试')) }
      chrome.tabs.onUpdated.addListener(listener)
      chrome.tabs.onRemoved.addListener(removed)
      // Cover completion between query/create and listener registration.
      chrome.tabs.get(tab.id).then(current => { if (current.status === 'complete') finish() }).catch(() => finish(new Error('Everplain 标签页已关闭，请重新打开后重试')))
    })
  }
  return { origin, id: tab.id }
}
async function send(destination, payload) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([destination.origin, payload])))
  const signature = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const { everplainImportIntent: previous } = await chrome.storage.session.get('everplainImportIntent')
  const intent = previous?.signature === signature && typeof previous.key === 'string' && !previous.completed
    ? previous : { signature, key: crypto.randomUUID(), completed: false }
  // Only the intent hash/key is held in browser memory, never payloads or credentials.
  await chrome.storage.session.set({ everplainImportIntent: intent })
  const [result] = await chrome.scripting.executeScript({ target: { tabId: destination.id }, func: submitImport, args: [destination.origin, payload, intent.key] })
  const response = result?.result
  if (response?.batch) {
    showLink(destination.origin, response.batch.id)
    importSummary(response.batch)
    // Once acceptance is confirmed, a later deliberate click is a fresh import
    // so the backend can check whether the selected pages have changed.
    const { everplainImportIntent: current } = await chrome.storage.session.get('everplainImportIntent')
    if (current?.key === intent.key) await chrome.storage.session.set({ everplainImportIntent: { ...intent, completed: true } })
    return response.batch
  }
  if (response?.batchId) showLink(destination.origin, response.batchId)
  throw new Error(response?.error || '提交结果未能确认，请先在 Everplain 查看导入记录')
}
async function run(action, message = '正在准备…') {
  if (working) return
  busy(true); status.textContent = message
  try { await action() } catch (error) { status.textContent = error.message || '暂时未完成，请重试' } finally { busy(false) }
}
function renderChoices() {
  rows = []; treeElement.replaceChildren()
  const query = searchInput.value.trim().toLocaleLowerCase()
  const matches = node => `${node.title} ${node.url || ''}`.toLocaleLowerCase().includes(query) || node.children?.some(matches)
  function render(nodes, parent, depth = 0, inheritedMatch = false) {
    for (const node of nodes) {
      if (query && !inheritedMatch && !matches(node)) continue
      const input = document.createElement('input')
      input.type = 'checkbox'; input.disabled = working
      input.addEventListener('change', () => {
        for (const id of node.bookmarkIds) input.checked ? selected.add(id) : selected.delete(id)
        updateSelection()
      })
      const label = document.createElement('label')
      label.className = 'bookmark-choice'; label.append(input)
      const text = document.createElement('span')
      text.textContent = node.title; label.append(text)
      rows.push({ input, node })
      if (node.children) {
        const folder = document.createElement('details')
        folder.open = depth === 0 || Boolean(query)
        const summary = document.createElement('summary')
        const count = document.createElement('small')
        count.textContent = `${node.bookmarkIds.length} 条`
        label.append(count); summary.append(label); folder.append(summary)
        const children = document.createElement('div')
        children.className = 'bookmark-children'
        render(node.children, children, depth + 1, inheritedMatch || node.title.toLocaleLowerCase().includes(query))
        folder.append(children); parent.append(folder)
      } else {
        const url = document.createElement('small')
        url.textContent = node.url; text.append(url); parent.append(label)
      }
    }
  }
  render(choices, treeElement)
  if (!rows.length) treeElement.textContent = query ? '没有匹配的书签，已选内容保持不变' : '没有找到可导入的 HTTP(S) 书签'
  updateSelection()
}
function closePicker() {
  picker.hidden = true
  document.querySelector('#bookmarks').setAttribute('aria-expanded', 'false')
  document.querySelector('#bookmarks').focus()
}
document.querySelector('#clip').addEventListener('click', () => run(async () => {
  const [origin, [page]] = await Promise.all([allowTarget(), chrome.tabs.query({ active: true, currentWindow: true })])
  showLink(origin)
  if (!page?.id || !isImportableWebUrl(page.url || '')) throw new Error('请在普通 HTTP(S) 网页上使用收藏；网址不能包含账号或密码')
  // Capture the user-selected page before opening/reusing the application tab.
  await chrome.scripting.executeScript({ target: { tabId: page.id }, files: ['capture.js'] })
  const [captured] = await chrome.scripting.executeScript({ target: { tabId: page.id }, func: () => { const value = globalThis.__everplainCapture; delete globalThis.__everplainCapture; return value } })
  if (!captured?.result?.html) throw new Error('这个页面没有提取到正文')
  if (captured.result.html.length > 1500000) throw new Error('页面过大，请分段保存')
  showBatch(origin, await send(await target(origin), { kind: 'clip', value: captured.result }))
}))
document.querySelector('#bookmarks').addEventListener('click', () => {
  if (working) return
  if (!picker.hidden) { closePicker(); return }
  if (bookmarksLoaded) {
    picker.hidden = false
    document.querySelector('#bookmarks').setAttribute('aria-expanded', 'true')
    return
  }
  void run(async () => {
  // Reading is explicitly requested here, even when permission was granted earlier.
  if (!await chrome.permissions.request({ permissions: ['bookmarks'] })) throw new Error('未获得书签权限，还没有读取或提交书签')
  tree = await chrome.bookmarks.getTree()
  choices = bookmarkSelectionTree(tree)
  selected.clear(); searchInput.value = ''; renderChoices()
  bookmarksLoaded = true
  picker.hidden = false
  document.querySelector('#bookmarks').setAttribute('aria-expanded', 'true')
  status.textContent = '选择要导入的内容后再提交。无需先导出文件。'
  }).then(() => { if (!picker.hidden) searchInput.focus() })
})
document.querySelector('#import-selected').addEventListener('click', () => run(async () => {
  const permission = allowTarget()
  const origin = await permission
  const exported = bookmarksHtml(tree, selected)
  showLink(origin)
  if (!exported.count) throw new Error('请先选择至少一条可导入的书签')
  if (new TextEncoder().encode(exported.html).length > 16 * 1024 * 1024) throw new Error('所选书签超过 16MB，请分批导入')
  showBatch(origin, await send(await target(origin), { kind: 'bookmarks', value: exported.html }))
}, '正在提交所选书签…'))
searchInput.addEventListener('input', renderChoices)
document.querySelector('#select-all').addEventListener('click', () => { for (const node of choices) for (const id of node.bookmarkIds) selected.add(id); updateSelection() })
document.querySelector('#clear-selection').addEventListener('click', () => { selected.clear(); updateSelection() })
document.querySelector('#close-picker').addEventListener('click', closePicker)
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !picker.hidden && !working) { event.preventDefault(); closePicker() } })
