import { WritingHomePage } from './writing/WritingHomePage'
import { WritingDocumentPage } from './writing/WritingDocumentPage'
import { CoursesPage } from './courses/CoursesPage'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from 'react-router'
import { type ReactNode } from 'react'

import {
  AccountSettingsPage,
  AdminUsersPage,
  AdminOperationsPage,
  LoginPage,
  PasswordResetPage,
  RegisterPage,
  useAccount,
} from '../modules/account'
import { ResearchTaskNavigationRoute } from './ResearchTaskNavigationRoute'
import { ResearchAgentPage } from './agent/ResearchAgentPage'
import { NewResearchWorkspacePage } from './agent/NewResearchWorkspacePage'
import { ExistingResearchEntryPage } from './research/ExistingResearchEntryPage'
import { ResearchMaterialsPage } from './research/ResearchMaterialsPage'
import { ResearchProjectWorkspacePage } from './research-workspace/ResearchProjectWorkspacePage'
import { legacyResearchWorkspaceDestination } from './research-workspace/researchProjectWorkspaceModel'
import { FoundationPage } from './foundation/FoundationPage'
import { AppHomePage } from './home/AppHomePage'
import { HomeCompanion } from './home/HomeCompanion'
import { SharingPage, PublicDirectoryPage, SharedReaderPage, ConnectionsPage, SubscriptionPage } from './integrations/IntegrationPages'
import { LibrarySharedPage } from './courses/LibrarySharedPage'
import { LibraryGraphPage, LegacyLibraryKnowledgeRoute } from './courses/LibraryGraphPage'
import { OnboardingGate, WelcomeSetupPage } from './welcome/WelcomeSetupPage'
import { PageContent, PageShell, RailStateProvider } from './ui/PageShell'
import { ErrorState, LoadingState } from './ui/States'
import { RouteMotionSurface } from './route-motion'
import { SettingsModal } from './ui/SettingsModal'

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated' }
  | { status: 'anonymous' }
  | { status: 'expired' }
  | { status: 'error' }

type AppRoutesProps = {
  sessionState?: SessionState
}

function loginRedirect(value: string | null) {
  if (!value?.startsWith('/')) return '/app'

  const origin = 'https://everplain.local'
  try {
    const target = new URL(value, origin)
    return target.origin === origin
      ? `${target.pathname}${target.search}${target.hash}`
      : '/app'
  } catch {
    return '/app'
  }
}

function LoginRoute({ sessionState }: { sessionState: SessionState }) {
  const { search } = useLocation()
  const navigate = useNavigate()
  const account = useAccount()
  const destination = loginRedirect(new URLSearchParams(search).get('redirect'))

  if (sessionState.status === 'authenticated') {
    return <Navigate replace to={destination} />
  }

  return (
    <PageShell immersive>
      <LoginPage
        onLogin={account.login}
        onAuthenticated={() => navigate(destination, { replace: true })}
        registerHref={`/register?redirect=${encodeURIComponent(destination)}`}
        sessionExpired={sessionState.status === 'expired'}
      />
    </PageShell>
  )
}

function RegisterRoute({ sessionState }: { sessionState: SessionState }) {
  const { search } = useLocation()
  const navigate = useNavigate()
  const account = useAccount()
  const destination = loginRedirect(new URLSearchParams(search).get('redirect'))

  if (sessionState.status === 'authenticated') {
    return <Navigate replace to={destination} />
  }

  return (
    <PageShell immersive>
      <RegisterPage
        onRegister={account.register}
        onSendRegistrationCode={account.sendRegistrationCode}
        onAuthenticated={() => navigate(destination, { replace: true })}
        loginHref={`/login?redirect=${encodeURIComponent(destination)}`}
      />
    </PageShell>
  )
}

function NewResearchRoute({ userId }: { userId: string | null }) {
  return <NewResearchWorkspacePage userId={userId} />
}

function AccountSettingsRoute() {
  const location = useLocation()
  const account = useAccount()
  const navigate = useNavigate()
  const returnToPublicHome = () => navigate('/', { replace: true, state: { loggedOut: true } })
  const leaveAccount = () => {
    void account.logout().then(() => {
      window.setTimeout(returnToPublicHome, 0)
    }).catch(() => {
      returnToPublicHome()
    })
  }
  return (
    <SettingsModal userId={account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : undefined} accountName={account.sessionState.status === 'authenticated' ? account.sessionState.session.user.displayName || account.sessionState.session.user.email : undefined} onClose={() => location.state?.settingsBackground ? navigate(-1) : navigate('/app', { replace: true })}>
        <AccountSettingsPage
          onResetAgent={() => navigate('/welcome/setup')}
          onLogout={leaveAccount}
          onProfileUpdated={() => account.retrySession()}
          onSessionExpired={() => account.retrySession()}
          onAccountDeactivated={leaveAccount}
          onAccountDeleted={leaveAccount}
        />
    </SettingsModal>
  )
}

