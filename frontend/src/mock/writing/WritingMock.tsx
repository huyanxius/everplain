import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpIcon,
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  ExportIcon,
  FeatherIcon,
  FileTextIcon,
  ListBulletsIcon,
  MagicWandIcon,
  PlayIcon,
  PlusIcon,
  QuotesIcon,
  TextBIcon,
  TextHOneIcon,
  TextItalicIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'

/*
 * 写作工作台的 UI 参照。只做前端样子和动效，文风学习算法不在这里。
 *
 * 布局（从左到右）：
 *   应用侧栏位置 —— 由应用外壳提供，本页只占位并写明，不重复设计；
 *   工作台 —— 一整块面板：顶栏（文档切换、排版、状态、版本、导出）、正文、底部状态栏；
 *   右栏 —— 两个标签：协作（和 Agent 对话）、修订（Agent 改过什么）。文风由算法在后台学，界面不单独展示。
 *
 * 人机协作的规则：
 *   用户随时直接改正文；选中文字 → 浮条（改写 / 更像我 / 缩短 / 扩写）；在协作栏里说 → Agent 直接写进正文。
 *   Agent 的每次修改先是"待定"：旧字划掉淡出，新字光影扫过写入，段下给「接受 / 撤回」；修订栏里同步一条记录。
 */

type Change = { start: number; end: number; after: string; phase: 'sweeping' | 'pending' }
type Para = { id: string; text: string; change?: Change; stream?: string[]; streaming?: boolean; touched?: boolean }
type Revision = { id: string; kind: string; before: string; after: string; state: 'pending' | 'accepted' | 'rejected'; pid: string; when: string }
type Tab = 'collab' | 'revisions'

const initialParas: Para[] = [
  { id: 'p1', text: '我第一次注意到楼下那家便利店，是在搬来这座城市的第三个冬天。' },
  { id: 'p2', text: '那时候我每天加班到很晚，回家路上总会进去买一瓶热豆浆。店员是个话不多的年轻人，他会在我推门的时候抬头看一眼，然后继续低头整理货架。我们从来没有聊过天，但是这种被看见的感觉让我觉得这座城市没有那么冷漠和疏离。' },
  { id: 'p3', text: '后来我读到奥尔登堡写的"第三空间"，才明白那种感觉有个名字。' },
]

const docs = {
  writing: ['便利店与第三空间', '开题报告 · 研究问题', '周记 · 十月'],
  samples: ['去年的公众号文章（12 篇）', '本科毕业论文致谢', '旅行随笔 · 京都'],
}



const actions = [
  { id: 'rewrite', label: '改写', icon: <MagicWandIcon /> },
  { id: 'mine', label: '更像我', icon: <FeatherIcon /> },
  { id: 'short', label: '缩短', icon: <ArrowsInLineHorizontalIcon /> },
  { id: 'long', label: '扩写', icon: <ArrowsOutLineHorizontalIcon /> },
]

/* 模拟的改写结果：真实实现里由文风模型生成。 */
const rewrites: Record<string, string> = {
  rewrite: '我们没说过一句话。可被人看见这一下，城市就没那么冷了。',
  mine: '我们没聊过天。但他抬头那一眼，让我觉得自己在这座城市里被看见了。',
  short: '没聊过天，但被看见，城市就暖了一点。',
  long: '我们从来没有聊过天，连他叫什么都不知道。可每次推门时他抬头的那一眼，像是在说"你回来了"，这座城市因此有了一点温度。',
}
const kindLabel: Record<string, string> = { rewrite: '改写', mine: '更像我', short: '缩短', long: '扩写', stream: '续写' }

const continuation = '我开始留意城市里别的这种地方：小区门口的修鞋摊，地铁站外卖烤红薯的推车，深夜还亮着灯的打印店。它们都不起眼，却在每天经过的路上，给人一个可以停一下的理由。'

