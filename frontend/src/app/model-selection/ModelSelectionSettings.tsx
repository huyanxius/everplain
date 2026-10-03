import { useAppLocale } from '../../i18n/AppLocaleProvider'
import type { AgentTurnRequest } from '../../modules/research-agent'
import { ModelSelectionControl } from './ModelSelectionControl'
import { isModelSelectionValid, type ModelSelection } from './modelSelection'
import type { AgentModelSelectionState } from './useAgentModelSelection'
import './model-selection.css'

export function ModelSelectionSettings({ state, disabled, activeRequest }: {
  state: AgentModelSelectionState
  disabled: boolean
  activeRequest?: AgentTurnRequest | null
}) {
  const { text } = useAppLocale()
  const activeSelection: ModelSelection | null = disabled && activeRequest?.model_id && activeRequest.reasoning_effort
    ? { modelId: activeRequest.model_id, reasoningEffort: activeRequest.reasoning_effort } : null
  const activeUsesDefault = Boolean(disabled && activeRequest && !activeRequest.model_id)
  const selection = activeUsesDefault ? null : activeSelection ?? state.selection
  const supported = Boolean(selection && isModelSelectionValid(selection, state.catalog))

  return <section className="model-selection-settings" aria-label={text('模型设置', 'Model settings')}>
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
  </section>
}
