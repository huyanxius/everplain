import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowCounterClockwiseIcon, FileTextIcon, ImageIcon, LinkSimpleIcon, NotePencilIcon, PlayIcon, XIcon } from '@phosphor-icons/react'
import claudeMark from '../../assets/models/claude.svg'
import chatgptMark from '../../assets/models/chatgpt.svg'
import geminiMark from '../../assets/models/gemini.svg'
import { prefersReducedMotion, useTimeline } from './useReveal'

/*
 * 官网上的产品演示全部是写死的示例数据，不发任何模型或接口请求。
 * 两段演示讲的是同一个人、同一篇论文：知识库里整理出来的概念和出处，
 * 就是对话里被引用的那几条。改一处时记得两段一起对上。
 */
const collection = [
  { id: 'web', icon: LinkSimpleIcon, title: '为什么我们越来越难说真话', status: '已存全文' },
  { id: 'video', icon: PlayIcon, title: '沉默的螺旋，十分钟讲清楚', status: '已转写' },
  { id: 'image', icon: ImageIcon, title: '展览里拍下的说明牌', status: '已识别文字' },
  { id: 'paper', icon: FileTextIcon, title: '公共讨论中的自我审查', status: '已解析' },
  { id: 'note', icon: NotePencilIcon, title: '好几个人都说「算了，不说了」', status: '已记下' },
] as const

const outline = [
  { kind: '概念', name: '沉默的螺旋', from: '视频 07:12 · 论文 第 4 页' },
  { kind: '概念', name: '自我审查', from: '论文 第 4 页 · 长文' },
  { kind: '现象', name: '「算了，不说了」', from: '随手记 · 展览说明牌' },
  { kind: '关联', name: '觉得自己是少数 → 更倾向沉默', from: '由 3 份资料连起来' },
]

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

/*
 * 收到一处：零散的东西先各自漂在原来的地方，再整整齐齐落进「我的空间」的网格里。
 * x / y 是宽屏漂浮时的百分比位置，mx / my 是窄屏的；百分比同时用来反向平移卡片自身，
 * 所以 0 贴左/上边、100 贴右/下边，不会溢出画布。落位后的网格位置按序号算，不用手写。
 */
const scattered = [
  { from: '聊天记录', text: '朋友转来的一篇长文', status: '已存全文', x: 2, y: 4, mx: 0, my: 0, r: -4 },
  { from: '浏览器', text: '没读完的网页', status: '已存全文', x: 50, y: 0, mx: 100, my: 0, r: 2 },
  { from: '相册', text: '展览里拍下的说明牌', status: '已识别文字', x: 98, y: 6, mx: 0, my: 33, r: 3 },
  { from: '截图', text: '一段课堂板书', status: '已识别文字', x: 0, y: 52, mx: 100, my: 33, r: 5 },
  { from: '语音', text: '路上想到的一句话', status: '已转写', x: 100, y: 46, mx: 0, my: 66, r: -5 },
  { from: '收藏夹', text: '一个十分钟的讲解视频', status: '已转写', x: 4, y: 98, mx: 100, my: 66, r: 2 },
  { from: '备忘录', text: '「算了，不说了」', status: '已记下', x: 48, y: 100, mx: 0, my: 100, r: -2 },
  { from: '下载', text: '导师发的论文 PDF', status: '已解析', x: 96, y: 94, mx: 100, my: 100, r: -3 },
]
const spaceFilters = ['全部', '文章', '图片', '视频', '文档', '笔记']

export function GatherDemo() {
  return <LoopingDemo label="收集演示" className="ep-gather">{props => <GatherStage {...props} />}</LoopingDemo>
}

function GatherStage({ active, onDone }: { active: boolean; onDone: () => void }) {
  // 1-8 各处的东西依次浮现  9 停一拍  10 一起落进空间的网格  11-18 逐条读完
  const { step, done } = useTimeline(active, [200, 220, 220, 220, 220, 220, 220, 220, 1300, 900, 260, 180, 180, 180, 180, 180, 180, 180])
  useEffect(() => { if (done) onDone() }, [done, onDone])
  const gathered = step >= 10
  return <div className="ep-gather-canvas" data-gathered={gathered}>
    <div className="ep-space-frame" aria-hidden={!gathered}>
      <div className="ep-space-bar">
        <span className="ep-space-title">我的空间</span>
        <span className="ep-space-filters">{spaceFilters.map((filter, index) => <i key={filter} data-on={index === 0}>{filter}</i>)}</span>
        <span className="ep-space-count">{gathered ? scattered.length : 0} 条</span>
      </div>
    </div>
    {scattered.map((item, index) => <div key={item.text} className="ep-drift" data-shown={step >= index + 1} data-read={step >= index + 11}
      style={{ '--x': `${item.x}%`, '--y': `${item.y}%`, '--mx': `${item.mx}%`, '--my': `${item.my}%`, '--r': `${item.r}deg`, '--d': `${index * -0.7}s`,
        '--gx': index % 4, '--gy': Math.floor(index / 4), '--mgx': index % 2, '--mgy': Math.floor(index / 2), '--i': index } as CSSProperties}>
      <small>{item.from}</small><span>{item.text}</span><em>{step >= index + 11 ? item.status : '读取中'}</em>
    </div>)}
  </div>
}

export function LibraryDemo() {
  return <LoopingDemo label="知识库演示" className="ep-library">{props => <LibraryStage {...props} />}</LoopingDemo>
}

