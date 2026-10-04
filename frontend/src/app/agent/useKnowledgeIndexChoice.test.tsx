import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKnowledgeIndexChoice } from './useKnowledgeIndexChoice'

const api = vi.hoisted(() => ({ read: vi.fn(), repair: vi.fn() }))
vi.mock('../../modules/research-agent', () => ({
  isKnowledgeIndexStatus: (value: unknown) => Boolean(value && typeof value === 'object' && 'state' in value),
  readKnowledgeIndexStatus: api.read, repairKnowledgeIndex: api.repair,
}))
const failed = { knowledge_base_id: 'kb', document_id: 'doc', parse_id: 'parse', filename: '失败资料.pdf', index_status: 'failed', index_error: 'provider unavailable', reason: null }
const status = { state: 'missing_index' as const, embedding_model: 'embedding', total_count: 2, ready_count: 1, missing_count: 1, processing_count: 0, failed_count: 1,
  ready_document_ids: ['ready'], ready_documents: [{ ...failed, document_id: 'ready', filename: '已完成.pdf', index_status: 'ready', index_error: null }], missing_documents: [failed] }
const request = { message: '从我的资料中回答', conversation_id: 'conversation', reference_knowledge_base_id: 'kb', model_id: 'chosen-model' }
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })
describe('knowledge indexing choice lifecycle', () => {
  it('does nothing before a real server choice, then skip preserves request and only opts into ready documents', () => {
    const resume = vi.fn(() => true)
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    expect(api.read).not.toHaveBeenCalled()
    expect(api.repair).not.toHaveBeenCalled()
    act(() => result.current.present(status, request))
    act(() => result.current.skip())
    expect(resume).toHaveBeenCalledWith({ ...request, knowledge_index_action: 'skip_missing' }, undefined)
    expect(result.current.choice).toBeNull()
    expect(api.repair).not.toHaveBeenCalled()
  })
  it('deduplicates repeated repair and stops waiting on failed jobs without requeueing', async () => {
    let resolve!: (value: typeof status) => void
    api.repair.mockReturnValueOnce(new Promise(r => { resolve = r }))
    api.read.mockResolvedValue(status)
    const resume = vi.fn(() => true)
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => result.current.present(status, request))
    act(() => { void result.current.repair(); void result.current.repair() })
    expect(api.repair).toHaveBeenCalledTimes(1)
    expect(api.repair.mock.calls[0][0].documents).toEqual([{ knowledge_base_id: 'kb', document_id: 'doc', parse_id: 'parse' }])
    await act(async () => resolve(status))
    await waitFor(() => expect(result.current.choice?.waiting).toBe(false))
    expect(result.current.error).toContain('整理失败')
    expect(resume).not.toHaveBeenCalled()
    expect(api.repair).toHaveBeenCalledTimes(1)
  })
  it('cancellation ignores a late repair response and never resumes the question', async () => {
    let resolve!: (value: typeof status) => void
    api.repair.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const resume = vi.fn(() => true)
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => result.current.present(status, request))
    act(() => { void result.current.repair() })
    act(() => result.current.cancel())
    await act(async () => resolve(status))
    expect(result.current.choice).toBeNull()
    expect(resume).not.toHaveBeenCalled()
    expect(api.read).not.toHaveBeenCalled()
  })
  it('restores a pending choice after refresh without silently queueing or sending', () => {
    const resume = vi.fn(() => true)
    const first = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => first.result.current.present(status, request))
    first.unmount()
    const second = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    expect(second.result.current.choice?.request).toEqual(request)
    expect(second.result.current.choice?.status).toEqual(status)
    expect(api.repair).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })
  it('resumes only after all requested documents become ready', async () => {
    api.repair.mockResolvedValue({ ...status, processing_count: 1, failed_count: 0 })
    api.read.mockResolvedValue({ ...status, state: 'ready', ready_count: 2, missing_count: 0, failed_count: 0, missing_documents: [] })
    const resume = vi.fn(() => true)
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => result.current.present(status, request))
    await act(async () => { await result.current.repair() })
    await waitFor(() => expect(resume).toHaveBeenCalledWith({ ...request, knowledge_index_action: null }, undefined))
    expect(result.current.choice).toBeNull()
  })
  it('refreshes stale parse identities without queueing until the user decides again', async () => {
    api.read.mockResolvedValue({ ...status, missing_documents: [{ ...failed, parse_id: 'new-parse' }] })
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', vi.fn(() => true)))
    act(() => result.current.present(status, request))
    await act(async () => { await result.current.refresh() })
    expect(result.current.choice?.status.missing_documents[0].parse_id).toBe('new-parse')
    expect(api.repair).not.toHaveBeenCalled()
  })
  it('restores explicit waiting after refresh by checking status without duplicate repair', async () => {
    localStorage.setItem('everplain.agent.index-choice.v1.scope', JSON.stringify({ status, request, waiting: true, repairKey: 'already-submitted' }))
    api.read.mockResolvedValue({ ...status, state: 'ready', ready_count: 2, missing_count: 0, failed_count: 0, missing_documents: [] })
    const resume = vi.fn(() => true)
    renderHook(() => useKnowledgeIndexChoice('scope', resume))
    await waitFor(() => expect(resume).toHaveBeenCalledOnce())
    expect(api.repair).not.toHaveBeenCalled()
  })
  it('isolates choices across accounts or conversations', () => {
    const { result, rerender } = renderHook(({ scope }) => useKnowledgeIndexChoice(scope, vi.fn(() => true)), { initialProps: { scope: 'owner1' } })
    act(() => result.current.present(status, request))
    rerender({ scope: 'owner2' })
    expect(result.current.choice).toBeNull()
  })
  it('keeps a ready waiting question while the conversation is loading, then resumes once accepted', async () => {
    localStorage.setItem('everplain.agent.index-choice.v1.scope', JSON.stringify({ status, request, waiting: true }))
    api.read.mockResolvedValue({ ...status, state: 'ready', ready_count: 2, missing_count: 0, failed_count: 0, missing_documents: [] })
    const resume = vi.fn(() => true)
    const { result, rerender } = renderHook(({ ready }) => useKnowledgeIndexChoice('scope', resume, ready), { initialProps: { ready: false } })
    await waitFor(() => expect(result.current.choice?.status.state).toBe('ready'))
    expect(resume).not.toHaveBeenCalled()
    expect(localStorage.getItem('everplain.agent.index-choice.v1.scope')).toContain(request.message)
    rerender({ ready: true })
    await waitFor(() => expect(resume).toHaveBeenCalledOnce())
    expect(result.current.choice).toBeNull()
  })
  it('does not discard a choice when continuation is declined by the page', () => {
    const resume = vi.fn(() => false)
    const { result } = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => result.current.present(status, request))
    act(() => result.current.skip())
    expect(result.current.choice?.request.message).toBe(request.message)
    expect(localStorage.getItem('everplain.agent.index-choice.v1.scope')).toContain(request.message)
  })
  it('preserves the original deep-research session key across a refreshed explicit choice', () => {
    const deepRequest = { ...request, mode: 'deep_research' as const, deep_research_run_id: 'deep-run', deep_research_action: 'confirm' as const }
    const resume = vi.fn(() => true)
    const first = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => first.result.current.present(status, deepRequest, 'scope', 'original-deep-key'))
    first.unmount()
    const second = renderHook(() => useKnowledgeIndexChoice('scope', resume))
    act(() => second.result.current.skip())
    expect(resume).toHaveBeenCalledWith({ ...deepRequest, knowledge_index_action: 'skip_missing' }, 'original-deep-key')
  })

})
