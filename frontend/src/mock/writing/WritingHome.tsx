import { useEffect, useRef, useState } from 'react'
import { ArrowRightIcon, FilesIcon, NotePencilIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { AgentComposer } from '../shared/Composer'
import { WritingMock } from './WritingMock'

/*
 * 写作首页，由 Agent 驱动。版式和类名照搬首页 /app（AppHomePage + personal-home.css），不另起一套：
 *   问候区 —— 头像、qx-display 标题、公共输入框、描边胶囊快捷说法；
 *   接着写 —— 最近文档，和首页「接着研究」同款卡片；
 *   澄能帮你写 —— 九项能力，同款 qx-card，点一下把示例说法填进输入框；
 *   页脚 —— 按文体新建，和首页页脚同款次级按钮。
 * 悬浮对话栏：问候区的输入框滚出视野后，同一个公共输入框悬浮在底部；说完，对话从它上方展开，起稿后给「打开文稿」。
 * 路由：#/ 首页，#/doc/<标题> 编辑页；真实应用对应 /writing 和 /writing/:documentId。
 */

type Genre = '公文' | '报告' | '正式文体' | '小说' | '随笔'
type Doc = { title: string; genre: Genre; excerpt: string; updated: string }

const documents: Doc[] = [
  { title: '便利店与第三空间', genre: '随笔', excerpt: '我第一次注意到楼下那家便利店，是在搬来这座城市的第三个冬天。', updated: '刚刚' },
  { title: '城市第三空间调研报告', genre: '报告', excerpt: '本报告基于 12 位受访者的半结构访谈，考察年轻人在大城市中的非正式社交场所。', updated: '今天' },
  { title: '关于开展读书月活动的通知', genre: '公文', excerpt: '各学院、各部门：为营造良好的读书氛围，经研究决定，于十月开展读书月活动。', updated: '昨天' },
]

const abilities: { title: string; note: string; example: string }[] = [
  { title: '按文体起稿', note: '公文、报告、正式文体、小说、随笔，说一句话就起个头。', example: '帮我起草一份读书月活动的通知，下周一发' },
  { title: '照你的写法写', note: '每种文体分开学，写公文像你写公文，写小说像你写小说。', example: '用我平时写随笔的语气，写一段下雨天的开头' },
  { title: '学攻略和范文', note: '丢进写作攻略、范文、格式规范，它照着要求来写。', example: '学一下这份公文格式规范，以后按它排版' },
  { title: '上课做参考', note: '课堂笔记、讲义整理成参考，写作业时随手引用。', example: '把今天社会学概论的课堂笔记整理成可引用的要点' },
  { title: '改写与润色', note: '选中一段改写、缩短、扩写，改动先给你看，你说了算。', example: '把第二段改得短一点，别丢掉开头那个细节' },
  { title: '接着往下写', note: '顺着你的节奏续一段，写在光标后面，随时停。', example: '接着《便利店与第三空间》的第三段往下写一段' },
  { title: '找依据、加引用', note: '从你的知识库里找出处，按引用格式标好。', example: '给"第三空间正在消失"这句话找两条资料依据' },
  { title: '检查与校对', note: '错字、病句、前后不一致、格式问题，一次标出来。', example: '帮我检查调研报告里的数据前后是否一致' },
  { title: '排版与导出', note: '按公文或论文格式排好，导出 Word、PDF。', example: '把开题报告按学校模板排版，导出 Word' },
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
  const [prefill, setPrefill] = useState<{ text: string; key: number }>()
  const [turns, setTurns] = useState<Turn[]>([])
  const [thinking, setThinking] = useState(false)
  const [heroVisible, setHeroVisible] = useState(true)
  const hero = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hero.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { root: scroller.current, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, thinking])

  const hour = new Date().getHours()
  const greeting = hour < 6 ? '还没睡呀' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const talking = turns.length > 0 || thinking
  const docked = talking || !heroVisible
  const ask = (text: string) => setPrefill({ text, key: Date.now() })

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

      <div className="wh-scroll" ref={scroller}>
        <main className="personal-start wh-main">
          <section className="personal-start__hero">
            <AgentAvatar avatar="cheng" color="#5d8fe6" size={84} state={thinking ? 'think' : 'greet'} label="澄" />
            <h1 className="qx-display">{greeting}，我来学你怎么写</h1>
            <div className="wh-hero-composer" ref={hero}>
              {docked ? <div className="wh-hero-composer__ghost" /> : <AgentComposer placeholder="说说你要写什么，或者丢一份范文进来" prefill={prefill} onSend={send} />}
            </div>
            <div className="personal-start__chips">
              <button className="qx-tag qx-tag--outline" type="button" onClick={() => ask('帮我起草一份读书月活动的通知，下周一发')}>起草一份通知</button>
              <button className="qx-tag qx-tag--outline" type="button" onClick={() => ask('用我平时写随笔的语气，写一段下雨天的开头')}>照我的写法写一段</button>
              <button className="qx-tag qx-tag--outline" type="button" onClick={() => onOpen(documents[0].title)}>接着写《{documents[0].title}》</button>
            </div>
          </section>


          <section className="wh-mimic" aria-label="澄学过的你的文章">
            <p className="wh-mimic__text">
              澄已经读过你的 <b>28</b> 篇文章
              <span className="wh-mimic__genres">公文 8 · 报告 3 · 正式文体 5 · 随笔 12 · 小说还没学</span>
            </p>
            <label className="qx-btn qx-btn--secondary wh-mimic__upload">
              <UploadSimpleIcon /> 上传我的文章
              <input type="file" multiple accept=".md,.txt,.docx,.pdf,.html" hidden />
            </label>
          </section>

          <section className="personal-start__section" aria-labelledby="writing-recent">
            <header className="personal-start__section-head">
              <h2 id="writing-recent" className="qx-heading">接着写</h2>
              <button type="button" className="qx-btn qx-btn--ghost">全部 <ArrowRightIcon /></button>
            </header>
            <div className="personal-start__grid">
              {documents.map((d) => (
                <button key={d.title} type="button" className="qx-card qx-card--interactive personal-start__research wh-card" onClick={() => onOpen(d.title)}>
                  <span className="qx-tag">{d.genre}</span>
                  <h3 className="qx-card__title">{d.title}</h3>
                  <p className="qx-card__body personal-start__excerpt">{d.excerpt}</p>
                  <span className="qx-card__meta">{d.updated}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="personal-start__section" aria-labelledby="writing-abilities">
            <header className="personal-start__section-head">
              <h2 id="writing-abilities" className="qx-heading">澄能帮你写</h2>
            </header>
            <div className="personal-start__grid">
              {abilities.map((a) => (
                <button key={a.title} type="button" className="qx-card qx-card--interactive personal-start__research wh-card" onClick={() => ask(a.example)}>
                  <h3 className="qx-card__title">{a.title}</h3>
                  <p className="qx-card__body">{a.note}</p>
                  <span className="qx-card__meta wh-card__try">试试：{a.example}</span>
                </button>
              ))}
            </div>
          </section>

          <footer className="personal-start__footer">
            <nav className="personal-start__destinations" aria-label="新建">
              <div className="personal-start__destination-group" role="group" aria-labelledby="writing-new">
                <p id="writing-new" className="qx-meta">新建</p>
                <div className="personal-start__destination-actions">
                  {(['公文', '报告', '正式文体', '小说', '随笔'] as Genre[]).map((g) => (
                    <button key={g} type="button" className="qx-btn qx-btn--secondary" onClick={() => onOpen(`未命名${g}`)}><NotePencilIcon />{g}</button>
                  ))}
                  <button type="button" className="qx-btn qx-btn--secondary" onClick={() => onOpen('未命名文档')}>空白文档</button>
                </div>
              </div>
            </nav>
          </footer>
        </main>
      </div>

      {docked ? (
        <div className="wh-dock">
          {talking ? (
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
      ) : null}
    </div>
  )
}
