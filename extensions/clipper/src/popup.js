import { serviceOrigin, bookmarksHtml } from './model.mjs'
const originInput = document.querySelector('#origin')
const status = document.querySelector('#status')
const buttons = [...document.querySelectorAll('button')]
const stored = await chrome.storage.local.get('everplainOrigin')
originInput.value = stored.everplainOrigin || ''
function busy(value) { for (const button of buttons) button.disabled = value }
async function allowTarget(bookmarks = false) {
  const origin = serviceOrigin(originInput.value.trim())
  if (!await chrome.permissions.request({ origins: [`${origin}/*`], permissions: bookmarks ? ['bookmarks'] : [] })) throw new Error('需要你允许这次收藏使用的权限')
  await chrome.storage.local.set({ everplainOrigin: origin })
  return origin
}
async function target(origin) {
  const matches = await chrome.tabs.query({ url: [`${origin}/*`] })
  let tab = matches[0]
  if (!tab) tab = await chrome.tabs.create({ url: origin + '/app', active: false })
  if (tab.status !== 'complete') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Everplain 页面还没打开，请先在浏览器登录后重试')) }, 15000)
      function listener(id, info) { if (id === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve() } }
      chrome.tabs.onUpdated.addListener(listener)
    })
  }
  return { origin, id: tab.id }
}
async function send(destination, payload) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: destination.id }, func: async (origin, data) => {
    if (location.origin !== origin) return { error: '目标页面已切换，请重试' }
    let body, path, headers = { 'Idempotency-Key': crypto.randomUUID() }
    if (data.kind === 'clip') { path = '/api/imports/clip'; headers['Content-Type'] = 'application/json'; body = JSON.stringify(data.value) }
    else { path = '/api/imports'; body = new FormData(); body.append('source_type','chrome'); body.append('files', new File([data.value], 'bookmarks.html', { type: 'text/html' })) }
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers, body })
    if (response.status === 401) return { error: '请先在 Everplain 页面登录，再点击重试' }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) return { error: typeof result.detail === 'string' ? result.detail : '导入失败，请在 Everplain 查看状态' }
    return { total: result.total }
  }, args: [destination.origin, payload] })
  if (result?.result?.error) throw new Error(result.result.error)
  return result?.result
}
async function run(action) {
  busy(true); status.textContent = '正在准备…'
  try { await action() } catch (error) { status.textContent = error.message || '暂时未完成，请重试' } finally { busy(false) }
}
document.querySelector('#clip').addEventListener('click', () => run(async () => {
  const permission = allowTarget()
  const current = chrome.tabs.query({ active: true, currentWindow: true })
  const origin = await permission
  const [page] = await current
  if (!page?.id || !/^https?:\/\//i.test(page.url || '')) throw new Error('请在一个普通网页上使用收藏')
  // Capture the user-selected page before opening/reusing the application tab.
  await chrome.scripting.executeScript({ target: { tabId: page.id }, files: ['capture.js'] })
  const [captured] = await chrome.scripting.executeScript({ target: { tabId: page.id }, func: () => { const value = globalThis.__everplainCapture; delete globalThis.__everplainCapture; return value } })
  if (!captured?.result?.html) throw new Error('这个页面没有提取到正文')
  if (captured.result.html.length > 1500000) throw new Error('页面过大，请分段保存')
  const destination = await target(origin)
  await send(destination, { kind: 'clip', value: captured.result })
  status.textContent = '已收藏，原文与来源将保存在你的资料库里'
}))
document.querySelector('#bookmarks').addEventListener('click', () => run(async () => {
  const origin = await allowTarget(true)
  const exported = bookmarksHtml(await chrome.bookmarks.getTree())
  if (!exported.count) throw new Error('没有找到可导入的 HTTP(S) 书签')
  const destination = await target(origin)
  await send(destination, { kind: 'bookmarks', value: exported.html })
  status.textContent = `已提交 ${exported.count} 条书签，正文会在后台读取`
}))
