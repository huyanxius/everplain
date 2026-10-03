import { useEffect, useState, type ReactElement } from 'react'
import {
  CopyIcon,
  CreditCardIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  KeyIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  ShareNetworkIcon,
  SunIcon,
  UserIcon,
  DatabaseIcon,
} from '@phosphor-icons/react'

import { connections, joinedLibraries, libraries, libraryById } from '../data'
import { Dialog } from '../ui'
import { Row } from './AgentPanel'

type Tab = 'account' | 'look' | 'plan' | 'sharing' | 'connections' | 'data'

/*
 * 设置只放"账户和外部"的东西。和 Agent 有关的（人格、记忆、模型）去了「我的 Agent」，
 * 导入来源去了「添加资料」。现在独立成页的 /subscription、/connections、/sharing（管理部分）收进这里，
 * 真实路由保留并打开对应分类：/settings?tab=plan 等。
 */
export function SettingsDialog({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const tabs: [Tab, string, ReactElement][] = [
    ['account', '账号', <UserIcon key="i" />],
    ['look', '外观', <PaletteIcon key="i" />],
    ['plan', '套餐与额度', <CreditCardIcon key="i" />],
    ['sharing', '共享', <ShareNetworkIcon key="i" />],
    ['connections', '外部连接', <KeyIcon key="i" />],
    ['data', '数据', <DatabaseIcon key="i" />],
  ]
  const [tab, setTab] = useState<Tab>(tabs.some(([id]) => id === initial) ? (initial as Tab) : 'account')
  return (
    <Dialog title="设置" onClose={onClose} wide>
      <div className="mk-settings">
        <nav className="mk-settings__nav">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className="qx-item" aria-current={tab === id ? 'true' : undefined} onClick={() => setTab(id)}>
              {icon} {label}
            </button>
          ))}
        </nav>
        <div className="mk-settings__body">
          {tab === 'account' ? <AccountTab /> : null}
          {tab === 'look' ? <LookTab /> : null}
          {tab === 'plan' ? <PlanTab /> : null}
          {tab === 'sharing' ? <SharingTab /> : null}
          {tab === 'connections' ? <ConnectionsTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
        </div>
      </div>
    </Dialog>
  )
}

function AccountTab() {
  return (
    <>
      <Row label="邮箱">
        <span>h*******s@gmail.com</span>
      </Row>
      <Row label="昵称">
        <input className="qx-input mk-select" defaultValue="huyan" />
      </Row>
      <Row label="密码">
        <button className="qx-btn qx-btn--secondary">修改</button>
      </Row>
    </>
  )
}

function LookTab() {
  const [scheme, setScheme] = useState(() => document.documentElement.style.colorScheme || 'system')
  const [lang, setLang] = useState('中文')
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme === 'system' ? '' : scheme
  }, [scheme])
  return (
    <>
      <Row label="主题">
        <div className="qx-segmented">
          <button aria-pressed={scheme === 'system'} onClick={() => setScheme('system')}>
            <DesktopIcon /> 跟随系统
          </button>
          <button aria-pressed={scheme === 'light'} onClick={() => setScheme('light')}>
            <SunIcon /> 浅色
          </button>
          <button aria-pressed={scheme === 'dark'} onClick={() => setScheme('dark')}>
            <MoonIcon /> 深色
          </button>
        </div>
      </Row>
      <Row label="语言">
        <div className="qx-segmented">
          {['中文', 'English'].map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l}
            </button>
          ))}
        </div>
      </Row>
    </>
  )
}

