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
const knownEfforts = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max'])

function validateCatalog(value: AgentModelCatalog) {
  if (!['mock', 'base', 'sft'].includes(value.runtimeMode) || !Array.isArray(value.models)) throw new Error('Invalid model catalog')
  const ids = new Set<string>()
  for (const model of value.models) {
    if (!model.id || !model.label || ids.has(model.id) || !Array.isArray(model.reasoningEfforts)
      || model.reasoningEfforts.length === 0 || new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length
      || !model.reasoningEfforts.every(effort => knownEfforts.has(effort))
      || !model.reasoningEfforts.includes(model.defaultReasoningEffort)) throw new Error('Invalid model catalog')
    ids.add(model.id)
  }
  return value
}

/** Owner-scoped in-memory state only. Never use the static model catalog for live requests. */
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
          selection: first ? { modelId: first.id, reasoningEffort: first.defaultReasoningEffort } : null })
      } catch {
        if (!controller.signal.aborted) setState({ ...emptyState(userId), status: 'error' })
      }
    }
    void load()
    return () => controller.abort()
  }, [userId, revision])

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
