import { CaretLeftIcon, CaretRightIcon, CheckIcon } from '@phosphor-icons/react'
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import chatgptMark from '../../assets/models/chatgpt.svg?raw'
import claudeMark from '../../assets/models/claude.svg'
import deepseekMark from '../../assets/models/deepseek.svg'
import geminiMark from '../../assets/models/gemini.svg'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
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
  active?: boolean
}

const effortLabels: Record<ReasoningEffort, readonly [string, string]> = {
  none: ['无', 'None'],
  low: ['低', 'Low'],
  medium: ['中', 'Medium'],
  high: ['高', 'High'],
  xhigh: ['很高', 'XHigh'],
  max: ['最高', 'Max'],
}

function EffortSlider({ id, labels, value, currentLabel, disabled, invalid, onChange }: {
  id: string
  labels: readonly string[]
  value: number
  currentLabel: string
  disabled: boolean
  invalid: boolean
  onChange: (step: number) => void
}) {
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; ratio: number } | null>(null)
  const lastStep = Math.max(labels.length - 1, 0)
  const ratio = dragRatio ?? (lastStep ? value / lastStep : 0)
  const previewStep = dragRatio === null ? value : Math.round(ratio * lastStep)
  const previewLabel = dragRatio === null ? currentLabel : labels[previewStep]

  const pointerRatio = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || !Number.isFinite(event.clientX)) return null
    return Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const nextRatio = pointerRatio(event) ?? drag.current.ratio
    drag.current = null
    setDragRatio(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (commit && !disabled) onChange(Math.round(nextRatio * lastStep))
  }
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const nextStep = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? lastStep : null
    if (nextStep === null) return
    event.preventDefault()
    onChange(Math.min(lastStep, Math.max(0, nextStep)))
  }

  return <div className="model-selection__slider" data-dragging={dragRatio !== null} data-disabled={disabled}>
    <div
      id={`${id}-effort`}
      className="model-selection__track"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-labelledby={`${id}-label`}
      aria-valuemin={0}
      aria-valuemax={lastStep}
      aria-valuenow={previewStep}
      aria-valuetext={previewLabel}
      aria-disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      style={{ '--model-effort-ratio': ratio } as CSSProperties}
      onKeyDown={handleKey}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || event.isPrimary === false || drag.current) return
        const nextRatio = pointerRatio(event)
        if (nextRatio === null) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { pointerId: event.pointerId, ratio: nextRatio }
        setDragRatio(nextRatio)
      }}
      onPointerMove={event => {
        if (disabled || !drag.current || drag.current.pointerId !== event.pointerId) return
        const nextRatio = pointerRatio(event)
        if (nextRatio === null) return
        drag.current.ratio = nextRatio
        setDragRatio(nextRatio)
      }}
      onPointerUp={event => finishDrag(event, true)}
      onPointerCancel={event => finishDrag(event, false)}
      onLostPointerCapture={event => finishDrag(event, false)}
    >
      <div className="model-selection__rail" aria-hidden="true"><div className="model-selection__fill" /></div>
      {labels.map((label, index) => <span key={label} className="model-selection__tick" aria-hidden="true" data-on={index <= previewStep} style={{ left: `${lastStep ? index / lastStep * 100 : 0}%` }} />)}
      <div className="model-selection__thumb" aria-hidden="true"><span className="model-selection__bubble">{previewLabel}</span></div>
    </div>
    <div className="model-selection__labels">
      {labels.map((label, index) => <button key={label} type="button" disabled={disabled} data-on={index === previewStep}
        style={{ left: `${lastStep ? index / lastStep * 100 : 0}%` }} onClick={() => { if (!disabled) onChange(index) }}>{label}</button>)}
    </div>
  </div>
}

/** Only known model ID prefixes identify a brand. Catalog labels never guess one. */
function ModelBrand({ modelId }: { modelId: string }) {
  if (modelId.startsWith('gpt-')) {
    return <span className="model-selection__brand" aria-hidden="true" dangerouslySetInnerHTML={{ __html: chatgptMark }} />
  }
  const mark = modelId.startsWith('claude-') ? claudeMark
    : modelId.startsWith('gemini-') ? geminiMark
    : modelId.startsWith('deepseek-') ? deepseekMark : null
  return mark ? <img className="model-selection__brand" src={mark} alt="" aria-hidden="true" />
    : null
}

