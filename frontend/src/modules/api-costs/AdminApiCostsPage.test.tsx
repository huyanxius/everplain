import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiCostsPage } from './AdminApiCostsPage'
import { ApiCostsRequestError, type ApiCostMetrics, type ApiCostReport, type ApiCostsApi } from './apiCostsModel'

const metrics: ApiCostMetrics = {
  attemptCount: 6, confirmedUsageAttempts: 3, confirmedTokenAttempts: 2, unpricedAttempts: 1,
  unknownUsageAttempts: 2, notSentAttempts: 1, activeReservedAttempts: 1, pendingUnknownAttempts: 1,
  missingTokenAttempts: 1, unverifiedProcurementAttempts: 5,
  inputTokens: 100, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: 10,
  cacheReadReportedAttempts: 1, cacheWriteReportedAttempts: 0, reasoningReportedAttempts: 2,
  referenceCostPico: '1234567890123', activeReservedCostPico: '5000000000000', pendingUnknownCostPico: '7000000000000', actualProcurementCostPico: null,
}
const makeReport = (overrides: Partial<ApiCostReport> = {}): ApiCostReport => ({
  startDate: '2026-09-06', endDate: '2026-10-05', groupBy: 'model', summary: metrics,
  items: [{ groupValue: 'synthetic-model', ...metrics }], totalGroups: 1, nextCursor: null, generatedAt: '2026-10-05T19:00:00Z', ...overrides,
})
function apiReturning(report = makeReport()) { return { read: vi.fn<ApiCostsApi['read']>().mockResolvedValue(report) } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: '成本统计筛选' }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Admin API costs read-only report', () => {
  it('shows initial loading then genuine reference, unknown, reserved and unverified values separately', async () => {
    const pending = deferred<ApiCostReport>()
    const api = { read: vi.fn<ApiCostsApi['read']>().mockReturnValue(pending.promise) }
    render(<AdminApiCostsPage api={api} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在读取')
    expect(screen.getByRole('button', { name: '刷新统计' })).toBeDisabled()
    await act(async () => pending.resolve(makeReport()))
    const summary = screen.getByRole('region', { name: '筛选范围汇总' })
    expect(within(summary).getByText('USD 1.234567890123')).toBeVisible()
    expect(within(summary).getByText('未核实')).toBeVisible()
    expect(within(summary).getByText('130')).toBeVisible()
    expect(within(summary).queryByText('180')).not.toBeInTheDocument()
    expect(within(summary).getByText('缓存读取 40（部分报告） · 缓存写入 未报告')).toBeVisible()
    expect(within(summary).getByText('推理 10')).toBeVisible()
    expect(within(summary).getByText('USD 5')).toBeVisible()
    expect(within(summary).getByText('USD 7')).toBeVisible()
    expect(screen.getByText(/缺少可核验凭证时，不能据此推算实付金额/)).toBeVisible()
    expect(screen.getByText(/token 总量只计算输入 \+ 输出/)).toBeVisible()
    expect(screen.getByRole('rowheader', { name: 'synthetic-model' })).toBeVisible()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('applies all exact filters, grouping and page size only on explicit submit', async () => {
    const api = apiReturning()
    render(<AdminApiCostsPage api={api} />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('开始日期（UTC，含）'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('结束日期（UTC，含）'), { target: { value: '2026-10-02' } })
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: ' test-model ' } })
    fireEvent.change(screen.getByLabelText('供应商域名（精确匹配）'), { target: { value: ' provider.example ' } })
    fireEvent.change(screen.getByLabelText('调用端点 ID（精确匹配）'), { target: { value: ' ep-a ' } })
    fireEvent.change(screen.getByLabelText('用户 ID（精确匹配）'), { target: { value: ' user-a ' } })
    fireEvent.click(screen.getByRole('combobox', { name: '分组方式' }))
    fireEvent.click(screen.getByRole('option', { name: '用户 ID' }))
    fireEvent.click(screen.getByRole('combobox', { name: '每页分组数' }))
    fireEvent.click(screen.getByRole('option', { name: '50' }))
    expect(api.read).toHaveBeenCalledTimes(1)
    submit()
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(api.read.mock.calls[1][0]).toEqual({ startDate: '2026-10-01', endDate: '2026-10-02', model: 'test-model', providerHost: 'provider.example', endpointId: 'ep-a', userId: 'user-a', groupBy: 'user_id', cursor: 0, limit: 50 })
    const applied = screen.getByText('精确匹配：模型 test-model · 供应商 provider.example · 端点 ep-a · 用户 user-a')
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: 'unsaved-model' } })
    expect(applied).toHaveTextContent('模型 test-model')
    expect(applied).not.toHaveTextContent('unsaved-model')
    expect(api.read).toHaveBeenCalledTimes(2)
  })

  it('paginates with server cursors while retaining the full-range summary and resets on filtering', async () => {
    const first = makeReport({ totalGroups: 26, nextCursor: 25 })
    const second = makeReport({ totalGroups: 26, items: [{ ...metrics, attemptCount: 1, groupValue: 'second-page-model' }] })
    const api = { read: vi.fn<ApiCostsApi['read']>().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(first) }
    render(<AdminApiCostsPage api={api} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('rowheader', { name: 'second-page-model' })
    expect(api.read.mock.calls[1][0].cursor).toBe(25)
    expect(screen.getByText('共 26 个分组 · 当前 26–26')).toBeVisible()
    expect(within(screen.getByRole('region', { name: '筛选范围汇总' })).getByText('USD 1.234567890123')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await screen.findByRole('rowheader', { name: 'synthetic-model' })
    expect(api.read.mock.calls[2][0].cursor).toBe(0)
    api.read.mockResolvedValueOnce(second)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('rowheader', { name: 'second-page-model' })
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: 'new-model' } })
    submit()
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(5))
    expect(api.read.mock.calls[4][0].cursor).toBe(0)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('rejects reversed and overlong inclusive date ranges without a new request', async () => {
    const api = apiReturning()
    render(<AdminApiCostsPage api={api} />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('开始日期（UTC，含）'), { target: { value: '2026-10-06' } })
    fireEvent.change(screen.getByLabelText('结束日期（UTC，含）'), { target: { value: '2026-10-05' } })
    submit()
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期')
    fireEvent.change(screen.getByLabelText('开始日期（UTC，含）'), { target: { value: '2024-01-01' } })
    submit()
    expect(screen.getByRole('alert')).toHaveTextContent('最多查询 366 天')
    expect(api.read).toHaveBeenCalledTimes(1)
  })

  it('shows an honest empty state with procurement still unverified', async () => {
    const api = apiReturning(makeReport({ items: [], totalGroups: 0 }))
    render(<AdminApiCostsPage api={api} />)
    expect(await screen.findByRole('heading', { name: '没有符合条件的账本记录' })).toBeVisible()
    expect(screen.getByText('未核实')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('recovers from a network failure by retrying the current submitted query', async () => {
    const api = { read: vi.fn<ApiCostsApi['read']>().mockRejectedValueOnce(new Error('network')).mockResolvedValue(makeReport()) }
    render(<AdminApiCostsPage api={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('table')
    expect(api.read.mock.calls[1][0]).toEqual(api.read.mock.calls[0][0])
  })

  it.each([401, 403])('handles the %i permission boundary without displaying a report', async status => {
    const api = { read: vi.fn<ApiCostsApi['read']>().mockRejectedValue(new ApiCostsRequestError('denied', status)) }
    const onForbidden = vi.fn()
    const onSessionExpired = vi.fn()
    render(<AdminApiCostsPage api={api} onForbidden={onForbidden} onSessionExpired={onSessionExpired} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? '登录已过期' : '仅管理员')
    expect(status === 401 ? onSessionExpired : onForbidden).toHaveBeenCalledOnce()
    expect(status === 401 ? onForbidden : onSessionExpired).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('deduplicates repeated submit and refresh while the same request is pending', async () => {
    const pending = deferred<ApiCostReport>()
    const refresh = deferred<ApiCostReport>()
    const api = { read: vi.fn<ApiCostsApi['read']>().mockReturnValueOnce(pending.promise).mockReturnValueOnce(refresh.promise) }
    render(<AdminApiCostsPage api={api} />)
    submit(); submit()
    expect(api.read).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(makeReport()))
    const button = screen.getByRole('button', { name: '刷新统计' })
    fireEvent.click(button); fireEvent.click(button)
    expect(api.read).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await act(async () => refresh.resolve(makeReport()))
    expect(screen.getByRole('table')).toBeVisible()
  })

  it('ignores out-of-order results when newer filters replace a pending request', async () => {
    const old = deferred<ApiCostReport>()
    const latest = deferred<ApiCostReport>()
    const api = { read: vi.fn<ApiCostsApi['read']>().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise) }
    render(<AdminApiCostsPage api={api} />)
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: 'latest-model' } })
    submit()
    expect(api.read.mock.calls[0][1]?.aborted).toBe(true)
    await act(async () => latest.resolve(makeReport({ items: [{ ...metrics, groupValue: 'latest-model' }] })))
    await act(async () => old.resolve(makeReport({ items: [{ ...metrics, groupValue: 'outdated-model' }] })))
    expect(screen.getByRole('rowheader', { name: 'latest-model' })).toBeVisible()
    expect(screen.queryByRole('rowheader', { name: 'outdated-model' })).not.toBeInTheDocument()
  })

  it('ignores a stale 401 and aborts on unmount without invoking auth callbacks', async () => {
    const old = deferred<ApiCostReport>()
    const latest = deferred<ApiCostReport>()
    const api = { read: vi.fn<ApiCostsApi['read']>().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise) }
    const onSessionExpired = vi.fn()
    const { unmount } = render(<AdminApiCostsPage api={api} onSessionExpired={onSessionExpired} />)
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: 'newer' } })
    submit()
    await act(async () => old.reject(new ApiCostsRequestError('expired', 401)))
    expect(onSessionExpired).not.toHaveBeenCalled()
    unmount()
    expect(api.read.mock.calls[1][1]?.aborted).toBe(true)
    await act(async () => latest.reject(new ApiCostsRequestError('expired', 401)))
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('does not refetch for freshly rendered navigation callbacks', async () => {
    const api = apiReturning()
    const { rerender } = render(<AdminApiCostsPage api={api} onForbidden={() => undefined} />)
    await screen.findByRole('table')
    rerender(<AdminApiCostsPage api={api} onForbidden={() => undefined} />)
    expect(api.read).toHaveBeenCalledOnce()
  })

  it('refreshes the applied filters rather than unsaved form edits', async () => {
    const api = apiReturning()
    render(<AdminApiCostsPage api={api} />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('模型（精确匹配）'), { target: { value: 'unsaved-model' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新统计' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(api.read.mock.calls[1][0].model).toBe('')
  })
})
