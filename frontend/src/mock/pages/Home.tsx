import { ArrowRightIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { materials, researches } from '../data'
import { go, useAgent } from '../state'
import { Composer, MaterialCard } from '../ui'

/*
 * 首页 = 新对话的起点，加上"接着做"。只有一句问候、一个输入框；下面两排是真实内容，
 * 不放功能介绍、不放"AI 可以帮你……"这类说明文字。
 */
export function HomePage() {
  const { agent } = useAgent()
  const hour = new Date().getHours()
  const greeting = hour < 6 ? '还没睡呀' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="mk-page mk-home">
      <section className="mk-home__hero">
        <AgentAvatar avatar={agent.avatar} color={agent.color} size={84} state="greet" label={agent.name} />
        <h1 className="qx-display">{greeting}，今天想弄清楚什么？</h1>
        <div className="mk-home__composer">
          <Composer placeholder={`问${agent.name}，或者丢一个链接进来`} onSend={() => go('/agent/c1')} />
        </div>
        <div className="mk-home__chips">
          <a className="qx-tag qx-tag--outline" href="#/agent/c1">我收藏过哪些讲第三空间的？</a>
          <a className="qx-tag qx-tag--outline" href="#/agent/c1">把这周新收的整理一下</a>
          <a className="qx-tag qx-tag--outline" href="#/research/r1">接着写《城市第三空间》</a>
        </div>
      </section>

      <section className="mk-home__section">
        <header className="mk-section-head">
          <h2 className="qx-heading">接着研究</h2>
          <a className="qx-btn qx-btn--ghost" href="#/research">
            全部 <ArrowRightIcon />
          </a>
        </header>
        <div className="mk-grid mk-grid--3">
          {researches.map((r) => (
            <a key={r.id} className="qx-card qx-card--interactive mk-rcard" href={`#/research/${r.id}`}>
              <span className="qx-tag">{r.stage}</span>
              <h3 className="qx-card__title">{r.title}</h3>
              <p className="qx-card__body mk-clamp">{r.question}</p>
              <div className="qx-card__meta">
                {r.materials} 份资料 · {r.updated}
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="mk-home__section">
        <header className="mk-section-head">
          <h2 className="qx-heading">最近收进来的</h2>
          <a className="qx-btn qx-btn--ghost" href="#/library">
            知识库 <ArrowRightIcon />
          </a>
        </header>
        <div className="mk-grid mk-grid--3">
          {materials.slice(0, 3).map((m) => (
            <MaterialCard key={m.id} m={m} />
          ))}
        </div>
      </section>
    </div>
  )
}