/** Controlled UI: no global settings, provider requests, or persistent side effects. */
export function ModelSelectionControl({ value, onChange, disabled = false, catalog = MODEL_CATALOG, className = '', active = true }: ModelSelectionControlProps) {
  const { text } = useAppLocale()
  const id = useId()
  const [view, setView] = useState<'summary' | 'models'>('summary')
  const viewport = useRef<HTMLDivElement>(null)
  const summaryPanel = useRef<HTMLDivElement>(null)
  const modelsPanel = useRef<HTMLDivElement>(null)
  const summaryRow = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const modelButtons = useRef(new Map<string, HTMLButtonElement>())
  const model = findSelectedModel(value, catalog)
  const valid = isModelSelectionValid(value, catalog)
  const steps = model?.reasoningEfforts ?? []
  const step = value.reasoningEffort === null ? 0 : Math.max(steps.indexOf(value.reasoningEffort), 0)
  const labelFor = (effort: ReasoningEffort) => text(...effortLabels[effort])
  const currentLabel = valid && value.reasoningEffort !== null ? labelFor(value.reasoningEffort) : text('不可用', 'Unavailable')
  const chooseModel = (modelId: string) => {
    if (disabled) return
    const next = selectModel(modelId, value, catalog)
    if (next) onChange(next)
    return next
  }

  useLayoutEffect(() => {
    if (!active) { setView('summary'); return }
    const first = view === 'summary' ? summaryRow.current
      : modelButtons.current.get(model?.id ?? catalog[0]?.id) ?? backButton.current
    if (!first?.disabled) first?.focus({ preventScroll: true })
  }, [active, view, model?.id, catalog])

  useLayoutEffect(() => {
    const surface = viewport.current
    const measure = () => {
      const layer = view === 'summary' ? summaryPanel.current : modelsPanel.current
      if (surface && layer) surface.style.height = `${layer.getBoundingClientRect().height}px`
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (summaryPanel.current) observer?.observe(summaryPanel.current)
    if (modelsPanel.current) observer?.observe(modelsPanel.current)
    return () => observer?.disconnect()
  }, [view, catalog, value.modelId, disabled, valid])

  return <div className={`model-selection ${className}`.trim()} role="group" aria-label={text('模型与思考强度', 'Model and reasoning effort')}
    onKeyDown={event => {
      if (event.key === 'Escape' && view === 'models') {
        event.preventDefault()
        event.stopPropagation()
        setView('summary')
      }
    }}>
    <div ref={viewport} className="model-selection__viewport">
      <div className="model-selection__panels" data-view={view}>
        <div ref={summaryPanel} className="model-selection__layer" inert={view !== 'summary'} aria-hidden={view !== 'summary' || undefined}>
          <button ref={summaryRow} type="button" className="model-selection__summary-row" data-model-summary="true" disabled={disabled || catalog.length === 0}
            aria-label={`${text('选择模型', 'Choose model')}：${model?.label ?? text('不可用', 'Unavailable')}${valid && value.reasoningEffort !== null ? ` · ${currentLabel}` : ''}`}
            aria-controls={`${id}-models-panel`} aria-expanded={view === 'models'} onClick={() => setView('models')}>
            {model && <ModelBrand modelId={model.id} />}
            <span className="model-selection__summary-title">
              <strong>{model?.label ?? text('不可用', 'Unavailable')}</strong>
              {valid && value.reasoningEffort !== null && <span className="model-selection__summary-effort">{currentLabel}</span>}
              <CaretRightIcon size={14} aria-hidden="true" />
            </span>
          </button>
          {steps.length > 0 && <div className="model-selection__effort">
            <span id={`${id}-label`} className="model-selection__visually-hidden">{text('思考强度', 'Reasoning effort')}</span>
            <EffortSlider
              key={`${value.modelId}:${steps.join(',')}:${disabled}:${valid}`}
              id={id}
              labels={steps.map(labelFor)}
              value={step}
              currentLabel={currentLabel}
              disabled={disabled || !valid || steps.length < 2}
              invalid={!valid}
              onChange={index => {
                if (disabled || !valid) return
                const next = selectEffortStep(index, value, catalog)
                if (next) onChange(next)
              }}
            />
          </div>}
          {!valid && <p id={`${id}-error`} className="model-selection__error" role="alert">{text('请选择可用的模型和强度。', 'Choose an available model and reasoning effort.')}</p>}
        </div>
        <div ref={modelsPanel} id={`${id}-models-panel`} className="model-selection__layer" inert={view !== 'models'} aria-hidden={view !== 'models' || undefined}>
          <div className="model-selection__model-heading">
            <button ref={backButton} type="button" className="model-selection__back" aria-label={text('返回', 'Back')} onClick={() => setView('summary')}>
              <CaretLeftIcon size={14} aria-hidden="true" />
            </button>
            <p id={`${id}-models`} className="model-selection__title">{text('选择模型', 'Choose model')}</p>
          </div>
          <div className="model-selection__list" role="radiogroup" aria-labelledby={`${id}-models`}>
            {catalog.map((item, index) => <button key={item.id} type="button" role="radio" className="model-selection__option"
              ref={element => { if (element) modelButtons.current.set(item.id, element); else modelButtons.current.delete(item.id) }}
              aria-checked={item.id === value.modelId} disabled={disabled}
              tabIndex={item.id === (model?.id ?? catalog[0]?.id) ? 0 : -1}
              onClick={() => { if (chooseModel(item.id)) setView('summary') }}
              onKeyDown={event => {
                if (disabled || catalog.length < 2) return
                const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % catalog.length
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + catalog.length - 1) % catalog.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? catalog.length - 1 : null
                if (nextIndex === null) return
                event.preventDefault()
                const nextModel = catalog[nextIndex]
                chooseModel(nextModel.id)
                modelButtons.current.get(nextModel.id)?.focus()
              }}>
              <span className="model-selection__option-content"><ModelBrand modelId={item.id} /><strong>{item.label}</strong></span>
              {item.id === value.modelId && <CheckIcon size={16} aria-hidden="true" />}
            </button>)}
          </div>
        </div>
      </div>
    </div>
  </div>
}
