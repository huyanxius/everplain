import { useState } from 'react'
import { ArrowRightIcon, ArrowUpRightIcon, CornersOutIcon, MagnifyingGlassIcon, MinusIcon, PlusIcon, ShuffleIcon, XIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { libraryById, materials, topicById, topics, type Material } from '../data'
import { useAgent } from '../state'

/*
 * 图谱视图跟着左栏的范围走，原来的两张图都在：
 *   全部资料 → GraphView，原来的 /my/graph（个人图谱：我在中心，主题一圈，资料外圈）；
 *   某个库   → LibraryMap，原来 /library/knowledge 里的知识导图（库 → 资料 → 知识点，带知识关系）。
 * 真实实现两者都是 ObsidianKnowledgeGraph，这里用 SVG 摆出样子。
 */

function Zoom({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  return (
    <div className="mk-graph__zoom">
      <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="放大" onClick={() => setZoom(Math.min(1.6, zoom + 0.2))}><PlusIcon /></button>
      <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="缩小" onClick={() => setZoom(Math.max(0.6, zoom - 0.2))}><MinusIcon /></button>
      <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="适应画布" onClick={() => setZoom(1)}><CornersOutIcon /></button>
      <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="重新布局"><ShuffleIcon /></button>
    </div>
  )
}

/*
 * 个人图谱。原页面上的东西都在：搜索节点、主题标签、统计（资料·主题·节点·关系）、更新图谱、
 * 和 Agent 聊聊（带上所选资料的库）、继续导入、空状态、等待归类提示、图例、
 * 右侧面板（搜索结果 / 节点的相邻节点 / 资料原文 + 打开原文）、本地演示归类的说明。
 */
export function GraphView() {
  const { agent } = useAgent()
  const [selected, setSelected] = useState<Material | null>(null)
  const [focusTopic, setFocusTopic] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const list = materials.filter((m) => m.state !== 'parsing' && m.state !== 'failed-parse')
  const pending = materials.length - list.length + materials.filter((m) => m.state === 'organizing').length

  const topicPos = Object.fromEntries(
    topics.map((t, i) => {
      const a = (i / topics.length) * Math.PI * 2 - Math.PI / 2
      return [t.id, { x: Math.cos(a) * 150, y: Math.sin(a) * 150, a }]
    }),
  )
  const byTopic: Record<string, Material[]> = {}
  list.forEach((m) => (byTopic[m.topicId] ??= []).push(m))
  const matPos = Object.fromEntries(
    list.map((m) => {
      const group = byTopic[m.topicId]
      const idx = group.indexOf(m)
      const a = topicPos[m.topicId].a + (idx - (group.length - 1) / 2) * 0.38
      return [m.id, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 }]
    }),
  )
  const dim = (topicId: string) => focusTopic !== null && focusTopic !== topicId
  const results = query ? list.filter((m) => (m.title + m.points.join('')).includes(query)) : focusTopic ? byTopic[focusTopic] ?? [] : []
  const panel = selected || query || focusTopic

  return (
    <div className="mk-graph-view">
      <div className="mk-filters">
        <label className="qx-search mk-graph-search">
          <MagnifyingGlassIcon />
          <input aria-label="搜索我的图谱" placeholder="找一个节点" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null) }} />
        </label>
        {topics.map((t) => (
          <button key={t.id} className="qx-tag" aria-pressed={focusTopic === t.id} onClick={() => { setFocusTopic(focusTopic === t.id ? null : t.id); setQuery(''); setSelected(null) }}>
            <i className="mk-dot" style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="mk-graph__bar">
        <span className="qx-meta">{list.length} 份资料 · {topics.length} 个主题 · {list.length + topics.length + 1} 节点 · {list.length * 2} 关系</span>
        <div className="mk-graph__bar-actions">
          <button className="qx-btn qx-btn--ghost">更新图谱</button>
          <a className="qx-btn qx-btn--ghost" href="#/library?view=graph&add">继续导入</a>
          <a className="qx-btn qx-btn--ghost" href="#/c/c1">
            和 {agent.name} 聊聊 <ArrowRightIcon />
          </a>
        </div>
      </div>

      <div className="mk-graph">
        <svg viewBox="-400 -360 800 720" style={{ transform: `scale(${zoom})` }} role="img" aria-label="个人知识图谱">
          <circle r="150" className="mk-graph__orbit" />
          <circle r="300" className="mk-graph__orbit" />
          {topics.map((t) => (
            <line key={t.id} x1="0" y1="0" x2={topicPos[t.id].x} y2={topicPos[t.id].y} className="mk-graph__edge" data-dim={dim(t.id)} />
          ))}
          {list.map((m) => (
            <line key={m.id} x1={topicPos[m.topicId].x} y1={topicPos[m.topicId].y} x2={matPos[m.id].x} y2={matPos[m.id].y} className="mk-graph__edge" data-dim={dim(m.topicId)} />
          ))}
          {list.flatMap((m) =>
            m.related
              .filter((r) => r > m.id && matPos[r] && materials.find((x) => x.id === r)!.topicId !== m.topicId)
              .map((r) => <path key={m.id + r} d={`M${matPos[m.id].x} ${matPos[m.id].y} Q0 0 ${matPos[r].x} ${matPos[r].y}`} className="mk-graph__cross" data-dim={focusTopic !== null} />),
          )}
          {topics.map((t) => (
            <g key={t.id} transform={`translate(${topicPos[t.id].x} ${topicPos[t.id].y})`} className="mk-graph__topic" data-dim={dim(t.id)} onClick={() => setFocusTopic(focusTopic === t.id ? null : t.id)}>
              <circle r="30" fill={t.color} />
              <text y="50" textAnchor="middle">{t.name}</text>
            </g>
          ))}
          {list.map((m) => (
            <g key={m.id} transform={`translate(${matPos[m.id].x} ${matPos[m.id].y})`} className="mk-graph__node" data-dim={dim(m.topicId)} data-selected={selected?.id === m.id} onClick={() => setSelected(m)}>
              <circle r="11" stroke={topicById[m.topicId].color} />
              <text y="30" textAnchor="middle">{m.title.length > 9 ? `${m.title.slice(0, 9)}…` : m.title}</text>
            </g>
          ))}
        </svg>
        <div className="mk-graph__center" style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}>
          <AgentAvatar avatar={agent.avatar} color={agent.color} size={72} label={agent.name} />
        </div>
        <Zoom zoom={zoom} setZoom={setZoom} />
        {pending ? <p className="qx-meta mk-graph__working" role="status">{pending} 份资料等待归类，需要完成语义索引</p> : null}
        <div className="mk-graph__legend" aria-label="节点类型"><span>我</span><span>主题</span><span>资料</span><span>知识点</span></div>

        {panel ? (
          <aside className="qx-panel mk-graph__detail" aria-label={selected ? '资料原文' : '节点详情'}>
            <header className="mk-rail__head">
              <span className="qx-tag">{selected ? '原文' : query ? `找到 ${results.length} 个结果` : '主题'}</span>
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭" onClick={() => { setSelected(null); setQuery(''); setFocusTopic(null) }}><XIcon /></button>
            </header>
            {selected ? (
              <>
                <h2 className="qx-card__title">{selected.title}</h2>
                <div className="qx-prose mk-graph__source">
                  <p>{selected.summary}</p>
                  <p data-active="true">最重要的是常客。一个第三空间之所以成立，是因为每次去都能遇见几张熟悉的脸。</p>
                </div>
                <a className="qx-btn qx-btn--primary qx-btn--block" href={`#/library/${selected.id}?seg=2`}>
                  打开原文 <ArrowRightIcon />
                </a>
              </>
            ) : (
              <div className="mk-graph__results">
                {focusTopic && !query ? <h2 className="qx-card__title">{topicById[focusTopic].name}</h2> : null}
                {results.map((m) => (
                  <button key={m.id} className="qx-item" onClick={() => setSelected(m)}>
                    <span>{m.title}</span>
                    <span className="qx-item__trail">资料</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        ) : null}
      </div>
      <p className="qx-meta">当前为本地演示归类；接入专用模型后可进行语义归类与主题命名。</p>
    </div>
  )
}

/*
 * 某个库的知识导图：原来 /library/knowledge 的图。库在中心，资料一圈，知识点外圈，虚线是资料整理出的知识关系。
 * 点知识点 → 右侧「原文依据」：每份资料里的说法 + 阅读原文（逐段）；点关系 → 关系的依据。
 */
export function LibraryMap({ libId }: { libId: string }) {
  const [zoom, setZoom] = useState(1)
  const [focus, setFocus] = useState<{ kind: 'point'; name: string } | { kind: 'relation'; from: string; to: string } | null>(null)
  const docs = materials.filter((m) => m.libraryId === libId && m.state !== 'parsing' && m.state !== 'failed-parse' && m.state !== 'organizing')
  if (!docs.length) return <div className="mk-empty"><p className="qx-meta">知识尚未整理完成。资料仍可打开阅读，处理状态可在资料卡片上查看。</p></div>
  const docPos = Object.fromEntries(docs.map((m, i) => {
    const a = (i / docs.length) * Math.PI * 2 - Math.PI / 2
    return [m.id, { x: Math.cos(a) * 140, y: Math.sin(a) * 140, a }]
  }))
  const points = docs.flatMap((m) => m.points.map((p, j) => ({ p, m, j })))
  const ptPos = Object.fromEntries(points.map(({ p, m, j }) => {
    const a = docPos[m.id].a + (j - (m.points.length - 1) / 2) * 0.32
    return [m.id + p, { x: Math.cos(a) * 290, y: Math.sin(a) * 290 }]
  }))
  const relations = docs.filter((m) => m.points.length > 1).map((m) => ({ m, from: m.points[0], to: m.points[1], label: '支撑' }))
  const sources = focus?.kind === 'point' ? points.filter((x) => x.p === focus.name) : []

  return (
    <div className="mk-graph-view">
      <div className="mk-graph">
        <svg viewBox="-400 -360 800 720" style={{ transform: `scale(${zoom})` }} role="img" aria-label="知识导图">
          {docs.map((m) => <line key={m.id} x1="0" y1="0" x2={docPos[m.id].x} y2={docPos[m.id].y} className="mk-graph__edge" />)}
          {points.map(({ p, m }) => <line key={m.id + p} x1={docPos[m.id].x} y1={docPos[m.id].y} x2={ptPos[m.id + p].x} y2={ptPos[m.id + p].y} className="mk-graph__edge" />)}
          {relations.map(({ m, from, to }) => (
            <path key={m.id} d={`M${ptPos[m.id + from].x} ${ptPos[m.id + from].y} Q${docPos[m.id].x * 1.6} ${docPos[m.id].y * 1.6} ${ptPos[m.id + to].x} ${ptPos[m.id + to].y}`} className="mk-graph__cross mk-graph__relation" onClick={() => setFocus({ kind: 'relation', from, to })} />
          ))}
          <g className="mk-graph__topic"><circle r="34" className="mk-graph__root" /><text y="5" textAnchor="middle">{libraryById[libId].name}</text></g>
          {docs.map((m) => (
            <g key={m.id} transform={`translate(${docPos[m.id].x} ${docPos[m.id].y})`} className="mk-graph__node">
              <rect x="-9" y="-9" width="18" height="18" rx="4" />
              <text y="28" textAnchor="middle">{m.title.length > 8 ? `${m.title.slice(0, 8)}…` : m.title}</text>
            </g>
          ))}
          {points.map(({ p, m }) => (
            <g key={m.id + p} transform={`translate(${ptPos[m.id + p].x} ${ptPos[m.id + p].y})`} className="mk-graph__node mk-graph__point" data-selected={focus?.kind === 'point' && focus.name === p} onClick={() => setFocus({ kind: 'point', name: p })}>
              <circle r="7" />
              <text y="24" textAnchor="middle">{p}</text>
            </g>
          ))}
        </svg>
        <Zoom zoom={zoom} setZoom={setZoom} />
        {focus ? (
          <aside className="qx-panel mk-graph__detail" aria-label="知识点原文依据">
            <header className="mk-rail__head">
              <span className="qx-meta">原文依据</span>
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭知识详情" onClick={() => setFocus(null)}><XIcon /></button>
            </header>
            {focus.kind === 'point' ? (
              <>
                <h2 className="qx-card__title">{focus.name}</h2>
                {sources.map(({ m }) => (
                  <article key={m.id} className="mk-evidence">
                    <p>{m.summary.slice(0, 48)}…</p>
                    <strong className="qx-meta">{m.title}</strong>
                    <a className="qx-item" href={`#/library/${m.id}?seg=2`}>阅读原文 · {m.title} <ArrowUpRightIcon /></a>
                  </article>
                ))}
              </>
            ) : (
              <>
                <h2 className="qx-card__title">{focus.from} → {focus.to}</h2>
                <p className="qx-meta">支撑 · 由资料整理产生，需结合原文核对</p>
                <a className="qx-item" href="#/library/m1?seg=2">阅读原文 · 依据 1 <ArrowUpRightIcon /></a>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
