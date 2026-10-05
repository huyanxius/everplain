export function siteIconUrl(source?: { url?: string | null }) {
  let url: URL
  try { url = new URL(source?.url ?? '') } catch { return null }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.') || /(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$)/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null
  // Only the site's origin reaches the image request, never its private path or
  // query, a third-party favicon service, or a server-side URL fetch.
  return new URL('/favicon.ico', url.origin).href
}
