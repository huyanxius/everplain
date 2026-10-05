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


it('switches between reasoning and no-effort models without inventing an effort', () => {
  const gemini: ModelDefinition = { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoningEfforts: [], defaultReasoningEffort: null }
  const catalog = [...MODEL_CATALOG, gemini]
  const selected: ModelSelection = { modelId: gemini.id, reasoningEffort: null }
  expect(selectModel(gemini.id, DEFAULT_MODEL_SELECTION, catalog)).toEqual(selected)
  expect(isModelSelectionValid(selected, catalog)).toBe(true)
  expect(toModelSelectionRequest(selected, catalog)).toEqual({ model_id: gemini.id, reasoning_effort: null })
  expect(selectEffortStep(0, selected, catalog)).toBeNull()
  expect(isModelSelectionValid({ ...selected, reasoningEffort: 'none' }, catalog)).toBe(false)
  expect(selectModel('gpt-6-luna', selected, catalog)).toEqual(DEFAULT_MODEL_SELECTION)
  expect(selectModel(gemini.id, selected, [{ ...gemini, defaultReasoningEffort: 'medium' }])).toBeNull()
})

it('uses native server stop sets and drops an incompatible previous model effort', () => {
  const catalog: readonly ModelDefinition[] = [
    { id: 'gpt-fixture', label: 'GPT fixture', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'none' },
    { id: 'gemini-fixture', label: 'Gemini fixture', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
    { id: 'deepseek-fixture', label: 'DeepSeek fixture', reasoningEfforts: ['none', 'low', 'high', 'max'], defaultReasoningEffort: 'high' },
    { id: 'claude-fixture', label: 'Claude fixture', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'high' },
  ]
  let selection: ModelSelection = { modelId: 'gpt-fixture', reasoningEffort: 'xhigh' }
  selection = selectModel('gemini-fixture', selection, catalog)!
  expect(selection.reasoningEffort).toBe('medium')
  selection = selectEffortStep(0, selection, catalog)!
  expect(selection.reasoningEffort).toBe('minimal')
  expect(toModelSelectionRequest(selection, catalog)).toEqual({ model_id: 'gemini-fixture', reasoning_effort: 'minimal' })
  selection = selectModel('deepseek-fixture', selection, catalog)!
  expect(selection.reasoningEffort).toBe('high')
  selection = selectModel('claude-fixture', selection, catalog)!
  expect(selection.reasoningEffort).toBe('high')
  expect(isModelSelectionValid({ modelId: 'claude-fixture', reasoningEffort: 'none' }, catalog)).toBe(false)
  for (const model of catalog) {
    for (const [step, reasoningEffort] of model.reasoningEfforts.entries()) {
      expect(selectEffortStep(step, { modelId: model.id, reasoningEffort: model.defaultReasoningEffort }, catalog)).toEqual({ modelId: model.id, reasoningEffort })
    }
  }
})
