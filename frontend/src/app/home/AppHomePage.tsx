import { Link } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, ArrowUpRightIcon, BooksIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useAccount } from '../../modules/account'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { readPersonalGraph } from '../../modules/personal-graph'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState } from '../ui/States'
import './personal-home.css'

export function AppHomePage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile })
  const graph = useQuery({ queryKey: ['personal-graph', userId], queryFn: readPersonalGraph })
  const [query, setQuery] = useState('')
  const docs = (graph.data?.nodes ?? []).filter(n => n.nodeType === 'document' && n.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const p = profile.data
  return <PageShell wide><PageContent><main className="ep-home">
    <header className="ep-home-heading"><div><p>YOUR PERSONAL LIBRARY</p><h1>思绪有处安放，灵感自会生长。</h1><span>收藏、阅读、思考。把看过的世界，变成自己的理解。</span></div><Link to="/imports" className="ep-home-add"><PlusIcon size={16} />导入资料</Link></header>
    {p && <section className="ep-home-companion"><AgentAvatar avatar={p.avatar_id as AgentAvatarId} color={p.color} size={62} /><div><strong>{p.name}</strong><p>{p.greeting}</p></div><Link to="/agent">开始对话 <ArrowRightIcon size={16} /></Link></section>}
    <div className="ep-home-search"><MagnifyingGlassIcon size={19} /><input aria-label="搜索资料标题" value={query} onChange={e => setQuery(e.target.value)} placeholder="想起一个标题、一件感兴趣的事……" /><span>{graph.data?.document_count ?? 0} 份资料</span></div>
    <nav className="ep-home-views" aria-label="知识空间视图"><span aria-current="page"><BooksIcon size={16} />我的资料</span><Link to="/my/graph"><ShareNetworkIcon size={16} />知识图谱</Link><Link to="/library">管理知识库 <ArrowUpRightIcon size={13} /></Link><Link to="/sharing">共享与连接</Link><Link to="/discover">发现主题</Link><Link to="/research/new">新建研究 <PlusIcon size={13} /></Link></nav>
    {graph.isError ? <ErrorState detail={graph.error.message} onRetry={() => { void graph.refetch() }} /> : <div className="ep-home-grid" aria-label="资料卡片">
      {graph.isPending ? Array.from({ length: 6 }, (_, i) => <div className="ep-note-card ep-note-card--loading" key={i} aria-label="正在读取资料"><i /><i /><i /></div>) : docs.map(n => {
        const source = graph.data!.sources[n.id]
        if (!source) return null
        return <Link className="ep-note-card" key={n.id} to={`/library?kb_id=${encodeURIComponent(source.library_id)}&document_id=${encodeURIComponent(source.document_id)}`}><span className="ep-note-card__type"><FileTextIcon size={16} weight="light" />{source.source_url ? '网页收藏' : '我的笔记'}</span><h2>{n.label}</h2><p>{source.source_url ? '从收藏里拾起，回到原文继续阅读。' : '一段被留下的思考，等待新的联系。'}</p><footer><span>打开原文</span><ArrowUpRightIcon size={15} /></footer></Link>
      })}
      {!graph.isPending && !docs.length && <div className="ep-home-empty"><BooksIcon size={30} weight="light" /><h2>{query ? '还没找到这份资料。' : '把第一份资料，放进来。'}</h2><p>{query ? '换一个标题关键词试试。' : '从浏览器收藏、Obsidian 或一份 Markdown 开始。'}</p>{!query && <Link to="/imports">开始导入 <ArrowRightIcon size={15} /></Link>}</div>}
    </div>}
    <footer className="ep-home-footnote">默认仅你可见 · 每份资料保留来源 <Link to="/settings">偏好与账户设置</Link></footer>
  </main></PageContent></PageShell>
}
