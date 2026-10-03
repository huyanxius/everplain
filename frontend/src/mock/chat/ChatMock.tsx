import { useState, type ReactNode } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BooksIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeHemisphereWestIcon,
  GlobeIcon,
  PlusIcon,
  SidebarSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'

/*
 * /agent 对话页的视觉参照，只看样子，不是交互稿。两种模式各摆一屏：
 *   对话：一轮带引用和工具过程的完整回答 + 一轮没查资料的回答；
 *   研究：研究意图 → 计划 → 完成的研究卡片 + 研究回答。
 * 真实功能以 ResearchAgentConversationPage 和 conversation-view/ 为准，这里只决定它们放在哪、长什么样。
 *
 * 和现在的页面相比，位置上的改动只有四处：
 *   1. 模式切换写成「对话 / 研究」两个字，不再用头像当第一个标签；
 *   2. 知识来源、联网搜索从「⋯」菜单挪到输入框底栏——它们决定每条消息怎么答，不该藏起来；
 *   3. 研究面板按钮带引用数，常驻顶栏右侧；Agent 状态（等待消息/查找资料/正在回复…）跟在标题后面，不再单独一条；
 *   4. 研究模式的项目、材料库并进输入框底栏；问题示例在空状态里直接摆出来，不再折叠成「问题示例」。
 * 工具过程那一行改成人话（"查了知识库 2 次、网页 1 次"），展开后的内容照原样。
 */
type Mode = 'chat' | 'research'

const agent = { name: '澄', avatar: 'cheng' as const, color: '#5d8fe6' }

export function ChatMock() {
  const [mode, setMode] = useState<Mode>(() => (window.location.hash === '#research' ? 'research' : 'chat'))
  const [panel, setPanel] = useState(true)
  const switchMode = (next: Mode) => {
    setMode(next)
    window.location.hash = next
  }
  const sources = mode === 'chat' ? chatSources : researchSources

  return (
    <div className="ch-page" data-panel={panel}>
      <section className="ch-main" aria-label="Everplain 对话">
        <header className="ch-top">
          <div className="ch-top__title">
            <h1 className="qx-chat-title">{mode === 'chat' ? '第三空间的支持与反驳' : '年轻人还需要第三空间吗'}</h1>
            <span className="ch-status" role="status">
              <AgentAvatar avatar={agent.avatar} color={agent.color} size={20} playing={false} />
              等待消息
            </span>
          </div>
          <div className="qx-segmented ch-modes" role="tablist" aria-label="对话 / 研究">
            <button role="tab" aria-selected={mode === 'chat'} onClick={() => switchMode('chat')}>对话</button>
            <button role="tab" aria-selected={mode === 'research'} onClick={() => switchMode('research')}>研究</button>
          </div>
          <div className="ch-top__actions">
            <button className="qx-btn qx-btn--ghost" aria-pressed={panel} onClick={() => setPanel(!panel)}>
              <SidebarSimpleIcon /> 来源 <span className="ch-count">{sources.length}</span>
            </button>
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="更多对话操作"><DotsThreeIcon weight="bold" /></button>
          </div>
        </header>

        <div className="ch-scroll" role="log" aria-label="对话内容">
          <div className="ch-thread">{mode === 'chat' ? <ChatThread /> : <ResearchThread />}</div>
        </div>

        <div className="ch-compose">
          <Composer mode={mode} />
        </div>
      </section>

      {panel ? <SourcePanel sources={sources} research={mode === 'research'} onClose={() => setPanel(false)} /> : null}
    </div>
  )
}

/* ---------------- 对话 ---------------- */

