import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsPage, PublicDirectoryPage, SharedReaderPage, SharingPage, SubscriptionPage } from './IntegrationPages'
import * as api from '../../modules/product-integrations'

const identity = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('../../modules/account', () => ({ readAccountUsage: vi.fn(async () => ({ isUnlimited: false, remainingPercent: null, buckets: [] })), useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId } } } }) }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({children}: {children: ReactNode}) => <>{children}</>, PageContent: ({children}: {children: ReactNode}) => <>{children}</> }))
vi.mock('../../modules/product-integrations', () => Object.fromEntries(['directory','libraries','sharing','join','leave','publish','unpublish','connections','createConnection','revokeConnection','models','subscription','checkout','portal','publicLibrary','publicSource','library','privateSource'].map(name => [name, vi.fn()])))

const library = { id: 'kb', name: '自己的资料', description: '', viewer_access: 'owner', ready_document_count: 2, sharing_enabled: false, publication: null }
function setup(element: ReactNode, initial = '/sharing') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>{node}</MemoryRouter></QueryClientProvider>
  const result = render(wrap(element))
  return { ...result, rerenderPage: (node: ReactNode) => result.rerender(wrap(node)) }
}
afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks(); identity.userId = 'owner'
  vi.mocked(api.libraries).mockResolvedValue([library] as Awaited<ReturnType<typeof api.libraries>>)
  vi.mocked(api.connections).mockResolvedValue({ connections: [], mcp_endpoint: '/api/mcp' } as Awaited<ReturnType<typeof api.connections>>)
  vi.mocked(api.models).mockResolvedValue([])
  vi.mocked(api.directory).mockResolvedValue([])
  vi.mocked(api.subscription).mockResolvedValue({ available: false, unavailable_reason: '支付服务尚未配置', plans: [], subscription: null } as Awaited<ReturnType<typeof api.subscription>>)
})

