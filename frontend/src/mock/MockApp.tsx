import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BellIcon,
  BooksIcon,
  CaretUpDownIcon,
  CompassIcon,
  CreditCardIcon,
  GearSixIcon,
  ListIcon,
  NotePencilIcon,
  PencilSimpleLineIcon,
  ShieldIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../modules/agent-avatar'
import { conversations, notifications, researches, type AgentProfile } from './data'
import { AgentPage } from './pages/Agent'
import { AgentPanel } from './pages/AgentPanel'
import { DiscoverPage, SharedReaderPage } from './pages/Discover'
import { HomePage } from './pages/Home'
import { LibraryPage } from './pages/Library'
import { LoginPage } from './pages/Login'
import { MaterialPage } from './pages/Material'
import { ResearchListPage, ResearchWorkspacePage } from './pages/Research'
import { SettingsDialog } from './pages/Settings'
import { SetupPage } from './pages/Setup'
import { AgentContext, go, loadAgent, useAgent, useHashPath } from './state'
import { Dialog } from './ui'

/*
 * 信息结构只有三样东西：资料（知识库）、研究、Agent。其余功能都挂在它们身上，
 * 不再单独占导航——"更多功能"折叠、首页按钮墙、账户菜单里的人格/记忆都取消。
 *
 * hash 路由只为脱离后端单独跑。和真实路由的对应关系见 README。
 *   #/             首页 = 新对话（合并现在的 /app 和 /agent 空状态）
 *   #/c/c1         一段对话
 *   #/library      知识库；?lib= 选库，?view=points|graph 切视图
 *   #/library/m1   资料详情
 *   #/research     研究列表；#/research/r1 工作台
 *   #/discover     发现；#/discover/p1 只读阅读
 * 叠层：?settings 设置，?agent 我的 Agent，?inbox 通知。
 */
export function MockApp() {
  const path = useHashPath()
  const [agent, setAgentState] = useState(loadAgent)
  const setAgent = (next: AgentProfile) => {
    setAgentState(next)
    try {
      localStorage.setItem('mk-agent', JSON.stringify(next))
    } catch {
      /* 隐私模式下存不了，刷新后回到默认角色。 */
    }
  }

  const [route, query = ''] = path.split('?')
  const parts = route.split('/').filter(Boolean)
  const params = new URLSearchParams(query)
  const close = () => go(route || '/')

  let page: ReactNode
  let bare = false
  if (parts[0] === 'login') {
    page = <LoginPage />
    bare = true
  } else if (parts[0] === 'setup') {
    page = <SetupPage step={Number(parts[1] ?? 1)} />
    bare = true
  } else if (parts[0] === 'library' && parts[1]) page = <MaterialPage id={parts[1]} />
  else if (parts[0] === 'library') page = <LibraryPage lib={params.get('lib')} view={params.get('view')} />
  else if (parts[0] === 'graph') page = <LibraryPage lib={null} view="graph" />
  else if ((parts[0] === 'c' || parts[0] === 'agent') && parts[1]) page = <AgentPage id={parts[1]} />
  else if (parts[0] === 'research' && parts[1]) page = <ResearchWorkspacePage id={parts[1]} />
  else if (parts[0] === 'research') page = <ResearchListPage creating={params.has('new')} />
  else if (parts[0] === 'discover' && parts[1]) page = <SharedReaderPage id={parts[1]} />
  else if (parts[0] === 'discover') page = <DiscoverPage />
  else page = <HomePage />

  return (
    <AgentContext.Provider value={{ agent, setAgent }}>
      {bare ? page : <Shell section={parts[0] ?? ''} sub={parts[1]}>{page}</Shell>}
      {params.has('settings') ? <SettingsDialog onClose={close} initial={params.get('settings') || undefined} /> : null}
      {params.has('agent') ? <AgentPanel onClose={close} initial={params.get('agent') || undefined} /> : null}
      {params.has('inbox') ? <InboxDialog onClose={close} /> : null}
      <MockNav />
    </AgentContext.Provider>
  )
}

