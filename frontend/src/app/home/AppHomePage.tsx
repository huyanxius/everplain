import { Link, useNavigate } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  BooksIcon,
  CompassIcon,
  FileTextIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShareNetworkIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { useAccount } from '../../modules/account'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { readPersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState } from '../ui/States'
import './personal-home.css'

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/*
 * 首页：问候 + 直接向 Agent 提问的输入框 + 各处入口 + 我的资料。
 * 输入框不在这里发消息，只把问题放进 /agent 的草稿再跳过去，由用户在对话页确认发送。
 */
export function AppHomePage() {
  const account = useAccount()
  const navigate = useNavigate()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile })
  const graph = useQuery({ queryKey: ['personal-graph', userId], queryFn: readPersonalGraph })
  const [query, setQuery] = useState('')
  const [question, setQuestion] = useState('')
  const docs = (graph.data?.nodes ?? []).filter(n => n.nodeType === 'document' && n.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const p = profile.data
  const ask = () => {
    const text = question.trim()
    if (userId && text) seedAgentDraft(userId, text)
    navigate('/agent')
  }

  return <PageShell wide><PageContent><main className="ep-home">
    <section className="ep-home-hero">
      {p ? <AgentAvatar avatar={p.avatar_id as AgentAvatarId} color={p.color} size={84} state="greet" label={p.name} /> : <span className="ep-home-hero__placeholder" aria-hidden="true" />}
      <h1 className="qx-display">{greetingFor(new Date().getHours())}，今天想弄清楚什么？</h1>
      {p?.greeting ? <p className="ep-home-hero__greeting">{p.name}：{p.greeting}</p> : null}
      <form className="ep-home-ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
        <Link to="/imports" className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="导入资料"><PlusIcon /></Link>
        <input aria-label={`问${p?.name ?? 'Agent'}`} value={question} onChange={e => setQuestion(e.target.value)} placeholder={`问${p?.name ?? 'Agent'}，或者说说你在想的事`} />
        <button type="submit" className="qx-btn qx-btn--primary qx-btn--icon qx-btn--lg" aria-label="开始对话"><ArrowUpIcon weight="bold" /></button>
      </form>
      <nav className="ep-home-views" aria-label="知识空间视图">
        <Link to="/imports" className="qx-tag qx-tag--outline"><PlusIcon />导入资料</Link>
        <Link to="/my/graph" className="qx-tag qx-tag--outline"><ShareNetworkIcon />知识图谱</Link>
        <Link to="/library" className="qx-tag qx-tag--outline"><BooksIcon />管理知识库</Link>
        <Link to="/sharing" className="qx-tag qx-tag--outline"><UsersThreeIcon />共享与连接</Link>
        <Link to="/discover" className="qx-tag qx-tag--outline"><CompassIcon />发现主题</Link>
        <Link to="/research/new" className="qx-tag qx-tag--outline">新建研究 <ArrowRightIcon /></Link>
      </nav>
    </section>

    <section className="ep-home-section" aria-labelledby="ep-home-docs">
      <header className="ep-home-section__head">
        <h2 id="ep-home-docs" className="qx-heading">我的资料 <span className="qx-meta">{graph.data?.document_count ?? 0} 份资料</span></h2>
        <label className="qx-search ep-home-search"><MagnifyingGlassIcon /><input aria-label="搜索资料标题" value={query} onChange={e => setQuery(e.target.value)} placeholder="想起一个标题……" /></label>
      </header>
      {graph.isError ? <ErrorState detail={graph.error.message} onRetry={() => { void graph.refetch() }} /> : <div className="ep-home-grid" aria-label="资料卡片">
        {graph.isPending ? Array.from({ length: 6 }, (_, i) => <div className="qx-card ep-note-card ep-note-card--loading" key={i} aria-label="正在读取资料"><i /><i /><i /></div>) : docs.map(n => {
          const source = graph.data!.sources[n.id]
          if (!source) return null
          return <Link className="qx-card qx-card--interactive ep-note-card" key={n.id} to={`/library?kb_id=${encodeURIComponent(source.library_id)}&document_id=${encodeURIComponent(source.document_id)}`}>
            <span className="ep-note-card__type">{source.source_url ? <GlobeIcon /> : <FileTextIcon />}{source.source_url ? '网页收藏' : '我的笔记'}</span>
            <h3 className="qx-card__title">{n.label}</h3>
            <footer className="qx-card__meta"><span>打开原文</span><ArrowUpRightIcon /></footer>
          </Link>
        })}
        {!graph.isPending && !docs.length && <div className="ep-home-empty"><BooksIcon size={30} weight="light" /><h3 className="qx-card__title">{query ? '还没找到这份资料。' : '把第一份资料，放进来。'}</h3><p>{query ? '换一个标题关键词试试。' : '从浏览器收藏、Obsidian 或一份 Markdown 开始。'}</p>{!query && <Link to="/imports" className="qx-btn qx-btn--secondary">开始导入 <ArrowRightIcon /></Link>}</div>}
      </div>}
    </section>

    <footer className="ep-home-footnote qx-meta">默认仅你可见 · 每份资料保留来源 <Link to="/settings">偏好与账户设置</Link></footer>
  </main></PageContent></PageShell>
}
