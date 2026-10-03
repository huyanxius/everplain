import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_SELECTION,
  MODEL_CATALOG,
  isModelSelectionValid,
  selectEffortStep,
  selectModel,
  toModelSelectionRequest,
  type ModelDefinition,
  type ModelSelection,
} from './modelSelection'

describe('model selection contract', () => {
  it('exposes only Luna and its documented discrete efforts, with medium as default', () => {
    expect(MODEL_CATALOG.map(model => model.id)).toEqual(['gpt-6-luna'])
    expect(MODEL_CATALOG[0].reasoningEfforts).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(isModelSelectionValid(DEFAULT_MODEL_SELECTION)).toBe(true)
    expect(DEFAULT_MODEL_SELECTION.reasoningEffort).toBe('medium')
  })

  it('maps each slider stop to exactly one allowed effort', () => {
    for (const [step, reasoningEffort] of MODEL_CATALOG[0].reasoningEfforts.entries()) {
      expect(selectEffortStep(step, DEFAULT_MODEL_SELECTION)).toEqual({ modelId: 'gpt-6-luna', reasoningEffort })
    }
  })

  it.each([-1, 6, 0.5, NaN, Infinity])('rejects invalid slider index %s', step => {
    expect(selectEffortStep(step, DEFAULT_MODEL_SELECTION)).toBeNull()
  })

  it('rejects unknown models and unsupported efforts rather than silently substituting', () => {
    expect(selectModel('unknown', DEFAULT_MODEL_SELECTION)).toBeNull()
    expect(selectEffortStep(1, { ...DEFAULT_MODEL_SELECTION, modelId: 'unknown' })).toBeNull()
    expect(() => toModelSelectionRequest({ ...DEFAULT_MODEL_SELECTION, modelId: 'unknown' })).toThrow()
    for (const reasoningEffort of ['minimal', 'ultra', 'persistent', '', null]) {
      const selection = { ...DEFAULT_MODEL_SELECTION, reasoningEffort } as ModelSelection
      expect(isModelSelectionValid(selection)).toBe(false)
      expect(() => toModelSelectionRequest(selection)).toThrow()
    }
  })

  it('maps a validated UI selection to the per-turn wire fields without provider configuration', () => {
    expect(toModelSelectionRequest(DEFAULT_MODEL_SELECTION)).toEqual({ model_id: 'gpt-6-luna', reasoning_effort: 'medium' })
  })

  it('can add a future catalog entry without rewriting the selection controls', () => {
    const nextModel: ModelDefinition = { id: 'future-test-model', label: 'Test model', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }
    const catalog = [...MODEL_CATALOG, nextModel]
    expect(selectModel(nextModel.id, DEFAULT_MODEL_SELECTION, catalog)).toEqual({ modelId: nextModel.id, reasoningEffort: 'low' })
    expect(selectModel(nextModel.id, { ...DEFAULT_MODEL_SELECTION, reasoningEffort: 'high' }, catalog)).toEqual({ modelId: nextModel.id, reasoningEffort: 'high' })
    expect(selectModel(nextModel.id, DEFAULT_MODEL_SELECTION)).toBeNull()
  })

  it('refuses a malformed future catalog whose default is not available', () => {
    expect(selectModel('bad', DEFAULT_MODEL_SELECTION, [{ id: 'bad', label: 'Bad', reasoningEfforts: ['low'], defaultReasoningEffort: 'high' }])).toBeNull()
  })
})
