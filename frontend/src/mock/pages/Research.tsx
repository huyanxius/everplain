import { useState } from 'react'
import { ArrowLeftIcon, ChatCircleIcon, CheckIcon, ClockCounterClockwiseIcon, ExportIcon, FileArrowUpIcon, PlusIcon, QuestionIcon, SidebarSimpleIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { conversations, libraries, materialById, researches } from '../data'
import { go, useAgent } from '../state'
import { Composer, Dialog, KindIcon, PageHead } from '../ui'

const stages = ['提问', '找资料', '写大纲', '写作'] as const

/*
 * 研究列表。现在的三个入口（/research/new、/research/existing、对话里的新建项目）合成一个
 * 「新建研究」弹窗；侧栏上叫"研究"、点进去却是 /research/materials 的错位也一并消掉。
 */
export function ResearchListPage({ creating }: { creating: boolean }) {
  return (
    <div className="mk-page">
      <PageHead
        title="研究"
        actions={
          <a className="qx-btn qx-btn--primary" href="#/research?new">
            <PlusIcon /> 新建研究
          </a>
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
        <a className="qx-card qx-card--muted mk-card-add" href="#/research?new">
          <PlusIcon />
          <span className="qx-heading">从一个问题开始</span>
        </a>
      </div>
      {creating ? <NewResearchDialog onClose={() => go('/research')} /> : null}
    </div>
  )
}

/*
 * 新建研究：三种起点放在同一个地方。从对话转来时（new=chat）预先填好问题和资料，
 * 用户只需要确认。资料范围默认是整个知识库，可以收窄到某几个库。
 */
function NewResearchDialog({ onClose }: { onClose: () => void }) {
  const fromChat = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('new') === 'chat'
  const [from, setFrom] = useState<'question' | 'existing' | 'chat'>(fromChat ? 'chat' : 'question')
  const [libs, setLibs] = useState<string[]>(['thesis'])
  const ways = [
    { id: 'question' as const, icon: <QuestionIcon />, name: '从一个问题开始', hint: 'Agent 帮你把问题收窄，再去找资料' },
    { id: 'existing' as const, icon: <FileArrowUpIcon />, name: '接着一份已有的稿子', hint: '上传开题报告或草稿，从它继续' },
    { id: 'chat' as const, icon: <ChatCircleIcon />, name: '从一段对话', hint: '把聊出来的问题和引用过的资料带过来' },
  ]
  return (
    <Dialog title="新建研究" onClose={onClose} wide>
      <div className="mk-newr">
        <div className="mk-newr__ways">
          {ways.map((w) => (
            <button key={w.id} className="mk-source" aria-pressed={from === w.id} onClick={() => setFrom(w.id)}>
              <span className="mk-source__icon">{w.icon}</span>
              <span className="mk-source__text">
                <strong>{w.name}</strong>
                <small>{w.hint}</small>
              </span>
            </button>
          ))}
        </div>

        {from === 'question' ? (
          <textarea className="qx-input mk-newr__q" rows={3} placeholder="你想弄清楚的问题，一句话就够" autoFocus />
        ) : from === 'existing' ? (
          <button className="mk-dropzone">
            <FileArrowUpIcon />
            <strong>拖稿子到这里，或点击选择</strong>
            <small>Word、PDF、Markdown</small>
          </button>
        ) : (
          <div className="mk-newr__chat">
            <select className="qx-input" defaultValue="c1">
              {conversations.filter((c) => !c.researchId).map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <p className="mk-ws__question">中国城市里的年轻人，是在复制西方意义上的第三空间，还是在发明别的东西？</p>
            <p className="qx-meta">会带上这段对话里引用过的 4 份资料。</p>
          </div>
        )}

        <div>
          <h3 className="qx-heading">用哪些资料</h3>
          <div className="mk-filters">
            {libraries.map((l) => (
              <button key={l.id} className="qx-tag" aria-pressed={libs.includes(l.id)} onClick={() => setLibs(libs.includes(l.id) ? libs.filter((x) => x !== l.id) : [...libs, l.id])}>
                {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mk-newr__foot">
          <button className="qx-btn qx-btn--ghost" onClick={onClose}>取消</button>
          <a className="qx-btn qx-btn--primary" href="#/research/r1">开始</a>
        </div>
      </div>
    </Dialog>
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
  const [mode, setMode] = useState<'doc' | 'map'>('doc')
  const [versions, setVersions] = useState(false)
  const chats = conversations.filter((c) => c.researchId === r.id)

  return (
    <div className="mk-ws" data-outline={outline && mode === 'doc'}>
      <header className="mk-ws__bar">
        <a className="qx-btn qx-btn--ghost qx-btn--icon" href="#/research" aria-label="返回研究">
          <ArrowLeftIcon />
        </a>
        <button className="qx-btn qx-btn--ghost qx-btn--icon mk-only-desktop" aria-label="大纲" aria-pressed={outline} onClick={() => setOutline(!outline)}>
          <SidebarSimpleIcon />
        </button>
        <h1 className="qx-heading mk-ws__title">{r.title}</h1>
        <div className="qx-segmented mk-only-desktop" role="tablist" aria-label="视图">
          <button role="tab" aria-selected={mode === 'doc'} onClick={() => setMode('doc')}>文稿</button>
          <button role="tab" aria-selected={mode === 'map'} onClick={() => setMode('map')}>地图</button>
        </div>
        <ol className="mk-stepper">
          {stages.map((s, i) => (
            <li key={s} data-done={i < at} data-current={i === at}>
              <span>{i < at ? <CheckIcon weight="bold" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="版本历史" aria-pressed={versions} onClick={() => setVersions(!versions)}>
          <ClockCounterClockwiseIcon />
        </button>
        <button className="qx-btn qx-btn--secondary">
          <ExportIcon /> 导出
        </button>
      </header>

      <div className="mk-ws__body">
        {outline && mode === 'doc' ? (
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

        {mode === 'map' ? <ResearchMap /> : <article className="mk-ws__doc">
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
        </article>}

        <aside className="mk-ws__side">
          {versions ? (
            <div className="mk-versions">
              <h2 className="qx-heading">版本</h2>
              {[['现在', '自动保存'], ['今天 14:20', 'Agent 改写了第 2 节'], ['昨天 22:05', '你加了「访谈发现」'], ['9 月 30 日', '从对话创建']].map(([when, what], i) => (
                <button key={when} className="qx-item" aria-current={i === 0 ? 'true' : undefined}>
                  <span>{when}</span>
                  <span className="qx-item__trail">{what}</span>
                </button>
              ))}
              <button className="qx-btn qx-btn--secondary qx-btn--block" onClick={() => setVersions(false)}>回到资料</button>
            </div>
          ) : <>
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
              {chats.length ? (
                <div className="mk-ws__chats">
                  <p className="qx-group-label">这项研究里的对话</p>
                  {chats.map((c) => (
                    <a key={c.id} className="qx-item" href={`#/c/${c.id}`}>
                      <ChatCircleIcon /> <span>{c.title}</span>
                    </a>
                  ))}
                </div>
              ) : null}
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
          </>}
        </aside>
      </div>
    </div>
  )
}

/*
 * 研究地图：现在 ResearchMapCanvas 的画布。问题在上，几条线索往下分，每条线索挂着支撑它的资料。
 * 它和文稿是同一份研究的两种看法，所以是切换，不是另一个页面。
 */
function ResearchMap() {
  const threads = [
    { title: '第三空间的定义', mats: ['m1', 'm5'] },
    { title: '中国语境的反例', mats: ['m2', 'm7'] },
    { title: '访谈要问什么', mats: ['m3'] },
  ]
  return (
    <div className="mk-map">
      <div className="qx-card mk-map__root">年轻人在大城市里还需要第三空间吗？</div>
      <div className="mk-map__threads">
        {threads.map((t) => (
          <div key={t.title} className="mk-map__thread">
            <div className="qx-card mk-map__node">{t.title}</div>
            {t.mats.map((id) => (
              <a key={id} className="qx-card qx-card--interactive mk-map__mat" href={`#/library/${id}`}>
                <KindIcon kind={materialById[id].kind} /> {materialById[id].title}
              </a>
            ))}
          </div>
        ))}
        <button className="qx-card qx-card--muted mk-map__add">
          <PlusIcon /> 加一条线索
        </button>
      </div>
    </div>
  )
}
