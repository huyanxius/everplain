import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowCounterClockwiseIcon,
  BooksIcon,
  ChatCircleIcon,
  CheckIcon,
  FileTextIcon,
  GraphIcon,
  HouseIcon,
  ImageIcon,
  LinkSimpleIcon,
  MicrophoneIcon,
  NotePencilIcon,
  PlayIcon,
  SparkleIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react'
import { AgentAvatar } from '../../modules/agent-avatar'
import claudeMark from '../../assets/models/claude.svg'
import chatgptMark from '../../assets/models/chatgpt.svg'
import geminiMark from '../../assets/models/gemini.svg'
import { prefersReducedMotion, useTimeline } from './useReveal'

/*
 * 官网上的产品演示全部是写死的示例数据，不发任何模型或接口请求。
 * 三段演示讲的是同一个人、同一篇论文：收进来的资料、整理出来的概念、对话里被引用的出处是同一批东西。
 * 改一处时记得三段一起对上。
 *
 * 每段演示都放在一个「产品窗口」里（DemoWindow），长得和真实应用一样：窗口栏、迷你侧栏、内容区。
 * 访客看到的是 Everplain 用起来的样子，而不是几张飘着的说明卡片。
 */

/**
 * 演示循环播放：在视口里才播；播完停留 HOLD 毫秒，淡出后用新的 key 重新挂载，
 * 所有内部状态一起归零重来。离开视口就停在当前这一轮，回来再接着循环。
 * 减少动态效果时只显示终态，不循环。
 */
const HOLD = 3600
const FADE = 520
function LoopingDemo({ label, className, children }: { label: string; className: string; children: (props: { active: boolean; onDone: () => void }) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [cycle, setCycle] = useState(0)
  const [done, setDone] = useState(false)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const node = host.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!done || !visible || prefersReducedMotion()) return
    const fade = window.setTimeout(() => setFading(true), HOLD)
    const restart = window.setTimeout(() => { setDone(false); setFading(false); setCycle(value => value + 1) }, HOLD + FADE)
    return () => { window.clearTimeout(fade); window.clearTimeout(restart) }
  }, [done, visible])
  const onDone = useCallback(() => setDone(true), [])
  return <div className={`ep-demo ${className}`} ref={host} aria-label={label}>
    <div className="ep-demo-stage" data-fading={fading} key={cycle}>{children({ active: visible || cycle > 0, onDone })}</div>
  </div>
}

type NavKey = 'home' | 'library' | 'graph' | 'chat'
const nav: { key: NavKey; label: string; icon: Icon }[] = [
  { key: 'home', label: '首页', icon: HouseIcon },
  { key: 'library', label: '知识库', icon: BooksIcon },
  { key: 'graph', label: '图谱', icon: GraphIcon },
  { key: 'chat', label: '对话', icon: ChatCircleIcon },
]

/** 产品窗口的外壳：窗口栏 + 迷你侧栏 + 内容。侧栏只是布景，窄屏时收起。 */
function DemoWindow({ title, active, children, aside }: { title: string; active: NavKey; children: ReactNode; aside?: ReactNode }) {
  return <div className="ep-window" aria-hidden={false}>
    <div className="ep-window__bar" aria-hidden="true"><i /><i /><i /><span>{title}</span></div>
    <div className="ep-window__body">
      <nav className="ep-window__side" aria-hidden="true">
        <span className="ep-window__brand"><span className="ep-brand-mark" />Everplain</span>
        {nav.map(item => <span key={item.key} className="ep-window__nav" data-on={item.key === active}><item.icon size={15} />{item.label}</span>)}
        <span className="ep-window__agent"><AgentAvatar avatar="cheng" size={22} playing={false} />澄</span>
      </nav>
      <div className="ep-window__main">{children}</div>
      {aside}
    </div>
  </div>
}


type Kind = 'web' | 'image' | 'audio' | 'video' | 'note' | 'pdf'
const kindIcon: Record<Kind, Icon> = { web: LinkSimpleIcon, image: ImageIcon, audio: MicrophoneIcon, video: PlayIcon, note: NotePencilIcon, pdf: FileTextIcon }
/* ---------------- 二、一键建成知识库 ---------------- */

