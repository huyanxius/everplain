import { useEffect, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowRightIcon, ArrowUpRightIcon, PlusIcon, QuotesIcon, BookOpenIcon, FileTextIcon, LinkSimpleIcon, ImageIcon, SparkleIcon, CheckIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import brandMark from '../../assets/qunxue-brand-mark.svg'
import claudeMark from '../../assets/models/claude.svg'
import chatgptMark from '../../assets/models/chatgpt.svg'
import geminiMark from '../../assets/models/gemini.svg'
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
  const [collectionFilter, setCollectionFilter] = useState('全部')
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
      <nav aria-label="官网导航"><a href="#models">前沿模型</a><a href="#collection">知识空间</a><a href="#companion">AI 伙伴</a></nav>
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
        <div className="ep-machine-story"><p className="ep-eyebrow">Old soul. New possibilities.</p><h2>好奇心，<br />有了新的搭档。</h2><p className="ep-body-copy">从收藏到理解，从一个念头到一份作品。<br />把下一步，交给你和 AI 一起完成。</p></div>
        <div className="ep-journey-end" aria-hidden="true" />
      </section>
      <section className="ep-models ep-section" id="models" aria-labelledby="ep-models-title">
        <div className="ep-models-heading" data-reveal><p className="ep-eyebrow">Great minds. One place.</p><h2 id="ep-models-title">前沿 AI，<br />不必散落在几个地方。</h2><p className="ep-body-copy">在一个熟悉的空间，选择适合当下任务的模型。<br />读长文、做研究、写初稿，或换一个角度继续想。</p></div>
        <div className="ep-model-brands" aria-label="计划接入的 AI 品牌" data-reveal>
          <div><img src={claudeMark} alt="Claude 标志" /><span className="ep-claude-wordmark">Claude</span><small>Anthropic</small></div>
          <div><img src={chatgptMark} alt="ChatGPT 标志" /><span>ChatGPT</span><small>OpenAI</small></div>
          <div><img src={geminiMark} alt="Gemini 标志" /><span>Gemini</span><small>Google</small></div>
        </div>
        <div className="ep-model-benefits" data-reveal><p><CheckIcon size={16} aria-hidden="true" />一个入口，按任务选择模型</p><p><CheckIcon size={16} aria-hidden="true" />让模型围绕你的资料工作</p><p><CheckIcon size={16} aria-hidden="true" />更低门槛，更宽裕的使用额度</p></div>
        <p className="ep-model-note">多模型接入筹备中，具体开放模型、额度与价格将在上线时公布。</p>
      </section>
      <section className="ep-collection-section ep-section" id="collection" aria-labelledby="ep-collection-title">
        <div className="ep-library-feature-copy" data-reveal><p className="ep-eyebrow">Your knowledge, connected.</p><h2 id="ep-collection-title">不只是存起来。<br />是下次还能用起来。</h2><p className="ep-body-copy">网页、图片、视频、论文和随手记，<br />都可以成为你自己的知识。<br />按项目整理，带着线索找回，让收藏继续参与思考。</p><ul className="ep-feature-points"><li><strong>把零散内容放在一起</strong><span>一篇文章和一张照片，也可能属于同一个想法。</span></li><li><strong>回答有来处，资料可回看</strong><span>从 AI 的回答回到来源，保留自己的判断。</span></li><li><strong>围绕你正在做的事</strong><span>论文、产品研究或一堂课，都有自己的空间。</span></li></ul><Link className="ep-text-link" to="/library">探索个人知识库<ArrowUpRightIcon size={17} aria-hidden="true" /></Link></div>
        <div className="ep-sample-library" data-reveal>
          <header><span><img src={brandMark} alt="" />我的知识空间</span><small>概念预览</small></header>
          <div className="ep-archive-tabs" role="group" aria-label="筛选示例收藏">{['全部', '文档', '网页', '灵感'].map(filter => <button type="button" key={filter} aria-pressed={collectionFilter === filter} onClick={() => setCollectionFilter(filter)}>{filter}</button>)}</div>
          <div className="ep-archive-items" aria-live="polite">
            {(collectionFilter === '全部' || collectionFilter === '文档') && <article><span className="ep-file-symbol"><FileTextIcon size={23} weight="light" /></span><div><h3>城市记忆与日常生活</h3><p>论文 · 24 页 · 我的研究</p></div><small>PDF</small></article>}
            {(collectionFilter === '全部' || collectionFilter === '网页') && <article><span className="ep-file-symbol"><LinkSimpleIcon size={23} weight="light" /></span><div><h3>独处的时间</h3><p>一篇想再读一次的文章</p></div><small>WEB</small></article>}
            {(collectionFilter === '全部' || collectionFilter === '灵感') && <><article><span className="ep-file-symbol"><ImageIcon size={23} weight="light" /></span><div><h3>光落在书架上的那个下午</h3><p>图片 · 空间与灵感</p></div><small>IMAGE</small></article><article><span className="ep-file-symbol"><BookOpenIcon size={23} weight="light" /></span><div><h3>从通勤路上的声音开始写</h3><p>随手记 · 城市观察</p></div><small>NOTE</small></article></>}
          </div>
          <footer><SparkleIcon size={17} aria-hidden="true" /><span>这些资料，可以成为下一段对话的起点。</span></footer>
        </div>
      </section>
      <section className="ep-companion ep-section" id="companion" aria-labelledby="ep-companion-title">
        <div className="ep-companion-heading" data-reveal><p className="ep-eyebrow">Pick up where your mind left off.</p><h2 id="ep-companion-title">你的知识，<br />你的 AI 伙伴。</h2><p className="ep-body-copy">不用每次重新解释项目和背景。<br />从收藏过的资料、上次的想法，接着往下聊。</p></div>
        <div className="ep-thought-room" data-reveal>
          <div className="ep-moments" role="group" aria-label="选择使用场景">{moments.map((item, index) => <button key={item.label} type="button" aria-pressed={moment === index} onClick={() => setMoment(index)}><span className="ep-moment-number" aria-hidden="true">0{index + 1}</span>{item.label}<ArrowUpRightIcon size={18} aria-hidden="true" /></button>)}<p>体验片段 · 以下为示例内容</p></div>
          <div className="ep-dialogue" aria-live="polite" aria-atomic="true"><div key={moment} className="ep-dialogue-inner">
            <QuotesIcon className="ep-quote-icon" size={34} weight="light" aria-hidden="true" /><h3>{current.question}</h3>
            <div className="ep-answer"><img src={brandMark} alt="Everplain" /><p>{current.answer}</p></div>
            <div className="ep-source"><BookOpenIcon size={19} weight="light" aria-hidden="true" /><div><span>{current.kind} · {current.source}</span><p>{current.quote}</p></div><span className="ep-source-label">示例来源</span></div>
          </div></div>
        </div>
      </section>
      <section className="ep-use-cases ep-section" aria-labelledby="ep-use-cases-title" data-reveal>
        <div><p className="ep-eyebrow">Made for what you do.</p><h2 id="ep-use-cases-title">不必懂技术。<br />从你的日常开始。</h2></div>
        <div className="ep-use-case-list"><article><span>学习与写作</span><h3>读得更多，也想得更深。</h3><p>把论文、文献和批注放在一起，梳理观点、比对来源，再写出自己的判断。</p></article><article><span>产品与创作</span><h3>让灵感，往前走一步。</h3><p>连接调研、访谈和随手收藏，从一个模糊的问题，走向清楚的方案。</p></article><article><span>备课与教学</span><h3>把知识，变成一堂好课。</h3><p>围绕自己的材料设计讲解、讨论和案例，让备课少一些重复劳动。</p></article></div>
      </section>
      <section className="ep-access ep-section" aria-labelledby="ep-access-title" data-reveal>
        <div><p className="ep-eyebrow">More thinking. Less counting.</p><h2 id="ep-access-title">好模型，用得起。<br />好想法，尽管聊。</h2><p className="ep-body-copy">通过更低的模型服务成本，让前沿 AI 离日常更近。<br />不用为了每一次提问精打细算，<br />也不必为了试一个新模型，再熟悉一套工具。</p></div>
        <div className="ep-access-plans"><article><div><span>日常思考</span><small>从这里开始</small></div><h3>宽裕的基础使用额度</h3><p>阅读、问答、笔记和初稿，让 AI 成为随手就能用的日常工具。</p></article><article><div><span>深入探索</span><small>更高阶订阅</small></div><h3>按需使用更强的模型</h3><p>复杂推理、深入研究、长文创作，为更有挑战的任务留出空间。</p></article><p className="ep-access-note">订阅方案筹备中。具体模型、额度与价格将另行公布。</p></div>
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
      <section className="ep-closing" aria-labelledby="ep-closing-title"><div className="ep-closing-content" data-reveal><img className="ep-closing-mark" src={brandMark} alt="" /><p>有个想法？先留下来。</p><h2 id="ep-closing-title">Make yourself<br />at home.</h2><Link className="ep-button" to="/app">{authenticated ? '回到我的空间' : '探索当前版本'}<ArrowUpRightIcon size={18} aria-hidden="true" /></Link></div></section>
    </main>
    <footer className="ep-footer"><Link className="ep-brand" to="/welcome"><img src={brandMark} alt="" /><span>Everplain</span></Link><span>Room for your mind.</span><a href="#main">回到顶部<ArrowUpRightIcon size={15} aria-hidden="true" /></a></footer>
  </div>
}