function PlanTab() {
  return (
    <>
      <Row label="当前套餐">
        <div className="mk-plan">
          <strong>个人版</strong>
          <span className="qx-meta">下次续费 10 月 28 日</span>
          <button className="qx-btn qx-btn--primary">升级</button>
        </div>
      </Row>
      <Row label="本月额度">
        <div className="mk-usage">
          <div className="mk-progress">
            <span style={{ width: '62%' }} />
          </div>
          <span className="qx-meta">剩余 62% · 套餐 50%，赠送 12%</span>
        </div>
      </Row>
      <Row label="存储">
        <div className="mk-usage">
          <div className="mk-progress">
            <span style={{ width: '34%' }} />
          </div>
          <span className="qx-meta">已用 1.7 GB / 5 GB · 3 / 10 个库</span>
        </div>
      </Row>
      <Row label="加购">
        <button className="qx-btn qx-btn--secondary">购买额外额度</button>
      </Row>
    </>
  )
}

/* 共享总览：一眼看清哪些库对外开着。具体开关在库上，这里只是汇总和快捷入口。 */
function SharingTab() {
  const shared = libraries.filter((l) => l.shared)
  return (
    <>
      <p className="qx-group-label">我共享出去的</p>
      <ul className="mk-sources">
        {shared.map((l) => (
          <li key={l.id}>
            <span className="mk-source__text">
              <strong>{l.name}</strong>
              <small>{l.shared === 'public' ? '公开到发现' : `邀请链接 · ${l.members} 人已加入`}</small>
            </span>
            <a className="qx-btn qx-btn--ghost" href={`#/library?lib=${l.id}&share`}>管理</a>
          </li>
        ))}
      </ul>
      <p className="qx-group-label">我加入的</p>
      <ul className="mk-sources">
        {joinedLibraries.map((l) => (
          <li key={l.id}>
            <span className="mk-source__text">
              <strong>{l.name}</strong>
              <small>{l.owner} 分享 · 只读</small>
            </span>
            <button className="qx-btn qx-btn--ghost">退出</button>
          </li>
        ))}
      </ul>
    </>
  )
}

/*
 * 外部连接：给 MCP 客户端的只读钥匙，按库授权。钥匙只显示一次——这句提示真实页面里要保留。
 */
function ConnectionsTab() {
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<string[]>(['thesis'])
  return (
    <>
      <p className="mk-settings__lead">让 Claude、Cursor 这类工具只读你选中的库。不建连接，资料不会开放给任何外部工具。</p>
      <ul className="mk-sources">
        {connections.map((c) => (
          <li key={c.id}>
            <span className="mk-source__icon">
              <KeyIcon />
            </span>
            <span className="mk-source__text">
              <strong>{c.name}</strong>
              <small>
                可读 {c.libraries.map((id) => libraryById[id].name).join('、')} · {c.lastUsed}用过
              </small>
            </span>
            <button className="qx-btn qx-btn--ghost mk-danger">撤销</button>
          </li>
        ))}
      </ul>
      {creating ? (
        <div className="qx-card mk-conn-new">
          <input className="qx-input" placeholder="给这个连接起个名字，比如 Cursor" autoFocus />
          <p className="qx-meta">允许读哪些库</p>
          <div className="mk-filters">
            {libraries.map((l) => (
              <button key={l.id} className="qx-tag" aria-pressed={picked.includes(l.id)} onClick={() => setPicked(picked.includes(l.id) ? picked.filter((x) => x !== l.id) : [...picked, l.id])}>
                {l.name}
              </button>
            ))}
          </div>
          <div className="qx-search mk-import__link">
            <KeyIcon />
            <input readOnly value="ep_live_••••••••••••3f9a" />
            <button className="qx-btn qx-btn--secondary">
              <CopyIcon /> 复制
            </button>
          </div>
          <p className="qx-meta">密钥只显示这一次，关掉后看不到。</p>
        </div>
      ) : (
        <button className="qx-btn qx-btn--secondary" onClick={() => setCreating(true)}>
          <PlusIcon /> 新建连接
        </button>
      )}
    </>
  )
}

function DataTab() {
  return (
    <>
      <Row label="导出">
        <button className="qx-btn qx-btn--secondary">
          <DownloadSimpleIcon /> 导出全部资料
        </button>
      </Row>
      <Row label="注销">
        <button className="qx-btn qx-btn--danger">删除账号</button>
      </Row>
    </>
  )
}
