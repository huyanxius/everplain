import { CaretDownIcon } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import type { AgentTurnRequest } from '../../modules/research-agent'
import { ModelSelectionControl } from './ModelSelectionControl'
import { isModelSelectionValid, type ModelSelection } from './modelSelection'
import type { AgentModelSelectionState } from './useAgentModelSelection'
import './model-selection.css'

const effortLabels = { none: ['无', 'None'], low: ['低', 'Low'], medium: ['中', 'Medium'], high: ['高', 'High'], xhigh: ['很高', 'XHigh'], max: ['最高', 'Max'] } as const

export function ModelSelectionSettings({ state, disabled, activeRequest }: {
  state: AgentModelSelectionState
  disabled: boolean
  activeRequest?: AgentTurnRequest | null
}) {
  const { text } = useAppLocale()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const activeSelection: ModelSelection | null = disabled && activeRequest?.model_id && activeRequest.reasoning_effort
    ? { modelId: activeRequest.model_id, reasoningEffort: activeRequest.reasoning_effort } : null
  const activeUsesDefault = Boolean(disabled && activeRequest && !activeRequest.model_id)
  const selection = activeUsesDefault ? null : activeSelection ?? state.selection
  const supported = Boolean(selection && isModelSelectionValid(selection, state.catalog))
  const model = state.catalog.find(item => item.id === selection?.modelId)
  const summary = state.status === 'ready' && model && selection && supported
    ? `${model.label} · ${text(effortLabels[selection.reasoningEffort][0], effortLabels[selection.reasoningEffort][1])}`
    : activeSelection || activeUsesDefault ? text('本轮沿用原设置', 'Original turn settings')
    : state.status === 'loading' ? text('正在读取模型', 'Loading models')
    : state.status === 'error' ? text('模型暂不可用 · 服务端默认', 'Models unavailable · Server default')
    : text('模型未启用 · 服务端默认', 'Models not enabled · Server default')

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useLayoutEffect(() => {
    if (!open || !panel.current) return
    const menu = panel.current
    menu.showPopover?.()
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 12
      const top = (viewport?.offsetTop ?? 0) + 12
      const width = Math.max(0, Math.min(320, (viewport?.width ?? window.innerWidth) - 24))
      const bottom = top + (viewport?.height ?? window.innerHeight) - 24
      const above = Math.max(0, rect.top - top - 8)
      const below = Math.max(0, bottom - rect.bottom - 8)
      const upwards = above > below
      menu.style.width = `${width}px`
      menu.style.maxHeight = `${Math.min(400, upwards ? above : below)}px`
      menu.style.left = `${Math.max(left, Math.min(rect.right - width, left + (viewport?.width ?? window.innerWidth) - 24 - width))}px`
      menu.style.top = `${upwards ? Math.max(top, rect.top - Math.min(menu.scrollHeight, above, 400) - 8) : rect.bottom + 8}px`
    }
    place()
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(menu)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); menu.hidePopover?.() }
  }, [open])

  return <section ref={root} className="model-selection-settings" aria-label={text('模型设置', 'Model settings')}>
    <button ref={trigger} type="button" className="qx-btn qx-btn--ghost model-selection-settings__summary"
      aria-label={`${text('模型与思考强度', 'Model and reasoning effort')}：${summary}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={state.runtimeMode === 'mock' ? text('当前是隔离测试模型。', 'This is the isolated test runtime.') : undefined}
      onClick={() => setOpen(value => !value)}><span>{summary}</span><CaretDownIcon size={14} aria-hidden="true" /></button>
    {open && <div ref={panel} id={id} className="qx-menu model-selection-settings__popover" popover="manual" role="dialog" aria-label={text('选择模型与思考强度', 'Choose model and reasoning effort')}>
    {state.status === 'ready' && selection && supported ? <>
      <ModelSelectionControl className="model-selection--compact" catalog={state.catalog} value={selection} onChange={value => { if (!disabled) state.onChange(value) }} disabled={disabled} />
      {state.runtimeMode === 'mock' && <p className="qx-meta">{text('当前是隔离测试模型。', 'This is the isolated test runtime.')}</p>}
    </> : <p className="qx-meta" role="status">{activeUsesDefault
      ? text('本轮沿用服务端默认设置，结束后可调整。', 'This turn uses server defaults. You can change this after it finishes.')
      : state.status === 'loading'
      ? text('正在读取可用模型；本轮仍可使用服务端默认设置。', 'Loading available models. You can still use server defaults.')
      : state.status === 'error'
        ? text('模型设置暂时无法读取，本轮使用服务端默认设置。', 'Model settings could not be loaded. This turn uses server defaults.')
        : activeSelection
          ? text('恢复中的回合沿用原模型和强度，当前不可修改。', 'The resumed turn keeps its original model and effort.')
          : text('模型选择尚未启用，本轮使用服务端默认设置。', 'Model selection is not enabled. This turn uses server defaults.')}</p>}
    {state.status === 'error' && <button type="button" className="qx-btn qx-btn--ghost" disabled={disabled} onClick={state.retry}>{text('重新读取模型', 'Reload models')}</button>}
    {disabled && supported && <p className="qx-meta">{text('当前回合进行中，结束后可调整。', 'You can change this after the current turn finishes.')}</p>}
    <button type="button" className="qx-btn qx-btn--ghost" aria-label={text('关闭模型选择', 'Close model selection')} onClick={() => { setOpen(false); trigger.current?.focus() }}>{text('完成', 'Done')}</button>
    </div>}
  </section>
}
