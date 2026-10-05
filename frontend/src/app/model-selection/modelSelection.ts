/** Public product IDs; provider names and URLs are resolved only by the server. */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ModelDefinition = {
  readonly id: string
  readonly label: string
  readonly reasoningEfforts: readonly ReasoningEffort[]
  readonly defaultReasoningEffort: ReasoningEffort | null
}

export type ModelSelection = {
  readonly modelId: string
  readonly reasoningEffort: ReasoningEffort | null
}

/**
 * Product catalog, deliberately containing only the requested model.
 * Effort support and the medium default were checked against OpenAI's model page
 * on 2026-10-02: https://developers.openai.com/api/docs/models/gpt-6-luna
 * Provider/protocol availability must still be validated by the server. This is
 * not evidence that any configured third-party gateway has passed a live test.
 */
export const MODEL_CATALOG: readonly ModelDefinition[] = Object.freeze([
  Object.freeze({
    id: 'gpt-6-luna',
    label: 'GPT 6 Luna',
    reasoningEfforts: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const),
    defaultReasoningEffort: 'medium',
  }),
])

export const DEFAULT_MODEL_SELECTION: ModelSelection = Object.freeze({
  modelId: 'gpt-6-luna',
  reasoningEffort: 'medium',
})

export function findSelectedModel(
  selection: ModelSelection,
  catalog: readonly ModelDefinition[] = MODEL_CATALOG,
): ModelDefinition | undefined {
  return catalog.find(model => model.id === selection.modelId)
}

export function isModelSelectionValid(
  selection: ModelSelection,
  catalog: readonly ModelDefinition[] = MODEL_CATALOG,
): boolean {
  const model = findSelectedModel(selection, catalog)
  if (!model) return false
  return model.reasoningEfforts.length === 0
    ? model.defaultReasoningEffort === null && selection.reasoningEffort === null
    : selection.reasoningEffort !== null && model.reasoningEfforts.includes(selection.reasoningEffort)
}

/** Preserve a valid effort across model changes; otherwise use that model's default. */
export function selectModel(
  modelId: string,
  previous: ModelSelection,
  catalog: readonly ModelDefinition[] = MODEL_CATALOG,
): ModelSelection | null {
  const model = catalog.find(candidate => candidate.id === modelId)
  if (!model || !isModelSelectionValid({ modelId, reasoningEffort: model.defaultReasoningEffort }, catalog)) return null
  return {
    modelId: model.id,
    reasoningEffort: previous.reasoningEffort !== null && model.reasoningEfforts.includes(previous.reasoningEffort)
      ? previous.reasoningEffort
      : model.defaultReasoningEffort,
  }
}

/** Slider values are ordinal indices, never arbitrary or interpolated effort values. */
export function selectEffortStep(
  step: number,
  previous: ModelSelection,
  catalog: readonly ModelDefinition[] = MODEL_CATALOG,
): ModelSelection | null {
  const model = findSelectedModel(previous, catalog)
  if (!model || !Number.isInteger(step) || step < 0 || step >= model.reasoningEfforts.length) return null
  return { modelId: model.id, reasoningEffort: model.reasoningEfforts[step] }
}

/** Validates before mapping UI state; server-side allowlisting remains mandatory. */
export function toModelSelectionRequest(
  selection: ModelSelection,
  catalog: readonly ModelDefinition[] = MODEL_CATALOG,
) {
  if (!isModelSelectionValid(selection, catalog)) throw new Error('Unsupported model or reasoning effort')
  return { model_id: selection.modelId, reasoning_effort: selection.reasoningEffort }
}
