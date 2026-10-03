import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRightIcon,
  BooksIcon,
  ChalkboardTeacherIcon,
  ExportIcon,
  FeatherIcon,
  FilesIcon,
  MagicWandIcon,
  NotePencilIcon,
  PlusIcon,
  QuotesIcon,
  SealCheckIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { AgentComposer } from '../shared/Composer'
import { WritingMock } from './WritingMock'

/*
 * 写作首页：由 Agent 驱动。应用侧栏里点「写作」进来；点某篇文档或让 Agent 起稿，才进编辑页。
 * 路由：#/ 首页，#/doc/<标题> 编辑页；真实应用对应 /writing 和 /writing/:documentId。
 *
 * 页面结构（从上到下）：
 *   问候 —— Agent 头像 + 一句话；
 *   它能帮你写什么 —— 八项能力，每张卡点一下把示例说法填进底部输入条；
 *   最近的文档 —— 和研究列表同一套卡片（直接复用 research-materials-page.css 的类）；
 *   悬浮输入条 —— 公共 AgentComposer，常驻底部；说完，回话从输入条上方展开，Agent 起稿后给「打开文稿」。
 * 文体（公文 / 报告 / 正式文体 / 小说 / 随笔）是文档属性；Agent 按文体分别学用户的写法，界面不单独展示学习过程。
 */

type Genre = '公文' | '报告' | '正式文体' | '小说' | '随笔'
type Doc = { title: string; genre: Genre; excerpt: string; words: number; updated: string }

const documents: Doc[] = [
  { title: '便利店与第三空间', genre: '随笔', excerpt: '我第一次注意到楼下那家便利店，是在搬来这座城市的第三个冬天。', words: 1240, updated: '刚刚' },
  { title: '城市第三空间调研报告', genre: '报告', excerpt: '本报告基于 12 位受访者的半结构访谈，考察年轻人在大城市中的非正式社交场所。', words: 8630, updated: '今天' },
  { title: '关于开展读书月活动的通知', genre: '公文', excerpt: '各学院、各部门：为营造良好的读书氛围，经研究决定，于十月开展读书月活动。', words: 960, updated: '昨天' },
  { title: '第三个冬天 · 第一章', genre: '小说', excerpt: '雨停的时候，林舟还站在便利店门口，手里那杯豆浆已经凉了。', words: 5320, updated: '周一' },
  { title: '开题报告 · 研究问题', genre: '正式文体', excerpt: '本研究关注的问题是：中国城市中的年轻人如何在家与工作之外维系低成本的社会联系。', words: 3410, updated: '9 月 28 日' },
]

/* 八项能力。tone 取数据色，只给图标底，不当按钮色。 */
const abilities: { id: string; title: string; note: string; example: string; icon: ReactNode; tone: string }[] = [
  { id: 'draft', title: '按文体起稿', note: '公文、报告、正式文体、小说、随笔，说一句话就起个头', example: '帮我起草一份读书月活动的通知，下周一发', icon: <NotePencilIcon />, tone: 'blue' },
  { id: 'style', title: '照你的写法写', note: '每种文体分开学，写公文像你写公文，写小说像你写小说', example: '用我平时写随笔的语气，写一段关于下雨天的开头', icon: <FeatherIcon />, tone: 'violet' },
  { id: 'guide', title: '学攻略和范文', note: '丢进写作攻略、范文、格式规范，它照着要求来写', example: '学一下这份公文格式规范，以后按它排版', icon: <BooksIcon />, tone: 'green' },
  { id: 'class', title: '上课做参考', note: '课堂笔记、讲义整理成参考，写作业时随手引用', example: '把今天社会学概论的课堂笔记整理成可引用的要点', icon: <ChalkboardTeacherIcon />, tone: 'amber' },
  { id: 'polish', title: '改写与润色', note: '选中一段改写、缩短、扩写，改动先给你看，你说了算', example: '把第二段改得短一点，别丢掉开头那个细节', icon: <MagicWandIcon />, tone: 'rose' },
  { id: 'cite', title: '找依据、加引用', note: '从你的知识库里找出处，按引用格式标好', example: '给"第三空间正在消失"这句话找两条资料依据', icon: <QuotesIcon />, tone: 'teal' },
  { id: 'check', title: '检查与校对', note: '错字、病句、前后不一致、格式问题，一次标出来', example: '帮我检查这份报告里的数据前后是否一致', icon: <SealCheckIcon />, tone: 'olive' },
  { id: 'export', title: '排版与导出', note: '按公文或论文格式排好，导出 Word、PDF', example: '把开题报告按学校模板排版，导出 Word', icon: <ExportIcon />, tone: 'rust' },
]

