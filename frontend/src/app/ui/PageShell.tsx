import { usePresence } from '../../ui/usePresence'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, PropsWithChildren, ReactNode, Ref, SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, useLocation } from 'react-router'
import { NavIcon } from './NavIcon'

import { listMyResearchViaApi, readAccountProfile, useAccount } from '../../modules/account'
import { listAgentConversations } from '../../modules/research-agent'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { NetworkStatusNotice } from './NetworkStatusNotice'
import { ApplicationFrame } from '../application-frame/ApplicationFrame'
import { AccountMenu } from './AccountMenu'
import { useSidebarLayoutPreference } from '../../styles/sidebarLayoutPreference'
import { useSidebarRecordsOpen } from '../../styles/sidebarRecordsPreference'
import { useDrawerPresence } from './useDrawerPresence'

type PageTitleProps = { eyebrow?: string; title: string; lede?: string }
type RailState = { collapsed: boolean; setCollapsed: Dispatch<SetStateAction<boolean>> }
const RailStateContext = createContext<RailState | null>(null)

/** 折叠状态位于路由之上，切页时不丢。 */
export function RailStateProvider({ children }: PropsWithChildren) {
  const [collapsed, setCollapsed] = useState(false)
  return <RailStateContext.Provider value={{ collapsed, setCollapsed }}>{children}</RailStateContext.Provider>
}

function ProductMark() { return <span className="application-brand__mark" aria-hidden="true" /> }

function RecentConversations({ userId }: { userId: string }) {
  const { text } = useAppLocale()
  const conversations = useQuery({
    queryKey: ['agent', 'navigation-conversations', userId],
    queryFn: ({ signal }) => listAgentConversations(signal), staleTime: 30_000,
  })
  return <details className="application-history" open>
    <summary className="qx-item application-history__heading"><span>{text('最近对话', 'Recent conversations')}</span><NavIcon name="chevron" className="application-group-chevron" /></summary>
    {conversations.isPending ? <p className="qx-meta application-history__hint" role="status">{text('正在读取', 'Loading')}</p> : null}
    {conversations.isError ? <button type="button" className="qx-btn qx-btn--ghost" onClick={() => void conversations.refetch()}>{text('重试读取对话', 'Retry conversations')}</button> : null}
    {(conversations.data ?? []).slice(0, 20).map((conversation) => {
      const query = new URLSearchParams({ conversation_id: conversation.conversation_id })
      if (conversation.task_id) query.set('task_id', conversation.task_id)
      return <Link className="qx-item application-history__conversation" key={conversation.conversation_id} to={`/agent?${query}`} title={conversation.title}><span>{conversation.title || text('新对话', 'New conversation')}</span></Link>
    })}
  </details>
}

function RecentResearch({ userId }: { userId: string }) {
  const { text } = useAppLocale()
  const research = useQuery({ queryKey: ['account', 'research-tasks', userId], queryFn: listMyResearchViaApi, staleTime: 30_000 })
  const items = [...research.data ?? []].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)).slice(0, 8)
  return <details className="application-history" open>
    <summary className="qx-item application-history__heading"><span>{text('最近研究', 'Recent research')}</span><NavIcon name="chevron" className="application-group-chevron" /></summary>
    {research.isPending && <p className="qx-meta application-history__hint" role="status">{text('正在读取', 'Loading')}</p>}
    {research.isError && <button type="button" className="qx-btn qx-btn--ghost" onClick={() => void research.refetch()}>{text('重试读取研究', 'Retry research')}</button>}
    {items.map(item => <Link className="qx-item application-history__conversation" key={item.taskId} to={item.retry?.method === 'GET' ? item.retry.href : item.entryPath} title={item.projectTitle || item.phenomenonSummary}><span>{item.projectTitle?.trim() || item.phenomenonSummary}</span></Link>)}
    {!research.isPending && !research.isError && !items.length && <p className="qx-meta application-history__hint">{text('还没有研究记录', 'No research yet')}</p>}
  </details>
}

