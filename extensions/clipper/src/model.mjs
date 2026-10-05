export const DEFAULT_SERVICE_ORIGIN = 'https://e.qunxue.xyz'

export function serviceOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password) throw new Error('服务地址不能包含账号或密码')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('请使用 HTTPS 地址；本机开发可使用 localhost')
  return url.origin
}
export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]) }
export function isImportableWebUrl(value) {
  try {
    const url = new URL(value)
    return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}
export function bookmarkSelectionTree(tree) {
  const walk = nodes => nodes.flatMap(node => {
    if (node.url) {
      if (!isImportableWebUrl(node.url)) return []
      return [{ id: node.id, title: node.title || node.url, url: node.url, bookmarkIds: [node.id] }]
    }
    const children = walk(node.children || [])
    if (!children.length) return []
    // Chrome's virtual root has no title; don't show an empty folder.
    if (!node.title) return children
    return [{ id: node.id, title: node.title, children, bookmarkIds: children.flatMap(child => child.bookmarkIds) }]
  })
  return walk(tree)
}
export function bookmarksHtml(tree, selectedIds = null) {
  let count = 0
  const walk = nodes => nodes.map(n => {
    if (n.url && isImportableWebUrl(n.url) && (selectedIds === null || selectedIds.has(n.id))) { count++; return `<DT><A HREF="${escapeHtml(n.url)}">${escapeHtml(n.title || n.url)}</A>` }
    const children = n.children ? walk(n.children) : ''
    return children ? (n.title ? `<DT><H3>${escapeHtml(n.title)}</H3><DL>${children}</DL>` : children) : ''
  }).filter(Boolean).join('\n')
  const body = walk(tree)
  return { count, html: `<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><DL>${body}</DL>` }
}
export function importProgressUrl(origin, batchId = null) {
  const url = new URL('/imports', serviceOrigin(origin))
  if (batchId) url.searchParams.set('batch', batchId)
  return url.href
}
export function importSummary(batch) {
  const updated = batch?.updated ?? 0
  if (!batch?.id || !['processing', 'completed', 'partial'].includes(batch.status)
    || !['total', 'finished', 'imported', 'duplicates', 'failed'].every(key => Number.isInteger(batch[key]) && batch[key] >= 0)
    || !Number.isInteger(updated) || updated < 0
    || batch.finished > batch.total || batch.finished !== batch.imported + updated + batch.duplicates + batch.failed
    || (batch.status !== 'processing' && batch.finished !== batch.total)) throw new Error('已收到响应，但批次状态不完整。请在 Everplain 查看导入记录')
  const counts = `新增 ${batch.imported}，更新 ${updated}，重复 ${batch.duplicates}，失败 ${batch.failed}`
  if (batch.status === 'processing') return `已提交 ${batch.total} 条资料，后台已处理 ${batch.finished}/${batch.total}。${counts}`
  return `本批已处理 ${batch.finished}/${batch.total}。${counts}${batch.failed ? '；可在导入记录中重试失败条目' : ''}`
}
