import { useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  ExportIcon,
} from '@phosphor-icons/react'

import { materialById, researches } from '../data'
import { KindIcon, TopicChip } from '../ui'

/*
 * 资料详情：左边读原文（衬线、72 字宽），右边是这份资料被整理出来的东西——
 * 知识点、和谁有关、用在了哪个研究。知识点可以直接改，改过的保留用户版本。
 */
export function MaterialPage({ id }: { id: string }) {
  const m = materialById[id] ?? materialById.m1
  const [menu, setMenu] = useState(false)
  const [points, setPoints] = useState<string[]>([...m.points])
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <div className="mk-page mk-material">
      <div className="mk-material__bar">
        <a className="qx-btn qx-btn--ghost" href="#/library">
          <ArrowLeftIcon /> 知识库
        </a>
        <div className="mk-material__actions">
          <a className="qx-btn qx-btn--secondary" href="#/agent/c1">
            <ChatCircleIcon /> 问这份资料
          </a>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="打开原网页">
            <ArrowSquareOutIcon />
          </button>
          <div className="mk-menu-anchor">
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="更多" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <DotsThreeIcon weight="bold" />
            </button>
            {menu ? (
              <div className="qx-menu mk-menu" role="menu">
                <button className="qx-item" role="menuitem">
                  <PencilSimpleIcon /> 重命名
                </button>
                <button className="qx-item" role="menuitem">
                  <ExportIcon /> 导出 Markdown
                </button>
                <div className="qx-menu__divider" />
                <button className="qx-item mk-danger" role="menuitem">
                  <TrashIcon /> 删除
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mk-material__layout">
        <article className="mk-reader">
          <div className="mk-reader__meta">
            <span className="qx-tag">
              <KindIcon kind={m.kind} /> {m.kind}
            </span>
            <TopicChip topicId={m.topicId} />
            <span className="qx-meta">
              {m.host ? `${m.host} · ` : ''}来自{m.source} · {m.addedAt}
            </span>
          </div>
          <h1 className="mk-reader__title">{m.title}</h1>
          <p className="mk-reader__summary">{m.summary}</p>
          <div className="qx-prose">
            <p>
              我们每个人都需要三个地方。第一个是家，第二个是工作的地方，第三个是那些让我们在家和工作之外，能够自在地和别人待在一起的地方——咖啡馆、书店、街角的小酒馆、理发店。
            </p>
            <p>
              这些地方有几个共同点。它们是中立的：没有人是主人，也没有人是客人，你可以随时来随时走。它们让身份变得不重要：在这里，经理和学生坐在同一张桌子前。谈话是主要的活动，而且大多数时候，谈话本身没有任何目的。
            </p>
            <p>
              <mark>最重要的是常客。</mark>一个第三空间之所以成立，不是因为它的装修或者咖啡，而是因为每次去都能遇见几张熟悉的脸。新来的人正是通过这些常客，才慢慢变成这里的一部分。
            </p>
            <p>
              城市规划的变化让这类空间越来越少。郊区化把人分散到彼此隔绝的住宅里，连锁店则把"停留"设计成了"消费之后离开"。
            </p>
          </div>
        </article>

        <aside className="mk-rail">
          <section className="qx-card mk-rail__block">
            <header className="mk-rail__head">
              <h2 className="qx-heading">知识点</h2>
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加知识点" onClick={() => { setPoints([...points, '新知识点']); setEditing(points.length) }}>
                <PlusIcon />
              </button>
            </header>
            <ul className="mk-points">
              {points.map((p, i) => (
                <li key={i}>
                  {editing === i ? (
                    <input className="qx-input mk-points__input" autoFocus defaultValue={p} onBlur={(e) => { const next = [...points]; next[i] = e.target.value; setPoints(next); setEditing(null) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  ) : (
                    <button className="qx-item" onClick={() => setEditing(i)}>
                      {p}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="qx-card mk-rail__block">
            <h2 className="qx-heading">和这些有关</h2>
            <div className="mk-related">
              {m.related.map((rid) => {
                const r = materialById[rid]
                return (
                  <a key={rid} className="qx-item mk-related__item" href={`#/library/${rid}`}>
                    <KindIcon kind={r.kind} />
                    <span>{r.title}</span>
                  </a>
                )
              })}
            </div>
          </section>

          <section className="qx-card mk-rail__block">
            <h2 className="qx-heading">用在了</h2>
            <a className="qx-item" href={`#/research/${researches[0].id}`}>
              {researches[0].title}
              <span className="qx-item__trail">引用 3 次</span>
            </a>
          </section>
        </aside>
      </div>
    </div>
  )
}
