import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, parsePath, useLocation, useNavigate } from 'react-router'
import type { PropsWithChildren, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { draftKey } from './writing/writingState'

const mocks = vi.hoisted(() => ({
  session: { status: 'authenticated', session: { user: { userId: 'route-owner' }, sessionId: 'route-session' } },
  retrySession: vi.fn(), profile: vi.fn(), document: vi.fn(), revisions: vi.fn(), agent: vi.fn(),
}))
vi.mock('../modules/account', () => ({
  useAccount: () => ({ sessionState: mocks.session, retrySession: mocks.retrySession }),
  LoginPage: () => <h1>登录</h1>, RegisterPage: () => null, PasswordResetPage: () => null,
  AccountSettingsPage: () => <h1>账户设置</h1>, AdminUsersPage: () => null, AdminOperationsPage: () => null,
}))
vi.mock('../modules/agent-profile', () => ({ readAgentProfile: mocks.profile }))
vi.mock('../modules/agent-avatar', () => ({ AgentAvatar: () => null, AgentLiquid: () => null, agentAvatarPresets: [] }))
vi.mock('../modules/writing', async importOriginal => ({
  ...await importOriginal<typeof import('../modules/writing')>(),
  writingApi: { document: mocks.document, revisions: mocks.revisions },
}))
vi.mock('../modules/shared-editor', () => ({
  SharedEditor: ({ markdown, onChange, statusContent }: { markdown: string; onChange(value: string): void; statusContent: ReactNode }) => <>
    <textarea aria-label="文稿正文" value={markdown} onChange={event => onChange(event.target.value)} />{statusContent}
  </>,
}))
vi.mock('./agent/ResearchAgentConversationPage', () => ({ ResearchAgentConversationPage: (props: unknown) => { mocks.agent(props); return null } }))
vi.mock('./ui/PageShell', () => ({
  PageShell: ({ children }: PropsWithChildren) => <main>{children}</main>,
  PageContent: ({ children }: PropsWithChildren) => <>{children}</>,
  RailStateProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}))
vi.mock('./ui/SettingsModal', () => ({ SettingsModal: ({ children, onClose }: PropsWithChildren<{ onClose(): void }>) => <div role="dialog">{children}<button onClick={onClose}>关闭设置</button></div> }))
vi.mock('./writing/WritingHomePage', () => ({ WritingHomePage: () => <h1>写作首页</h1> }))
vi.mock('./courses/CoursesPage', () => ({ CoursesPage: () => null }))
vi.mock('./imports/ImportsRedirect', () => ({ ImportsRedirect: () => null }))
vi.mock('./ResearchTaskNavigationRoute', () => ({ ResearchTaskNavigationRoute: () => null }))
vi.mock('../modules/api-costs', () => ({ AdminApiCostsPage: () => null }))
vi.mock('./agent/ResearchAgentPage', () => ({ ResearchAgentPage: () => null }))
vi.mock('./agent/NewResearchWorkspacePage', () => ({ NewResearchWorkspacePage: () => null }))
vi.mock('./research/ExistingResearchEntryPage', () => ({ ExistingResearchEntryPage: () => null }))
vi.mock('./research/ResearchMaterialsPage', () => ({ ResearchMaterialsPage: () => null }))
vi.mock('./research-workspace/ResearchProjectWorkspacePage', () => ({ ResearchProjectWorkspacePage: () => null }))
vi.mock('./foundation/FoundationPage', () => ({ FoundationPage: () => null }))
vi.mock('./docs/DocsPage', () => ({ DocsPage: () => null }))
vi.mock('./home/AppHomePage', () => ({ AppHomePage: () => null }))
vi.mock('./home/HomeCompanion', () => ({ HomeCompanion: () => null }))
vi.mock('./integrations/IntegrationPages', () => ({ SharingPage: () => null, PublicDirectoryPage: () => null, SharedReaderPage: () => null, ConnectionsPage: () => null, SubscriptionPage: () => null }))
vi.mock('./courses/LibrarySharedPage', () => ({ LibrarySharedPage: () => null }))
vi.mock('./courses/LibraryGraphPage', () => ({ LibraryGraphPage: () => null, LegacyLibraryKnowledgeRoute: () => null }))
vi.mock('./welcome/WelcomeSetupPage', async importOriginal => ({
  ...await importOriginal<typeof import('./welcome/WelcomeSetupPage')>(),
  WelcomeSetupPage: () => <h1>完成设置</h1>,
}))

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const initialPath = '/writing/doc-1?view=draft#paragraph'
const submission = { writingInstruction: '保留写作要求', writingSubmissionKey: 'submission-1' }
function Navigation() {
  const navigate = useNavigate(), location = useLocation()
  return <>
    <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>
    <button onClick={() => navigate('/writing')}>离开文稿</button>
    <button onClick={() => navigate('/writing/doc-2')}>另一篇文稿</button>
    <button onClick={() => navigate('/writing/doc-1')}>第一篇文稿</button>
    <button onClick={() => navigate('/writing/doc-1?view=revision#next', { state: location.state })}>更换查询参数</button>
    <button onClick={() => navigate('/settings', { state: { settingsBackground: location } })}>打开设置</button>
  </>
}

// Real AppRoutes, OnboardingGate, PageLoading, route motion, document page and
// global recovery. Only the chunk timing, API data and unrelated UI are synthetic.
async function mount({ status = 'authenticated', path = initialPath, profileReady = true }: { status?: SessionState['status']; path?: string; profileReady?: boolean } = {}) {
  const chunk = deferred(), load = vi.fn(async () => {
    await chunk.promise
    return vi.importActual<typeof import('./writing/WritingDocumentPage')>('./writing/WritingDocumentPage')
  })
  vi.doMock('./writing/WritingDocumentPage', load)
  const { AppRoutes } = await import('./App')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (profileReady) client.setQueryData(['agent-profile', 'route-owner'], { setup_completed: true })
  const view = render(<ErrorBoundary><MemoryRouter initialEntries={[{ ...parsePath(path), state: submission }]}>
    <QueryClientProvider client={client}><Navigation /><AppRoutes sessionState={{ status } as SessionState} /></QueryClientProvider>
  </MemoryRouter></ErrorBoundary>)
  return { chunk, load, client, view }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  mocks.profile.mockImplementation(() => new Promise(() => {}))
  mocks.document.mockImplementation(async (id: string) => ({ document_id: id, title: `标题 ${id}`, markdown: `正文 ${id}`, genre: 'essay', version: 1 }))
  mocks.revisions.mockResolvedValue({ items: [] })
})
afterEach(() => { cleanup(); vi.doUnmock('./writing/WritingDocumentPage'); vi.restoreAllMocks() })