const collection: { id: string; kind: Kind; title: string; status: string }[] = [
  { id: 'web', kind: 'web', title: '为什么我们越来越难说真话', status: '已存全文' },
  { id: 'video', kind: 'video', title: '沉默的螺旋，十分钟讲清楚', status: '已转写' },
  { id: 'image', kind: 'image', title: '展览里拍下的说明牌', status: '已识别文字' },
  { id: 'paper', kind: 'pdf', title: '公共讨论中的自我审查', status: '已解析' },
  { id: 'note', kind: 'note', title: '好几个人都说「算了，不说了」', status: '已记下' },
]
/* 概念板四角：kind 决定类别色，pos 是四个角。 */
const outline = [
  { kind: '概念', name: '沉默的螺旋', from: '视频 07:12 · 论文 第 4 页', tone: 'blue', pos: 'nw' },
  { kind: '概念', name: '自我审查', from: '论文 第 4 页 · 长文', tone: 'violet', pos: 'ne' },
  { kind: '现象', name: '「算了，不说了」', from: '随手记 · 展览说明牌', tone: 'amber', pos: 'sw' },
  { kind: '关联', name: '觉得自己是少数 → 更倾向沉默', from: '由 3 份资料连起来', tone: 'green', pos: 'se' },
] as const

export function LibraryDemo() {
  return <LoopingDemo label="知识库演示" className="ep-library">{props => <LibraryStage {...props} />}</LoopingDemo>
}

/* 1-10 五条收藏各两拍（落进来、读完）；11 按下一键整理；12 主题；13-16 概念逐个长出来；17 切到「给 AI 用」 */
function LibraryStage({ active, onDone }: { active: boolean; onDone: () => void }) {
  const { step, done } = useTimeline(active, [300, 420, 260, 420, 260, 420, 260, 420, 260, 420, 700, 500, 360, 360, 360, 360, 1600])
  useEffect(() => { if (done) onDone() }, [done, onDone])
  const organized = step >= 12
  const forAI = step >= 17
  return <DemoWindow title="知识库" active="graph">
    <div className="ep-library-grid">
      <section className="ep-inbox-pane">
        <header><span>收藏</span><span>{Math.min(collection.length, Math.ceil(step / 2))} 条</span></header>
        <ul className="ep-inbox">
          {collection.map((item, index) => {
            const arrive = index * 2 + 1
            const Glyph = kindIcon[item.kind]
            return <li key={item.id} data-state={step < arrive ? 'hidden' : step === arrive ? 'arriving' : organized ? 'filed' : 'ready'}>
              <Glyph size={15} aria-hidden="true" /><span className="ep-inbox-title">{item.title}</span>
              <small>{step === arrive ? '读取中' : item.status}</small>
            </li>
          })}
        </ul>
        <span className="ep-organize-button" data-pressed={step === 11} data-done={organized}>
          {organized ? <><CheckIcon size={13} weight="bold" />已整理</> : <><SparkleIcon size={13} weight="fill" />一键整理</>}
        </span>
      </section>
      <section className="ep-board-pane">
        <header>
          <span>我的知识库</span>
          <span className="ep-view-switch" aria-hidden="true"><i data-on={!forAI}>给你看</i><i data-on={forAI}>给 AI 用</i></span>
        </header>
        <div className="ep-result-views">
          <div className="ep-outline" data-shown={organized && !forAI}>
            <svg className="ep-board-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {outline.map((row, index) => <path key={row.pos} data-tone={row.tone} data-shown={step >= index + 13}
                d={{ nw: 'M50 50 C40 50 30 40 22 28', ne: 'M50 50 C60 50 70 40 78 28', sw: 'M50 50 C40 50 30 60 22 72', se: 'M50 50 C60 50 70 60 78 72' }[row.pos]} />)}
            </svg>
            <h3 data-shown={organized}>公共讨论中的沉默</h3>
            <ul>{outline.map((row, index) => <li key={row.name} data-pos={row.pos} data-tone={row.tone} data-shown={step >= index + 13}>
              <span className="ep-outline-kind">{row.kind}</span><strong>{row.name}</strong><small>{row.from}</small>
            </li>)}</ul>
          </div>
          <div className="ep-for-ai" data-shown={forAI}>
            <p>你问起论文第三章时，你的 AI 从这里取材：</p>
            <ul>{outline.slice(0, 3).map((row, index) => <li key={row.name}><span className="ep-source-n">{index + 1}</span><strong>{row.name}</strong><small>{row.from}</small></li>)}</ul>
            <p className="ep-for-ai-note">回答里的每一句，都能点回原文。</p>
          </div>
        </div>
      </section>
    </div>
  </DemoWindow>
}

/* ---------------- 三、只属于你的 AI ---------------- */