/* 最近：对话和研究按时间混排。用户记得的是"昨天弄的那个"，不是它属于哪个功能。 */
const recents = [
  { href: '#/research/r1', title: researches[0].title, kind: 'research' as const, id: 'r1' },
  ...conversations.slice(0, 3).map((c) => ({ href: `#/c/${c.id}`, title: c.title, kind: 'chat' as const, id: c.id })),
  { href: '#/research/r2', title: researches[1].title, kind: 'research' as const, id: 'r2' },
  ...conversations.slice(3).map((c) => ({ href: `#/c/${c.id}`, title: c.title, kind: 'chat' as const, id: c.id })),
]

function Shell({ section, sub, children }: { section: string; sub?: string; children: ReactNode }) {
  const { agent } = useAgent()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    setDrawer(false)
  }, [section, sub])

  const nav = [
    { id: 'library', match: ['library', 'graph'], label: '知识库', icon: <BooksIcon /> },
    { id: 'research', match: ['research'], label: '研究', icon: <PencilSimpleLineIcon /> },
    { id: 'discover', match: ['discover'], label: '发现', icon: <CompassIcon /> },
  ]
  const here = window.location.hash.replace(/^#/, '').split('?')[0] || '/'
  const onHome = section === '' || (section === 'agent' && !sub)

  return (
    <div className="mk-shell" data-collapsed={collapsed} data-drawer={drawer}>
      <aside className="mk-sidebar">
        <div className="mk-sidebar__top">
          <a className="mk-brand" href="#/">
            <img src="/src/assets/qunxue-brand-mark.svg" alt="" width={26} height={26} />
            <span>Everplain</span>
          </a>
          <button className="qx-btn qx-btn--ghost qx-btn--icon mk-only-desktop" aria-label="收起侧栏" onClick={() => setCollapsed(!collapsed)}>
            <SidebarSimpleIcon />
          </button>
          <button className="qx-btn qx-btn--ghost qx-btn--icon mk-only-mobile" aria-label="关闭菜单" onClick={() => setDrawer(false)}>
            <XIcon />
          </button>
        </div>

        <a className="qx-item mk-new-chat" href="#/" aria-current={onHome ? 'page' : undefined} title="新对话">
          <NotePencilIcon /> <span>新对话</span>
        </a>

        <nav className="mk-sidebar__nav">
          {nav.map((n) => (
            <a key={n.id} className="qx-item" href={`#/${n.id}`} aria-current={n.match.includes(section) ? 'page' : undefined} title={n.label}>
              {n.icon} <span>{n.label}</span>
            </a>
          ))}
        </nav>

        <div className="mk-sidebar__scroll">
          <p className="qx-group-label">最近</p>
          {recents.map((r) => {
            const current = (r.kind === 'research' && section === 'research' && sub === r.id) || (r.kind === 'chat' && (section === 'c' || section === 'agent') && sub === r.id)
            return (
              <a key={r.href} className="qx-item mk-sidebar__conv" href={r.href} aria-current={current ? 'page' : undefined} title={r.title}>
                <span>{r.title}</span>
                {r.kind === 'research' ? <PencilSimpleLineIcon className="mk-sidebar__kind" aria-label="研究" /> : null}
              </a>
            )
          })}
        </div>

        <a className="qx-item mk-sidebar__agent" href={`#${here}?agent`} title={`我的 Agent：${agent.name}`}>
          <AgentAvatar avatar={agent.avatar} color={agent.color} size={32} />
          <span className="mk-sidebar__agent-name">
            {agent.name}
            <small>人格 · 记忆 · 模型</small>
          </span>
        </a>
        <AccountMenu here={here} />
      </aside>

      <div className="mk-scrim" onClick={() => setDrawer(false)} />

      <div className="mk-main">
        <header className="mk-mobilebar">
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="打开菜单" onClick={() => setDrawer(true)}>
            <ListIcon />
          </button>
          <span className="mk-brand">Everplain</span>
          <a className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="新对话" href="#/">
            <NotePencilIcon />
          </a>
        </header>
        {children}
      </div>
    </div>
  )
}

/*
 * 账户：额度、套餐、通知、设置、退出都在这一个菜单里。
 * 现在的额度和"升级套餐"同时出现在侧栏折叠和账户菜单两处，这里只留一处。
 */