function AdminUsersRoute() {
  const navigate = useNavigate()
  return (
    <PageShell wide>
      <PageContent>
        <AdminUsersPage
          onForbidden={() => navigate('/settings', { replace: true })}
          onSessionExpired={() => navigate('/login?redirect=%2Fadmin%2Fusers', { replace: true })}
        />
      </PageContent>
    </PageShell>
  )
}

function AdminOperationsRoute() {
  const navigate = useNavigate()
  return (
    <PageShell wide>
      <PageContent>
        <AdminOperationsPage
          onForbidden={() => navigate('/settings', { replace: true })}
          onSessionExpired={() => navigate('/login?redirect=%2Fadmin%2Foperations', { replace: true })}
        />
        <button className="qx-btn qx-btn--ghost admin-ops-back" type="button" onClick={() => navigate('/admin/users')}>返回用户管理</button>
      </PageContent>
    </PageShell>
  )
}

function PasswordResetRoute() {
  const { token = '' } = useParams<{ token: string }>()
  return (
    <PageShell immersive>
      <PasswordResetPage token={token} loginHref="/login" />
    </PageShell>
  )
}

function LegacyResearchWorkspaceRedirect() {
  const location = useLocation()
  const destination = legacyResearchWorkspaceDestination(
    `${location.pathname}${location.search}${location.hash}`,
  )
  return destination
    ? <Navigate replace to={destination} />
    : <ErrorState detail="研究工作区地址无效。" />
}

function ResearchMaterialsRoute({ userId }: { userId: string | null }) {
  const location = useLocation()
  const destination = legacyResearchWorkspaceDestination(
    `${location.pathname}${location.search}${location.hash}`,
  )
  return destination
    ? <Navigate replace to={destination} />
    : <ResearchMaterialsPage userId={userId} />
}

function ProtectedRoute({
  sessionState,
  children,
}: {
  sessionState: SessionState
  children: ReactNode
}) {
  const location = useLocation()

  if (sessionState.status === 'loading') {
    return <LoadingState message="正在确认登录状态" />
  }
  if (sessionState.status === 'authenticated') return children
  if (sessionState.status === 'error') {
    return <ErrorState detail="暂时无法确认登录状态，请稍后重试。" />
  }

  const redirect = `${location.pathname}${location.search}${location.hash}`
  return <Navigate replace to={`/login?redirect=${encodeURIComponent(redirect)}`} />
}