const question = '上个月看的那个，讲人为什么不敢说真话的视频，和我论文第三章有关系吗？'
const answer: { text: string; cite?: number }[] = [
  { text: '有。那是你收藏的《沉默的螺旋，十分钟讲清楚》，07:12 讲到：人一旦觉得自己是少数，就更倾向于沉默' },
  { text: '', cite: 2 },
  { text: '。这和你 9 月 12 日记下的「算了，不说了」是同一件事' },
  { text: '', cite: 1 },
  { text: '。第三章可以先写这个现象，再用论文里「自我审查」的概念解释它' },
  { text: '', cite: 3 },
  { text: '。' },
]
const sources = [
  { n: 1, kind: '随手记', title: '好几个人都说「算了，不说了」', icon: NotePencilIcon, excerpt: '组会上问大家对新规定的看法，好几个人都说「算了，不说了」。是不想说，还是觉得说了也没用？' },
  { n: 2, kind: '视频 07:12', title: '沉默的螺旋，十分钟讲清楚', icon: PlayIcon, excerpt: '当一个人觉得自己的看法属于少数，他公开表达的意愿就会下降——沉默又让这种看法显得更少。' },
  { n: 3, kind: '论文 第 4 页', title: '公共讨论中的自我审查', icon: FileTextIcon, excerpt: '自我审查并不总是来自外部压力，更多时候是个体对社交代价的预判。' },
]
const answerLength = answer.reduce((sum, part) => sum + (part.cite ? 1 : part.text.length), 0)

export function CompanionDemo() {
  return <LoopingDemo label="对话演示" className="ep-chat">{props => <CompanionStage {...props} />}</LoopingDemo>
}

function CompanionStage({ active, onDone }: { active: boolean; onDone: () => void }) {
  const [shownChars, setShownChars] = useState(0)
  const [focus, setFocus] = useState<number | null>(null)
  const [touched, setTouched] = useState(false)
  // 1 问题出现  2 「在你的知识库里找」  3 开始回答
  const { step } = useTimeline(active, [400, 800, 1100])
  useEffect(() => {
    if (step < 3) return
    if (prefersReducedMotion()) { setShownChars(answerLength); return }
    let count = 0
    const timer = window.setInterval(() => {
      count += 2
      setShownChars(Math.min(count, answerLength))
      if (count >= answerLength) window.clearInterval(timer)
    }, 38)
    return () => window.clearInterval(timer)
  }, [step])
  const finished = shownChars >= answerLength
  // 回答写完后依次点亮三个出处，右侧抽屉跟着翻到那一份；访客点过就以访客为准
  const { step: citeStep, done } = useTimeline(finished, [600, 1000, 1000, 1000])
  useEffect(() => { if (done) onDone() }, [done, onDone])
  const current = touched ? focus : citeStep >= 1 && citeStep <= 3 ? [2, 1, 3][citeStep - 1] : null
  const opened = sources.find(source => source.n === current)
  let budget = shownChars
  const pick = (n: number) => { setTouched(true); setFocus(current === n ? null : n) }
  return <DemoWindow title="第三章的思路" active="chat" aside={
    <aside className="ep-source-drawer" data-open={Boolean(opened)} aria-hidden={!opened}>
      {opened ? <>
        <span className="ep-drawer-kind"><opened.icon size={13} />{opened.kind}</span>
        <h5>{opened.title}</h5>
        <blockquote>{opened.excerpt}</blockquote>
        <small>在知识库里打开 ↗</small>
      </> : null}
    </aside>
  }>
    <div className="ep-thread">
      <p className="ep-bubble" data-shown={step >= 1}>{question}</p>
      <div className="ep-turn" data-shown={step >= 2}>
        <AgentAvatar avatar="cheng" size={28} state={step === 2 ? 'think' : 'idle'} />
        <div className="ep-turn__body">
          <p className="ep-thinking" data-shown={step === 2}>在你的知识库里找…</p>
          <div className="ep-reply" data-shown={step >= 3}>
            <p>{answer.map((part, index) => {
              if (budget <= 0) return null
              if (part.cite) {
                budget -= 1
                return <button key={index} type="button" className="ep-cite" aria-pressed={current === part.cite} aria-label={`查看来源 ${part.cite}`} onClick={() => pick(part.cite!)}>{part.cite}</button>
              }
              const visible = part.text.slice(0, budget)
              budget -= part.text.length
              return <span key={index}>{visible}</span>
            })}{!finished && step >= 3 && <i className="ep-caret" aria-hidden="true" />}</p>
            <ol className="ep-sources" data-shown={finished}>
              {sources.map(source => <li key={source.n} data-focus={current === source.n} onClick={() => pick(source.n)}>
                <span className="ep-source-n">{source.n}</span>{source.title}
              </li>)}
            </ol>
          </div>
        </div>
      </div>
    </div>
    <div className="ep-ask" aria-hidden="true"><span>接着问</span><i /></div>
  </DemoWindow>
}

const initialMemories = [
  { id: 'thesis', text: '在写毕业论文，第三章关于公共讨论中的沉默' },
  { id: 'examples', text: '喜欢先看具体例子，再谈概念' },
  { id: 'apa', text: '参考文献用 APA 格式' },
  { id: 'tone', text: '说话直接一点，不用客套' },
]

