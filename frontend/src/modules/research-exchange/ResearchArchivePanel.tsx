import { ArchiveBoxIcon, CheckCircleIcon, DownloadSimpleIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'

import { exportResearchArchive, listResearchAuditEvents, type ResearchArchiveDownload, type ResearchAuditEvent } from './researchExchangeApi'
import './research-archive-view.css'

type ResearchArchivePanelProps = {
  readonly taskId: string
}

function downloadArchive(value: ResearchArchiveDownload) {
  const url = URL.createObjectURL(value.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = value.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ResearchArchivePanel({ taskId }: ResearchArchivePanelProps) {
  const [events, setEvents] = useState<ResearchAuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<ResearchArchiveDownload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAudit = useCallback(async (signal?: AbortSignal) => {
    setAuditLoading(true)
    setError(null)
    try {
      setEvents(await listResearchAuditEvents(taskId, signal))
    } catch (cause: unknown) {
      if ((cause as { name?: string } | null)?.name !== 'AbortError') {
        setError(cause instanceof Error ? cause.message : '审计记录暂时无法加载。')
      }
    } finally {
      if (!signal?.aborted) setAuditLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    const controller = new AbortController()
    void loadAudit(controller.signal)
    return () => controller.abort()
  }, [loadAudit])

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const value = await exportResearchArchive(taskId)
      setExported(value)
      downloadArchive(value)
      await loadAudit()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '研究归档导出失败。')
    } finally {
      setExporting(false)
    }
  }

  return <section className="ep-project-archive" role="region" aria-label="项目归档与交换">
    <header className="ep-project-archive__head"><ArchiveBoxIcon size={28} /><h2 className="qx-section-title">研究归档</h2><p className="qx-meta">把研究过程、证据与成果一起保存。</p></header>
    <article className="qx-card ep-project-archive__download">
      <div><ShieldCheckIcon size={24} /><h3 className="qx-card__title">完整研究归档</h3></div>
      <p className="qx-card__body">包含原始恢复数据、QDPX、BagIt 校验、文稿、交换损失说明与审计记录。</p>
      <button className="qx-btn qx-btn--primary" type="button" disabled={exporting} onClick={() => void handleExport()}><DownloadSimpleIcon />{exporting ? '正在归档…' : '导出研究归档'}</button>
    </article>
    {error ? <div className="ep-project-archive__notice" role="alert"><WarningCircleIcon /><p>{error}</p><button className="qx-btn qx-btn--secondary" type="button" disabled={auditLoading || exporting} onClick={() => void loadAudit()}>重试读取审计</button></div> : null}
    {exported ? <p className="ep-project-archive__notice" role="status"><CheckCircleIcon />归档已生成：{exported.lossCount} 项交换损失，其中 {exported.blockingLossCount} 项阻断；完整说明已写入归档。</p> : null}
    <section className="ep-project-archive__history" aria-labelledby="archive-history-title">
      <h3 id="archive-history-title" className="qx-heading">交换审计</h3>
      {auditLoading ? <p className="qx-meta" role="status">正在读取审计记录…</p> : !events.length ? <p className="qx-meta">还没有项目交换记录。</p> : <ol>{events.map(event => <li key={event.event_id}><span className="ep-project-archive__event-dot" aria-hidden="true" /><div><strong>{event.event_type}</strong><span className="qx-meta">对象版本 {event.object_version ?? '—'}</span></div><time className="qx-meta" dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time></li>)}</ol>}
    </section>
  </section>
}
