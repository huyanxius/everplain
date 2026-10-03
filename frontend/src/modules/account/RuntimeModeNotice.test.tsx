import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAccountSystemHealth } from './accountManagementApi'
import type { AccountSystemHealth } from './accountManagementModels'
import { RuntimeModeNotice } from './RuntimeModeNotice'

vi.mock('./accountManagementApi', () => ({ getAccountSystemHealth: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('RuntimeModeNotice', () => {
  it('clearly labels mock AI while preserving real authentication messaging', async () => {
    vi.mocked(getAccountSystemHealth).mockResolvedValue({ runtimeMode: 'mock' } as AccountSystemHealth)
    render(<RuntimeModeNotice />)
    expect(await screen.findByText('模型 API 未配置 · 模型响应为模拟')).toBeVisible()
    expect(screen.getByText(/注册、登录与邮箱验证仍走真实流程；邮件未接通时无法注册/)).toBeVisible()
  })
  it('does not label a live runtime as mock', async () => {
    vi.mocked(getAccountSystemHealth).mockResolvedValue({ runtimeMode: 'base' } as AccountSystemHealth)
    const { container } = render(<RuntimeModeNotice />)
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
  it('does not claim real AI or mock success when health fails', async () => {
    vi.mocked(getAccountSystemHealth).mockRejectedValue(new Error('offline'))
    render(<RuntimeModeNotice />)
    expect(await screen.findByText(/暂时无法确认模型/)).toBeVisible()
    expect(screen.queryByText('模型 API 未配置 · 模型响应为模拟')).not.toBeInTheDocument()
  })
})
