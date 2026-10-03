import { useState, type ReactElement, type ReactNode } from 'react'
import { ArrowsClockwiseIcon, BrainIcon, CpuIcon, SmileyIcon, TrashIcon } from '@phosphor-icons/react'

import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { agentColors, memories } from '../data'
import { useAgent } from '../state'
import { Dialog } from '../ui'

type Tab = 'soul' | 'memory' | 'model'

/*
 * 我的 Agent：从侧栏底部那个角色点进来。现在人格和记忆藏在账户菜单里（"Soul · 人格""Memory · 记忆"），
 * 模型选择在对话页里——都是"它是谁、它记得什么、它用什么脑子"，放回角色身上。
 * 研究级别的记忆（ResearchMemoryPanel）不在这里，它跟着研究走。
 */
export function AgentPanel({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const [tab, setTab] = useState<Tab>(initial === 'memory' || initial === 'model' ? initial : 'soul')
  const tabs: [Tab, string, ReactElement][] = [
    ['soul', '人格', <SmileyIcon key="i" />],
    ['memory', '记忆', <BrainIcon key="i" />],
    ['model', '模型', <CpuIcon key="i" />],
  ]
  return (
    <Dialog title="我的 Agent" onClose={onClose} wide>
      <div className="mk-settings">
        <nav className="mk-settings__nav">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className="qx-item" aria-current={tab === id ? 'true' : undefined} onClick={() => setTab(id)}>
              {icon} {label}
            </button>
          ))}
        </nav>
        <div className="mk-settings__body">
          {tab === 'soul' ? <SoulTab /> : null}
          {tab === 'memory' ? <MemoryTab /> : null}
          {tab === 'model' ? <ModelTab /> : null}
        </div>
      </div>
    </Dialog>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mk-setrow">
      <span className="mk-setrow__label">{label}</span>
      <div className="mk-setrow__control">{children}</div>
    </div>
  )
}

function SoulTab() {
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
      <Row label="自我介绍">
        <textarea className="qx-input mk-soul" rows={3} defaultValue="陪你读资料、找联系的研究伙伴。不替你下结论，会指出你没注意到的反例。" />
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
  const [on, setOn] = useState(true)
  return (
    <>
      <div className="mk-share__row">
        <span>
          <strong>从对话里记住新东西</strong>
          <small>关掉后只用已有的记忆，不再新增。</small>
        </span>
        <button className="qx-switch" role="switch" aria-checked={on} aria-label="自动记忆" onClick={() => setOn(!on)} />
      </div>
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

function ModelTab() {
  const [model, setModel] = useState('均衡')
  const [cite, setCite] = useState('GB/T 7714')
  return (
    <>
      <Row label="默认模型">
        <div className="qx-segmented">
          {['快速', '均衡', '深入'].map((m) => (
            <button key={m} aria-pressed={model === m} onClick={() => setModel(m)}>
              {m}
            </button>
          ))}
        </div>
      </Row>
      <Row label="引用格式">
        <select className="qx-input mk-select" value={cite} onChange={(e) => setCite(e.target.value)}>
          {['GB/T 7714', 'APA', 'MLA', 'Chicago'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Row>
      <Row label="联网">
        <span className="qx-meta">资料里找不到时，问过你再上网查</span>
      </Row>
    </>
  )
}