export function WritingMock({ title = docs.writing[0], onBack }: { title?: string; onBack?: () => void } = {}) {
  const [paras, setParas] = useState<Para[]>(initialParas)
  const [doc, setDoc] = useState(title)
  const [status, setStatus] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('collab')
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [bar, setBar] = useState<{ x: number; y: number; pid: string; start: number; end: number } | null>(null)
  const [messages, setMessages] = useState<{ role: 'user' | 'agent'; text: string }[]>([
    { role: 'user', text: '帮我看看第二段，感觉有点啰嗦。' },
    { role: 'agent', text: '第二段最后一句用了三个并列的形容词，你平时很少这样写。选中它让我改，或者直接说"改得更像我"。' },
  ])
  const editor = useRef<HTMLDivElement>(null)

  const chars = paras.reduce((n, p) => n + (p.stream ? p.stream.join('').length : p.text.length), 0)
  const pending = revisions.filter((r) => r.state === 'pending').length

  /* ---- Agent 改写：旧字划掉，新字光影扫过写进来，之后进入待定 ---- */
  const rewrite = (pid: string, start: number, end: number, kind: string) => {
    const after = rewrites[kind]
    const target = paras.find((p) => p.id === pid)
    if (!target) return
    setStatus('正在改写')
    setRevisions((rs) => [{ id: 'r' + Date.now(), kind, before: target.text.slice(start, end), after, state: 'pending', pid, when: '刚刚' }, ...rs])
    setParas((ps) => ps.map((p) => (p.id === pid ? { ...p, change: { start, end, after, phase: 'sweeping' } } : p)))
    window.setTimeout(() => {
      setParas((ps) => ps.map((p) => (p.id === pid && p.change ? { ...p, change: { ...p.change, phase: 'pending' } } : p)))
      setStatus(null)
    }, 1700)
  }
  const settle = (pid: string, accept: boolean) => {
    setParas((ps) => ps.map((p) => {
      if (p.id !== pid || !p.change) return p
      const c = p.change
      return { id: p.id + '·', text: accept ? p.text.slice(0, c.start) + c.after + p.text.slice(c.end) : p.text, touched: accept }
    }))
    setRevisions((rs) => rs.map((r) => (r.pid === pid && r.state === 'pending' ? { ...r, state: accept ? 'accepted' : 'rejected' } : r)))
  }
  const settleAll = (accept: boolean) => paras.filter((p) => p.change?.phase === 'pending').forEach((p) => settle(p.id, accept))

  /* ---- Agent 续写：一小段一小段流进来 ---- */
  const stream = () => {
    const id = 'p' + Date.now()
    const chunks = continuation.match(/.{1,6}/gu) ?? []
    setStatus('正在续写')
    setParas((ps) => [...ps, { id, text: '', stream: [], streaming: true }])
    chunks.forEach((c, i) =>
      window.setTimeout(() => {
        setParas((ps) => ps.map((p) => (p.id === id ? { ...p, stream: [...(p.stream ?? []), c] } : p)))
        if (i === chunks.length - 1)
          window.setTimeout(() => {
            setParas((ps) => ps.map((p) => (p.id === id ? { id, text: continuation, touched: true } : p)))
            setRevisions((rs) => [{ id: 'r' + Date.now(), kind: 'stream', before: '', after: continuation, state: 'accepted', pid: id, when: '刚刚' }, ...rs])
            setStatus(null)
          }, 700)
      }, 90 * i),
    )
  }

  /* ---- 选中文字 → 浮条。真实鼠标松开和演示按钮都走这里 ---- */
  const placeBar = useCallback(() => {
    const sel = window.getSelection()
    const host = editor.current
    if (!sel || sel.isCollapsed || !host?.contains(sel.anchorNode)) return setBar(null)
    const p = (sel.anchorNode?.parentElement as HTMLElement | null)?.closest<HTMLElement>('[data-pid]')
    if (!p || p !== (sel.focusNode?.parentElement as HTMLElement | null)?.closest('[data-pid]')) return setBar(null)
    const picked = sel.toString()
    const start = p.innerText.indexOf(picked)
    if (start < 0 || !picked.trim()) return setBar(null)
    const r = sel.getRangeAt(0).getBoundingClientRect()
    const box = host.getBoundingClientRect()
    setBar({ x: r.left + r.width / 2 - box.left, y: r.top - box.top + host.scrollTop, pid: p.dataset.pid!, start, end: start + picked.length })
  }, [])
  useEffect(() => {
    document.addEventListener('mouseup', placeBar)
    return () => document.removeEventListener('mouseup', placeBar)
  }, [placeBar])

  const applyAction = (kind: string) => {
    if (!bar) return
    const b = bar
    setBar(null)
    window.getSelection()?.removeAllRanges()
    rewrite(b.pid, b.start, b.end, kind)
  }

  const demoRewrite = () => {
    const p2 = paras.find((p) => p.text.includes('我们从来没有聊过天') && !p.change) ?? paras.find((p) => !p.change && !p.stream) ?? paras[0]
    const i = p2.text.indexOf('我们从来没有聊过天')
    rewrite(p2.id, i < 0 ? 0 : i, p2.text.length, 'mine')
  }

  const send = (text: string) => {
    setMessages((m) => [...m, { role: 'user', text }])
    window.setTimeout(() => {
      const continuing = /续写|接着|往下/.test(text)
      setMessages((m) => [...m, { role: 'agent', text: continuing ? '好，我按你的节奏接着写一段，接在第三段后面。' : '我把第二段的后半句改了，保留你开头的细节。在正文里接受或撤回。' }])
      if (continuing) stream()
      else demoRewrite()
    }, 500)
  }

  const reset = () => {
    setParas(initialParas)
    setRevisions([])
    setStatus(null)
    setBar(null)
  }


  /* 落定演示：没有待定修改时先改一句，扫光结束后自动接受 */
  const demoSettle = () => {
    const p = paras.find((x) => x.change?.phase === 'pending')
    if (p) return settle(p.id, true)
    const target = paras.find((x) => x.text.includes('我们从来没有聊过天') && !x.change) ?? paras.find((x) => !x.change && !x.stream)
    if (!target) return
    demoRewrite()
    window.setTimeout(() => settle(target.id, true), 2300)
  }

  /* 选区浮条演示：在最后一段选中一截文字，走和真实鼠标一样的定位逻辑 */
  const floatDemo = () => {
    const target = editor.current?.querySelector<HTMLElement>('p[data-pid][contenteditable]:last-of-type') ?? editor.current?.querySelector<HTMLElement>('p[data-pid][contenteditable]')
    const node = target?.firstChild
    if (!node) return
    const range = document.createRange()
    const len = node.textContent?.length ?? 0
    range.setStart(node, Math.min(5, Math.max(0, len - 1)))
    range.setEnd(node, Math.min(15, len))
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    placeBar()
  }

  return (
    <div className="wr-page">
      <aside className="wr-shell-gap" aria-label="应用侧栏位置说明">
        <div>
          <strong>应用侧栏</strong>
          <p>全局导航（新对话、知识库、研究、写作、最近）由应用外壳提供。</p>
          <p>本页常驻在它右侧，这里只占位，不重复设计。</p>
        </div>
        <MotionDemos
          onSweep={() => { setTab('collab'); demoRewrite() }}
          onStream={stream}
          onFloat={floatDemo}
          onSettle={demoSettle}
          onReset={reset}
        />
      </aside>

      <div className="wr-workbench">
        <header className="wr-top">
          <DocSwitcher value={doc} onChange={(d) => { setDoc(d); reset() }} onBack={onBack} />
          <div className="wr-format" role="toolbar" aria-label="排版">
            <button type="button" aria-label="标题"><TextHOneIcon /></button>
            <button type="button" aria-label="加粗"><TextBIcon /></button>
            <button type="button" aria-label="斜体"><TextItalicIcon /></button>
            <span className="wr-format__sep" />
            <button type="button" aria-label="引用"><QuotesIcon /></button>
            <button type="button" aria-label="列表"><ListBulletsIcon /></button>
          </div>
          <div className="wr-top__right">
            {status ? (
              <span className="wr-working" role="status"><AgentAvatar avatar="cheng" color="#5d8fe6" size={18} state="work" />{status}</span>
            ) : (
              <span className="wr-saved">已保存</span>
            )}
            <button type="button" className="wr-tool" aria-label="版本历史"><ClockCounterClockwiseIcon /></button>
            <button type="button" className="wr-btn"><ExportIcon /> 导出</button>
          </div>
        </header>

        <div className="wr-body">
          <section className="wr-editor">
            <div className="wr-scroll" ref={editor}>
              <article className="wr-doc">
                <p className="wr-kicker">随笔 · 草稿</p>
                <h1 className="wr-title" contentEditable suppressContentEditableWarning>{doc}</h1>
                {paras.map((p) => <Paragraph key={p.id} p={p} onSettle={(ok) => settle(p.id, ok)} />)}
              </article>
              {bar ? (
                <div className="wr-float" style={{ left: bar.x, top: bar.y }} onMouseDown={(e) => e.preventDefault()}>
                  {actions.map((a) => <button key={a.id} type="button" onClick={() => applyAction(a.id)}>{a.icon}{a.label}</button>)}
                </div>
              ) : null}
            </div>
            <footer className="wr-statusbar">
              <span>{chars} 字</span>
              <span>约 {Math.max(1, Math.round(chars / 400))} 分钟读完</span>
              <span className="wr-statusbar__sep" />
              <button type="button" onClick={() => setTab('revisions')}>{pending ? <><i className="wr-dot" />{pending} 处修改待处理</> : '没有待处理的修改'}</button>
            </footer>
          </section>

          <aside className="wr-side">
            <div className="wr-tabs" role="tablist">
              {([['collab', '协作'], ['revisions', '修订']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}{id === 'revisions' && pending ? <span className="wr-badge">{pending}</span> : null}
                </button>
              ))}
            </div>
            {tab === 'collab' ? <Collab messages={messages} busy={!!status} onSend={send} /> : null}
            {tab === 'revisions' ? <Revisions items={revisions} onSettle={settle} onAll={settleAll} /> : null}
          </aside>
        </div>
      </div>

    </div>
  )
}

