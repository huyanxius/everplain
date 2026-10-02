import { useEffect, useState } from 'react'
import { ArrowUpIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { Link, useNavigate } from 'react-router'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { Companion } from '../../modules/companion'
import { ActAgent, AgentCrew } from './AgentCrew'
import { HeroFilm } from './HeroFilm'
import { CompanionDemo, GatherDemo, LibraryDemo, MemoryDemo, ModelOrbit } from './ProductDemos'
import './everplain-website.css'

function Composer({ id, authenticated }: { id: string; authenticated: boolean }) {
  const navigate = useNavigate()
  const [thought, setThought] = useState('')
  const start = () => {
    const prompt = thought.trim()
    if (!prompt) return
    const destination = `/agent?${new URLSearchParams({ prompt })}`
    navigate(authenticated ? destination : `/login?${new URLSearchParams({ redirect: destination })}`)
  }
  return <form className="ep-composer" onSubmit={event => { event.preventDefault(); start() }}>
    <label className="ep-visually-hidden" htmlFor={id}>你的想法</label>
    <textarea id={id} placeholder="说说你的想法…" value={thought} maxLength={4000} rows={1} onChange={event => setThought(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); start() }
    }} />
    <button type="submit" aria-label="开始对话" disabled={!thought.trim()}><ArrowUpIcon size={20} aria-hidden="true" /></button>
  </form>
}

/*
 * 首屏标题：「Everplain〔角色〕，」+「帮你……」轮换产品真实能做的事，每换一句换一个角色。
 * 读屏只读固定的一句完整说明，轮换的部分对读屏隐藏，免得一直被打断。
 */
const abilities = ['整理散落的收藏', '找回读过的文章', '把笔记连成图谱', '带着出处回答', '把问题想清楚', '写出第一稿']
const headlineLabel = `Everplain，帮你${abilities.slice(0, 3).join('、')}。`

function RotatingHeadline() {
  const [turn, setTurn] = useState({ current: 0, previous: -1 })
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setTurn(t => ({ current: (t.current + 1) % abilities.length, previous: t.current })), 3000)
    return () => window.clearInterval(timer)
  }, [])
  const active = turn.current % agentAvatarPresets.length
  const chars = (text: string, phase: 'in' | 'out') => Array.from(text).map((char, i) => (
    <span key={`${phase}-${i}`} className={`ep-char ep-char--${phase}`} style={{ animationDelay: `${i * 38}ms` }}>{char}</span>
  ))
  return <h1 id="ep-hero-title" className="ep-headline" aria-label={headlineLabel}>
    <span className="ep-headline__line" aria-hidden="true">
      Everplain
      {/* 七个 bot 叠成一排，只在进场时依次弹出一次；之后谁对应当前这句，谁打招呼 */}
      <span className="ep-crew">
        {agentAvatarPresets.map((preset, i) => (
          <span key={preset.id} className="ep-crew__bot" data-active={i === active} style={{ animationDelay: `${300 + i * 90}ms`, zIndex: i === active ? 10 : 7 - i }}>
            <AgentAvatar avatar={preset.id} state={i === active ? 'greet' : 'idle'} offset={i * 0.6} size="100%" />
          </span>
        ))}
      </span>
      ，
    </span>
    <span className="ep-headline__line" aria-hidden="true">
      帮你
      <span className="ep-ability">
        {turn.previous >= 0 ? <span className="ep-ability__text ep-ability__text--out" key={`out-${turn.previous}-${turn.current}`}>{chars(abilities[turn.previous], 'out')}</span> : null}
        <span className="ep-ability__text" key={`in-${turn.current}`}>{chars(abilities[turn.current], 'in')}</span>
      </span>
    </span>
  </h1>
}

/*
 * 叙事四幕，每幕换一种版式，避免「左文右图」一路重复：
 * 一、收到一处：没有面板框，零散的东西直接漂在纸面上再汇合；
 * 二、知识库：居中标题 + 通栏演示；三、你的 AI：左对齐标题 + 对话与记忆并排；
 * 四、价格与模型：标题在环绕的模型卡中间。
 * 七个角色先在定位句下面整排亮相，之后每幕标题旁各站一个，左右交替。
 */