export function WritingApp() {
  const read = () => {
    const m = /^#\/doc\/(.+)$/.exec(window.location.hash)
    return m ? decodeURIComponent(m[1]) : null
  }
  const [doc, setDoc] = useState<string | null>(read)
  useEffect(() => {
    const on = () => setDoc(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (doc) return <WritingMock key={doc} title={doc} onBack={() => { window.location.hash = '/' }} />
  return <WritingHome onOpen={(t) => { window.location.hash = `/doc/${encodeURIComponent(t)}` }} />
}

type Turn = { role: 'user' | 'agent'; text: string; doc?: string }

function WritingHome({ onOpen }: { onOpen: (title: string) => void }) {
  const [genre, setGenre] = useState<Genre | null>(null)
  const [prefill, setPrefill] = useState<{ text: string; key: number }>()
  const [turns, setTurns] = useState<Turn[]>([])
  const [thinking, setThinking] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, thinking])

  const shown = documents.filter((d) => !genre || d.genre === genre)
  const hour = new Date().getHours()
  const greeting = hour < 6 ? '还没睡呀' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  const send = (text: string) => {
    setTurns((t) => [...t, { role: 'user', text }])
    setThinking(true)
    window.setTimeout(() => {
      setThinking(false)
      const notice = /通知|公文/.test(text)
      setTurns((t) => [...t, notice
        ? { role: 'agent', text: '按你以往写通知的格式起了一稿：标题、主送单位、正文三段、落款和日期都留好了，活动时间先写成下周一。', doc: '关于开展读书月活动的通知' }
        : { role: 'agent', text: '好，我按你写随笔的节奏起了个头，三段左右，你看看方向对不对。', doc: '便利店与第三空间' }])
    }, 1100)
  }

  return (
    <div className="wh-page">
      <aside className="wh-shellgap" aria-label="应用侧栏位置说明">
        <strong>应用侧栏</strong>
        <p>全局导航由应用外壳提供，「写作」是其中一项，点它进入这一页。</p>
      </aside>

      <div className="wh-scroll">
        <main className="ep-research wh-main">
          <section className="wh-hero">
            <AgentAvatar avatar="cheng" color="#5d8fe6" size={72} state={thinking ? 'think' : 'greet'} label="澄" />
            <div className="wh-hero__text">
              <h1 className="qx-section-title">{greeting}，今天写点什么？</h1>
              <p className="qx-meta">说一句你要写的东西，我来起个头。也可以从下面挑一件事让我做。</p>
            </div>
          </section>

          <section className="wh-section">
            <h2 className="qx-heading">澄能帮你写</h2>
            <div className="wh-abilities">
              {abilities.map((a, i) => (
                <button key={a.id} type="button" className="qx-card qx-card--interactive wh-ability" style={{ animationDelay: `${i * 40}ms` }} onClick={() => setPrefill({ text: a.example, key: Date.now() })}>
                  <span className="wh-ability__icon" data-tone={a.tone}>{a.icon}</span>
                  <strong className="qx-card__title">{a.title}</strong>
                  <span className="qx-card__body">{a.note}</span>
                  <span className="wh-ability__try">试试：{a.example}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="wh-section">
            <header className="wh-section__head">
              <h2 className="qx-heading">最近的文档</h2>
              <div className="wh-filters" role="group" aria-label="按文体筛选">
                <button type="button" className="qx-tag" aria-pressed={!genre} onClick={() => setGenre(null)}>全部</button>
                {(['公文', '报告', '正式文体', '小说', '随笔'] as Genre[]).map((g) => (
                  <button key={g} type="button" className="qx-tag" aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>
                ))}
              </div>
            </header>
            <div className="ep-research__grid" aria-label="文档">
              {shown.map((d) => (
                <button key={d.title} type="button" className="qx-card qx-card--interactive ep-research__card wh-doc" onClick={() => onOpen(d.title)}>
                  <span className="qx-tag">{d.genre}</span>
                  <h3 className="qx-card__title">{d.title}</h3>
                  <p className="qx-card__body ep-research__question">{d.excerpt}</p>
                  <span className="qx-card__meta">{d.words.toLocaleString()} 字 · {d.updated}</span>
                </button>
              ))}
              <button type="button" className="qx-card qx-card--muted ep-research__add-card wh-doc" onClick={() => onOpen('未命名文档')}>
                <PlusIcon aria-hidden="true" /><span className="qx-heading">空白文档</span>
              </button>
            </div>
          </section>
        </main>
      </div>

      <div className="wh-dock">
        {turns.length || thinking ? (
          <section className="wh-sheet" aria-label="和澄的对话">
            <header>
              <span><AgentAvatar avatar="cheng" color="#5d8fe6" size={20} state={thinking ? 'work' : 'idle'} /> 澄</span>
              <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="收起对话" onClick={() => setTurns([])}><XIcon /></button>
            </header>
            <div className="wh-sheet__log">
              {turns.map((t, i) => t.role === 'user' ? (
                <div key={i} className="qx-bubble wh-sheet__user">{t.text}</div>
              ) : (
                <div key={i} className="wh-sheet__agent">
                  <p>{t.text}</p>
                  {t.doc ? (
                    <button type="button" className="qx-card qx-card--interactive wh-sheet__doc" onClick={() => onOpen(t.doc!)}>
                      <FilesIcon /><span><strong>{t.doc}</strong><small>草稿 · 刚刚</small></span><ArrowRightIcon />
                    </button>
                  ) : null}
                </div>
              ))}
              {thinking ? <p className="wh-sheet__thinking">正在起稿…</p> : null}
              <div ref={end} />
            </div>
          </section>
        ) : null}
        <AgentComposer placeholder="说说你要写什么" prefill={prefill} onSend={send} />
      </div>
    </div>
  )
}