export function MemoryDemo() {
  const [memories, setMemories] = useState(initialMemories)
  const [forgotten, setForgotten] = useState<typeof initialMemories[number] | null>(null)
  const forget = (id: string) => {
    const item = memories.find(memory => memory.id === id)
    if (!item) return
    setMemories(memories.filter(memory => memory.id !== id))
    setForgotten(item)
  }
  const undo = () => {
    if (!forgotten) return
    setMemories(initialMemories.filter(memory => memory.id === forgotten.id || memories.some(kept => kept.id === memory.id)))
    setForgotten(null)
  }
  return <aside className="ep-memory" aria-label="记忆演示">
    <header className="ep-memory__head">
      <AgentAvatar avatar="cheng" size={40} state="greet" />
      <span><strong>它记得你</strong><small>{memories.length} 条</small></span>
    </header>
    <ul>
      {memories.map(memory => <li key={memory.id}>
        <span>{memory.text}</span>
        <button type="button" aria-label={`忘掉：${memory.text}`} onClick={() => forget(memory.id)}><XIcon size={14} aria-hidden="true" /></button>
      </li>)}
    </ul>
    <p className="ep-memory-toast" role="status">
      {forgotten ? <>已忘掉这一条。<button type="button" onClick={undo}>撤销</button></> : '记住什么，你说了算。点 × 试试。'}
    </p>
    {memories.length < initialMemories.length && !forgotten && <button type="button" className="ep-restore" onClick={() => setMemories(initialMemories)}><ArrowCounterClockwiseIcon size={13} aria-hidden="true" />恢复示例</button>}
  </aside>
}

/* 名字按供应商接口里实际可用的型号写（2026-09-30 核对），上线前再对一次。 */
const models = [
  { provider: 'Anthropic', name: 'Claude Opus 5.5', mark: claudeMark },
  { provider: 'OpenAI', name: 'GPT-6 Sol', mark: chatgptMark },
  { provider: 'Google', name: 'Gemini 3.1 Pro', mark: geminiMark },
  { provider: 'Anthropic', name: 'Claude Fable 5.1', mark: claudeMark },
  { provider: 'OpenAI', name: 'GPT-6 Luna', mark: chatgptMark },
  { provider: 'Google', name: 'Gemini 3.8 Flash', mark: geminiMark },
]

/** 模型卡片沿一条扁椭圆缓慢转动，靠后的更小更淡，模拟纵深。窄屏不转，改成静态排列。 */
export function ModelOrbit() {
  const stage = useRef<HTMLDivElement>(null)
  const tiles = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    const host = stage.current
    if (!host) return
    let frame = 0
    let visible = true
    // 手机上同样转，只是轨道压扁、单独占一块舞台，不再环绕标题（窄屏里卡片会压住字）
    const narrow = window.matchMedia?.('(max-width: 640px)')
    const place = (time: number) => {
      const { width, height } = host.getBoundingClientRect()
      const flat = narrow?.matches
      const rx = width * (flat ? 0.34 : 0.4), ry = height * (flat ? 0.34 : 0.4), cx = width / 2, cy = height * (flat ? 0.5 : 0.52)
      tiles.current.forEach((tile, index) => {
        if (!tile) return
        const angle = time / 12000 + (index / models.length) * Math.PI * 2 + Math.PI / 2
        const depth = (Math.sin(angle) + 1) / 2 // 0 在后，1 在前
        tile.style.transform = `translate(${cx + Math.cos(angle) * rx}px, ${cy + Math.sin(angle) * ry}px) translate(-50%, -50%) scale(${0.8 + depth * 0.24})`
        tile.style.opacity = String(0.4 + depth * 0.6)
        tile.style.zIndex = String(Math.round(depth * 10))
      })
    }
    const loop = (time: number) => { place(time); if (visible) frame = requestAnimationFrame(loop) }
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') { place(0); return }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancelAnimationFrame(frame)
      if (visible) frame = requestAnimationFrame(loop)
    })
    observer?.observe(host)
    frame = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(frame); observer?.disconnect() }
  }, [])
  return <div className="ep-orbit" ref={stage} role="list" aria-label="模型示意">
    <svg className="ep-orbit-ring" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="52" rx="40" ry="40" vectorEffect="non-scaling-stroke" /></svg>
    {models.map((model, index) => <div key={model.name} role="listitem" className="ep-orbit-tile" ref={node => { tiles.current[index] = node }}>
      <img src={model.mark} alt="" />
      <span><strong>{model.name}</strong><small>{model.provider}</small></span>
    </div>)}
  </div>
}