export function FoundationPage({ authenticated = false }: { authenticated?: boolean }) {
  return <div className="ep-site">
    <a className="ep-skip" href="#main">跳到正文</a>
    <header className="ep-header">
      <Link className="ep-brand" to="/welcome" aria-label="Everplain 首页"><span className="ep-brand-mark" aria-hidden="true" /><span>Everplain</span></Link>
      <nav aria-label="官网导航"><a href="#gather">收集</a><a href="#library">知识库</a><a href="#your-ai">你的 AI</a><a href="#models">模型与价格</a></nav>
      <Link className="ep-login" to={authenticated ? '/app' : '/login'}>{authenticated ? '工作台' : '登录'}<ArrowUpRightIcon size={15} aria-hidden="true" /></Link>
    </header>

    <main id="main">
      <section className="ep-hero" aria-labelledby="ep-hero-title">
        <HeroFilm />
        <div className="ep-hero-copy">
          <RotatingHeadline />
          <Composer id="ep-thought" authenticated={authenticated} />
          <a className="ep-text-link" href="#gather">免登录查看静态演示<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
          <p className="ep-demo-disclosure">下方演示使用预设示例，不读取个人资料，也不调用真实 AI。进入工作台仍需登录。</p>
        </div>
      </section>

      <section className="ep-statement" aria-labelledby="ep-statement-title">
        <h2 id="ep-statement-title"><span>你的知识，</span>你的 AI。</h2>
        <AgentCrew />
      </section>

      <section className="ep-act ep-act-gather" id="gather" aria-labelledby="ep-gather-title">
        <ActAgent avatar="cheng" state="work" side="end" />
        <div className="ep-act-head">
          <h2 id="ep-gather-title">散落各处的，<br />收到一处。</h2>
          <p>聊天里的链接、相册里的截图、收藏夹的视频、下载的论文、备忘录里的一句话。随手一存，都在这里，视频会转写，图里的字会被认出来。</p>
        </div>
        <GatherDemo />
      </section>

      <section className="ep-act ep-act-library" id="library" aria-labelledby="ep-library-title">
        <ActAgent avatar="nian" state="think" side="start" />
        <h2 id="ep-library-title">一键，建成你的知识库。</h2>
        <p>收齐之后，一键整理成有主题、有关联、连着原文的知识库。你翻得到，你的 AI 也用得上。</p>
        <LibraryDemo />
      </section>

      <section className="ep-act ep-act-ai" id="your-ai" aria-labelledby="ep-ai-title">
        <ActAgent avatar="heng" state="greet" side="end" />
        <div className="ep-act-head">
          <h2 id="ep-ai-title">只属于你的 AI。</h2>
          <p>它读过你收藏的一切，记得你想过的每一步。说出你还记得的那一点，它就能接上。它有你取的名字，也有你挑的样子。</p>
        </div>
        <div className="ep-ai-grid">
          <CompanionDemo />
          <MemoryDemo />
        </div>
      </section>

      <section className="ep-models" id="models" aria-labelledby="ep-models-title">
        <ModelOrbit />
        <div className="ep-models-copy">
          <h2 id="ep-models-title">用 1% 的成本，<br />和全球最顶尖的模型对话。</h2>
          <p className="ep-price"><span>低至</span><strong>1%</strong><span>官方 API 价格</span></p>
          <small>以各模型官方 API 标价为对比基准。</small>
        </div>
      </section>

      <section className="ep-closing" aria-labelledby="ep-closing-title">
        <ActAgent avatar="you" state="greet" side="center" />
        <h2 id="ep-closing-title">说说你在想的事。</h2>
        <Composer id="ep-thought-closing" authenticated={authenticated} />
        <a className="ep-text-link" href="#gather">再看静态演示<ArrowUpRightIcon size={16} aria-hidden="true" /></a>
      </section>
    </main>

    <div className="ep-companion"><Companion size={190} /></div>

    <footer className="ep-footer">
      <Link className="ep-brand" to="/welcome"><span className="ep-brand-mark" aria-hidden="true" /><span>Everplain</span></Link>
      <small>© 2026 Everplain</small>
    </footer>
  </div>
}
