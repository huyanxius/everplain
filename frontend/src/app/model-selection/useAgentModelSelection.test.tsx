import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const loadCatalog = vi.hoisted(() => vi.fn())
vi.mock('../../modules/research-agent', () => ({ getAgentModelCatalog: loadCatalog }))
import { useAgentModelSelection } from './useAgentModelSelection'

const catalog = { runtimeMode: 'base', models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }] }
afterEach(() => { cleanup(); loadCatalog.mockReset(); localStorage.clear() })

describe('owner-scoped live model catalog', () => {
  it('keeps a choice across route mounts only after revalidating the live catalog', async () => {
    loadCatalog.mockResolvedValue(catalog)
    const first = renderHook(() => useAgentModelSelection('owner'))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => first.result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'high' }))
    first.unmount()
    const next = renderHook(() => useAgentModelSelection('owner'))
    expect(next.result.current.requestFields()).toEqual({})
    await waitFor(() => expect(next.result.current.status).toBe('ready'))
    expect(next.result.current.requestFields()).toEqual({ model_id: 'gpt-6-luna', reasoning_effort: 'high' })
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it('does not send a saved effort that the latest catalog no longer supports', async () => {
    loadCatalog.mockResolvedValueOnce(catalog).mockResolvedValueOnce({ ...catalog, models: [{ ...catalog.models[0], reasoningEfforts: ['low', 'medium'] }] })
    const first = renderHook(() => useAgentModelSelection('owner'))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => first.result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'high' }))
    first.unmount()
    const next = renderHook(() => useAgentModelSelection('owner'))
    await waitFor(() => expect(next.result.current.status).toBe('ready'))
    expect(next.result.current.requestFields()).toEqual({ model_id: 'gpt-6-luna', reasoning_effort: 'medium' })
  })

  it('restores each account’s own choice without sharing it with another account', async () => {
    loadCatalog.mockResolvedValue(catalog)
    const { result, rerender } = renderHook(({ owner }) => useAgentModelSelection(owner), { initialProps: { owner: 'a' } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'high' }))
    rerender({ owner: 'b' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.selection?.reasoningEffort).toBe('medium')
    act(() => result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'low' }))
    rerender({ owner: 'a' })
    expect(result.current.requestFields()).toEqual({})
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.selection?.reasoningEffort).toBe('high')
  })

  it('uses only server-supported stops and validates every change against that subset', async () => {
    loadCatalog.mockResolvedValue(catalog)
    const { result } = renderHook(() => useAgentModelSelection('owner'))
    expect(result.current.requestFields()).toEqual({})
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.catalog[0].reasoningEfforts).toEqual(['low', 'medium', 'high'])
    act(() => result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'max' }))
    expect(result.current.requestFields()).toEqual({ model_id: 'gpt-6-luna', reasoning_effort: 'medium' })
    act(() => result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'high' }))
    expect(result.current.requestFields()).toEqual({ model_id: 'gpt-6-luna', reasoning_effort: 'high' })
  })

  it('clears prior-owner values immediately and ignores their late response', async () => {
    let resolveA!: (value: unknown) => void
    let resolveB!: (value: unknown) => void
    loadCatalog.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve })).mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve }))
    const { result, rerender } = renderHook(({ userId }) => useAgentModelSelection(userId), { initialProps: { userId: 'owner-a' as string | null } })
    rerender({ userId: 'owner-b' })
    expect(result.current.catalog).toEqual([])
    expect(result.current.requestFields()).toEqual({})
    await act(async () => resolveA(catalog))
    expect(result.current.status).toBe('loading')
    await act(async () => resolveB({ ...catalog, models: [] }))
    expect(result.current.status).toBe('unavailable')
    expect(result.current.requestFields()).toEqual({})
    rerender({ userId: null })
    expect(result.current.catalog).toEqual([])
    expect(result.current.selection).toBeNull()
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it('clears a populated selection when switching accounts before the next catalog resolves', async () => {
    loadCatalog.mockResolvedValueOnce(catalog).mockReturnValueOnce(new Promise(() => undefined))
    const { result, rerender } = renderHook(({ userId }) => useAgentModelSelection(userId), { initialProps: { userId: 'a' } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.onChange({ modelId: 'gpt-6-luna', reasoningEffort: 'high' }))
    rerender({ userId: 'b' })
    expect(result.current.requestFields()).toEqual({})
    expect(result.current.selection).toBeNull()
  })

  it.each([undefined, { runtimeMode: 'base', models: [{ ...catalog.models[0], reasoningEfforts: ['ultra'] }] }, { ...catalog, models: [{ ...catalog.models[0], defaultReasoningEffort: 'max' }] }])('does not replace a malformed server response with the static catalog', async value => {
    loadCatalog.mockResolvedValue(value)
    const { result } = renderHook(() => useAgentModelSelection('owner'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.catalog).toEqual([])
    expect(result.current.requestFields()).toEqual({})
  })

  it('can retry a failed lookup without persisting credentials or a cross-user cache', async () => {
    loadCatalog.mockRejectedValueOnce(new Error('synthetic')).mockResolvedValueOnce(catalog)
    const { result } = renderHook(() => useAgentModelSelection('owner'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })
})


it('persists no-effort choices per owner against the live two-model catalog', async () => {
  const gemini = { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoningEfforts: [], defaultReasoningEffort: null }
  loadCatalog.mockResolvedValue({ ...catalog, models: [...catalog.models, gemini] })
  const first = renderHook(() => useAgentModelSelection('owner'))
  await waitFor(() => expect(first.result.current.status).toBe('ready'))
  expect(first.result.current.selection?.modelId).toBe('gpt-6-luna')
  act(() => first.result.current.onChange({ modelId: gemini.id, reasoningEffort: null }))
  expect(first.result.current.requestFields()).toEqual({ model_id: gemini.id, reasoning_effort: null })
  first.unmount()
  const next = renderHook(({ owner }) => useAgentModelSelection(owner), { initialProps: { owner: 'owner' } })
  await waitFor(() => expect(next.result.current.status).toBe('ready'))
  expect(next.result.current.selection).toEqual({ modelId: gemini.id, reasoningEffort: null })
  next.rerender({ owner: 'other-owner' })
  await waitFor(() => expect(next.result.current.status).toBe('ready'))
  expect(next.result.current.selection?.modelId).toBe('gpt-6-luna')
})

it.each([
  { reasoningEfforts: [], defaultReasoningEffort: 'medium' },
  { reasoningEfforts: ['medium'], defaultReasoningEffort: null },
])('rejects incompatible no-effort defaults: %j', async incompatible => {
  loadCatalog.mockResolvedValue({ ...catalog, models: [{ ...catalog.models[0], ...incompatible }] })
  const { result } = renderHook(() => useAgentModelSelection('owner'))
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.requestFields()).toEqual({})
})

it('accepts native minimal only when the live server catalog advertises it and revalidates saved selection', async () => {
  const gemini = { id: 'gemini-fixture', label: 'Gemini fixture', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' }
  loadCatalog.mockResolvedValueOnce({ runtimeMode: 'base', models: [gemini] })
  const first = renderHook(() => useAgentModelSelection('native-owner'))
  await waitFor(() => expect(first.result.current.status).toBe('ready'))
  act(() => first.result.current.onChange({ modelId: gemini.id, reasoningEffort: 'minimal' }))
  expect(first.result.current.requestFields()).toEqual({ model_id: gemini.id, reasoning_effort: 'minimal' })
  first.unmount()
  loadCatalog.mockResolvedValueOnce({ runtimeMode: 'base', models: [{ ...gemini, reasoningEfforts: ['low', 'medium', 'high'] }] })
  const second = renderHook(() => useAgentModelSelection('native-owner'))
  await waitFor(() => expect(second.result.current.status).toBe('ready'))
  expect(second.result.current.requestFields()).toEqual({ model_id: gemini.id, reasoning_effort: 'medium' })
})
