import { useCallback, useEffect, useState } from 'react'
import { getAgentModelCatalog, type AgentModelCatalog } from '../../modules/research-agent'
import { isModelSelectionValid, toModelSelectionRequest, type ModelDefinition, type ModelSelection } from './modelSelection'

export type ModelCatalogStatus = 'loading' | 'ready' | 'unavailable' | 'error'
type SelectionState = {
  owner: string | null
  status: ModelCatalogStatus
  catalog: readonly ModelDefinition[]
  runtimeMode: AgentModelCatalog['runtimeMode'] | null
  selection: ModelSelection | null
}

const emptyState = (owner: string | null): SelectionState => ({
  owner, status: owner ? 'loading' : 'unavailable', catalog: [], runtimeMode: null, selection: null,
})
const knownEfforts = new Set(['none', 'enabled', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const preferenceKey = (owner: string) => `everplain.agent-model-selection.v1.${encodeURIComponent(owner)}`

function savedSelection(owner: string, catalog: readonly ModelDefinition[]): ModelSelection | null {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey(owner)) ?? 'null')
    return value && typeof value.modelId === 'string' && (typeof value.reasoningEffort === 'string' || value.reasoningEffort === null)
      && isModelSelectionValid(value, catalog)
      ? { modelId: value.modelId, reasoningEffort: value.reasoningEffort } : null
  } catch { return null }
}

function validateCatalog(value: AgentModelCatalog) {
  if (!['mock', 'base', 'sft'].includes(value.runtimeMode) || !Array.isArray(value.models)) throw new Error('Invalid model catalog')
  const ids = new Set<string>()
  for (const model of value.models) {
    if (!model.id || !model.label || ids.has(model.id) || !Array.isArray(model.reasoningEfforts)
      || new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length
      || !model.reasoningEfforts.every(effort => knownEfforts.has(effort))
      || !isModelSelectionValid({ modelId: model.id, reasoningEffort: model.defaultReasoningEffort }, [model])) throw new Error('Invalid model catalog')
    ids.add(model.id)
  }
  return value
}

/** Save only the owner’s product choice; always revalidate against the live catalog. */
export function useAgentModelSelection(userId: string | null) {
  const [state, setState] = useState<SelectionState>(() => emptyState(userId))
  const [revision, setRevision] = useState(0)
  const current = state.owner === userId ? state : emptyState(userId)

  useEffect(() => {
    const controller = new AbortController()
    setState(emptyState(userId))
    if (!userId) return () => controller.abort()
    async function load() {
      try {
        const result = validateCatalog(await getAgentModelCatalog(controller.signal))
        if (controller.signal.aborted) return
        const first = result.models[0]
        setState({ owner: userId, status: first ? 'ready' : 'unavailable', catalog: result.models,
          runtimeMode: result.runtimeMode,
          selection: first ? savedSelection(userId, result.models) ?? { modelId: first.id, reasoningEffort: first.defaultReasoningEffort } : null })
      } catch {
        if (!controller.signal.aborted) setState({ ...emptyState(userId), status: 'error' })
      }
    }
    void load()
    return () => controller.abort()
  }, [userId, revision])

  useEffect(() => {
    if (!userId || state.owner !== userId || state.status !== 'ready' || !state.selection) return
    try { localStorage.setItem(preferenceKey(userId), JSON.stringify(state.selection)) } catch { /* Storage may be unavailable; the current selection still works. */ }
  }, [state, userId])

  const onChange = useCallback((selection: ModelSelection) => {
    setState(previous => previous.owner === userId && previous.status === 'ready' && isModelSelectionValid(selection, previous.catalog)
      ? { ...previous, selection } : previous)
  }, [userId])
  const retry = useCallback(() => setRevision(value => value + 1), [])
  const requestFields = () => current.status === 'ready' && current.selection
    ? toModelSelectionRequest(current.selection, current.catalog)
    : {}

  return { ...current, onChange, retry, requestFields }
}
export type AgentModelSelectionState = ReturnType<typeof useAgentModelSelection>
