import type { SharedDocument } from '../../modules/shared-knowledge'

export type WebMaterialSource = { url?: string | null; title?: string | null }

export function webSourceUrl(source?: WebMaterialSource) {
  try {
    const url = new URL(source?.url ?? '')
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url
  } catch { /* Invalid source metadata stays a normal document. */ }
  return null
}

export function documentKind(document: SharedDocument, source?: WebMaterialSource) {
  if (webSourceUrl(source)) return '网页'
  const extension = document.filename.split('.').pop()?.toLocaleLowerCase()
  if (extension === 'pdf' || document.mediaType === 'application/pdf') return 'PDF'
  if (extension === 'docx') return 'Word'
  if (extension === 'pptx') return '演示文稿'
  if (document.mediaType?.startsWith('image/')) return '图片'
  if (extension === 'html' || extension === 'htm') return '网页'
  return '笔记'
}

export function isProcessing(document: SharedDocument) {
  return document.status === 'processing' || (document.status === 'ready' && [document.knowledgeStatus, document.indexStatus].some(status => status === 'queued' || status === 'running'))
}

const genericBookmarkTitle = /^(?:bookmark(?:[-_]\d+)?|网页收藏|untitled)(?:\.(?:md|markdown|html?))?$/i

export function documentTitle(document: SharedDocument, source?: WebMaterialSource) {
  if (!webSourceUrl(source) || !genericBookmarkTitle.test(document.filename.trim())) return document.filename
  const title = source?.title?.trim()
  if (title && !genericBookmarkTitle.test(title)) return title
  const topic = document.knowledge?.topics.find(item => item.title.trim() && !genericBookmarkTitle.test(item.title.trim()))?.title.trim()
  if (topic) return topic
  const summary = document.knowledge?.summary?.trim().split(/[。！？\n]/)[0]?.replace(/^[#*\s]+/, '').trim()
  return summary ? summary.slice(0, 80) : webSourceUrl(source)!.hostname.replace(/^www\./, '')
}

export function siteIconUrl(source?: WebMaterialSource) {
  const url = webSourceUrl(source)
  if (!url || url.port || !url.hostname.includes('.') || /(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$)/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null
  // Only the site's origin reaches the image request; no private path, query,
  // third-party favicon service, or server-side URL fetch is involved.
  return new URL('/favicon.ico', url.origin).href
}