function AccountMenu({ here }: { here: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((n) => n.unread).length
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  return (
    <div className="mk-account" ref={ref}>
      {open ? (
        <div className="qx-menu mk-account__menu" role="menu">
          <div className="mk-account__quota">
            <div className="mk-account__quota-row">
              <span>本月额度</span>
              <span className="qx-meta">剩余 62%</span>
            </div>
            <div className="mk-progress">
              <span style={{ width: '62%' }} />
            </div>
          </div>
          <a className="qx-item" role="menuitem" href={`#${here}?inbox`} onClick={() => setOpen(false)}>
            <BellIcon /> 通知
            {unread ? <span className="qx-item__trail mk-badge">{unread}</span> : null}
          </a>
          <a className="qx-item" role="menuitem" href={`#${here}?settings=plan`} onClick={() => setOpen(false)}>
            <CreditCardIcon /> 套餐与额度
          </a>
          <a className="qx-item" role="menuitem" href={`#${here}?settings`} onClick={() => setOpen(false)}>
            <GearSixIcon /> 设置
          </a>
          <div className="qx-menu__divider" />
          <button className="qx-item" role="menuitem">
            <ShieldIcon /> 管理后台
            <span className="qx-item__trail">仅管理员</span>
          </button>
          <a className="qx-item" role="menuitem" href="#/login">
            <SignOutIcon /> 退出登录
          </a>
        </div>
      ) : null}
      <button className="qx-item mk-account__trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} title="账户">
        <span className="mk-account__avatar">H{unread ? <i className="mk-account__dot" /> : null}</span>
        <span className="mk-account__name">huyan</span>
        <CaretUpDownIcon className="mk-account__caret" />
      </button>
    </div>
  )
}

function InboxDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'全部' | '消息' | '更新'>('全部')
  return (
    <Dialog title="通知" onClose={onClose}>
      <div className="mk-inbox">
        <div className="qx-segmented">
          {(['全部', '消息', '更新'] as const).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <ul className="mk-inbox__list">
          {notifications
            .filter((n) => tab === '全部' || n.kind === tab)
            .map((n) => (
              <li key={n.id} data-unread={n.unread}>
                <p>{n.text}</p>
                <span className="qx-meta">
                  {n.kind} · {n.when}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </Dialog>
  )
}

/* 浮在右下角的页面目录，只为方便浏览 mock；真实应用里没有它。 */
function MockNav() {
  const [open, setOpen] = useState(false)
  const pages = [
    ['#/login', '登录'],
    ['#/setup/1', '引导 · 导入'],
    ['#/setup/2', '引导 · 取名与外观'],
    ['#/setup/3', '引导 · 问卷'],
    ['#/setup/4', '引导 · 生成图谱'],
    ['#/', '首页 / 新对话'],
    ['#/c/c1', '对话'],
    ['#/c/c2', '研究里的对话'],
    ['#/library', '知识库 · 资料'],
    ['#/library?lib=thesis&view=points', '知识库 · 知识点'],
    ['#/library?view=graph', '知识库 · 图谱'],
    ['#/library?lib=thesis&share', '共享一个库'],
    ['#/library?add', '添加资料'],
    ['#/library/m1', '资料详情'],
    ['#/research', '研究列表'],
    ['#/research?new', '新建研究'],
    ['#/research/r1', '研究工作台'],
    ['#/discover', '发现'],
    ['#/discover/p1', '只读阅读'],
    ['#/?agent', '我的 Agent'],
    ['#/?settings', '设置'],
    ['#/?settings=connections', '设置 · 外部连接'],
    ['#/?inbox', '通知'],
  ]
  return (
    <div className="mk-pages" data-open={open}>
      {open ? (
        <div className="qx-menu mk-pages__menu">
          {pages.map(([href, label]) => (
            <a key={href} className="qx-item" href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </div>
      ) : null}
      <button className="qx-btn qx-btn--secondary mk-pages__toggle" onClick={() => setOpen(!open)}>
        {open ? <XIcon /> : <ListIcon />} 全部页面
      </button>
    </div>
  )
}
