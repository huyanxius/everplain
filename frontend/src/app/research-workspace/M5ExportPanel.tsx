import { CircleNotchIcon, FileTextIcon, FileTsIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

import './m5-research-delivery.css'

type ExportFormat = 'markdown' | 'json'

type Props = {
  confirmed: boolean
  gateReady: boolean
  saveState: 'saved' | 'saving' | 'unsaved'
  onExport: (format: ExportFormat) => Promise<void>
}

export function M5ExportPanel({ confirmed, gateReady, saveState, onExport }: Props) {
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const lockRef = useRef(false)
  const ready = confirmed && gateReady && saveState === 'saved'

  async function exportAs(format: ExportFormat) {
    if (!ready || lockRef.current) return
    lockRef.current = true
    setBusyFormat(format)
    setMessage(null)
    setError(false)
    try {
      await onExport(format)
      setMessage(`${format === 'markdown' ? 'Markdown' : 'JSON'} 成果包已下载。`)
    } catch (failure: unknown) {
      setMessage(failure instanceof Error ? failure.message : '成果包导出失败，请重试。')
      setError(true)
    } finally {
      lockRef.current = false
      setBusyFormat(null)
    }
  }

  return <section className="qx-card ep-delivery-export" aria-labelledby="m5-export-heading" aria-busy={busyFormat !== null}>
    <header className="ep-delivery-section-head"><h3 className="qx-card__title" id="m5-export-heading">导出与交付</h3><span className="qx-meta">完整研究成果包</span></header>
    <div className="ep-delivery-export__formats">
      <button type="button" className="ep-delivery-export__format" aria-label="下载 Markdown" disabled={!ready || busyFormat !== null} onClick={() => void exportAs('markdown')}>
        {busyFormat === 'markdown' ? <CircleNotchIcon className="ep-delivery-spin" size={22} aria-hidden="true" /> : <FileTextIcon size={22} aria-hidden="true" />}<span><strong>下载 Markdown</strong><span>便于审阅与归档</span></span>
      </button>
      <button type="button" className="ep-delivery-export__format" aria-label="下载 JSON" disabled={!ready || busyFormat !== null} onClick={() => void exportAs('json')}>
        {busyFormat === 'json' ? <CircleNotchIcon className="ep-delivery-spin" size={22} aria-hidden="true" /> : <FileTsIcon size={22} aria-hidden="true" />}<span><strong>下载 JSON</strong><span>保留章节、证据、决策、版本与来源结构</span></span>
      </button>
    </div>
    <p className="ep-delivery-message" data-error={error} role="status" aria-live="polite">{message ?? (!ready ? '研究完成并通过门禁后，才会生成可审查的成果包。' : '成果包已就绪。')}</p>
  </section>
}
