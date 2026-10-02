import { useState } from 'react'
import { ArrowLeftIcon, CheckIcon, ExportIcon, PlusIcon, SidebarSimpleIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { materialById, researches } from '../data'
import { useAgent } from '../state'
import { Composer, KindIcon, PageHead } from '../ui'

const stages = ['提问', '找资料', '写大纲', '写作'] as const

export function ResearchListPage() {
  return (
    <div className="mk-page">
      <PageHead
        title="研究"
        actions={
          <button className="qx-btn qx-btn--primary">
            <PlusIcon /> 新建研究
          </button>
        }
      />
      <div className="mk-grid mk-grid--cards">
        {researches.map((r) => (
          <a key={r.id} className="qx-card qx-card--interactive mk-rcard" href={`#/research/${r.id}`}>
            <StageBar stage={r.stage} />
            <h3 className="qx-card__title">{r.title}</h3>
            <p className="qx-card__body mk-clamp">{r.question}</p>
            <div className="qx-card__meta">
              {r.materials} 份资料 · {r.updated}
            </div>
          </a>
        ))}
        <button className="qx-card qx-card--muted mk-card-add">
          <PlusIcon />
          <span className="qx-heading">从一个问题开始</span>
        </button>
      </div>
    </div>
  )
}

/* 四段进度：做到哪一步一眼能看见，不用文字说明。 */
function StageBar({ stage }: { stage: (typeof stages)[number] }) {
  const at = stages.indexOf(stage)
  return (
    <div className="mk-stagebar" aria-label={`进行到：${stage}`}>
      {stages.map((s, i) => (
        <span key={s} data-done={i <= at} />
      ))}
      <em>{stage}</em>
    </div>
  )
}

/*
 * 研究工作台：左大纲、中间文稿、右边资料 / Agent 切换。
 * 文稿是衬线正文，引用编号和对话里同一种样式，点开对应右侧资料。
 */
export function ResearchWorkspacePage({ id }: { id: string }) {
  const r = researches.find((x) => x.id === id) ?? researches[0]
  const { agent } = useAgent()
  const [side, setSide] = useState<'materials' | 'agent'>('materials')
  const [outline, setOutline] = useState(true)
  const [active, setActive] = useState('m1')
  const sections = ['问题从哪里来', '第三空间的定义', '中国城市的情况', '访谈发现', '讨论']
  const used = ['m1', 'm5', 'm2', 'm3']
  const at = stages.indexOf(r.stage)

  return (
    <div className="mk-ws" data-outline={outline}>
      <header className="mk-ws__bar">
        <a className="qx-btn qx-btn--ghost qx-btn--icon" href="#/research" aria-label="返回研究">
          <ArrowLeftIcon />
        </a>
        <button className="qx-btn qx-btn--ghost qx-btn--icon mk-only-desktop" aria-label="大纲" aria-pressed={outline} onClick={() => setOutline(!outline)}>
          <SidebarSimpleIcon />
        </button>
        <h1 className="qx-heading mk-ws__title">{r.title}</h1>
        <ol className="mk-stepper">
          {stages.map((s, i) => (
            <li key={s} data-done={i < at} data-current={i === at}>
              <span>{i < at ? <CheckIcon weight="bold" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <button className="qx-btn qx-btn--secondary">
          <ExportIcon /> 导出
        </button>
      </header>

      <div className="mk-ws__body">
        {outline ? (
          <nav className="mk-ws__outline" aria-label="大纲">
            <p className="qx-group-label">大纲</p>
            {sections.map((s, i) => (
              <a key={s} className="qx-item" href={`#/research/${r.id}`} aria-current={i === 1 ? 'true' : undefined}>
                <span className="mk-ws__num">{i + 1}</span>
                {s}
              </a>
            ))}
            <button className="qx-item mk-muted-item">
              <PlusIcon /> 加一节
            </button>
          </nav>
        ) : null}

        <article className="mk-ws__doc">
          <p className="mk-ws__question">{r.question}</p>
          <h2 className="mk-ws__h">2　第三空间的定义</h2>
          <div className="qx-prose" contentEditable suppressContentEditableWarning>
            <p>
              "第三空间"由奥尔登堡在 1989 年提出，指家庭和工作场所之外、供人非正式聚集的公共场所
              <button className="qx-cite" contentEditable={false} onClick={() => { setSide('materials'); setActive('m1') }}>1</button>
              。他列举了八个特征，其中最关键的两条是中立性和常客。
            </p>
            <p>
              雅各布斯从街道的尺度给出了相近的观察：一条街是否安全，取决于有没有足够多的"街道眼"
              <button className="qx-cite" contentEditable={false} onClick={() => { setSide('materials'); setActive('m5') }}>2</button>
              。两者都把陌生人之间低成本、可持续的照面当作城市生活的基础。
            </p>
            <p>
              但这一前提在中国语境下需要重新检验。费孝通描述的差序格局里，关系沿着亲疏向外推
              <button className="qx-cite" contentEditable={false} onClick={() => { setSide('materials'); setActive('m2') }}>3</button>
              ，公共场所中的陌生人关系本来就弱……
            </p>
          </div>
        </article>

        <aside className="mk-ws__side">
          <div className="qx-segmented mk-ws__tabs" role="tablist">
            <button role="tab" aria-selected={side === 'materials'} onClick={() => setSide('materials')}>
              资料 {used.length}
            </button>
            <button role="tab" aria-selected={side === 'agent'} onClick={() => setSide('agent')}>
              {agent.name}
            </button>
          </div>

          {side === 'materials' ? (
            <div className="mk-ws__materials">
              {used.map((mid, i) => {
                const m = materialById[mid]
                return (
                  <button key={mid} className="qx-card mk-ws__mat" data-active={active === mid} onClick={() => setActive(mid)}>
                    <span className="mk-mcard__kind">
                      <KindIcon kind={m.kind} /> {i + 1} · {m.kind}
                    </span>
                    <strong>{m.title}</strong>
                    {active === mid ? <p className="qx-card__body">{m.summary}</p> : null}
                  </button>
                )
              })}
              <button className="qx-btn qx-btn--secondary qx-btn--block">
                <PlusIcon /> 从知识库添加
              </button>
            </div>
          ) : (
            <div className="mk-ws__agent">
              <div className="mk-turn">
                <AgentAvatar avatar={agent.avatar} color={agent.color} size={28} />
                <div className="qx-prose mk-ws__agent-text">
                  <p>第二节已经把定义讲清楚了。第三段可以加一个你访谈里的例子，比如受访者 B 说的"楼下便利店"，让对比落到具体的人身上。</p>
                </div>
              </div>
              <Composer placeholder="让它改这一节" />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
