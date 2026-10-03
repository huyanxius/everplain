import { CaretRightIcon, CheckCircleIcon, CircleNotchIcon, FileTextIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import type { ConversationToolStep } from './types'

function printable(value: unknown) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value) }
}

export function ConversationToolDetail({ step }: { step: ConversationToolStep }) {
  const { text } = useAppLocale()
  return <div className="cv-tool-detail">
    {step.purpose ? <p>{step.purpose}</p> : null}
    {step.input != null ? <details><summary role="button">{text('工具输入', 'Tool input')}</summary><pre>{printable(step.input)}</pre></details> : null}
    {step.detail ? <details><summary role="button">{text('查看完整工具返回', 'View full tool output')}</summary><pre>{step.detail}</pre></details> : null}
    {step.resultItems?.length ? <ul className="cv-tool-results">{step.resultItems.map(item => <li key={item.id}><FileTextIcon aria-hidden="true" /><div><strong>{item.title}</strong>{item.excerpt ? <p>{item.excerpt}</p> : null}</div></li>)}</ul> : null}
    {step.output != null ? <details><summary role="button">{text('工具结果数据', 'Tool result data')}</summary><pre>{printable(step.output)}</pre></details> : null}
  </div>
}

export function ConversationToolStatus({ step }: { step: ConversationToolStep }) {
  const { text } = useAppLocale()
  const status = step.interrupted ? 'interrupted' : step.status
  const label = status === 'interrupted' ? text('已中断', 'Interrupted') : status === 'running' ? text('进行中', 'In progress') : status === 'failed' ? text('失败', 'Failed') : text('已完成', 'Completed')
  const Icon = status === 'running' ? CircleNotchIcon : status === 'completed' ? CheckCircleIcon : WarningCircleIcon
  return <span className="cv-tool-state" data-state={status}><Icon aria-hidden="true" /><span>{label}</span></span>
}

export function ConversationActivity({ steps, onOpen }: { steps: readonly ConversationToolStep[]; onOpen?: (step?: ConversationToolStep) => void }) {
  const { text } = useAppLocale()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (!steps.length) return null
  const running = steps.some(step => step.status === 'running' && !step.interrupted)
  const interrupted = steps.some(step => step.interrupted)
  const failed = steps.some(step => step.status === 'failed')
  const label = running ? text('Agent 正在调用工具', 'Agent is using tools') : interrupted ? text('工具调用已中断', 'Tool activity was interrupted') : failed ? text('工具调用未完成', 'Tool activity did not complete') : text('Agent 已完成工具调用', 'Agent completed its tool activity')
  return <section className="cv-tools" aria-label={text('Agent 工作过程', 'Agent activity')}>
    <header>
      <button className="qx-btn qx-btn--ghost cv-tools__toggle" type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(open => !open)}>
        <CaretRightIcon aria-hidden="true" /><span>{label}</span><small>{text(`${steps.length} 个实际步骤`, `${steps.length} actual steps`)}</small>
      </button>
      {onOpen ? <button className="qx-btn qx-btn--ghost" type="button" onClick={() => onOpen()}>{text('查看活动', 'View activity')}</button> : null}
    </header>
    <ol id={listId} hidden={!expanded} className="cv-tools__steps">{steps.map(step => <li key={step.id}>
      <div className="cv-tools__step-heading"><strong>{step.label}</strong><ConversationToolStatus step={step} /></div>
      <ConversationToolDetail step={step} />
      {onOpen ? <button className="qx-btn qx-btn--ghost cv-tools__open" type="button" onClick={() => onOpen(step)}>{text('查看这一步', 'View this step')}</button> : null}
    </li>)}</ol>
  </section>
}
