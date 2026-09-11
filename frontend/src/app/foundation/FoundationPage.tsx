import { ArrowRightIcon, BooksIcon, FileTextIcon, LinkSimpleIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import brandMark from '../../assets/qunxue-brand-mark.svg'
import './foundation.css'

export function FoundationPage({ authenticated = false }: { authenticated?: boolean }) {
  return <div className="everplain-public">
    <header className="everplain-public__header">
      <Link className="everplain-public__brand" to="/welcome" aria-label="Everplain 首页"><img src={brandMark} alt="" /><span>Everplain</span></Link>
      <nav aria-label="首页导航"><a href="#features">产品功能</a><Link to="/library">知识库</Link>{authenticated ? <Link to="/app">工作台</Link> : <Link to="/login">登录</Link>}</nav>
    </header>
    <main>
      <section className="everplain-intro" aria-labelledby="everplain-intro-title">
        <div className="everplain-intro__copy"><p className="everplain-eyebrow">KNOWLEDGE, MADE USEFUL.</p>
          <h1 id="everplain-intro-title">你的个人知识库，<br />也是研究工作台。</h1>
          <p className="everplain-intro__lede">把文档、笔记与报告收在一起。用自己的资料提问，沿着来源深入研究，把发现写成可以继续编辑的成果。</p>
          <div className="everplain-intro__actions"><Link className="everplain-start-link" to="/app">开始使用<ArrowRightIcon size={17} aria-hidden="true" /></Link><a href="#features">了解 Everplain</a></div>
        </div>
        <section className="everplain-product-map" aria-label="Everplain 工作流程">
          <header><span>一个工作台，连接整个过程</span><img src={brandMark} alt="" /></header>
          <ol>
            <li><span className="everplain-product-map__icon"><BooksIcon size={21} weight="light" /></span><div><strong>归集资料</strong><p>PDF · Word · PPT · Markdown · TXT</p></div><span className="everplain-product-map__step">01</span></li>
            <li><span className="everplain-product-map__icon"><LinkSimpleIcon size={21} weight="light" /></span><div><strong>连接知识与来源</strong><p>摘要、知识点、关系与原文出处</p></div><span className="everplain-product-map__step">02</span></li>
            <li><span className="everplain-product-map__icon"><FileTextIcon size={21} weight="light" /></span><div><strong>研究，写成自己的成果</strong><p>提问、核对、编辑与导出</p></div><span className="everplain-product-map__step">03</span></li>
          </ol>
          <footer>资料与过程都留在你的账户中，下次继续。</footer>
        </section>
      </section>
      <section className="everplain-features" id="features" aria-labelledby="everplain-features-title">
        <header><p className="everplain-eyebrow">BUILT AROUND YOUR KNOWLEDGE</p><h2 id="everplain-features-title">从一份资料，到一份有依据的成果。</h2></header>
        <div className="everplain-features__grid">
          <article><span>01 / LIBRARY</span><h3>整理私有知识</h3><p>按主题建立知识库，上传资料，整理摘要、知识点与关系。需要回顾时，直接找到相关内容和原文。</p><Link to="/library">建立知识库<ArrowRightIcon size={14} /></Link></article>
          <article><span>02 / RESEARCH</span><h3>基于来源研究</h3><p>选定知识库后开始提问，检索、比较不同材料，再沿着引用核对出处。围绕同一个问题持续深入。</p><Link to="/agent">开始一项研究<ArrowRightIcon size={14} /></Link></article>
          <article><span>03 / WRITE</span><h3>留下可编辑的成果</h3><p>在画布中组织观点与证据，将研究内容写成文稿。直接修改、保存与导出，下一次打开仍能继续。</p><Link to="/app">打开工作台<ArrowRightIcon size={14} /></Link></article>
        </div>
      </section>
      <section className="everplain-private" aria-labelledby="everplain-private-title"><div><p className="everplain-eyebrow">PERSONAL BY DEFAULT</p><h2 id="everplain-private-title">知识库属于你，研究由你决定。</h2></div><p>资料仅对你的账户可见。由你选择本次研究使用哪个知识库，也可以删除不再需要的资料及其索引。回答有来源，整理结果可修改，最终判断留给你。</p></section>
    </main>
    <footer className="everplain-public__footer"><span>Everplain</span><p>个人知识库与研究工作台</p><Link to="/app">开始使用 Everplain<ArrowRightIcon size={14} /></Link></footer>
  </div>
}
