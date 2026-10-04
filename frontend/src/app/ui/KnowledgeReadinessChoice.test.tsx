import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeReadinessChoice } from './KnowledgeReadinessChoice'

afterEach(cleanup)
const documents = [
  { id: 'ready', title: '已完成.pdf', state: 'ready' as const },
  { id: 'working', title: '处理中.pdf', state: 'processing' as const, reason: '正在建立语义索引' },
  { id: 'failed', title: '失败.pdf', state: 'failed' as const, reason: '索引服务暂不可用' },
]
function setup(overrides = {}) {
  const callbacks = { onSkip: vi.fn(), onRepair: vi.fn(), onCancel: vi.fn() }
  render(<KnowledgeReadinessChoice totalCount={3} readyCount={1} documents={documents} {...callbacks} {...overrides} />)
  return callbacks
}
describe('KnowledgeReadinessChoice', () => {
  it('shows real counts, ready/processing/failed documents and reasons', () => {
    setup()
    expect(screen.getByRole('region')).toHaveTextContent('共 3 份资料，已就绪 1 份，尚未就绪 2 份')
    expect(screen.getByText('失败.pdf')).toBeVisible()
    expect(screen.getByText('索引服务暂不可用')).toBeVisible()
    expect(screen.getByText('处理中.pdf')).toBeVisible()
    expect(screen.getByText('已就绪 · 1')).toBeVisible()
  })
  it('keeps skip, repair and cancel as separate explicit decisions', () => {
    const callbacks = setup()
    fireEvent.click(screen.getByRole('button', { name: '直接开始，忽略未就绪资料' }))
    expect(callbacks.onSkip).toHaveBeenCalledOnce()
    expect(callbacks.onRepair).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '补齐并等待整理完成' }))
    expect(callbacks.onRepair).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })
  it('prevents duplicate repair while waiting but keeps cancellation available', () => {
    const callbacks = setup({ waiting: true, busy: true })
    expect(screen.getByRole('button', { name: '正在等待整理完成…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '直接开始，忽略未就绪资料' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })
  it('does not offer an empty ready-only result and explains graph readiness', () => {
    setup({ readyCount: 0, purpose: 'graph', error: '实体提取失败' })
    expect(screen.getByRole('button', { name: '直接开始，忽略未就绪资料' })).toBeDisabled()
    expect(screen.getByRole('region')).toHaveTextContent('仅完成向量索引不代表图谱已就绪')
    expect(screen.getByRole('alert')).toHaveTextContent('实体提取失败')
  })
})
