export function serviceOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password) throw new Error('服务地址不能包含账号或密码')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('请使用 HTTPS 地址；本机开发可使用 localhost')
  return url.origin
}
export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]) }
export function bookmarksHtml(tree) {
  let count = 0
  const walk = nodes => nodes.map(n => {
    if (n.url && /^https?:\/\//i.test(n.url)) { count++; return `<DT><A HREF="${escapeHtml(n.url)}">${escapeHtml(n.title || n.url)}</A>` }
    return n.children ? `<DT><H3>${escapeHtml(n.title || '')}</H3><DL>${walk(n.children)}</DL>` : ''
  }).join('\n')
  const body = walk(tree)
  return { count, html: `<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><DL>${body}</DL>` }
}