function ChatThread() {
  return (
    <>
      <Turn question="第三空间这个概念，我的资料里有哪些支持和反驳？">
        <Activity summary="查了知识库 2 次、网页 1 次" steps={['检索知识库', '读取知识条目', '搜索公开网页']} />
        <div className="qx-prose ch-answer">
          <p>
            支持的有两处。奥尔登堡的原始定义强调"中立地带"和"常客"<Cite n={1} />，你的访谈提纲也正好在追问"上一次和陌生人聊天在哪里"<Cite n={2} />。
          </p>
          <p>
            反驳主要来自对中国城市的观察：熟人关系沿着亲疏一圈圈推出去，公共场所里的陌生人关系本来就弱<Cite n={3} />。这和奥尔登堡默认的前提不一样。
          </p>
          <p>如果要写进论文，可以把这个张力当成问题本身。</p>
        </div>
        <Sources items={chatSources} />
        <Handoff
          label="研究建议"
          title="中国城市里的年轻人，是在复制第三空间，还是在发明别的东西？"
          actions={[{ label: '去新建研究', primary: true }]}
        />
        <TurnActions />
      </Turn>

      <Turn question="那你觉得我该先读哪一本？">
        <div className="qx-prose ch-answer">
          <p>先读奥尔登堡的《绝好的地方》第二章，它把八个特征讲得最清楚，后面你判断案例时都要用到。</p>
        </div>
        <p className="ch-provenance"><WarningCircleIcon /> 未调用知识库 · 以下内容仅作工作假设，请结合材料核验。</p>
        <TurnActions />
      </Turn>
    </>
  )
}

/* ---------------- 研究 ---------------- */

function ResearchThread() {
  return (
    <>
      <div className="ch-question"><div className="qx-bubble">年轻人在大城市里还需要第三空间吗？</div></div>

      <ResearchCard label="确认研究意图" title="你更想从哪个角度看？">
        <div className="ch-options" role="radiogroup">
          {['概念与理论背景', '现实案例与最新资料', '不同观点之间的争议', '研究方法与数据'].map((o, i) => (
            <button key={o} className="qx-btn qx-btn--ghost" role="radio" aria-checked={i === 2} disabled>{o}</button>
          ))}
        </div>
      </ResearchCard>

      <ResearchCard label="研究计划" title="围绕「不同观点之间的争议」">
        <ol className="ch-plan">
          <li data-done="true">拆解研究问题</li>
          <li data-done="true">检索知识库与个人材料</li>
          <li data-done="true">补充并阅读公开网页</li>
          <li data-done="true">核对来源，整理研究结论</li>
        </ol>
        <p className="qx-meta">用时 4 分 12 秒</p>
        <progress className="ch-progress" max={100} value={100} aria-label="研究进度" />
      </ResearchCard>

      <Turn question="">
        <Activity summary="查了知识库 3 次、个人材料 2 次、网页 4 次" steps={['检索知识库', '检索研究材料', '读取研究材料原文', '搜索公开网页', '读取网页正文']} />
        <div className="qx-prose ch-answer">
          <h3>结论</h3>
          <p>
            "需要"不成问题，变的是形态。受访者很少提到咖啡馆，更多说的是便利店门口、小区篮球场和自习室<Cite n={2} />；这些地方没有奥尔登堡说的"常客文化"<Cite n={1} />，但提供了低成本的照面。
          </p>
          <h3>分歧</h3>
          <p>
            一派认为这是第三空间的衰落<Cite n={4} />，另一派认为是被平台化的社交替代了<Cite n={5} />。你的访谈材料更支持后一种，但样本只有 12 人。
          </p>
        </div>
        <Sources items={researchSources} />
      </Turn>

      <ResearchCard label="研究结论" title="已完成" done>
        <p className="qx-meta">知识库 3 条 · 网页资料 4 条</p>
        <div className="ch-card-actions">
          <button className="qx-btn qx-btn--ghost"><DownloadSimpleIcon /> 下载 Word</button>
          <button className="qx-btn qx-btn--ghost"><FilePdfIcon /> 下载 PDF</button>
          <button className="qx-btn qx-btn--primary">继续形成研究 <ArrowRightIcon /></button>
        </div>
      </ResearchCard>
    </>
  )
}

function ResearchCard({ label, title, done, children }: { label: string; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="ch-rcard" aria-label={label}>
      <p className="ch-rcard__label">{done ? <CheckCircleIcon /> : null}{label}</p>
      <h2 className="qx-card__title">{title}</h2>
      {children}
    </section>
  )
}

/* ---------------- 回合 ---------------- */

function Turn({ question, children }: { question: string; children: ReactNode }) {
  return (
    <article className="ch-turn">
      {question ? <div className="ch-question"><div className="qx-bubble">{question}</div></div> : null}
      <div className="ch-answer-row">
        <AgentAvatar avatar={agent.avatar} color={agent.color} size={32} playing={false} />
        <div className="ch-answer-body">{children}</div>
      </div>
    </article>
  )
}

