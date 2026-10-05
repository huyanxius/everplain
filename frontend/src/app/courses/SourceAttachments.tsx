import type { SharedSource } from '../../modules/shared-knowledge'
import { formatMaterialSize } from '../../modules/research-materials'
import './source-attachments.css'

export function SourceAttachments({ source }: { source: SharedSource }) {
  const attachments = source.attachments?.filter(item => item.url && /^\/api\/imports\/assets\/[a-zA-Z0-9-]+\/attachments\/[a-zA-Z0-9-]+$/.test(item.url)) ?? []
  if (!attachments.length) return null
  return <section className="ep-source-attachments" aria-label="原文附件">
    <h2 className="qx-heading">原文附件</h2>
    <ul>{attachments.map(item => <li key={item.id}>
      <a href={item.url!} download={item.filename}>{item.filename}</a>
      <small className="qx-meta">{item.relativePath} · {formatMaterialSize(item.sizeBytes)}</small>
      {/^image\/(png|jpeg|webp|gif)$/.test(item.mediaType) && <details><summary>预览图片</summary><img src={item.url!} alt={item.filename} loading="lazy" /></details>}
    </li>)}</ul>
  </section>
}
