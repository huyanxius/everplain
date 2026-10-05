import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPublicProductCatalog, type PublicProductCatalog } from '../../modules/product-docs'
import { DocsPage } from './DocsPage'

vi.mock('../../modules/product-docs', async importOriginal => ({ ...await importOriginal<typeof import('../../modules/product-docs')>(), readPublicProductCatalog: vi.fn() }))
const exampleCatalog: PublicProductCatalog = {
  plans: [
    { id: 'plus', name: 'Plus', description: '适合日常使用', price_cny_fen: 4900, weekly_points: 50, period_days: 28, period_points: 200 },
    { id: 'pro', name: 'PRO', description: '', price_cny_fen: 9900, weekly_points: 100, period_days: 28, period_points: 400 },
    { id: 'max', name: 'Max', description: '', price_cny_fen: 24900, weekly_points: 250, period_days: 28, period_points: 1000 },
  ],
  free_weekly_points: 30, reset_days: 7, top_up_points: 50, top_up_price_cny_fen: 1500,
  payments_enabled: false, runtime_mode: 'base',
  agent_models: [
    { model_id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoning_efforts: ['none', 'low', 'medium', 'high'], default_reasoning_effort: 'medium' },
    { model_id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoning_efforts: [], default_reasoning_effort: null },
  ],
}
const clients: QueryClient[] = []
function Location() { const location = useLocation(); return <output aria-label="当前地址">{location.pathname + location.hash}</output> }
function renderDocs(catalog?: PublicProductCatalog, path = '/docs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  if (catalog) client.setQueryData(['public-product-catalog'], catalog)
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><DocsPage /><Location /></MemoryRouter></QueryClientProvider>) }
}
beforeEach(() => { vi.mocked(readPublicProductCatalog).mockResolvedValue(exampleCatalog) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('public product documentation', () => {
  it('renders unauthenticated documentation with prices before usage and real catalog models', () => {
    const { container } = renderDocs(exampleCatalog)
    expect(screen.getByRole('heading', { level: 1, name: '把资料用起来。' })).toBeVisible()
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
    const sections = [...container.querySelectorAll('main > section')].map(section => section.id)
    expect(sections.indexOf('pricing')).toBeLessThan(sections.indexOf('free'))
    expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })).not.toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' }))
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: 'Gemini 3.5 Flash' }))
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择模型：Gemini 3.5 Flash' })).toHaveFocus()
    expect(readPublicProductCatalog).not.toHaveBeenCalled()
  })
  it('uses current plan and quota data for every price and estimate, with no checkout controls', () => {
    renderDocs({ ...exampleCatalog, free_weekly_points: 60, reset_days: 14, top_up_price_cny_fen: 1800, plans: exampleCatalog.plans.map(plan => ({ ...plan, period_days: 56 })) })
    expect(screen.getByRole('cell', { name: '1,272 次' })).toBeVisible()
    expect(screen.getByText('每 14 天 60 积分')).toBeVisible()
    expect(screen.getByText(/充值包：¥18.00 \/ 50 积分/)).toBeVisible()
    expect(screen.getByText(/当前未接入真实支付/)).toBeVisible()
    expect(screen.getByText(/共 200 积分/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /购买|充值|支付/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看账户订阅与额度' })).toHaveAttribute('href', '/subscription')
    expect(screen.getByText(/不代表平台按官方标价采购/)).toBeInTheDocument()
    expect(screen.getByText(/tokens 不等于中文字数/)).toBeVisible()
  })
  it('publishes reference sources, assumptions and cache / long-context exceptions', () => {
    renderDocs(exampleCatalog)
    const priceTable = screen.getByRole('table', { name: '标准 API 输入、缓存读取与输出价格' })
    expect(within(priceTable).getAllByRole('link')).toHaveLength(5)
    expect(within(priceTable).getByRole('link', { name: /GPT 6 Luna/ })).toHaveAttribute('href', 'https://developers.openai.com/api/docs/models/gpt-6-luna')
    expect(screen.getByText('2026-10-05')).toHaveAttribute('datetime', '2026-10-05')
    fireEvent.click(screen.getByText('缓存、长上下文与时段说明'))
    expect(screen.getByText(/输入超过 272K/)).toBeVisible()
    expect(screen.getByText(/周一至周五北京时间/)).toBeVisible()
    expect(screen.getByText(/示例请求次数仅供估算/)).toBeVisible()
  })
  it('shows two authentic full-size product images with links to the unchanged originals', () => {
    const { container } = renderDocs(exampleCatalog)
    const images = [...container.querySelectorAll<HTMLImageElement>('.ep-docs-screenshot img')]
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect(image).toHaveAttribute('width', '1440')
      expect(image).toHaveAttribute('height', '1000')
      expect(image).toHaveAttribute('loading', 'lazy')
      expect(image.closest('a')).toHaveAttribute('href', image.getAttribute('src'))
      expect(image.closest('a')).toHaveAttribute('target', '_blank')
      expect(image.closest('a')).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(screen.getByRole('img', { name: /三份演示笔记已保存.*等待知识整理与语义索引/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /写作工作区真实界面.*导出 Markdown/ })).toBeVisible()
    expect(screen.getByRole('link', { name: '放大知识库原图，在新窗口打开' })).toBeVisible()
    expect(screen.getByRole('link', { name: '放大写作文稿原图，在新窗口打开' })).toBeVisible()
  })
  it('keeps product guidance concise while retaining one AI caution and pricing assumptions', () => {
    renderDocs(exampleCatalog)
    expect(screen.getAllByText(/AI 可能出错/)).toHaveLength(1)
    expect(screen.queryByText(/列出型号不代表每一次调用/)).not.toBeInTheDocument()
    expect(screen.queryByText(/界面共用纸面|设计变量|没有读取到额度时/)).not.toBeInTheDocument()
    expect(screen.getByText(/总输出包含|思考／推理 tokens 会计入总输出/)).toBeVisible()
    expect(screen.getByText(/示例无缓存、无工具、无搜索/)).toBeVisible()
  })
  it('does not invent selectable models when the server has no choices', () => {
    renderDocs({ ...exampleCatalog, agent_models: [], runtime_mode: 'mock' })
    expect(screen.getByText(/没有提供可选对话模型/)).toBeVisible()
    expect(screen.getByText(/当前服务处于演示模式/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /选择模型/ })).not.toBeInTheDocument()
  })
  it('keeps guidance readable while loading, then renders returned data', async () => {
    let resolve!: (value: PublicProductCatalog) => void
    vi.mocked(readPublicProductCatalog).mockReturnValue(new Promise(done => { resolve = done }))
    renderDocs()
    expect(screen.getByText('正在读取当前模型与订阅目录…')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('heading', { name: '先看官方价格' })).toBeVisible()
    expect(screen.queryByRole('cell', { name: '636 次' })).not.toBeInTheDocument()
    resolve(exampleCatalog)
    expect(await screen.findByRole('cell', { name: '636 次' })).toBeVisible()
  })
  it('shows a retryable error without fabricated allowance or plan prices', async () => {
    vi.mocked(readPublicProductCatalog).mockRejectedValue(new Error('offline'))
    renderDocs()
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('暂时无法读取当前目录')
    expect(screen.queryByRole('cell', { name: '636 次' })).not.toBeInTheDocument()
    vi.mocked(readPublicProductCatalog).mockResolvedValue(exampleCatalog)
    fireEvent.click(screen.getByRole('button', { name: '重试目录' }))
    expect(await screen.findByRole('cell', { name: '636 次' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('retains the last successful catalog after a failed refresh and labels its age', async () => {
    const { client } = renderDocs(exampleCatalog)
    vi.mocked(readPublicProductCatalog).mockRejectedValue(new Error('offline'))
    void client.refetchQueries({ queryKey: ['public-product-catalog'] })
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('保留上次成功读取的内容')
    expect(screen.getByRole('cell', { name: '636 次' })).toBeVisible()
    expect(screen.getByText(/目录上次读取/)).toBeVisible()
    expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })).toBeVisible()
  })
  it('an unsupported preview option does not hide other models, plans or documentation', () => {
    renderDocs({ ...exampleCatalog, agent_models: [...exampleCatalog.agent_models, { model_id: 'future', label: '新型号', reasoning_efforts: ['future-effort'], default_reasoning_effort: 'future-effort' }] })
    expect(screen.getByText(/部分新型号暂不能/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Plus' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '636 次' })).toBeVisible()
  })
  it('previews the actual avatar component without saving or making requests', () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    renderDocs(exampleCatalog)
    const avatars = screen.getByRole('group', { name: '预览角色头像' })
    expect(within(avatars).getAllByRole('button')).toHaveLength(7)
    fireEvent.click(within(avatars).getByRole('button', { name: '预览念头像' }))
    expect(within(avatars).getByRole('button', { name: '预览念头像' })).toHaveAttribute('aria-pressed', 'true')
    expect(persist).not.toHaveBeenCalled()
    expect(readPublicProductCatalog).not.toHaveBeenCalled()
  })
  it('supports deep links without redirecting to login', async () => {
    renderDocs(exampleCatalog, '/docs#free')
    await waitFor(() => expect(screen.getByLabelText('当前地址')).toHaveTextContent('/docs#free'))
    expect(screen.getByRole('link', { name: 'Free 能用多少' })).toHaveAttribute('aria-current', 'location')
  })
})
