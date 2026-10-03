import { useId, type CSSProperties } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { Select } from '../ui/Select'
import {
  MODEL_CATALOG,
  findSelectedModel,
  isModelSelectionValid,
  selectEffortStep,
  selectModel,
  type ModelDefinition,
  type ModelSelection,
  type ReasoningEffort,
} from './modelSelection'
import './model-selection.css'

export type ModelSelectionControlProps = {
  value: ModelSelection
  onChange: (value: ModelSelection) => void
  disabled?: boolean
  catalog?: readonly ModelDefinition[]
  className?: string
}

const effortLabels: Record<ReasoningEffort, readonly [string, string]> = {
  none: ['无', 'None'],
  low: ['低', 'Low'],
  medium: ['中', 'Medium'],
  high: ['高', 'High'],
  xhigh: ['很高', 'XHigh'],
  max: ['最高', 'Max'],
}

/** Controlled UI: no global settings, provider requests, or persistent side effects. */
export function ModelSelectionControl({ value, onChange, disabled = false, catalog = MODEL_CATALOG, className = '' }: ModelSelectionControlProps) {
  const { text } = useAppLocale()
  const id = useId()
  const model = findSelectedModel(value, catalog)
  const valid = isModelSelectionValid(value, catalog)
  const steps = model?.reasoningEfforts ?? []
  const step = steps.indexOf(value.reasoningEffort)
  const labelFor = (effort: ReasoningEffort) => text(...effortLabels[effort])
  const currentLabel = valid ? labelFor(value.reasoningEffort) : text('不可用', 'Unavailable')

  return <div className={`model-selection ${className}`.trim()} role="group" aria-label={text('模型与思考强度', 'Model and reasoning effort')}>
    <div className="model-selection__model">
      <Select
        value={valid ? value.modelId : ''}
        onChange={modelId => {
          if (disabled) return
          const next = selectModel(modelId, value, catalog)
          if (next) onChange(next)
        }}
        options={catalog.map(item => ({ value: item.id, label: item.label }))}
        aria-label={text('模型', 'Model')}
        placeholder={text('选择模型', 'Choose model')}
        disabled={disabled || catalog.length === 0}
      />
    </div>
    <div className="model-selection__effort">
      <div className="model-selection__effort-heading">
        <label id={`${id}-label`} htmlFor={`${id}-effort`}>{text('思考强度', 'Reasoning effort')}</label>
        <output htmlFor={`${id}-effort`}>{currentLabel}</output>
      </div>
      <input
        id={`${id}-effort`}
        className="model-selection__range"
        style={{ '--model-effort-progress': `${steps.length > 1 ? Math.max(step, 0) / (steps.length - 1) * 100 : 0}%` } as CSSProperties}
        type="range"
        min={0}
        max={Math.max(steps.length - 1, 0)}
        step={1}
        value={Math.max(step, 0)}
        disabled={disabled || !valid || steps.length < 2}
        aria-labelledby={`${id}-label`}
        aria-valuetext={currentLabel}
        aria-invalid={!valid || undefined}
        aria-describedby={!valid ? `${id}-error` : undefined}
        onChange={event => {
          if (disabled || !valid) return
          const next = selectEffortStep(Number(event.currentTarget.value), value, catalog)
          if (next) onChange(next)
        }}
      />
      <div className="model-selection__ticks" aria-hidden="true">
        {steps.map(effort => <span key={effort} data-selected={effort === value.reasoningEffort} title={effort}>{labelFor(effort)}</span>)}
      </div>
    </div>
    {!valid && <p id={`${id}-error`} className="model-selection__error" role="alert">{text('请选择可用的模型和强度。', 'Choose an available model and reasoning effort.')}</p>}
  </div>
}
