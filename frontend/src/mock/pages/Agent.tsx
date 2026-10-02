import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowSquareOutIcon,
  BookmarkSimpleIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleLineIcon,
  ThumbsDownIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../agent-avatar'
import { conversations, materialById } from '../data'
import { useAgent } from '../state'
import { Composer, KindIcon, TopicChip } from '../ui'

interface Turn {
  readonly role: 'user' | 'agent'
  readonly body: ReactNode
  readonly sources?: readonly string[]
}

/*
 * 对话：用户一侧灰气泡，Agent 一侧是角色头像 + 衬线正文，不套气泡。
 * 引用编号点开后右侧滑出原文片段，不跳走、不丢掉对话位置。
 */
export function AgentPage({ id }: { id?: string }) {
  const { agent } = useAgent()
  const [source, setSource] = useState<string | null>(null)
  const conv = conversations.find((c) => c.id === id)
  const cite = (n: number, mid: string) => (
    <button className="qx-cite" onClick={() => setSource(mid)} aria-label={`来源 ${n}：${materialById[mid].title}`}>
      {n}
    </button>
  )

  const seed: Turn[] = conv
    ? [
        { role: 'user', body: '第三空间这个概念，我的资料里有哪些支持和反驳？' },
        {
          role: 'agent',
          sources: ['m1', 'm3', 'm2', 'm5'],
          body: (
            <>
              <p>
                支持的有三处。奥尔登堡的原始定义强调"中立地带"和"常客"{cite(1, 'm1')}，雅各布斯讲的街道眼其实是同一件事在街道尺度上的版本{cite(4, 'm5')}；你的访谈提纲也正好在追问"上一次和陌生人聊天在哪里"{cite(2, 'm3')}。
              </p>
              <p>
                反驳主要来自《乡土中国》：在差序格局里，人和人的关系沿着亲疏一圈圈推出去，公共场所里的陌生人关系本来就弱{cite(3, 'm2')}。这和奥尔登堡默认的前提不一样——他假设陌生人之间值得也愿意建立轻关系。
              </p>
              <p>如果要写进论文，可以把这个张力当成问题本身：中国城市里的年轻人，是在复制西方意义上的第三空间，还是在发明别的东西？</p>
            </>
          ),
        },
      ]
    : []
  const [turns, setTurns] = useState<Turn[]>(seed)
  const [thinking, setThinking] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTurns(seed)
    setSource(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, thinking])

  const send = (text: string) => {
    setTurns((t) => [...t, { role: 'user', body: text }])
    setThinking(true)
    window.setTimeout(() => {
      setThinking(false)
      setTurns((t) => [
        ...t,
        {
          role: 'agent',
          sources: ['m3'],
          body: <p>可以。我先按你访谈提纲里的顺序{cite(1, 'm3')}，把每个问题改成能落到具体场景的问法，改完放进研究里给你看。</p>,
        },
      ])
    }, 1400)
  }

  const empty = turns.length === 0

  return (
    <div className="mk-chat" data-source={source !== null}>
      <div className="mk-chat__main">
        {!empty ? (
          <header className="mk-chat__head">
            <h1 className="qx-heading">{conv?.title ?? '新对话'}</h1>
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="对话选项">
              <DotsThreeIcon weight="bold" />
            </button>
          </header>
        ) : null}

        {empty ? (
          <div className="mk-chat__empty">
            <AgentAvatar avatar={agent.avatar} color={agent.color} size={96} state="greet" label={agent.name} />
            <h1 className="qx-display">我是{agent.name}，你想聊点什么？</h1>
            <div className="mk-chat__composer mk-chat__composer--center">
              <Composer placeholder={`问${agent.name}`} onSend={send} autoFocus />
            </div>
          </div>
        ) : (
          <>
            <div className="mk-chat__scroll">
              <div className="mk-chat__thread">
                {turns.map((t, i) =>
                  t.role === 'user' ? (
                    <div key={i} className="qx-bubble">
                      {t.body}
                    </div>
                  ) : (
                    <div key={i} className="mk-turn">
                      <AgentAvatar avatar={agent.avatar} color={agent.color} size={32} offset={i} />
                      <div className="mk-turn__body">
                        <div className="qx-prose">{t.body}</div>
                        {t.sources ? (
                          <div className="mk-turn__sources">
                            {t.sources.map((s, n) => (
                              <button key={s} className="qx-tag qx-tag--outline" onClick={() => setSource(s)}>
                                <span className="mk-turn__n">{n + 1}</span>
                                {materialById[s].title}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div className="mk-turn__actions">
                          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="复制">
                            <CopyIcon />
                          </button>
                          <button className="qx-btn qx-btn--ghost">
                            <BookmarkSimpleIcon /> 存为笔记
                          </button>
                          <button className="qx-btn qx-btn--ghost">
                            <PencilSimpleLineIcon /> 放进研究
                          </button>
                          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="回答不好">
                            <ThumbsDownIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  ),
                )}
                {thinking ? (
                  <div className="mk-turn">
                    <AgentAvatar avatar={agent.avatar} color={agent.color} size={32} state="think" />
                    <p className="mk-turn__thinking">在翻你的资料…</p>
                  </div>
                ) : null}
                <div ref={end} />
              </div>
            </div>
            <div className="mk-chat__composer">
              <Composer placeholder="接着问" onSend={send} />
            </div>
          </>
        )}
      </div>

      {source ? <SourceDrawer id={source} onClose={() => setSource(null)} /> : null}
    </div>
  )
}

function SourceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const m = materialById[id]
  return (
    <aside className="mk-source-drawer" aria-label="引用来源">
      <header className="mk-rail__head">
        <span className="qx-tag">
          <KindIcon kind={m.kind} /> {m.host ?? m.source}
        </span>
        <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭" onClick={onClose}>
          <XIcon />
        </button>
      </header>
      <h2 className="qx-card__title">{m.title}</h2>
      <TopicChip topicId={m.topicId} />
      <blockquote className="mk-quote">
        <p>{m.summary}</p>
      </blockquote>
      <p className="qx-meta">引用位置：第 3 段</p>
      <a className="qx-btn qx-btn--secondary qx-btn--block" href={`#/library/${m.id}`}>
        <ArrowSquareOutIcon /> 在知识库里打开
      </a>
    </aside>
  )
}
