import { ArchiveBoxIcon, CheckCircleIcon, DownloadSimpleIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'

import { exportResearchArchive, listResearchAuditEvents, type ResearchArchiveDownload, type ResearchAuditEvent } from './researchExchangeApi'
import './research-exchange.css'

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

  return (
    <section className="research-exchange" role="region" aria-label="项目归档与交换">
      <header className="research-exchange__header">
        <div>
          <h2>研究归档</h2>
          <p>保存研究证据链、跨工具交换与审计记录。</p>
        </div>
        <ShieldCheckIcon size={24} aria-hidden="true" />
      </header>

      <div className="research-exchange__actions">
        <article>
          <ArchiveBoxIcon size={22} aria-hidden="true" />
          <div>
            <h3>完整研究归档</h3>
            <p>BagIt 校验包、QDPX、原生恢复 JSON、损失报告、审计与文稿成果。</p>
          </div>
          <button className="qx-button qx-button--primary" type="button" disabled={exporting} onClick={() => void handleExport()}>
            <DownloadSimpleIcon size={16} aria-hidden="true" />
            {exporting ? '正在归档…' : '导出研究归档'}
          </button>
        </article>

      </div>

      {error && (
        <div className="research-exchange__notice qx-notice-surface is-error" role="alert">
          <WarningCircleIcon size={17} aria-hidden="true" />
          {error}
        </div>
      )}

      {exported && (
        <div className="research-exchange__notice qx-notice-surface">
          <CheckCircleIcon size={17} aria-hidden="true" />
          <span>
            归档已生成：{exported.lossCount} 项交换损失，其中 {exported.blockingLossCount} 项阻断；
            完整说明已写入归档。
          </span>
        </div>
      )}

      <section className="research-exchange__audit" aria-labelledby="research-exchange-audit-title">
        <div>
          <h3 id="research-exchange-audit-title">交换审计</h3>
        </div>
        {auditLoading ? <p>正在读取审计记录…</p> : events.length === 0 ? (
          <p>还没有项目交换记录。</p>
        ) : (
          <ol>
            {events.map((event) => (
              <li key={event.event_id}>
                <code>{event.event_type}</code>
                <span>对象版本 {event.object_version ?? '—'}</span>
                <time dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  )
}
