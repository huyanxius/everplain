import type { SharedDocument } from '../../modules/shared-knowledge'

export function documentKind(document: SharedDocument) {
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