/* 段落：平时可直接编辑；有待定修改时显示划掉的旧字和扫光写入的新字。左侧细线标出 Agent 动过的段落。 */
function Paragraph({ p, onSettle }: { p: Para; onSettle: (accept: boolean) => void }) {
  if (p.stream) {
    return (
      <p className="wr-p" data-pid={p.id} data-touched="true">
        {p.stream.map((c, i) => <span key={i} className="wr-chunk">{c}</span>)}
        {p.streaming ? <span className="wr-caret" /> : null}
      </p>
    )
  }
  if (!p.change) return <p className="wr-p" data-pid={p.id} data-touched={p.touched} contentEditable suppressContentEditableWarning>{p.text}</p>
  const c = p.change
  return (
    <div className="wr-p-wrap" data-phase={c.phase}>
      <p className="wr-p" data-pid={p.id} data-touched="true">
        {p.text.slice(0, c.start)}
        <del className="wr-del">{p.text.slice(c.start, c.end)}</del>
        <ins className="wr-ins" data-phase={c.phase}>{c.after}</ins>
        {p.text.slice(c.end)}
      </p>
      {c.phase === 'pending' ? (
        <div className="wr-decide">
          <AgentAvatar avatar="cheng" color="#5d8fe6" size={18} playing={false} />
          <span>按你的文风改了这一句</span>
          <button type="button" className="wr-decide__ok" onClick={() => onSettle(true)}><CheckIcon weight="bold" /> 接受</button>
          <button type="button" onClick={() => onSettle(false)}><XIcon /> 撤回</button>
        </div>
      ) : null}
    </div>
  )
}

