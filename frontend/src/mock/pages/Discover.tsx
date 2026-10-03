import { useState } from 'react'
import { ArrowLeftIcon, ChatCircleIcon, LinkIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'

import { materials, publicTopics, topicById } from '../data'
import { PageHead } from '../ui'

/*
 * 发现：别人公开的库，加上"收到一份邀请"的入口。
 * 现在 /discover 和 /sharing 里的"收到邀请"是两处，合到这里——用户拿着链接时想的是"去看别人的东西"，
 * 不是"管理我的共享"。管理自己的共享在库上（共享按钮）和设置里（共享总览）。
 */
export function DiscoverPage() {
  const [q, setQ] = useState('')
  const shown = publicTopics.filter((t) => !q || (t.name + t.blurb).includes(q))
  return (
    <div className="mk-page">
      <PageHead title="发现">
        <div className="mk-discover__bar">
          <label className="qx-search mk-search">
            <MagnifyingGlassIcon />
            <input placeholder="找一个主题" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="qx-search mk-discover__invite">
            <LinkIcon />
            <input placeholder="收到邀请链接？粘贴到这里" />
            <button className="qx-btn qx-btn--secondary">加入</button>
          </label>
        </div>
      </PageHead>
      <div className="mk-grid mk-grid--cards">
        {shown.map((t) => (
          <a key={t.id} className="qx-card qx-card--interactive mk-rcard" href={`#/discover/${t.id}`}>
            <span className="mk-mcard__kind">
              <i className="mk-dot" style={{ background: t.color }} /> {t.owner}
            </span>
            <h3 className="qx-card__title">{t.name}</h3>
            <p className="qx-card__body mk-clamp">{t.blurb}</p>
            <div className="qx-card__meta">{t.count} 份资料</div>
          </a>
        ))}
      </div>
    </div>
  )
}

/* 只读阅读：公开主题和别人分享给我的库用同一个阅读页。加入后出现在知识库左栏「共享给我的」。 */
export function SharedReaderPage({ id }: { id: string }) {
  const t = publicTopics.find((x) => x.id === id) ?? publicTopics[0]
  const [joined, setJoined] = useState(false)
  const [active, setActive] = useState(materials[0].id)
  const list = materials.slice(0, 6)
  const m = list.find((x) => x.id === active) ?? list[0]
  return (
    <div className="mk-page mk-material">
      <div className="mk-material__bar">
        <a className="qx-btn qx-btn--ghost" href="#/discover">
          <ArrowLeftIcon /> 发现
        </a>
        <div className="mk-material__actions">
          <a className="qx-btn qx-btn--secondary" href="#/c/c1">
            <ChatCircleIcon /> 问这个库
          </a>
          <button className="qx-btn qx-btn--primary" disabled={joined} onClick={() => setJoined(true)}>
            {joined ? '已加入知识库' : <><PlusIcon /> 加入我的知识库</>}
          </button>
        </div>
      </div>
      <header className="mk-reader-head">
        <h1 className="mk-reader__title">{t.name}</h1>
        <p className="qx-meta">
          {t.owner} · {t.count} 份资料 · 只读
        </p>
      </header>
      <div className="mk-shared">
        <nav className="mk-shared__list">
          {list.map((x) => (
            <button key={x.id} className="qx-item" aria-current={x.id === active ? 'true' : undefined} onClick={() => setActive(x.id)}>
              <i className="mk-dot" style={{ background: topicById[x.topicId].color }} />
              <span>{x.title}</span>
            </button>
          ))}
        </nav>
        <article className="mk-reader">
          <h2 className="qx-section-title">{m.title}</h2>
          <p className="mk-reader__summary">{m.summary}</p>
          <div className="mk-filters">
            {m.points.map((p) => (
              <span key={p} className="qx-tag qx-tag--outline">{p}</span>
            ))}
          </div>
        </article>
      </div>
    </div>
  )
}
