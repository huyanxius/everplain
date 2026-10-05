// Serialized by chrome.scripting.executeScript: keep this function self-contained.
// Runs in the extension's isolated world on the chosen Everplain origin.
export async function submitImport(origin, data, requestKey) {
  if (location.origin !== origin) return { error: '目标页面已切换，请重新打开 Everplain 后重试' }
  let session
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
    if (response.status === 401) return { error: '请先在同一浏览器的 Everplain 页面登录，再回来提交', login: true }
    if (!response.ok) return { error: '暂时无法确认登录状态，请稍后重试' }
    session = await response.json()
    if (!session?.user?.user_id) return { error: '登录状态不完整，请在 Everplain 重新登录', login: true }
  } catch { return { error: '无法连接 Everplain，请检查网络后重试' } }
  // The popup may close during fetch. Keep its receipt in the isolated page
  // world, scoped to the current owner, never in site JavaScript or on disk.
  const requests = globalThis.__everplainImportRequests ||= new Map()
  const receiptKey = `${session.user.user_id}:${requestKey}`
  const previous = requests.get(receiptKey)
  if (previous?.promise) return await previous.promise
  if (previous?.uncertain) return { error: '提交结果尚未确认。请先查看导入记录，避免重复提交', uncertain: true }
  if (previous?.batchId) {
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(previous.batchId)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (response.status === 401) return { error: '登录已过期，请先在 Everplain 重新登录', login: true }
      if (response.ok) return { batch: await response.json() }
    } catch { /* Keep the receipt; don't silently submit a second batch. */ }
    return { error: '这一批已经提交，请在 Everplain 查看最新进度', batchId: previous.batchId }
  }
  const record = {}
  requests.set(receiptKey, record)
  record.promise = (async () => {
    let body, path
    const headers = { 'Idempotency-Key': requestKey }
    if (data.kind === 'clip') {
      path = '/api/imports/clip'; headers['Content-Type'] = 'application/json'; body = JSON.stringify(data.value)
    } else {
      path = '/api/imports'; body = new FormData()
      body.append('source_type', 'chrome')
      body.append('files', new File([data.value], 'bookmarks.html', { type: 'text/html' }))
    }
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers, body })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) {
          record.uncertain = true
          return { error: '服务响应中断，提交结果尚未确认。请先查看导入记录，避免重复提交', uncertain: true }
        }
        requests.delete(receiptKey)
        if (response.status === 401) return { error: '请先在同一浏览器的 Everplain 页面登录，再回来提交', login: true }
        return { error: typeof result.detail === 'string' ? result.detail : '未能提交，请在 Everplain 查看状态后重试' }
      }
      if (!result.id) {
        record.uncertain = true
        return { error: '已收到响应，但批次编号不完整。请先查看导入记录', uncertain: true }
      }
      record.batchId = result.id
      return { batch: result }
    } catch {
      record.uncertain = true
      return { error: '网络中断，提交结果尚未确认。请先查看导入记录，避免重复提交', uncertain: true }
    }
  })()
  try { return await record.promise } finally { delete record.promise }
}
