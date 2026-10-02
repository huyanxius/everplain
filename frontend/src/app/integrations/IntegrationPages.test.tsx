import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsPage, SharedReaderPage, SharingPage } from './IntegrationPages'
import * as api from '../../modules/product-integrations'

const identity = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('../../modules/account', () => ({ useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: identity.userId } } } }) }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({children}: {children: ReactNode}) => <>{children}</>, PageContent: ({children}: {children: ReactNode}) => <>{children}</> }))
vi.mock('../../modules/product-integrations', () => Object.fromEntries(['libraries','sharing','join','leave','publish','unpublish','connections','createConnection','revokeConnection','models','subscription','checkout','portal','publicLibrary','publicSource','library','privateSource'].map(name => [name, vi.fn()])))

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
})
