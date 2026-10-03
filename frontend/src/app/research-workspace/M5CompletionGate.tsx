import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import './m5-research-delivery.css'

export type M5CompletionCheck = Readonly<{
  code: string
  label: string
  passed: boolean
  detail?: string | null
}>

export type M5CompletionGateData = Readonly<{
  ready: boolean
  checks: readonly M5CompletionCheck[]
  blockers: readonly string[]
}>

type Props = {
  gate: M5CompletionGateData
  saveState: 'saved' | 'saving' | 'unsaved'
  busy?: boolean
  error?: string | null
  version?: number | null
  completed?: boolean
  onConfirm: () => Promise<void> | void
}

export function M5CompletionGate({ gate, saveState, busy = false, error, version, completed = false, onConfirm }: Props) {
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [locallyCompleted, setLocallyCompleted] = useState(completed)
  const lockRef = useRef(false)
  const isBusy = busy || localBusy
  const isCompleted = completed || locallyCompleted
  const canConfirm = gate.ready && saveState === 'saved' && !isBusy && !isCompleted
  const saveMessage = saveState === 'saved'
    ? null
    : saveState === 'saving'
      ? '正在保存当前修改，保存完成后才能提交。'
      : '请先保存当前修改，再检查完成条件。'

  useEffect(() => {
    setLocallyCompleted(completed)
  }, [completed, version])

  async function confirm() {
    if (!canConfirm || lockRef.current) return
    lockRef.current = true
    setLocalBusy(true)
    setLocalError(null)
    try {
      await onConfirm()
      setLocallyCompleted(true)
    } catch (reason: unknown) {
      setLocalError(reason instanceof Error ? reason.message : '完成研究失败，请重试。')
    } finally {
      lockRef.current = false
      setLocalBusy(false)
    }
  }

  return <section className="qx-card ep-delivery-check" aria-labelledby="m5-completion-heading" aria-busy={isBusy}>
    <header className="ep-delivery-section-head"><h3 className="qx-card__title" id="m5-completion-heading">交付前门禁</h3><span className="qx-tag">{gate.ready ? '可以完成' : `${gate.checks.filter(check => !check.passed).length} 项待处理`}</span></header>
    <ul className="ep-delivery-check__items">{gate.checks.map(check => <li key={check.code} data-passed={check.passed}>{check.passed ? <CheckCircleIcon size={18} aria-hidden="true" /> : <WarningCircleIcon size={18} aria-hidden="true" />}<span>{check.label}</span></li>)}</ul>
    {gate.blockers.length ? <section className="ep-delivery-check__blockers" aria-label="尚未满足的条件"><ul>{gate.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></section> : null}
    <footer className="ep-delivery-actions"><button type="button" className="qx-btn qx-btn--primary" disabled={!canConfirm} onClick={() => void confirm()}>{isBusy ? <CircleNotchIcon className="ep-delivery-spin" aria-hidden="true" /> : null}{isCompleted ? '研究已完成' : '完成研究'}</button></footer>
    <p className="ep-delivery-message" role="status" aria-live="polite">{isCompleted ? '研究已完成，正式成果包现已可以导出。' : saveMessage ?? localError ?? error ?? ''}</p>
  </section>
}