export function AppRoutes({
  sessionState,
}: AppRoutesProps) {
  const account = useAccount()
  const location = useLocation()
  // Read outside Routes: its explicit background location reports POP to descendants.
  const entryNavigationType = useNavigationType()
  const resolvedSessionState: SessionState = sessionState ?? account.sessionState
  const settingsOpen = location.pathname === '/settings' && resolvedSessionState.status === 'authenticated'
  const settingsBackground = settingsOpen ? location.state?.settingsBackground : undefined
  const isLoggedOutNavigation = Boolean(
    location.state && typeof location.state === 'object' && 'loggedOut' in location.state,
  )
  const authenticatedUserId = account.sessionState.status === 'authenticated'
    ? account.sessionState.session.user.userId
    : null
  const authenticatedSessionId = account.sessionState.status === 'authenticated'
    ? account.sessionState.session.sessionId
    : null
  const protectedRoute = (element: ReactNode) => (
    <ProtectedRoute sessionState={resolvedSessionState}><OnboardingGate userId={authenticatedUserId}>{element}</OnboardingGate></ProtectedRoute>
  )
  const productHome = (
    <FoundationPage authenticated={resolvedSessionState.status === 'authenticated'} checkingSession={resolvedSessionState.status === 'loading'} />
  )

  return (
    <RailStateProvider>
      <HomeCompanion userId={authenticatedUserId} active={resolvedSessionState.status === 'authenticated' && (location.pathname === '/app' || settingsOpen)} />
      <RouteMotionSurface identityKey={authenticatedUserId}>
        <Routes location={settingsOpen ? settingsBackground ?? { pathname: '/app' } : location}>
      <Route
        path="/"
        element={resolvedSessionState.status === 'authenticated' && !isLoggedOutNavigation
          ? <Navigate replace to="/app" />
          : productHome}
      />
      <Route path="/welcome" element={productHome} />
      <Route path="/welcome/setup" element={protectedRoute(<WelcomeSetupPage userId={authenticatedUserId} />)} />
      <Route path="/sharing" element={protectedRoute(<SharingPage />)} />
      <Route path="/connections" element={protectedRoute(<ConnectionsPage />)} />
      <Route path="/subscription" element={protectedRoute(<SubscriptionPage />)} />
      <Route path="/shared/:libraryId" element={protectedRoute(<LibrarySharedPage />)} />
      <Route path="/discover" element={<PublicDirectoryPage />} />
      <Route path="/discover/:libraryId" element={<SharedReaderPage publicView />} />
      <Route path="/imports" element={protectedRoute(<Navigate replace to="/library?add=extension" />)} />
      <Route path="/my/graph" element={protectedRoute(<LibraryGraphPage userId={authenticatedUserId} />)} />
      <Route path="/app" element={protectedRoute(<AppHomePage />)} />
      <Route path="/agent" element={protectedRoute(<ResearchAgentPage userId={authenticatedUserId} introSessionId={authenticatedSessionId} entryNavigationType={entryNavigationType} />)} />
      <Route path="/writing" element={protectedRoute(<WritingHomePage userId={authenticatedUserId} />)} />
      <Route path="/writing/:documentId" element={protectedRoute(<WritingDocumentPage userId={authenticatedUserId} />)} />
      <Route path="/library" element={protectedRoute(<CoursesPage />)} />
      <Route path="/library/knowledge" element={protectedRoute(<LegacyLibraryKnowledgeRoute />)} />
      <Route path="/knowledge/*" element={<Navigate replace to="/library" />} />
      <Route path="/research/new" element={protectedRoute(<NewResearchRoute userId={authenticatedUserId} />)} />
      <Route path="/research/existing" element={protectedRoute(<ExistingResearchEntryPage />)} />
      <Route path="/research/tools" element={<Navigate to="/app" replace />} />
      <Route path="/courses/*" element={<Navigate replace to="/library" />} />
      <Route path="/research/materials" element={protectedRoute(<ResearchMaterialsRoute userId={authenticatedUserId} />)} />
      <Route
        path="/research/:task_id"
        element={protectedRoute(<ResearchTaskNavigationRoute>{null}</ResearchTaskNavigationRoute>)}
      />
      <Route
        path="/research/:task_id/workspace/:tool?"
        element={protectedRoute(<ResearchProjectWorkspacePage userId={authenticatedUserId} />)}
      />
      <Route
        path="/research/:task_id/phenomenon"
        element={protectedRoute(<LegacyResearchWorkspaceRedirect />)}
      />
      <Route
        path="/research/:task_id/match"
        element={protectedRoute(<LegacyResearchWorkspaceRedirect />)}
      />
      <Route
        path="/research/:task_id/framework"
        element={protectedRoute(<LegacyResearchWorkspaceRedirect />)}
      />
      <Route
        path="/research/:task_id/method"
        element={protectedRoute(<LegacyResearchWorkspaceRedirect />)}
      />
      <Route path="/login" element={<LoginRoute sessionState={resolvedSessionState} />} />
      <Route path="/register" element={<RegisterRoute sessionState={resolvedSessionState} />} />
      <Route path="/password-reset/:token" element={<PasswordResetRoute />} />
      <Route path="/my" element={protectedRoute(<Navigate replace to="/app?research=all" />)} />
      <Route path="/settings" element={protectedRoute(<AccountSettingsRoute />)} />
      <Route path="/admin/users" element={protectedRoute(<AdminUsersRoute />)} />
      <Route path="/admin/operations" element={protectedRoute(<AdminOperationsRoute />)} />
        </Routes>
      </RouteMotionSurface>
      {settingsOpen ? <Routes><Route path="/settings" element={protectedRoute(<AccountSettingsRoute />)} /></Routes> : null}
    </RailStateProvider>
  )
}

export function App() {
  return (
    <BrowserRouter useTransitions={false}>
      <AppRoutes />
    </BrowserRouter>
  )
}