function DocSwitcher({ value, onChange, onBack }: { value: string; onChange: (d: string) => void; onBack?: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])
  const row = (d: string, sample?: boolean) => (
    <button key={d} type="button" className="wr-menu__item" onClick={() => { onChange(d); setOpen(false) }}>
      {sample ? <FeatherIcon /> : <FileTextIcon />}<span>{d}</span>{d === value ? <CheckIcon className="wr-menu__check" /> : null}
    </button>
  )
  return (
    <div className="wr-anchor" ref={root}>
      <div className="wr-crumbs">
        <button type="button" className="wr-crumbs__back" onClick={onBack}>写作</button>
        <span className="wr-doc-btn__slash">/</span>
        <button type="button" className="wr-doc-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{value}</span><CaretDownIcon />
        </button>
      </div>
      {open ? (
        <div className="wr-menu">
          <p className="wr-menu__label">正在写</p>
          {docs.writing.map((d) => row(d))}
          <p className="wr-menu__label">文风样本<small>用来学你的写法</small></p>
          {docs.samples.map((d) => row(d, true))}
          <div className="wr-menu__rule" />
          <button type="button" className="wr-menu__item"><PlusIcon /> 新建文档</button>
        </div>
      ) : null}
    </div>
  )
}

/* 协作：Agent 身份 + 对话 + 快捷指令 + 输入。输入框上方标出这次作用于哪里。 */
function Collab({ messages, busy, onSend }: { messages: { role: 'user' | 'agent'; text: string }[]; busy: boolean; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])
  const submit = () => {
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
  }
  return (
    <div className="wr-collab">
      <div className="wr-agent">
        <AgentAvatar avatar="cheng" color="#5d8fe6" size={36} state={busy ? 'work' : 'idle'} />
        <div>
          <strong>澄</strong>
          <span>{busy ? '正在写…' : '按你的文风写 · 已开启'}</span>
        </div>
      </div>
      <div className="wr-log">
        {messages.map((m, i) => <div key={i} className={`wr-msg wr-msg--${m.role}`}>{m.text}</div>)}
        <div ref={end} />
      </div>
      <div className="wr-quick">
        {['接着往下写一段', '第二段改得更像我', '标题再短一点'].map((c) => (
          <button key={c} type="button" disabled={busy} onClick={() => onSend(c)}>{c}</button>
        ))}
      </div>
      <form className="wr-input" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <span className="wr-input__scope"><FileTextIcon /> 作用于全文</span>
        <div className="wr-input__row">
          <textarea rows={2} placeholder="让它写，或者问它" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
          <button type="submit" className="wr-send" disabled={!text.trim() || busy} aria-label="发送"><ArrowUpIcon weight="bold" /></button>
        </div>
      </form>
    </div>
  )
}