function AdminNavigation({ userId }: { userId: string }) {
  const { text } = useAppLocale()
  const account = useQuery({ queryKey: ['account', 'profile', userId], queryFn: readAccountProfile, staleTime: 30_000 })
  if (account.data?.role !== 'admin') return null
  return <nav className="application-navigation" aria-label={text('管理导航', 'Administration')}>
    <NavLink className="qx-item" to="/admin/users" title={text('用户管理', 'Users')}><NavIcon name="users" /><span className="application-navigation__label">{text('用户管理', 'Users')}</span></NavLink>
    <NavLink className="qx-item" to="/admin/operations" title={text('运行管理', 'Operations')}><NavIcon name="shield" /><span className="application-navigation__label">{text('运行管理', 'Operations')}</span></NavLink>
    <NavLink className="qx-item" to="/admin/api-costs" title={text('API 成本统计', 'API costs')}><NavIcon name="card" /><span className="application-navigation__label">{text('API 成本统计', 'API costs')}</span></NavLink>
  </nav>
}

export function PageShell({ children, workspace = false, immersive = false, wide = false, defaultRailCollapsed = false, railContent, railContentRef }: PropsWithChildren<{
  workspace?: boolean; immersive?: boolean; wide?: boolean; defaultRailCollapsed?: boolean; railContent?: ReactNode; railContentRef?: Ref<HTMLDivElement>
}>) {
  const account = useAccount()
  const { text } = useAppLocale()
  const location = useLocation()
  const sharedRail = useContext(RailStateContext)
  const [localCollapsed, setLocalCollapsed] = useState(defaultRailCollapsed)
  const collapsed = sharedRail?.collapsed ?? localCollapsed
  const setCollapsed = sharedRail?.setCollapsed ?? setLocalCollapsed
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760)
  const [splitPreference] = useSidebarLayoutPreference()
  const splitRail = splitPreference && !narrow
  const [recordsOpen, setRecordsOpen] = useSidebarRecordsOpen()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'updates' | 'messages'>('all')
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const notificationButtonRef = useRef<HTMLButtonElement>(null)
  const notificationSurface = useRef<HTMLElement>(null)
  const session = account.sessionState.status === 'authenticated' ? account.sessionState.session : null
  const authenticated = session !== null
  const userId = session?.user.userId
  const drawerMotion = useDrawerPresence({ open: drawerOpen, enabled: narrow && !immersive, scopeKey: userId, drawerRef, triggerRef: menuButtonRef, onDismiss: () => setDrawerOpen(false) })
  const notificationMotion = usePresence(notificationsOpen, notificationSurface, userId)
  useLayoutEffect(() => { setDrawerOpen(false); setNotificationsOpen(false) }, [userId])
  const accountName = session ? session.user.displayName?.trim() || text('我的账户', 'My account') : text('账户', 'Account')

  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 760)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { setDrawerOpen(false); setNotificationsOpen(false) }, [location.pathname, location.search])
  useEffect(() => { if (!narrow || immersive) setDrawerOpen(false) }, [narrow, immersive])

  const params = new URLSearchParams(location.search)
  const conversationId = params.get('conversation_id')
  const isConversationPage = location.pathname === '/agent' || location.pathname === '/research/new' || /^\/research\/[^/]+\/workspace/.test(location.pathname)
  const viewParams = new URLSearchParams()
  for (const key of ['conversation_id', 'task_id', 'knowledge_release_id']) {
    const value = params.get(key); if (value) viewParams.set(key, value)
  }
  const projectId = location.pathname.match(/^\/research\/([^/]+)\/workspace/)?.[1]
  if (projectId && !viewParams.has('task_id')) viewParams.set('task_id', decodeURIComponent(projectId))
  const viewDestination = conversationId && isConversationPage ? `${location.pathname === '/agent' ? '/research/new' : '/agent'}?${viewParams}` : null
  const viewLabel = location.pathname === '/agent' ? text('研究画布', 'Research canvas') : text('对话视图', 'Conversation view')
  const navigation = [
    ['/app', text('首页', 'Home'), 'home'],
    ['/library', text('知识库', 'Library'), 'library'],
    ['/writing', text('写作', 'Writing'), 'compose'],
    ['/my/graph', text('图谱', 'Graph'), 'graph'],
    ['/research/materials', text('研究', 'Research'), 'file'],
  ] as const
  const moreNavigation = [
    ['/research/new', text('新建研究', 'New research'), 'plus'],
    ['/library/knowledge', text('知识整理', 'Organized knowledge'), 'library'],
    ['/imports', text('导入', 'Imports'), 'import'],
    ['/sharing', text('共享', 'Sharing'), 'share'],
    ['/discover', text('发现', 'Discover'), 'compass'],
    ['/connections', text('连接', 'Connections'), 'connection'],
    ['/subscription', text('订阅', 'Subscription'), 'card'],
  ] as const


  return <ApplicationFrame
    collapsed={splitRail || collapsed} drawerOpen={drawerMotion.open} drawerPresent={drawerMotion.present} narrow={narrow}
    splitRail={splitRail} recordsOpen={recordsOpen} recordsLabel={text('对话与研究', 'Conversations and research')}
    immersive={immersive} workspace={workspace} wide={wide}
    sidebarRef={drawerRef} onDismiss={() => setDrawerOpen(false)}
    skipLabel={text('跳到主要内容', 'Skip to main content')}
    sidebarLabel={text('Everplain 功能栏', 'Everplain navigation')}
    dismissLabel={text('关闭菜单', 'Close menu')}
    notice={<NetworkStatusNotice />}
    brand={<Link className="application-brand" to="/welcome" aria-label={text('Everplain 官网', 'Everplain website')}><ProductMark /><strong>Everplain</strong></Link>}
    toggle={<button aria-controls={splitRail ? 'application-records' : undefined} aria-expanded={splitRail ? recordsOpen : undefined} data-close-drawer={narrow || undefined} className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={narrow ? text('关闭菜单', 'Close menu') : splitRail ? recordsOpen ? text('收起对话与研究', 'Hide conversations and research') : text('展开对话与研究', 'Show conversations and research') : collapsed ? text('展开侧栏', 'Expand sidebar') : text('收起侧栏', 'Collapse sidebar')} onClick={() => narrow ? setDrawerOpen(false) : splitRail ? setRecordsOpen(value => !value) : setCollapsed(value => !value)}>{narrow ? <NavIcon name="close" /> : <NavIcon name="sidebar" />}</button>}
    newConversation={<Link className="qx-item" to="/agent" title={text('新对话', 'New conversation')}><NavIcon name="compose" /><span className="application-navigation__label">{text('新对话', 'New conversation')}</span></Link>}
    navigation={<nav className="application-navigation" aria-label={narrow ? text('移动主导航', 'Mobile navigation') : text('桌面主导航', 'Main navigation')}>
      {navigation.map(([href, label, icon]) => <NavLink className="qx-item" key={href} to={href} end title={label}><NavIcon name={icon} /><span className="application-navigation__label">{label}</span></NavLink>)}

    </nav>}
    secondaryNavigation={<>{viewDestination && <nav className="application-navigation" aria-label={text('对话视图', 'Conversation views')}><Link className="qx-item" to={viewDestination} title={viewLabel}><NavIcon name="chat" /><span className="application-navigation__label">{viewLabel}</span></Link></nav>}<details className="application-more"><summary className="qx-item" title={text('更多功能', 'More features')}><NavIcon name="more" /><span className="application-navigation__label">{text('更多功能', 'More features')}</span><NavIcon name="chevron" className="application-group-chevron" /></summary>
      <nav className="application-navigation" aria-label={text('更多功能', 'More features')}>{moreNavigation.map(([href, label, icon]) => <NavLink className="qx-item" to={href} key={href} title={label}><NavIcon name={icon} /><span className="application-navigation__label">{label}</span></NavLink>)}</nav>
      {userId ? <AdminNavigation userId={userId} /> : null}
    </details></>}
    history={<div ref={railContentRef}>{railContent ?? (userId && !railContentRef ? <><RecentConversations userId={userId} />{splitRail && <RecentResearch userId={userId} />}</> : null)}</div>}
    account={<div className="application-account">
      {authenticated ? <>
        {userId && <AccountMenu userId={userId} accountName={accountName} onOpen={() => setNotificationsOpen(false)} />}
        <button ref={notificationButtonRef} className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('通知', 'Notifications')} aria-expanded={notificationsOpen} aria-controls="desktop-notifications" onClick={() => setNotificationsOpen(value => !value)}><NavIcon name="bell" /></button>
      </> : account.sessionState.status === 'loading' ? <span className="qx-meta" role="status">{text('确认账户中', 'Checking account')}</span> : <Link className="qx-item" to="/login" title={text('登录', 'Sign in')}><NavIcon name="user" /><span className="application-navigation__label">{text('登录', 'Sign in')}</span></Link>}
    </div>}
    notifications={notificationMotion.present ? <section ref={notificationSurface} data-motion-surface="popover" {...notificationMotion.props} className="qx-panel application-notifications" id="desktop-notifications" aria-label={text('通知栏', 'Notifications panel')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNotificationsOpen(false); notificationButtonRef.current?.focus() } }}>
            <header><h2 className="qx-card__title">{text('通知', 'Notifications')}</h2><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={text('关闭通知', 'Close notifications')} onClick={() => { setNotificationsOpen(false); notificationButtonRef.current?.focus() }}><NavIcon name="close" /></button></header>
            <div className="qx-segmented application-notifications__tabs" role="tablist" aria-label={text('通知分类', 'Notification categories')}>
              {([['all', text('全部', 'All')], ['updates', text('更新日志', 'Updates')], ['messages', text('消息', 'Messages')]] as const).map(([filter, label]) => <button className="qx-btn qx-btn--ghost" key={filter} type="button" role="tab" aria-selected={notificationFilter === filter} onClick={() => setNotificationFilter(filter)}>{label}</button>)}
            </div>
            {notificationFilter !== 'messages' ? <article className="application-notifications__item"><strong>{text('深度研究现已上线', 'Deep Research is now available')}</strong><p>{text('选择深度研究，自动让 Agent 规划任务，检索你的知识库并阅读网页。你可以查看来源，在文稿中继续编辑结果。', 'Use Deep Research to plan a task, search your library, and read web sources. Inspect citations and continue editing the result in your document.')}</p></article> : null}
            {notificationFilter !== 'updates' ? <article className="application-notifications__item"><strong>{text('暂无新消息', 'No new messages')}</strong></article> : null}
          </section> : null}
    mobileHeader={<>
      <button ref={menuButtonRef} className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('打开菜单', 'Open menu')} aria-expanded={drawerMotion.open} aria-controls="application-sidebar" onClick={() => setDrawerOpen(true)}><NavIcon name="menu" /></button>
      <Link className="application-brand" to="/welcome" aria-label={text('Everplain 官网', 'Everplain website')}><ProductMark /><strong>Everplain</strong></Link>
      <Link data-mobile-new className="qx-btn qx-btn--ghost qx-btn--icon" to="/agent" aria-label={text('新对话', 'New conversation')}><NavIcon name="compose" /></Link>
    </>}
  >{children}</ApplicationFrame>
}

export function PageTitle({ title, lede }: PageTitleProps) {
  return <header className="application-page-heading"><h1 className="qx-section-title">{title}</h1>{lede ? <p className="qx-body">{lede}</p> : null}</header>
}
export function PageContent({ children }: { children: ReactNode }) { return <section className="application-content">{children}</section> }
