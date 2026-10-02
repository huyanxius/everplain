import { useEffect, useState, type ReactNode } from 'react'
import {
  BooksIcon,
  GearSixIcon,
  GraphIcon,
  HouseIcon,
  ListIcon,
  NotePencilIcon,
  PencilSimpleLineIcon,
  SidebarSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from './agent-avatar'
import { conversations, type AgentProfile } from './data'
import { AgentPage } from './pages/Agent'
import { GraphPage } from './pages/Graph'
import { HomePage } from './pages/Home'
import { LibraryPage } from './pages/Library'
import { LoginPage } from './pages/Login'
import { MaterialPage } from './pages/Material'
import { ResearchListPage, ResearchWorkspacePage } from './pages/Research'
import { SettingsDialog } from './pages/Settings'
import { SetupPage } from './pages/Setup'
import { AgentContext, go, loadAgent, useAgent, useHashPath } from './state'

/*
 * 路由用 hash，是为了 mock 能脱离后端单独跑。真实应用继续用 react-router 和现有路径：
 *   #/            → /app            #/library      → /library
 *   #/library/m1  → 资料详情（新）   #/graph        → 图谱（新，次级视图）
 *   #/agent/c1    → /agent          #/research     → /app?research=all
 *   #/research/r1 → /research/:id/workspace
 *   #/login       → /login          #/setup/1..4   → /welcome/setup（计划中）
 * 设置是叠在当前页上的弹窗（?settings），和现在的 settingsOpen 行为一致。
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
  const settingsOpen = new URLSearchParams(query).has('settings')

  let page: ReactNode
  let bare = false
  if (parts[0] === 'login') {
    page = <LoginPage />
    bare = true
  } else if (parts[0] === 'setup') {
    page = <SetupPage step={Number(parts[1] ?? 1)} />
    bare = true
  } else if (parts[0] === 'library' && parts[1]) page = <MaterialPage id={parts[1]} />
  else if (parts[0] === 'library') page = <LibraryPage />
  else if (parts[0] === 'graph') page = <GraphPage />
  else if (parts[0] === 'agent') page = <AgentPage id={parts[1]} />
  else if (parts[0] === 'research' && parts[1]) page = <ResearchWorkspacePage id={parts[1]} />
  else if (parts[0] === 'research') page = <ResearchListPage />
  else page = <HomePage />

  return (
    <AgentContext.Provider value={{ agent, setAgent }}>
      {bare ? page : <Shell section={parts[0] ?? ''} sub={parts[1]}>{page}</Shell>}
      {settingsOpen ? <SettingsDialog onClose={() => go(route || '/')} /> : null}
      <MockNav />
    </AgentContext.Provider>
  )
}

function Shell({ section, sub, children }: { section: string; sub?: string; children: ReactNode }) {
  const { agent } = useAgent()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    setDrawer(false)
  }, [section, sub])

  const nav = [
    { id: '', label: '首页', icon: <HouseIcon /> },
    { id: 'library', label: '知识库', icon: <BooksIcon /> },
    { id: 'graph', label: '图谱', icon: <GraphIcon /> },
    { id: 'research', label: '研究', icon: <PencilSimpleLineIcon /> },
  ]
  const here = window.location.hash.replace(/^#/, '').split('?')[0] || '/'

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

        <a className="qx-item mk-new-chat" href="#/agent">
          <NotePencilIcon /> <span>新对话</span>
        </a>

        <nav className="mk-sidebar__nav">
          {nav.map((n) => (
            <a key={n.id} className="qx-item" href={`#/${n.id}`} aria-current={section === n.id ? 'page' : undefined} title={n.label}>
              {n.icon} <span>{n.label}</span>
            </a>
          ))}
        </nav>

        <div className="mk-sidebar__scroll">
          <p className="qx-group-label">最近对话</p>
          {conversations.map((c) => (
            <a key={c.id} className="qx-item mk-sidebar__conv" href={`#/agent/${c.id}`} aria-current={section === 'agent' && sub === c.id ? 'page' : undefined}>
              <span>{c.title}</span>
            </a>
          ))}
        </div>

        <a className="qx-item mk-sidebar__agent" href={`#${here}?settings`} title="设置">
          <AgentAvatar avatar={agent.avatar} color={agent.color} size={32} />
          <span className="mk-sidebar__agent-name">
            {agent.name}
            <small>你的 Agent</small>
          </span>
          <GearSixIcon className="mk-sidebar__gear" />
        </a>
      </aside>

      <div className="mk-scrim" onClick={() => setDrawer(false)} />

      <div className="mk-main">
        <header className="mk-mobilebar">
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="打开菜单" onClick={() => setDrawer(true)}>
            <ListIcon />
          </button>
          <span className="mk-brand">Everplain</span>
          <a className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="新对话" href="#/agent">
            <NotePencilIcon />
          </a>
        </header>
        {children}
      </div>
    </div>
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
    ['#/', '首页'],
    ['#/library', '知识库'],
    ['#/library/m1', '资料详情'],
    ['#/graph', '图谱'],
    ['#/agent/c1', 'Agent 对话'],
    ['#/agent', '新对话'],
    ['#/research', '研究列表'],
    ['#/research/r1', '研究工作台'],
    ['#/?settings', '设置'],
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
