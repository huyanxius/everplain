import type { ImportBatch } from '../../modules/knowledge-import'
import './note-folder.css'

export function ImportAttachments({ item }: { item: ImportBatch['items'][number] }) {
  if (!item.attachments?.length) return null
  return <ul className="ep-import-attachments" aria-label={`${item.title}的附件`}>{item.attachments.map(asset => <li key={asset.id}>
    {asset.url ? <a href={asset.url} download={asset.filename}>{asset.filename}</a> : <span>{asset.filename} · 等待入库</span>}
    <small>{asset.relative_path} · {Math.max(1, Math.round(asset.size_bytes / 1024))} KB</small>
  </li>)}</ul>
}
