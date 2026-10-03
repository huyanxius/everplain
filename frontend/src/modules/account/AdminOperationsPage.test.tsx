import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOperationsPage } from './AdminOperationsPage'
import { accountManagementApi } from './accountManagementApi'

vi.mock('./accountManagementApi', () => ({ accountManagementApi: { getRuntimeSettings: vi.fn(), updateRuntimeSettings: vi.fn() } }))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(accountManagementApi.getRuntimeSettings!).mockResolvedValue({ model: 'configured-model', reasoningEffort: 'high', providerBaseUrl: 'https://provider.example/v1', restartRequired: true })
  vi.mocked(accountManagementApi.updateRuntimeSettings!).mockResolvedValue({ model: 'new-model', reasoningEffort: 'medium', providerBaseUrl: 'https://provider.example/v1', restartRequired: true })
})

describe('AdminOperationsPage', () => {
  it('keeps the provider read-only and submits the trimmed model with the real reload action', async () => {
    render(<AdminOperationsPage />)
    const model = await screen.findByDisplayValue('configured-model')
    expect(screen.getByText('https://provider.example/v1')).toBeVisible()
    expect(screen.queryByDisplayValue('https://provider.example/v1')).not.toBeInTheDocument()
    expect(screen.getByText('保存后将重新加载服务配置。下一次请求将使用新配置。')).toBeVisible()
    fireEvent.change(model, { target: { value: '  new-model  ' } })
    fireEvent.click(screen.getByRole('combobox', { name: '思考强度' }))
    fireEvent.click(screen.getByRole('option', { name: 'medium' }))
    expect(accountManagementApi.updateRuntimeSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '应用并重载服务' }))
    await waitFor(() => expect(accountManagementApi.updateRuntimeSettings).toHaveBeenCalledWith({ model: 'new-model', reasoningEffort: 'medium' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已写入服务器配置，服务正在重载')
  })

  it('keeps failed edits available and routes denied configuration writes through the permission boundary', async () => {
    vi.mocked(accountManagementApi.updateRuntimeSettings!).mockRejectedValue({ status: 403 })
    const onForbidden = vi.fn()
    render(<AdminOperationsPage onForbidden={onForbidden} />)
    const model = await screen.findByDisplayValue('configured-model')
    fireEvent.change(model, { target: { value: 'another-model' } })
    fireEvent.click(screen.getByRole('button', { name: '应用并重载服务' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写入失败，服务器配置未改变')
    expect(onForbidden).toHaveBeenCalledOnce()
    expect(model).toHaveValue('another-model')
    expect(screen.getByRole('button', { name: '应用并重载服务' })).toBeEnabled()
  })

  it('reports an expired session during initial configuration reading', async () => {
    vi.mocked(accountManagementApi.getRuntimeSettings!).mockRejectedValue({ status: 401 })
    const onSessionExpired = vi.fn()
    render(<AdminOperationsPage onSessionExpired={onSessionExpired} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取服务器配置')
    expect(onSessionExpired).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '应用并重载服务' })).toBeDisabled()
  })
})
