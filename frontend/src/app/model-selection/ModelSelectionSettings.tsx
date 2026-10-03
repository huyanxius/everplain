import { CaretDownIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
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
  const panelId = useId()
  const activeSelection: ModelSelection | null = disabled && activeRequest?.model_id && activeRequest.reasoning_effort
    ? { modelId: activeRequest.model_id, reasoningEffort: activeRequest.reasoning_effort } : null
  const activeUsesDefault = Boolean(disabled && activeRequest && !activeRequest.model_id)
  const selection = activeUsesDefault ? null : activeSelection ?? state.selection
  const selected = state.catalog.find(model => model.id === selection?.modelId)
  const supported = Boolean(selection && isModelSelectionValid(selection, state.catalog))
  const summary = selected && supported && selection
    ? `${selected.label} · ${text(effortLabels[selection.reasoningEffort][0], effortLabels[selection.reasoningEffort][1])}`
    : activeSelection ? text('原回合设置', 'Original turn settings') : text('服务端默认', 'Server default')

  return <section className="cv-tool-group model-selection-settings" aria-label={text('模型设置', 'Model settings')}>
    <button className="qx-btn qx-btn--ghost model-selection-settings__toggle" type="button"
      aria-label={text('模型设置', 'Model settings')} aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}>
      <span>{text('模型', 'Model')}</span><span className="model-selection-settings__summary">{summary}</span><CaretDownIcon aria-hidden="true" />
    </button>
    {open && <div id={panelId} className="model-selection-settings__panel">
      {state.status === 'ready' && selection && supported ? <>
        <ModelSelectionControl catalog={state.catalog} value={selection} onChange={value => { if (!disabled) state.onChange(value) }} disabled={disabled} />
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
    </div>}
  </section>
}