/* 工具过程：默认一行，展开后逐步列出（名称、状态、目的、工具输入、完整返回、结果条目），每步可在来源面板打开。 */
function Activity({ summary, steps }: { summary: string; steps: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="ch-activity" aria-label="Agent 工作过程">
      <button className="ch-activity__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <CaretDownIcon /> : <CaretRightIcon />}
        <span>{summary}</span>
        <small>{steps.length} 步</small>
      </button>
      {open ? (
        <ol className="ch-activity__steps">
          {steps.map((s) => (
            <li key={s}>
              <strong>{s}</strong>
              <span className="ch-state"><CheckCircleIcon /> 已完成</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function Cite({ n }: { n: number }) {
  return <button className="qx-cite" aria-label={`来源 ${n}`}>{n}</button>
}

type Source = { n: number; kind: 'knowledge' | 'material' | 'web'; label: string }
const chatSources: Source[] = [
  { n: 1, kind: 'knowledge', label: '为什么城市需要第三空间' },
  { n: 2, kind: 'material', label: '访谈提纲草稿' },
  { n: 3, kind: 'web', label: '县城的消费与面子 · thepaper.cn' },
]
const researchSources: Source[] = [
  { n: 1, kind: 'knowledge', label: '为什么城市需要第三空间' },
  { n: 2, kind: 'material', label: '访谈记录 B · 第 4 页' },
  { n: 3, kind: 'material', label: '访谈记录 F · 第 2 页' },
  { n: 4, kind: 'web', label: '第三空间的消失 · aeon.co' },
  { n: 5, kind: 'web', label: '平台如何替代街角 · thepaper.cn' },
]

function Sources({ items }: { items: Source[] }) {
  return (
    <div className="ch-sources" aria-label="回答证据">
      {items.map((s) => (
        <button key={s.n} className="qx-tag qx-tag--outline">
          <span className="ch-num">{s.n}</span>
          <span className="ch-sources__label">{s.label}</span>
        </button>
      ))}
    </div>
  )
}

function Handoff({ label, title, actions }: { label: string; title: string; actions: { label: string; primary?: boolean }[] }) {
  return (
    <section className="ch-handoff" aria-label={label}>
      <p className="qx-meta">{label}</p>
      <h2 className="qx-card__title">{title}</h2>
      <div className="ch-card-actions">
        {actions.map((a) => (
          <button key={a.label} className={`qx-btn ${a.primary ? 'qx-btn--secondary' : 'qx-btn--ghost'}`}>{a.label} <ArrowRightIcon /></button>
        ))}
      </div>
    </section>
  )
}

function TurnActions() {
  return (
    <div className="ch-turn-actions">
      <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="复制回答"><CopyIcon /></button>
      <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="重新生成"><ArrowClockwiseIcon /></button>
    </div>
  )
}

/* ---------------- 输入框 ---------------- */

/*
 * 底栏左边是"这条消息怎么答"：附件、知识来源、联网；研究模式再加项目和材料库。右边是模型与思考强度、发送。
 * 「+」菜单仍是上传文件 / 从研究材料添加；附件以标签挂在输入框上方，带解析状态，可移除。
 */
function Composer({ mode }: { mode: Mode }) {
  const research = mode === 'research'
  return (
    <form className="ch-composer" onSubmit={(e) => e.preventDefault()}>
      <div className="ch-attachments" aria-label="本轮附件">
        <span className="qx-tag ch-attachment">
          <FileTextIcon /> 访谈记录-B.docx <span className="qx-meta">已添加</span>
          <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="移除附件"><XIcon /></button>
        </span>
        {research ? (
          <span className="qx-tag ch-attachment">
            <FileTextIcon /> 街角照片.png <span className="qx-meta">需要 OCR</span>
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="移除附件"><XIcon /></button>
          </span>
        ) : null}
      </div>
      <textarea rows={1} aria-label="问 Everplain" placeholder={research ? '描述你想弄清楚的问题' : '问一个问题'} />
      <div className="ch-composer__bar">
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加附件"><PlusIcon /></button>
        <button type="button" className="qx-btn qx-btn--ghost ch-chip"><BooksIcon /> 毕业论文 <CaretDownIcon /></button>
        <button type="button" className="qx-btn qx-btn--ghost ch-chip" aria-pressed="true"><GlobeHemisphereWestIcon /> 联网</button>
        {research ? (
          <>
            <span className="ch-sep" />
            <button type="button" className="qx-btn qx-btn--ghost ch-chip"><FolderIcon /> 城市第三空间 <CaretDownIcon /></button>
            <button type="button" className="qx-btn qx-btn--ghost ch-chip"><FolderOpenIcon /> 材料库</button>
          </>
        ) : null}
        <span className="ch-spacer" />
        <button type="button" className="qx-btn qx-btn--ghost ch-chip ch-model">GPT 6 Luna · 中 <CaretDownIcon /></button>
        <button type="submit" className="qx-btn qx-btn--primary qx-btn--icon" aria-label="发送给 Everplain"><ArrowUpIcon /></button>
      </div>
    </form>
  )
}

/* ---------------- 来源面板 ---------------- */

/*
 * 研究面板：引用按知识库 / 网页 / 你的文件分组，下面是工作流程。点一条进详情（类型、标题、摘录、引用位置、
 * 打开资料原文 / 打开原文位置 / 打开知识条目 / 在知识图谱中查看 / 打开网页），左上角返回列表。手机上是底部弹层。
 */
function SourcePanel({ sources, research, onClose }: { sources: Source[]; research: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<Source | null>(null)
  const groups: [Source['kind'], string][] = [['knowledge', '知识库'], ['web', '网页'], ['material', '你的文件']]
  return (
    <aside className="qx-panel ch-panel" aria-label="研究面板">
      <header className="ch-panel__head">
        {picked ? (
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="返回研究面板" onClick={() => setPicked(null)}><CaretRightIcon className="ch-flip" /></button>
        ) : null}
        <h2 className="qx-heading">{picked ? '引用来源' : '来源'}</h2>
        <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭研究面板" onClick={onClose}><XIcon /></button>
      </header>

      {picked ? (
        <div className="ch-detail">
          <span className="qx-tag">{picked.kind === 'web' ? <GlobeIcon /> : <FileTextIcon />}{picked.kind === 'web' ? '网页' : picked.kind === 'material' ? '研究材料' : '知识库资料'}</span>
          <h3 className="qx-card__title">{picked.label}</h3>
          <blockquote className="ch-quote">最重要的是常客。一个第三空间之所以成立，是因为每次去都能遇见几张熟悉的脸。</blockquote>
          <p className="qx-meta">引用位置：第 5 段</p>
          <div className="ch-detail__actions">
            {picked.kind === 'web' ? (
              <button className="qx-btn qx-btn--secondary">打开网页</button>
            ) : picked.kind === 'material' ? (
              <button className="qx-btn qx-btn--secondary">打开原文位置</button>
            ) : (
              <>
                <button className="qx-btn qx-btn--secondary">打开资料原文</button>
                <button className="qx-btn qx-btn--ghost">在知识图谱中查看</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="ch-panel__list">
          {groups.map(([kind, title]) => {
            const items = sources.filter((s) => s.kind === kind)
            return (
              <section key={kind}>
                <h3 className="ch-panel__group">{title}<span>{items.length}</span></h3>
                {items.map((s) => (
                  <button key={s.n} className="qx-item ch-panel__row" onClick={() => setPicked(s)}>
                    <span className="ch-num">{s.n}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </section>
            )
          })}
          <section>
            <h3 className="ch-panel__group">工作流程<span>{research ? 5 : 3}</span></h3>
            {(research ? ['检索知识库', '检索研究材料', '读取研究材料原文', '搜索公开网页', '读取网页正文'] : ['检索知识库', '读取知识条目', '搜索公开网页']).map((s) => (
              <button key={s} className="qx-item ch-panel__row">
                <span>{s}</span>
                <span className="ch-state qx-item__trail"><CheckCircleIcon /></span>
              </button>
            ))}
            <p className="ch-panel__running qx-meta"><CircleNotchIcon className="ch-spin" /> 进行中的步骤显示在这里</p>
          </section>
        </div>
      )}
    </aside>
  )
}
