import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Link } from 'react-router'
import { ArrowRightIcon, ArrowUpRightIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { ObsidianKnowledgeGraph } from '../../modules/knowledge-graph'
import { readPersonalGraph, rebuildPersonalGraph } from '../../modules/personal-graph'
import { readCourseDocument } from '../../modules/shared-knowledge'
import { ErrorState } from '../ui/States'
import { AgentLoading } from '../ui/AgentLoading'
import { KnowledgeGraphControls, KnowledgePage, KnowledgePageHead, KnowledgeViewSwitch } from '../courses/KnowledgeLayout'
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
  if (graph.isPending) return <AgentLoading message="正在展开你的知识图谱" />
  if (graph.isError || !projection) return <ErrorState detail={graph.error?.message} onRetry={() => { void graph.refetch() }} />
  const g = graph.data!
  const search = query.trim().toLocaleLowerCase()
  const selectedNode = g.nodes.find(node => node.id === selected)
  const neighbors = new Set(g.edges.flatMap(edge => edge.source === selected ? [edge.target] : edge.target === selected ? [edge.source] : []))
  const results = g.nodes.filter(node => node.nodeType !== 'self' && (search ? node.label.toLocaleLowerCase().includes(search) : selected ? neighbors.has(node.id) : false))
  const showSidebar = Boolean(search || selected)
  const closeSidebar = () => { setSelected(undefined); setQuery('') }
  return <KnowledgePage graph>
    <KnowledgePageHead title="图谱" actions={<><KnowledgeViewSwitch view="graph" /><Link className="qx-btn qx-btn--primary" to="/imports"><PlusIcon size={18} />继续导入</Link></>}>
      <div className="ep-knowledge-filters"><label className="qx-search ep-personal-map__search"><MagnifyingGlassIcon size={18} /><input aria-label="搜索我的图谱" value={query} onChange={event => { setQuery(event.target.value); setSelected(undefined) }} placeholder="找一个节点" /></label>{g.nodes.filter(node => node.nodeType === 'topic').map(node => <button className="qx-tag" type="button" key={node.id} aria-pressed={selected === node.id} onClick={() => { setSelected(selected === node.id ? undefined : node.id); setQuery('') }}>{node.label}</button>)}</div>
    </KnowledgePageHead>
    <div className="ep-personal-map__bar"><span className="qx-meta">{g.document_count} 份资料 · {g.topic_count} 个主题 · {g.nodes.length} 节点 · {g.edges.length} 关系</span><div className="ep-knowledge-actions"><button type="button" className="qx-btn qx-btn--ghost" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? '正在更新…' : '更新图谱'}</button><Link className="qx-btn qx-btn--ghost" to={record ? `/agent?reference_knowledge_base_id=${encodeURIComponent(record.library_id)}` : '/agent'}>和 {g.name} 聊聊<ArrowRightIcon size={16} /></Link></div></div>
    {error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}
    <div className="ep-personal-map">
      <ObsidianKnowledgeGraph layoutScope={userId ?? 'anonymous'} renderControls={controls => <KnowledgeGraphControls controls={controls} />} projection={projection} personal focusNodeId={selected} onSelectKnowledge={setSelected} onExpandNode={setSelected} />
      {g.document_count === 0 && <div className="ep-personal-map__empty"><h2 className="qx-card__title">每个想法，都可以从这里开始。</h2><p className="qx-meta">导入几份收藏或笔记，慢慢长出你的知识图谱。</p><Link className="qx-btn qx-btn--secondary" to="/imports">带来第一份资料<ArrowUpRightIcon size={15} /></Link></div>}
      {g.pending_count > 0 && <p className="qx-meta ep-personal-map__working" role="status">{g.pending_count} 份资料等待归类{g.mode === 'semantic' ? '，需要完成语义索引' : ''}</p>}
      <div className="ep-personal-map__legend" aria-label="节点类型"><span>我</span><span>主题</span><span>资料</span><span>知识点</span></div>
      {showSidebar && <aside className="qx-panel ep-personal-map__detail" aria-label={record ? '资料原文' : search ? '搜索结果' : '节点详情'}>
        <header><span className="qx-tag">{record ? '原文' : search ? `找到 ${results.length} 个结果` : selectedNode?.nodeType === 'topic' ? '主题' : '知识点'}</span><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={record ? '关闭原文' : '关闭节点面板'} onClick={closeSidebar}><XIcon size={18} /></button></header>
        {record ? <><h2 className="qx-card__title">{record.title}</h2>{record.asset_url && <img src={record.asset_url} alt={record.title} />}{source.isPending ? <AgentLoading compact state="work" message="正在读取原文…" /> : source.isError ? <ErrorState detail={source.error.message} onRetry={() => void source.refetch()} /> : <div className="qx-prose ep-personal-map__source">{source.data?.segments.map(segment => <p key={segment.id} data-active={segment.id === record.segment_id}>{segment.text}</p>)}</div>}<Link className="qx-btn qx-btn--primary qx-btn--block" to={`/library?kb_id=${encodeURIComponent(record.library_id)}&document_id=${encodeURIComponent(record.document_id)}${record.segment_id ? `&segment_id=${encodeURIComponent(record.segment_id)}` : ''}`}>在资料库中打开<ArrowUpRightIcon size={15} /></Link>{record.source_url && /^https?:\/\//i.test(record.source_url) && <a className="qx-btn qx-btn--ghost" href={record.source_url} target="_blank" rel="noreferrer">访问来源网页<ArrowUpRightIcon size={15} /></a>}</> : <>{selectedNode && <h2 className="qx-card__title">{selectedNode.label}</h2>}<div className="ep-personal-map__results">{results.slice(0, 80).map(node => <button className="qx-item" type="button" key={node.id} onClick={() => setSelected(node.id)}><FileTextIcon size={17} /><span>{node.label}<small>{node.nodeType === 'topic' ? '主题' : node.nodeType === 'document' ? '资料' : '知识点'}</small></span><ArrowUpRightIcon size={14} /></button>)}</div>{!results.length && <p className="qx-meta">{search ? '换一个词试试看。' : '这个节点暂时还没有关联资料。'}</p>}</>}
      </aside>}
    </div>
    {g.mode === 'mock' && <p className="qx-meta ep-personal-map__note">当前为本地演示归类；接入专用模型后可进行语义归类与主题命名。</p>}
  </KnowledgePage>
}