/* 修订：Agent 每次动正文都留一条，新的在上。待定的可在这里接受 / 撤回，也可一次处理全部。 */
function Revisions({ items, onSettle, onAll }: { items: Revision[]; onSettle: (pid: string, ok: boolean) => void; onAll: (ok: boolean) => void }) {
  const pending = items.some((r) => r.state === 'pending')
  return (
    <div className="wr-revs">
      {pending ? (
        <div className="wr-revs__all">
          <button type="button" className="wr-btn" onClick={() => onAll(false)}>全部撤回</button>
          <button type="button" className="wr-btn wr-btn--primary" onClick={() => onAll(true)}>全部接受</button>
        </div>
      ) : null}
      {items.length ? items.map((r) => (
        <article key={r.id} className="wr-rev" data-state={r.state}>
          <header>
            <span className="wr-rev__kind">{kindLabel[r.kind]}</span>
            <span className="wr-rev__state">{r.state === 'pending' ? '待处理' : r.state === 'accepted' ? '已接受' : '已撤回'} · {r.when}</span>
          </header>
          {r.before ? <p className="wr-rev__before">{r.before}</p> : null}
          <p className="wr-rev__after">{r.after}</p>
          {r.state === 'pending' ? (
            <footer>
              <button type="button" onClick={() => onSettle(r.pid, false)}>撤回</button>
              <button type="button" className="wr-rev__ok" onClick={() => onSettle(r.pid, true)}><CheckIcon weight="bold" /> 接受</button>
            </footer>
          ) : null}
        </article>
      )) : (
        <div className="wr-empty">
          <ClockCounterClockwiseIcon />
          <p>Agent 改过的地方会记在这里</p>
        </div>
      )}
    </div>
  )
}

/* 动效演示：放在左侧占位区，用侧栏条目样式。只为评审看动效，真实页面里没有。 */
function MotionDemos(props: { onSweep: () => void; onStream: () => void; onFloat: () => void; onSettle: () => void; onReset: () => void }) {
  const items: [string, () => void][] = [
    ['光影扫过 · 改写', props.onSweep],
    ['逐段流入 · 续写', props.onStream],
    ['选区浮条', props.onFloat],
    ['落定 · 接受修改', props.onSettle],
  ]
  return (
    <nav className="wr-demos" aria-label="动效演示">
      <p className="qx-group-label">动效演示 · 点一下播放</p>
      {items.map(([label, run]) => (
        <button key={label} type="button" className="qx-item" onMouseDown={(e) => e.preventDefault()} onClick={run}>
          <PlayIcon /><span>{label}</span>
        </button>
      ))}
      <button type="button" className="qx-item wr-demos__reset" onClick={props.onReset}>重置正文</button>
    </nav>
  )
}
