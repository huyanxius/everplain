import { useEffect, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowRightIcon, ArrowUpRightIcon, PlusIcon, QuotesIcon, BookOpenIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import brandMark from '../../assets/qunxue-brand-mark.svg'
import cabinet from '../../assets/workbench/knowledge-library-hero.webp'
import machine from '../../assets/workbench/research-agent-hero.webp'
import meadow from '../../assets/website/meadow.webp'
import { MeadowScene } from './MeadowScene'
import './everplain-website.css'

const moments = [
  { label: '想起一份收藏', question: '我之前看过一篇关于独处的文章，想接着聊聊。', answer: '你收藏过《独处的时间》，还在旁边留了一句：“独处和孤独，好像不是一回事。”我们从这个区别接着聊，好吗？', source: '独处的时间', kind: '网页收藏', quote: '独处和孤独，好像不是一回事。' },
  { label: '展开一个想法', question: '上次那个关于城市声音的想法，我想继续写。', answer: '上次你想从通勤路上的声音写起。那段地铁录音、记下的街边对话，还有关于“城市记忆”的阅读笔记，可以放在一起了。先从一个具体的早晨开始吧。', source: '城市声音观察', kind: '个人笔记', quote: '从一个普通的早晨，写城市里的相遇。' },
  { label: '开始一项工作', question: '用我的阅读笔记，准备一堂关于媒介的讨论课。', answer: '你在阅读笔记里多次提到“注意力”。可以从大家刷手机的经历聊起，再回到材料里看看：是我们在选择媒介，还是媒介在塑造我们的选择？', source: '媒介与注意力', kind: '阅读笔记', quote: '让学生从自己的经历出发，讨论媒介。' },
]

export function FoundationPage({ authenticated = false }: { authenticated?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const [moment, setMoment] = useState(0)
  const current = moments[moment]
  useEffect(() => {
    if (!root.current || !('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.revealed = 'true'; observer.unobserve(entry.target) }
      })
    }, { threshold: .1 })
    const targets = root.current.querySelectorAll<HTMLElement>('[data-reveal]')
    targets.forEach((target) => { target.dataset.revealed = 'false'; observer.observe(target) })
    return () => { observer.disconnect(); targets.forEach((target) => { delete target.dataset.revealed }) }
  }, [])
  return <div className="ep-site" ref={root}>
    <a className="ep-skip" href="#main">跳到正文</a>
    <header className="ep-header">
      <Link className="ep-brand" to="/welcome" aria-label="Everplain 首页"><img src={brandMark} alt="" /><span>Everplain</span></Link>
      <nav aria-label="官网导航"><a href="#space">你的空间</a><a href="#companion">AI 伙伴</a><a href="#questions">关于 Everplain</a></nav>
      <Link className="ep-login" to={authenticated ? '/app' : '/login'}>{authenticated ? '工作台' : '登录'}<ArrowUpRightIcon size={15} aria-hidden="true" /></Link>
    </header>
    <main id="main">
      <section className="ep-journey" aria-label="从草地走进图书馆">
        <MeadowScene />
        <div className="ep-hero-copy">
          <p className="ep-eyebrow ep-hero-intro">A home for your curiosity</p>
          <h1>Room for your mind.</h1>
          <p className="ep-hero-chinese">给思绪一处空间。</p>
          <a className="ep-button ep-hero-button" href="#space">走进 Everplain<ArrowUpRightIcon size={18} aria-hidden="true" /></a>
          <a className="ep-scroll-cue" href="#space"><span>往下，走进你的图书馆</span><ArrowDownIcon size={17} aria-hidden="true" /></a>
        </div>
        <div className="ep-library-story" id="space"><div>
          <p className="ep-eyebrow">A library of your own</p>
          <h2>那些念念不忘的，<br />都有地方安放。</h2>
          <p className="ep-body-copy">一篇文章，一段影像，一本书的批注。<br />还有那个没来得及展开的想法。<br />让零散的收藏，慢慢成为你的知识。</p>
          <a className="ep-text-link" href="#collection">看看这片空间<ArrowRightIcon size={17} aria-hidden="true" /></a>
        </div></div>
        <div className="ep-journey-end" aria-hidden="true" />
      </section>
      <section className="ep-collection-section ep-section" id="collection" aria-labelledby="ep-collection-title">
        <div className="ep-collection-heading" data-reveal><p className="ep-eyebrow">Keep what moves you.</p><div><h2 id="ep-collection-title">收藏是起点，<br /><span>想法在这里继续。</span></h2><p className="ep-body-copy">把值得留下的，放进自己的空间。<br />再次想起时，找到的不只是一个文件，<br />还有当时的好奇，和往下走的线索。</p></div></div>
        <div className="ep-destinations">
          <Link className="ep-destination ep-destination-library" to="/library" data-reveal>
            <div className="ep-destination-image"><img src={cabinet} alt="草地上的木质索引柜，抽屉中收着一张张纸卡" loading="lazy" /><span className="ep-destination-light" /></div>
            <div className="ep-destination-copy"><div><span className="ep-eyebrow">01 / Collect</span><h3>一座属于你的图书馆。</h3><p>安放资料，整理线索，随时回到原文。</p></div><span className="ep-round-arrow"><ArrowUpRightIcon size={22} aria-hidden="true" /></span></div>
          </Link>
          <Link className="ep-destination ep-destination-agent" to="/agent" data-reveal>
            <div className="ep-destination-image"><img src={machine} alt="草地上的复古放映机与银色胶片卷轴" loading="lazy" /><span className="ep-destination-light" /></div>
            <div className="ep-destination-copy"><div><span className="ep-eyebrow">02 / Connect</span><h3>一台为好奇心工作的机器。</h3><p>从你的材料出发，一起提问、研究与写作。</p></div><span className="ep-round-arrow"><ArrowUpRightIcon size={22} aria-hidden="true" /></span></div>
          </Link>
        </div>
      </section>
      <section className="ep-companion ep-section" id="companion" aria-labelledby="ep-companion-title">
        <div className="ep-companion-heading" data-reveal><p className="ep-eyebrow">Pick up where your mind left off.</p><h2 id="ep-companion-title">你的知识，<br />你的 AI 伙伴。</h2><p className="ep-body-copy">有时，你需要的只是说一句：<br />“我有个想法，你还记得吗？”</p></div>
        <div className="ep-thought-room" data-reveal>
          <div className="ep-moments" role="group" aria-label="选择使用场景">{moments.map((item, index) => <button key={item.label} type="button" aria-pressed={moment === index} onClick={() => setMoment(index)}><span className="ep-moment-number" aria-hidden="true">0{index + 1}</span>{item.label}<ArrowUpRightIcon size={18} aria-hidden="true" /></button>)}<p>体验片段 · 以下为示例内容</p></div>
          <div className="ep-dialogue" aria-live="polite" aria-atomic="true"><div key={moment} className="ep-dialogue-inner">
            <QuotesIcon className="ep-quote-icon" size={34} weight="light" aria-hidden="true" /><h3>{current.question}</h3>
            <div className="ep-answer"><img src={brandMark} alt="Everplain" /><p>{current.answer}</p></div>
            <div className="ep-source"><BookOpenIcon size={19} weight="light" aria-hidden="true" /><div><span>{current.kind} · {current.source}</span><p>{current.quote}</p></div><ArrowUpRightIcon size={16} aria-hidden="true" /></div>
          </div></div>
        </div>
      </section>
      <section className="ep-access ep-section" aria-labelledby="ep-access-title" data-reveal>
        <span className="ep-eyebrow">More room. More possibility.</span><h2 id="ep-access-title">好 AI，<br />离日常近一点。</h2>
        <div><p className="ep-body-copy">让前沿模型成为日常用得起的伙伴。<br />留出更宽裕的额度，给阅读、写作，<br />也给一场没有预设终点的讨论。</p><p className="ep-access-note">多模型与订阅方案筹备中，开放时公布具体价格。</p></div>
      </section>
      <section className="ep-faq ep-section" id="questions" aria-labelledby="ep-faq-title">
        <div data-reveal><p className="ep-eyebrow">Before you settle in.</p><h2 id="ep-faq-title">也许你想问。</h2></div>
        <div className="ep-faq-list" data-reveal>
          <details><summary>这里适合我吗？<PlusIcon size={18} aria-hidden="true" /></summary><p>如果你常常阅读、收藏、写作，或有一些想和人一起理清的想法，这就是我们希望为你创造的空间。学习、备课、产品研究和日常好奇，都可以从这里开始。</p></details>
          <details><summary>现在可以用到哪些功能？<PlusIcon size={18} aria-hidden="true" /></summary><p>当前版本提供个人文档知识库、资料问答、来源回看和文稿入口，仍在完善。网页、图片、视频收藏与跨资料回忆是正在构建的方向，尚未全部开放。你可以登录探索当前版本。</p></details>
          <details><summary>AI 会记住我的所有内容吗？<PlusIcon size={18} aria-hidden="true" /></summary><p>收藏不代表赞同，资料也不等于你的观点。我们希望让你决定 AI 可以使用哪些资料，让记忆可以查看、纠正和删除。这些控制能力将逐步补齐；使用 AI 时，必要内容会发送给所选模型服务商。</p></details>
          <details><summary>如何收费，可以选择哪些模型？<PlusIcon size={18} aria-hidden="true" /></summary><p>我们计划提供宽裕的日常使用额度，并通过不同订阅开放更强的模型。具体模型、额度与价格尚未公布，当前官网不提供订阅购买。</p></details>
        </div>
      </section>
      <section className="ep-closing" aria-labelledby="ep-closing-title"><img className="ep-closing-landscape" src={meadow} alt="" loading="lazy" /><div className="ep-closing-content" data-reveal><img className="ep-closing-mark" src={brandMark} alt="" /><p>有个想法？先留下来。</p><h2 id="ep-closing-title">Make yourself<br />at home.</h2><Link className="ep-button" to="/app">{authenticated ? '回到我的空间' : '探索当前版本'}<ArrowUpRightIcon size={18} aria-hidden="true" /></Link></div></section>
    </main>
    <footer className="ep-footer"><Link className="ep-brand" to="/welcome"><img src={brandMark} alt="" /><span>Everplain</span></Link><span>Room for your mind.</span><a href="#main">回到顶部<ArrowUpRightIcon size={15} aria-hidden="true" /></a></footer>
  </div>
}
