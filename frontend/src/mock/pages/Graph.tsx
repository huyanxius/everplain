import { useState } from 'react'
import { ArrowRightIcon, MagnifyingGlassIcon, MinusIcon, PlusIcon, SquaresFourIcon, GraphIcon, XIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { materials, topicById, topics, type Material } from '../data'
import { go, useAgent } from '../state'
import { KindIcon, PageHead } from '../ui'

/*
 * 个人图谱：同心圆，Agent 在中心，主题第一圈，资料外圈挨着自己的主题。
 * 真实实现复用 ObsidianKnowledgeGraph（cytoscape）换 concentric 布局；这里用 SVG 摆出样子。
 */
export function GraphPage() {
  const { agent } = useAgent()
  const [selected, setSelected] = useState<Material | null>(null)
  const [focusTopic, setFocusTopic] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  const topicPos = Object.fromEntries(
    topics.map((t, i) => {
      const a = (i / topics.length) * Math.PI * 2 - Math.PI / 2
      return [t.id, { x: Math.cos(a) * 150, y: Math.sin(a) * 150, a }]
    }),
  )
  const byTopic: Record<string, Material[]> = {}
  materials.forEach((m) => (byTopic[m.topicId] ??= []).push(m))
  const matPos = Object.fromEntries(
    materials.map((m) => {
      const group = byTopic[m.topicId]
      const idx = group.indexOf(m)
      const spread = 0.38
      const a = topicPos[m.topicId].a + (idx - (group.length - 1) / 2) * spread
      return [m.id, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 }]
    }),
  )
  const dim = (topicId: string) => focusTopic !== null && focusTopic !== topicId

  return (
    <div className="mk-page mk-graph-page">
      <PageHead
        title="图谱"
        actions={
          <div className="qx-segmented" role="tablist" aria-label="视图">
            <button role="tab" aria-selected="false" aria-label="卡片" onClick={() => go('/library')}>
              <SquaresFourIcon />
            </button>
            <button role="tab" aria-selected="true" aria-label="图谱">
              <GraphIcon />
            </button>
          </div>
        }
      >
        <div className="mk-filters">
          <label className="qx-search mk-graph-search">
            <MagnifyingGlassIcon />
            <input placeholder="找一个节点" />
          </label>
          {topics.map((t) => (
            <button key={t.id} className="qx-tag" aria-pressed={focusTopic === t.id} onClick={() => setFocusTopic(focusTopic === t.id ? null : t.id)}>
              <i className="mk-dot" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      </PageHead>

      <div className="mk-graph">
        <svg viewBox="-400 -360 800 720" style={{ transform: `scale(${zoom})` }} role="img" aria-label="个人知识图谱">
          <circle r="150" className="mk-graph__orbit" />
          <circle r="300" className="mk-graph__orbit" />
          {topics.map((t) => (
            <line key={t.id} x1="0" y1="0" x2={topicPos[t.id].x} y2={topicPos[t.id].y} className="mk-graph__edge" data-dim={dim(t.id)} />
          ))}
          {materials.map((m) => (
            <line key={m.id} x1={topicPos[m.topicId].x} y1={topicPos[m.topicId].y} x2={matPos[m.id].x} y2={matPos[m.id].y} className="mk-graph__edge" data-dim={dim(m.topicId)} />
          ))}
          {materials.flatMap((m) =>
            m.related
              .filter((r) => r > m.id && topicById[materials.find((x) => x.id === r)!.topicId].id !== m.topicId)
              .map((r) => (
                <path key={m.id + r} d={`M${matPos[m.id].x} ${matPos[m.id].y} Q0 0 ${matPos[r].x} ${matPos[r].y}`} className="mk-graph__cross" data-dim={focusTopic !== null} />
              )),
          )}
          {topics.map((t) => (
            <g key={t.id} transform={`translate(${topicPos[t.id].x} ${topicPos[t.id].y})`} className="mk-graph__topic" data-dim={dim(t.id)} onClick={() => setFocusTopic(focusTopic === t.id ? null : t.id)}>
              <circle r="30" fill={t.color} />
              <text y="50" textAnchor="middle">{t.name}</text>
            </g>
          ))}
          {materials.map((m) => (
            <g key={m.id} transform={`translate(${matPos[m.id].x} ${matPos[m.id].y})`} className="mk-graph__node" data-dim={dim(m.topicId)} data-selected={selected?.id === m.id} onClick={() => setSelected(m)}>
              <circle r="11" stroke={topicById[m.topicId].color} />
              <text y="30" textAnchor="middle">{m.title.length > 9 ? `${m.title.slice(0, 9)}…` : m.title}</text>
            </g>
          ))}
        </svg>
        <div className="mk-graph__center" style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}>
          <AgentAvatar avatar={agent.avatar} color={agent.color} size={72} label={agent.name} />
        </div>

        <div className="mk-graph__zoom">
          <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="放大" onClick={() => setZoom(Math.min(1.6, zoom + 0.2))}>
            <PlusIcon />
          </button>
          <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="缩小" onClick={() => setZoom(Math.max(0.6, zoom - 0.2))}>
            <MinusIcon />
          </button>
        </div>

        {selected ? (
          <aside className="qx-panel mk-graph__detail">
            <header className="mk-rail__head">
              <span className="qx-tag">
                <KindIcon kind={selected.kind} /> {selected.kind}
              </span>
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭" onClick={() => setSelected(null)}>
                <XIcon />
              </button>
            </header>
            <h2 className="qx-card__title">{selected.title}</h2>
            <p className="qx-card__body">{selected.summary}</p>
            <div className="mk-graph__detail-tags">
              {selected.points.map((p) => (
                <span key={p} className="qx-tag qx-tag--outline">{p}</span>
              ))}
            </div>
            <a className="qx-btn qx-btn--primary qx-btn--block" href={`#/library/${selected.id}`}>
              打开原文 <ArrowRightIcon />
            </a>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
