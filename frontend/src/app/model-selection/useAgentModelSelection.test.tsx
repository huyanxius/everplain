import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const loadCatalog = vi.hoisted(() => vi.fn())
vi.mock('../../modules/research-agent', () => ({ getAgentModelCatalog: loadCatalog }))
import { useAgentModelSelection } from './useAgentModelSelection'

const catalog = { runtimeMode: 'base', models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }] }
afterEach(() => { cleanup(); loadCatalog.mockReset() })

describe('owner-scoped live model catalog', () => {
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

  it.each([undefined, { runtimeMode: 'base', models: [{ ...catalog.models[0], reasoningEfforts: ['minimal'] }] }, { ...catalog, models: [{ ...catalog.models[0], defaultReasoningEffort: 'max' }] }])('does not replace a malformed server response with the static catalog', async value => {
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
