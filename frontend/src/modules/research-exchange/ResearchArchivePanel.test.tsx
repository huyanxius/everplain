import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ResearchArchivePanel } from './ResearchArchivePanel'

const api = vi.hoisted(() => ({
  exportArchive: vi.fn(),
  listAudit: vi.fn(),
}))

vi.mock('./researchExchangeApi', () => ({
  exportResearchArchive: api.exportArchive,
  listResearchAuditEvents: api.listAudit,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ResearchArchivePanel', () => {
  it('shows archive evidence without the retired QDPX import entry', async () => {
    api.listAudit.mockResolvedValue([{
      event_id: 'event-1',
      event_type: 'project.exported',
      object_type: 'research_task',
      object_id: 'task-1',
      object_version: '3',
      actor_type: 'user',
      actor_id: 'user-1',
      payload: { loss_count: 4 },
      occurred_at: '2026-09-01T02:00:00Z',
    }])
    api.exportArchive.mockResolvedValue({
      blob: new Blob(['archive']),
      filename: 'field-study.zip',
      exchangeId: 'exchange-1',
      sha256: 'a'.repeat(64),
      lossCount: 4,
      blockingLossCount: 1,
    })
    const createObjectURL = vi.fn(() => 'blob:archive')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    render(<ResearchArchivePanel taskId="task-1" />)

    expect(await screen.findByText('project.exported')).toBeVisible()
    expect(screen.getByRole('heading', { name: '研究归档' })).toBeVisible()
    const exportButton = screen.getByRole('button', { name: '导出研究归档' })
    expect(exportButton).toHaveClass('qx-btn', 'qx-btn--primary')
    fireEvent.click(exportButton)
    expect(await screen.findByText(/4 项交换损失/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('4 项交换损失')
    expect(api.exportArchive).toHaveBeenCalledWith('task-1')
    expect(screen.queryByLabelText('选择 QDPX 文件')).not.toBeInTheDocument()

  })
})