function LibraryStage({ active, onDone }: { active: boolean; onDone: () => void }) {
  // 1-10 五条收藏各两拍（落进来、读完）  11 按下一键整理  12 主题  13-16 结构逐行  17 切到「给 AI 用」
  const { step, done } = useTimeline(active, [300, 420, 260, 420, 260, 420, 260, 420, 260, 420, 700, 500, 360, 360, 360, 360, 1600])
  useEffect(() => { if (done) onDone() }, [done, onDone])
  const organized = step >= 12
  const forAI = step >= 17
  return <div className="ep-library-grid">
    <div className="ep-pane">
      <div className="ep-pane-head"><span>收藏</span><span>{Math.min(collection.length, Math.ceil(step / 2))} 条</span></div>
      <ul className="ep-inbox">
        {collection.map((item, index) => {
          const arrive = index * 2 + 1
          const Icon = item.icon
          return <li key={item.id} data-state={step < arrive ? 'hidden' : step === arrive ? 'arriving' : organized ? 'filed' : 'ready'}>
            <Icon size={15} aria-hidden="true" /><span className="ep-inbox-title">{item.title}</span>
            <small>{step === arrive ? '读取中' : item.status}</small>
          </li>
        })}
      </ul>
    </div>
    <div className="ep-library-action">
      <span className="ep-organize-button" data-pressed={step === 11} data-done={organized}>{organized ? '已整理' : '一键整理'}</span>
    </div>
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>我的知识库</span>
        <span className="ep-view-switch" aria-hidden="true"><i data-on={!forAI}>给你看</i><i data-on={forAI}>给 AI 用</i></span>
      </div>
      <div className="ep-result-views">
        <div className="ep-outline" data-shown={organized && !forAI}>
          <h3 data-shown={organized}>公共讨论中的沉默</h3>
          <ul>{outline.map((row, index) => <li key={row.name} data-shown={step >= index + 13}>
            <span className="ep-outline-kind">{row.kind}</span><strong>{row.name}</strong><small>{row.from}</small>
          </li>)}</ul>
        </div>
        <div className="ep-for-ai" data-shown={forAI}>
          <p>你问起论文第三章时，你的 AI 从这里取材：</p>
          <ul>{outline.slice(0, 3).map((row, index) => <li key={row.name}><span className="ep-source-n">{index + 1}</span><strong>{row.name}</strong><small>{row.from}</small></li>)}</ul>
          <p className="ep-for-ai-note">回答里的每一句，都能点回原文。</p>
        </div>
      </div>
    </div>
  </div>
}

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
  { n: 1, kind: '随手记', title: '好几个人都说「算了，不说了」' },
  { n: 2, kind: '视频 07:12', title: '沉默的螺旋，十分钟讲清楚' },
  { n: 3, kind: '论文 第 4 页', title: '公共讨论中的自我审查' },
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
  // 回答写完后依次点亮三个出处；访客点过就以访客为准
  const { step: citeStep, done } = useTimeline(finished, [600, 1000, 1000, 1000])
  useEffect(() => { if (done) onDone() }, [done, onDone])
  const current = touched ? focus : citeStep >= 1 && citeStep <= 3 ? [2, 1, 3][citeStep - 1] : null
  let budget = shownChars
  return <>
    <p className="ep-bubble" data-shown={step >= 1}>{question}</p>
    <p className="ep-thinking" data-shown={step === 2}>在你的知识库里找…</p>
    <div className="ep-reply" data-shown={step >= 3}>
      <p>{answer.map((part, index) => {
        if (budget <= 0) return null
        if (part.cite) {
          budget -= 1
          return <button key={index} type="button" className="ep-cite" aria-pressed={current === part.cite} aria-label={`查看来源 ${part.cite}`} onClick={() => { setTouched(true); setFocus(current === part.cite ? null : part.cite!) }}>{part.cite}</button>
        }
        const visible = part.text.slice(0, budget)
        budget -= part.text.length
        return <span key={index}>{visible}</span>
      })}{!finished && step >= 3 && <i className="ep-caret" aria-hidden="true" />}</p>
      <ol className="ep-sources" data-shown={finished}>
        {sources.map(source => <li key={source.n} data-focus={current === source.n}>
          <span className="ep-source-n">{source.n}</span><span className="ep-source-kind">{source.kind}</span>{source.title}
        </li>)}
      </ol>
    </div>
  </>
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
    <div className="ep-pane-head"><span>它记得你</span><span>{memories.length} 条</span></div>
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
    const narrow = window.matchMedia?.('(max-width: 640px)')
    const place = (time: number) => {
      if (narrow?.matches) {
        tiles.current.forEach(tile => { if (tile) { tile.style.transform = ''; tile.style.opacity = ''; tile.style.zIndex = '' } })
        return
      }
      const { width, height } = host.getBoundingClientRect()
      const rx = width * 0.4, ry = height * 0.4, cx = width / 2, cy = height * 0.52
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
  return <div className="ep-orbit" ref={stage} role="list" aria-label="可用模型">
    <svg className="ep-orbit-ring" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="52" rx="40" ry="40" vectorEffect="non-scaling-stroke" /></svg>
    {models.map((model, index) => <div key={model.name} role="listitem" className="ep-orbit-tile" ref={node => { tiles.current[index] = node }}>
      <img src={model.mark} alt="" />
      <span><strong>{model.name}</strong><small>{model.provider}</small></span>
    </div>)}
  </div>
}