describe('integration surfaces', () => {
  it('requires explicit confirmation to publish and allows closing without publishing', async () => {
    setup(<SharingPage />)
    fireEvent.click(await screen.findByRole('button', {name: /发布到公共主题/}))
    expect(screen.getByRole('button', {name: '确认公开当前资料'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: '关闭发布'}))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.publish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: /发布到公共主题/}))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', {name: '确认公开当前资料'}))
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('kb', expect.objectContaining({confirm_public_content: true})))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('restores focus after cancelling publication with Escape', async () => {
    setup(<SharingPage />)
    const trigger = await screen.findByRole('button', { name: /发布到公共主题/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: '关闭发布' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(api.publish).not.toHaveBeenCalled()
  })
  it('keeps invited libraries read-only while allowing the member to leave', async () => {
    vi.mocked(api.libraries).mockResolvedValue([{ ...library, viewer_access: 'reader' }] as Awaited<ReturnType<typeof api.libraries>>)
    setup(<SharingPage />)
    expect(await screen.findByText('加入的只读知识库')).toBeVisible()
    expect(screen.queryByRole('button', { name: /发布到公共主题/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开启只读邀请' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出知识库' }))
    await waitFor(() => expect(api.leave).toHaveBeenCalledWith('kb'))
  })
  it('searches the live public directory and distinguishes no matching result', async () => {
    vi.mocked(api.directory).mockResolvedValue([{ knowledge_base_id: 'public-1', title: '社会记忆', description: '公开阅读', document_count: 3, topics: ['记忆'] }] as Awaited<ReturnType<typeof api.directory>>)
    setup(<PublicDirectoryPage />, '/discover')
    expect(await screen.findByRole('link', { name: /社会记忆/ })).toHaveAttribute('href', '/discover/public-1')
    vi.mocked(api.directory).mockResolvedValue([])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索公共主题' }), { target: { value: '无结果' } })
    await waitFor(() => expect(api.directory).toHaveBeenLastCalledWith('无结果'))
    expect(await screen.findByRole('heading', { name: '没有找到“无结果”' })).toBeVisible()
  })
  it('keeps a rejected invitation visible for correction', async () => {
    vi.mocked(api.join).mockRejectedValue(new Error('邀请已失效'))
    setup(<SharingPage />)
    fireEvent.change(screen.getByLabelText('邀请链接或口令'), {target: {value: 'https://example.test/sharing?invite=expired'}})
    fireEvent.click(screen.getByRole('button', {name: '加入'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请已失效')
    expect(api.join).toHaveBeenCalledWith('expired')
    expect(screen.getByLabelText('邀请链接或口令')).toHaveValue('https://example.test/sharing?invite=expired')
  })
  it('does not create connections until a library is selected and clears secrets on identity change', async () => {
    vi.mocked(api.createConnection).mockResolvedValue({ secret: 'test-one-time-value' } as Awaited<ReturnType<typeof api.createConnection>>)
    const view = setup(<ConnectionsPage />, '/connections')
    expect(screen.getByRole('button', {name: '创建只读连接'})).toBeDisabled()
    fireEvent.change(screen.getByLabelText('连接名称'), {target: {value: '我的工具'}})
    fireEvent.click(await screen.findByRole('checkbox', {name: '自己的资料'}))
    fireEvent.click(screen.getByRole('button', {name: '创建只读连接'}))
    expect(await screen.findByLabelText('一次性连接密钥')).toHaveValue('test-one-time-value')
    expect(api.createConnection).toHaveBeenCalledTimes(1)
    identity.userId = 'another-owner'
    view.rerenderPage(<ConnectionsPage />)
    expect(screen.queryByLabelText('一次性连接密钥')).not.toBeInTheDocument()
  })
  it('clears selected source when navigating to another public library', async () => {
    vi.mocked(api.publicLibrary).mockImplementation(async id => ({ documents: [{ id: `${id}-doc`, filename: `${id}文章` }], publication: {title: id} }) as Awaited<ReturnType<typeof api.publicLibrary>>)
    vi.mocked(api.publicSource).mockResolvedValue({ document: {filename: 'a文章'}, segments: [{segment_id: 's', text: '第一份原文'}] } as Awaited<ReturnType<typeof api.publicSource>>)
    setup(<><Link to="/discover/b">换主题</Link><Routes><Route path="/discover/:libraryId" element={<SharedReaderPage publicView />} /></Routes></>, '/discover/a')
    fireEvent.click(await screen.findByRole('button', {name: 'a文章'}))
    await screen.findByText('第一份原文')
    fireEvent.click(screen.getByRole('link', {name: '换主题'}))
    await screen.findByRole('button', {name: 'b文章'})
    expect(screen.queryByText('第一份原文')).not.toBeInTheDocument()
    expect(screen.getByText('选择一份资料开始阅读。')).toBeInTheDocument()
    expect(api.publicSource).toHaveBeenCalledTimes(1)
  })
  it('does not fall back to public APIs when a shared source refuses access', async () => {
    vi.mocked(api.library).mockResolvedValue({ name: '受限资料', documents: [{ id: 'private-doc', filename: '私有文章' }] } as Awaited<ReturnType<typeof api.library>>)
    vi.mocked(api.privateSource).mockRejectedValue(new Error('访问已撤销'))
    setup(<Routes><Route path="/shared/:libraryId" element={<SharedReaderPage />} /></Routes>, '/shared/private-kb')
    fireEvent.click(await screen.findByRole('button', { name: '私有文章' }))
    expect(await screen.findByText('访问已撤销')).toBeVisible()
    expect(api.privateSource).toHaveBeenCalledWith('private-kb', 'private-doc')
    expect(api.publicSource).not.toHaveBeenCalled()
    expect(api.publicLibrary).not.toHaveBeenCalled()
  })
  it('uses the selected connection duration and hides a dismissed one-time secret', async () => {
    vi.mocked(api.createConnection).mockResolvedValue({ secret: 'one-time' } as Awaited<ReturnType<typeof api.createConnection>>)
    const started = Date.now()
    setup(<ConnectionsPage />, '/connections')
    fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '限定工具' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: '自己的资料' }))
    fireEvent.click(screen.getByRole('combobox', { name: '有效期' }))
    fireEvent.click(screen.getByRole('option', { name: '7 天' }))
    fireEvent.click(screen.getByRole('button', { name: '创建只读连接' }))
    await screen.findByLabelText('一次性连接密钥')
    const input = vi.mocked(api.createConnection).mock.calls[0][0]
    expect(input.library_ids).toEqual(['kb'])
    expect(new Date(input.expires_at).getTime()).toBeGreaterThanOrEqual(started + 7 * 86400000)
    expect(new Date(input.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400000)
    fireEvent.click(screen.getByRole('button', { name: '我已保存，关闭密钥' }))
    expect(screen.queryByLabelText('一次性连接密钥')).not.toBeInTheDocument()
  })
  it('rejects unsafe checkout destinations and recovers the action button', async () => {
    vi.mocked(api.subscription).mockResolvedValue({ available: true, unavailable_reason: null, plans: [{ id: 'plan', name: '研究方案', description: '真实方案' }], subscription: null } as Awaited<ReturnType<typeof api.subscription>>)
    vi.mocked(api.checkout).mockResolvedValue({ checkout_url: 'http://unsafe.example/checkout', session_id: 'session' })
    setup(<SubscriptionPage />, '/subscription')
    const checkout = await screen.findByRole('button', { name: '查看正式结算' })
    fireEvent.click(checkout)
    expect(await screen.findByRole('alert')).toHaveTextContent('支付服务返回了无效地址')
    expect(checkout).toBeEnabled()
    expect(api.checkout).toHaveBeenCalledWith('plan')
  })
  it('does not offer a live checkout when payments are unconfigured', async () => {
    setup(<SubscriptionPage />, '/subscription')
    expect(await screen.findByText('支付服务尚未配置')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: '查看正式结算'})).not.toBeInTheDocument()
    expect(api.checkout).not.toHaveBeenCalled()
  })
})
