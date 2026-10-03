import { ArrowCounterClockwiseIcon, CircleNotchIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

import './m5-research-delivery.css'

export type M5DocumentVersion = Readonly<{
  version: number
  createdAt: string
  actorLabel: string
  summary: string
  status: 'draft' | 'confirmed'
  restoredFromVersion?: number | null
}>

type Props = {
  currentVersion: number
  versions: readonly M5DocumentVersion[]
  onRestore: (version: number) => Promise<void>
}

function displayDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function M5VersionHistory({ currentVersion, versions, onRestore }: Props) {
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lockRef = useRef(false)

  async function restore(version: number) {
    if (version === currentVersion || lockRef.current) return
    lockRef.current = true
    setBusyVersion(version)
    setError(null)
    try {
      await onRestore(version)
      setRestoredVersion(version)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : '版本恢复失败，请重试。')
    } finally {
      lockRef.current = false
      setBusyVersion(null)
    }
  }

  return <section className="qx-card ep-delivery-history" aria-labelledby="m5-version-heading" aria-busy={busyVersion !== null}>
    <header className="ep-delivery-section-head"><h3 className="qx-card__title" id="m5-version-heading">可恢复历史</h3><span className="qx-meta">第 {currentVersion} 版</span></header>
    <ol className="ep-delivery-history__list">{versions.map(version => {
      const current = version.version === currentVersion
      return <li key={version.version} aria-current={current ? 'true' : undefined}>
        <header><strong>第 {version.version} 版</strong>{current ? <span className="qx-tag">当前版本</span> : null}{version.status === 'confirmed' ? <span className="qx-tag">正式版</span> : null}{!current ? <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" disabled={busyVersion !== null} onClick={() => void restore(version.version)} aria-label={`恢复第 ${version.version} 版`}>{busyVersion === version.version ? <CircleNotchIcon className="ep-delivery-spin" aria-hidden="true" /> : <ArrowCounterClockwiseIcon aria-hidden="true" />}</button> : null}</header>
        <p>{version.summary}</p><div className="qx-meta"><time dateTime={version.createdAt}>{displayDate(version.createdAt)}</time><span> · {version.actorLabel}</span></div>{version.restoredFromVersion ? <p className="qx-meta">由第 {version.restoredFromVersion} 版恢复</p> : null}
      </li>
    })}</ol>
    {!versions.length ? <p className="qx-meta">还没有可恢复的历史版本。</p> : null}
    <p className="ep-delivery-message" data-error={Boolean(error)} role="status" aria-live="polite">{error ?? (restoredVersion ? `已从第 ${restoredVersion} 版创建新的可编辑版本。` : '')}</p>
  </section>
}