describe('writing document route loading', () => {
  it.each(['anonymous', 'expired'] as const)('redirects %s access without importing the document page', async status => {
    const { load } = await mount({ status })
    expect(await screen.findByRole('heading', { name: '登录' })).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent(`/login?redirect=${encodeURIComponent(initialPath)}`)
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['loading', 'error'] as const)('keeps the %s session gate ahead of the document import', async status => {
    const { load } = await mount({ status })
    expect(screen.getByText(status === 'loading' ? '正在确认登录状态' : '暂时无法确认登录状态')).toBeVisible()
    if (status === 'error') { fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(mocks.retrySession).toHaveBeenCalledOnce() }
    expect(load).not.toHaveBeenCalled()
  })

  it('does not import the document for the writing home route', async () => {
    const { load } = await mount({ path: '/writing' })
    expect(screen.getByRole('heading', { name: '写作首页' })).toBeVisible()
    expect(load).not.toHaveBeenCalled()
  })

  it('waits for onboarding and redirects incomplete setup without importing the document', async () => {
    const { load, client } = await mount({ profileReady: false })
    expect(screen.getByText('正在准备你的空间')).toBeVisible()
    expect(load).not.toHaveBeenCalled()
    act(() => client.setQueryData(['agent-profile', 'route-owner'], { setup_completed: false }))
    expect(await screen.findByRole('heading', { name: '完成设置' })).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent('/welcome/setup')
    expect(load).not.toHaveBeenCalled()
  })

  it('keeps a failed onboarding check ahead of the document import', async () => {
    mocks.profile.mockRejectedValue(new Error('setup check failed'))
    const { load } = await mount({ profileReady: false })
    expect(await screen.findByText('setup check failed')).toBeVisible()
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
    expect(load).not.toHaveBeenCalled()
  })

  it('waits for onboarding permission, shows the standard loader, then opens the existing page with its state', async () => {
    const { chunk, load, client } = await mount({ profileReady: false })
    expect(load).not.toHaveBeenCalled()
    act(() => client.setQueryData(['agent-profile', 'route-owner'], { setup_completed: true }))
    expect(await screen.findByText('正在打开文稿…')).toBeVisible()
    expect(screen.getByRole('status', { busy: true })).toHaveAttribute('aria-busy', 'true')
    expect(load).toHaveBeenCalledOnce()
    expect(mocks.document).not.toHaveBeenCalled()
    await act(async () => chunk.resolve())
    expect(await screen.findByRole('textbox', { name: '文稿标题' })).toHaveValue('标题 doc-1')
    expect(screen.getByTestId('location')).toHaveTextContent(initialPath)
    expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'route-owner', writingDocumentId: 'doc-1', initialWritingMessage: { id: 'submission-1', text: '保留写作要求' } }))
  })

  it('does not resurrect the document when its pending chunk resolves after leaving', async () => {
    const { chunk, load } = await mount()
    expect(screen.getByText('正在打开文稿…')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '离开文稿' }))
    await act(async () => {
      chunk.resolve()
      // The unmounted page has no UI to await. Drain its import before the next
      // test resets modules, or this factory can repopulate the new mock cache.
      await vi.dynamicImportSettled()
    })
    expect(screen.getByRole('heading', { name: '写作首页' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: '文稿标题' })).not.toBeInTheDocument()
    expect(mocks.document).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledOnce()
  })

  it('uses the latest document parameter when navigation changes during chunk loading', async () => {
    const { chunk, load } = await mount()
    expect(screen.getByText('正在打开文稿…')).toBeVisible()
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
    expect(mocks.document).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '另一篇文稿' }))
    await act(async () => chunk.resolve())
    expect(await screen.findByRole('textbox', { name: '文稿标题' })).toHaveValue('标题 doc-2')
    expect(mocks.document.mock.calls.map(([id]) => id)).toEqual(['doc-2'])
    expect(load).toHaveBeenCalledOnce()
  })

  it('preserves a draft through query/hash changes and settings, and retains the page’s document-key reset', async () => {
    const { chunk, load } = await mount()
    await act(async () => chunk.resolve())
    const title = await screen.findByRole('textbox', { name: '文稿标题' })
    fireEvent.change(title, { target: { value: '未保存标题' } })
    fireEvent.change(screen.getByRole('textbox', { name: '文稿正文' }), { target: { value: '未保存正文' } })
    fireEvent.click(screen.getByRole('button', { name: '更换查询参数' }))
    expect(screen.getByRole('textbox', { name: '文稿标题' })).toBe(title)
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('textbox', { name: '文稿标题' })).toBe(title)
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    expect(screen.getByRole('textbox', { name: '文稿正文' })).toHaveValue('未保存正文')
    expect(mocks.document).toHaveBeenCalledOnce()
    expect(mocks.revisions).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem(draftKey('route-owner', 'doc-1'))!)).toMatchObject({ title: '未保存标题', markdown: '未保存正文', version: 1 })
    fireEvent.click(screen.getByRole('button', { name: '另一篇文稿' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文稿标题' })).toHaveValue('标题 doc-2'))
    expect(screen.getByRole('textbox', { name: '文稿标题' })).not.toBe(title)
    fireEvent.click(screen.getByRole('button', { name: '第一篇文稿' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文稿标题' })).toHaveValue('未保存标题'))
    expect(screen.getByRole('textbox', { name: '文稿正文' })).toHaveValue('未保存正文')
    expect(mocks.document.mock.calls.map(([id]) => id)).toEqual(['doc-1', 'doc-2', 'doc-1'])
    expect(load).toHaveBeenCalledOnce()
  })

  it('routes a rejected chunk to the existing reload/home recovery instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { chunk } = await mount()
    await act(async () => chunk.reject(new Error('synthetic chunk failure')))
    expect(await screen.findByRole('heading', { name: '页面暂时打不开' })).toBeVisible()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
    expect(screen.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/welcome')
    expect(mocks.document).not.toHaveBeenCalled()
  })
})
