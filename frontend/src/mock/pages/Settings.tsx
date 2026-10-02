import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  BookmarkSimpleIcon,
  BrainIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  FolderIcon,
  MoonIcon,
  NoteIcon,
  PaletteIcon,
  SmileyIcon,
  SunIcon,
  TelevisionSimpleIcon,
  TrashIcon,
  UserIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react'

import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { agentColors, memories } from '../data'
import { useAgent } from '../state'
import { Dialog } from '../ui'

type Tab = 'agent' | 'memory' | 'sources' | 'look' | 'account'

/* 设置：叠在当前页上的弹窗，左边分类、右边内容；手机上分类变成顶部横排。 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('agent')
  const tabs: [Tab, string, ReactElement][] = [
    ['agent', '我的 Agent', <SmileyIcon key="i" />],
    ['memory', '记忆', <BrainIcon key="i" />],
    ['sources', '导入来源', <FolderIcon key="i" />],
    ['look', '外观', <PaletteIcon key="i" />],
    ['account', '账号与数据', <UserIcon key="i" />],
  ]
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
          {tab === 'agent' ? <AgentTab /> : null}
          {tab === 'memory' ? <MemoryTab /> : null}
          {tab === 'sources' ? <SourcesTab /> : null}
          {tab === 'look' ? <LookTab /> : null}
          {tab === 'account' ? <AccountTab /> : null}
        </div>
      </div>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mk-setrow">
      <span className="mk-setrow__label">{label}</span>
      <div className="mk-setrow__control">{children}</div>
    </div>
  )
}

function AgentTab() {
  const { agent, setAgent } = useAgent()
  const [style, setStyle] = useState('先给结论')
  return (
    <>
      <div className="mk-agent-card">
        <AgentAvatar avatar={agent.avatar} color={agent.color} size={88} state="greet" />
        <input className="qx-input mk-name-input" value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} aria-label="名字" />
      </div>
      <Row label="外观">
        <div className="mk-avatar-pick mk-avatar-pick--sm">
          {agentAvatarPresets.map((p) => (
            <button key={p.id} role="radio" aria-checked={agent.avatar === p.id} aria-label={p.name} onClick={() => setAgent({ ...agent, avatar: p.id, color: p.color })}>
              <AgentAvatar avatar={p.id} color={agent.avatar === p.id ? agent.color : p.color} size={40} playing={false} />
            </button>
          ))}
        </div>
      </Row>
      <Row label="颜色">
        <div className="mk-color-pick mk-color-pick--sm">
          {agentColors.map((c) => (
            <button key={c} role="radio" aria-checked={agent.color === c} aria-label={c} style={{ background: c }} onClick={() => setAgent({ ...agent, color: c })} />
          ))}
        </div>
      </Row>
      <Row label="说话方式">
        <div className="qx-segmented">
          {['先给结论', '多问我', '详细展开'].map((s) => (
            <button key={s} aria-pressed={style === s} onClick={() => setStyle(s)}>
              {s}
            </button>
          ))}
        </div>
      </Row>
      <Row label="引导">
        <a className="qx-btn qx-btn--secondary" href="#/setup/1">
          <ArrowsClockwiseIcon /> 重新走一遍
        </a>
      </Row>
    </>
  )
}

function MemoryTab() {
  const [list, setList] = useState(memories)
  return (
    <>
      <p className="mk-settings__lead">这些是它记住的关于你的事。删掉的不会再被用到。</p>
      <ul className="mk-memories">
        {list.map((m) => (
          <li key={m.id} className="qx-card">
            <div>
              <p>{m.text}</p>
              <span className="qx-meta">{m.source}</span>
            </div>
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="删除这条记忆" onClick={() => setList(list.filter((x) => x.id !== m.id))}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function SourcesTab() {
  const [sync, setSync] = useState({ chrome: true, obsidian: true, bili: false, notes: false })
  const items = [
    { id: 'chrome', icon: <BookmarkSimpleIcon />, name: 'Chrome 书签', state: '248 条 · 今天' },
    { id: 'obsidian', icon: <FolderIcon />, name: 'Obsidian', state: '63 条 · 昨天' },
    { id: 'bili', icon: <TelevisionSimpleIcon />, name: 'B 站收藏夹', state: '未连接' },
    { id: 'notes', icon: <NoteIcon />, name: 'Apple 备忘录', state: '未连接' },
  ] as const
  return (
    <ul className="mk-sources">
      {items.map((s) => (
        <li key={s.id}>
          <span className="mk-source__icon">{s.icon}</span>
          <span className="mk-source__text">
            <strong>{s.name}</strong>
            <small>{s.state}</small>
          </span>
          <button className="qx-switch" role="switch" aria-checked={sync[s.id]} aria-label={`自动同步 ${s.name}`} onClick={() => setSync({ ...sync, [s.id]: !sync[s.id] })} />
        </li>
      ))}
    </ul>
  )
}

function LookTab() {
  const [scheme, setScheme] = useState(() => document.documentElement.style.colorScheme || 'system')
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme === 'system' ? '' : scheme
  }, [scheme])
  return (
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
  )
}

function AccountTab() {
  return (
    <>
      <Row label="邮箱">
        <span>h*******s@gmail.com</span>
      </Row>
      <Row label="密码">
        <button className="qx-btn qx-btn--secondary">修改</button>
      </Row>
      <Row label="存储">
        <div className="mk-usage">
          <div className="mk-progress">
            <span style={{ width: '34%' }} />
          </div>
          <span className="qx-meta">已用 1.7 GB / 5 GB</span>
        </div>
      </Row>
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
