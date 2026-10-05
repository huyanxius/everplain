import { useEffect, useState } from 'react'
import { ArrowUpIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { Link, useNavigate } from 'react-router'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { Companion } from '../../modules/companion'
import { ActAgent, AgentCrew } from './AgentCrew'
import { HeroFilm } from './HeroFilm'
import { useRecall } from './HeroRecall'
import { PlatformWall } from './PlatformWall'
import { CompanionDemo, LibraryDemo, MemoryDemo, ModelOrbit } from './ProductDemos'
import './everplain-website.css'

function Composer({ id, authenticated, placeholder = '说说你的想法…' }: { id: string; authenticated: boolean; placeholder?: string }) {
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
    <textarea id={id} placeholder={placeholder} value={thought} maxLength={4000} rows={1} onChange={event => setThought(event.target.value)} onKeyDown={event => {
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
export function FoundationPage({ authenticated = false, checkingSession = false }: { authenticated?: boolean; checkingSession?: boolean }) {
  const recall = useRecall()
  return <div className="ep-site">
    <a className="ep-skip" href="#main">跳到正文</a>
    <header className="ep-header">
      <Link className="ep-brand" to="/welcome" aria-label="Everplain 首页"><span className="ep-brand-mark" aria-hidden="true" /><span>Everplain</span></Link>
      <nav aria-label="官网导航"><a href="#gather">收集</a><a href="#library">知识库</a><a href="#your-ai">你的 AI</a><a href="#models">模型与价格</a></nav>
      <div className="ep-header-actions"><Link className="ep-docs-link" to="/docs">Docs</Link>{checkingSession ? <span className="ep-login" role="status">确认登录中…</span> : <Link className="ep-login" to={authenticated ? '/app' : '/login'}>{authenticated ? '继续' : '登录'}<ArrowUpRightIcon size={15} aria-hidden="true" /></Link>}</div>
    </header>

    <main id="main">
      <section className="ep-hero" aria-labelledby="ep-hero-title">
        <HeroFilm />
        <div className="ep-hero-copy">
          <RotatingHeadline />
          <Composer id="ep-thought" authenticated={authenticated} placeholder={recall.placeholder} />
          <div className="ep-hero-actions">
            <a className="ep-hero-action" href="#intro">深入了解</a>
            <Link className="ep-hero-action ep-hero-action--primary" to={authenticated ? '/app' : '/login'}>{authenticated ? '进入工作台' : '领取你的 Everplain'}<ArrowUpRightIcon size={15} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className="ep-statement" id="intro" aria-labelledby="ep-statement-title">
        <h2 id="ep-statement-title"><span>你的知识，</span>你的 AI。</h2>
        <AgentCrew />
      </section>

      <section className="ep-act ep-act-gather" id="gather" aria-labelledby="ep-gather-title">
        <ActAgent avatar="cheng" state="work" side="end" />
        <div className="ep-act-head">
          <h2 id="ep-gather-title">散落各处的，<br />收到一处。</h2>
          <p>聊天里的链接、相册里的截图、收藏夹的视频、下载的论文、备忘录里的一句话。随手一存，都在这里，视频会转写，图里的字会被认出来。</p>
        </div>
        <PlatformWall />
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
          <h2 id="ep-models-title">按需选择模型，<br />清楚了解每次用量。</h2>
          <p className="ep-price">按模型官方参考倍率折算积分。</p>
          <small>可选模型与能力以服务端目录为准。<Link to="/docs#models">查看模型与积分说明</Link> · <Link to="/docs#plans">查看额度与订阅方案</Link></small>
        </div>
      </section>

      <section className="ep-closing" aria-labelledby="ep-closing-title">
        <ActAgent avatar="you" state="greet" side="center" />
        <h2 id="ep-closing-title">说说你在想的事。</h2>
        <Composer id="ep-thought-closing" authenticated={authenticated} />
      </section>
    </main>

    <div className="ep-companion"><Companion size={190} /></div>

    <footer className="ep-footer">
      <div className="ep-footer__brand">
        <Link className="ep-brand" to="/welcome"><span className="ep-brand-mark" aria-hidden="true" /><span>Everplain</span></Link>
        <small>© 2026 Everplain</small>
      </div>
      <nav className="ep-footer__column" aria-labelledby="ep-footer-code-title">
        <h2 id="ep-footer-code-title">下载与代码</h2>
        <Link to="/docs">Docs · 使用指南</Link>
        <div><a href="https://huyan-android-downloads.pages.dev/downloads/everplain-0.1.0-debug-cd1fd15.apk">安卓测试版 · Cloudflare 主下载</a></div>
        <div><a href="https://github.com/huyanxius/everplain/releases/download/android-v0.1.0-test-cd1fd15/everplain-0.1.0-debug-cd1fd15.apk">GitHub 备用下载</a></div>
        <small>Android 原生测试版 0.1.0 · debug 签名，研究工作区仍在完善。<a href="https://github.com/huyanxius/everplain/releases/tag/android-v0.1.0-test-cd1fd15">安装说明</a></small>
        <a href="https://github.com/huyanxius/everplain" target="_blank" rel="noopener noreferrer">Everplain · GitHub<ArrowUpRightIcon size={15} aria-hidden="true" /><span className="ep-visually-hidden">（在新窗口打开）</span></a>
      </nav>
      <section className="ep-footer__column" aria-labelledby="ep-footer-contact-title">
        <h2 id="ep-footer-contact-title">联系我们</h2>
        <address><a href="mailto:huyanxius@gmail.com">huyanxius@gmail.com</a></address>
      </section>
    </footer>
  </div>
}
