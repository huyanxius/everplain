import type { ImportBatch } from '../../modules/knowledge-import'

export function ImportBatchProgress({ batch, busy, stale, onRetry, onRefresh }: { batch: ImportBatch; busy: boolean; stale: boolean; onRetry(): void; onRefresh(): void }) {
  const success = batch.imported + batch.updated + batch.duplicates
  return <section className="qx-notice" aria-label="本次导入处理进度">
    <p role="status">{batch.status === 'processing' ? '服务器处理' : batch.failed ? '处理结束，部分资料失败' : '导入完成'}：{batch.finished} / {batch.total} 篇</p>
    <progress aria-label="服务器处理进度" value={batch.finished} max={Math.max(1, batch.total)} />
    <p>成功 {success} 篇（新增 {batch.imported}、更新 {batch.updated}、已存在 {batch.duplicates}）· 失败 {batch.failed} 篇 · 等待 {Math.max(0, batch.total - batch.finished)} 篇</p>
    {stale && <p role="alert">暂时无法读取最新处理状态，上面是最近确认的结果。<button type="button" className="qx-btn qx-btn--ghost" onClick={onRefresh}>刷新处理进度</button></p>}
    {batch.failed > 0 && <><ul>{batch.items.filter(item => item.status === 'failed').map(item => <li key={item.id}>{item.title}：{item.error ?? '处理失败，请重试。'}</li>)}</ul><button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={onRetry}>仅重试失败的 {batch.failed} 篇</button><p className="qx-meta">已成功的资料会保留；文件内容或格式有问题时，请修正后重新选择。</p></>}
  </section>
}
