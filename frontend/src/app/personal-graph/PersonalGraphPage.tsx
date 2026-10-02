import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Link } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { ObsidianKnowledgeGraph } from '../../modules/knowledge-graph'
import { readPersonalGraph, rebuildPersonalGraph } from '../../modules/personal-graph'
import { readCourseDocument } from '../../modules/shared-knowledge'
import { ErrorState, LoadingState } from '../ui/States'
import './personal-graph.css'

export function PersonalGraphPage({ userId }: { userId: string | null }) {
  const cache = useQueryClient()
  const graph = useQuery({ queryKey: ['personal-graph', userId], queryFn: readPersonalGraph,
    refetchInterval: q => q.state.data?.pending_count ? 2500 : false })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const record = selected ? graph.data?.sources[selected] : undefined
  const source = useQuery({ queryKey: ['personal-source', userId, record?.library_id, record?.document_id, record?.segment_id],
    queryFn: () => readCourseDocument(record!.library_id, record!.document_id, record!.segment_id ?? undefined), enabled: Boolean(record) })
  const projection = useMemo(() => {
    if (!graph.data) return null
    const g = graph.data
    const image = renderToStaticMarkup(<AgentAvatar avatar={g.avatar_id as AgentAvatarId} color={g.color} playing={false} />).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('</svg>', `<style>.aa-body{fill:${g.color}}.aa-eye,.aa-nose{fill:#252822}.aa-happy{display:none}</style></svg>`)
    return { releaseId: g.releaseId, nodes: g.nodes.map(node => ({ ...node, image: node.id === 'self' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}` : undefined })), edges: g.edges.map(edge => ({ ...edge, layer: 'structure' as const })) }
  }, [graph.data])
  async function refresh() { setRefreshing(true); setError(''); try { const value = await rebuildPersonalGraph(); cache.setQueryData(['personal-graph', userId], value) } catch (e) { setError(String(e)) } finally { setRefreshing(false) } }
  if (graph.isPending) return <LoadingState message="正在展开你的知识图谱" />
  if (graph.isError || !projection) return <ErrorState detail={graph.error?.message} onRetry={() => { void graph.refetch() }} />
  const g = graph.data!
  const results = g.nodes.filter(n => n.nodeType !== 'self' && n.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <main className="ep-personal-graph">
    <header className="ep-graph-header"><Link to="/app" className="ep-graph-back"><ArrowLeftIcon size={17} /><span>我的空间</span></Link><div><span>CONNECTIONS</span><h1>你的思绪，自成一片天地。</h1></div><Link className="ep-graph-talk" to={record ? `/agent?reference_knowledge_base_id=${encodeURIComponent(record.library_id)}` : '/agent'}>和 {g.name} 聊聊<ArrowRightIcon size={16} /></Link></header>
    <div className="ep-graph-toolbar"><label><MagnifyingGlassIcon size={17} /><input aria-label="搜索我的图谱" value={query} onChange={e => setQuery(e.target.value)} placeholder="寻找一个想法、一份资料……" /></label><span>{g.document_count} 份资料 · {g.topic_count} 个主题</span><button disabled={refreshing} onClick={() => { void refresh() }}>{refreshing ? '正在更新…' : '更新图谱'}</button><Link to="/imports"><PlusIcon size={15} />继续导入</Link></div>
    {error && <p role="alert" className="ep-graph-error">{error}</p>}
    <div className="ep-graph-layout"><section className="ep-graph-map"><ObsidianKnowledgeGraph projection={projection} personal focusNodeId={selected} onSelectKnowledge={setSelected} onExpandNode={setSelected} />
      <div className="ep-graph-legend"><span><i />我</span><span><i />主题</span><span><i />资料</span><span><i />知识点</span></div>
      {g.document_count === 0 && <div className="ep-graph-empty"><h2>每个想法，都可以从这里开始。</h2><p>导入几份收藏或笔记，慢慢长出你的知识图谱。</p><Link to="/imports">带来第一份资料 <ArrowUpRightIcon size={14} /></Link></div>}
      {g.pending_count > 0 && <p className="ep-graph-working" role="status">{g.pending_count} 份资料等待归类{g.mode === 'semantic' ? '，需要完成语义索引' : ''}</p>}
    </section>
    <aside className={`ep-graph-sidebar${record ? ' ep-graph-sidebar--source' : ''}`}>
      {record ? <><header><span>原文</span><button aria-label="关闭原文" onClick={() => setSelected(undefined)}><XIcon size={18} /></button></header><h2>{record.title}</h2>{record.asset_url && <img className="ep-graph-source-image" src={record.asset_url} alt={record.title} />}{source.isPending ? <LoadingState message="正在读取原文" /> : source.isError ? <ErrorState detail={source.error.message} onRetry={() => { void source.refetch() }} /> : <div className="ep-graph-source">{source.data?.segments.map(s => <p key={s.id} data-active={s.id === record.segment_id}>{s.text}</p>)}</div>}<Link className="ep-graph-source-link" to={`/library?kb_id=${encodeURIComponent(record.library_id)}&document_id=${encodeURIComponent(record.document_id)}`}>在资料库中打开 <ArrowUpRightIcon size={14} /></Link>{record.source_url && /^https?:\/\//i.test(record.source_url) && <a className="ep-graph-source-link" href={record.source_url} target="_blank" rel="noreferrer">访问来源网页 <ArrowUpRightIcon size={14} /></a>}</> : <><header><span>{query ? `找到 ${results.length} 个结果` : '沿着好奇心，开始探索'}</span></header><div className="ep-graph-result-list">{results.slice(0,80).map(n => <button key={n.id} data-selected={n.id === selected} onClick={() => setSelected(n.id)}><FileTextIcon size={15} weight="light" /><span>{n.label}<small>{n.nodeType === 'topic' ? '主题' : n.nodeType === 'document' ? '资料' : '知识点'}</small></span><ArrowUpRightIcon size={13} /></button>)}</div>{!results.length && <p className="ep-graph-sidebar-hint">{query ? '换一个词试试看。' : '你收集的资料与发现的联系，会在这里汇合。'}</p>}</>}
      {g.mode === 'mock' && <p className="ep-graph-mode">当前为本地演示归类；接入专用模型后可进行语义归类与主题命名。</p>}
    </aside></div>
  </main>
}
