import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowUpRightIcon, MagnifyingGlassIcon, SquaresFourIcon, TreeStructureIcon, XIcon } from '@phosphor-icons/react'
import { KnowledgeGraphControls, KnowledgePage, KnowledgePageHead } from './KnowledgeLayout'
import { ObsidianKnowledgeGraph, type KnowledgeGraphProjection } from '../../modules/knowledge-graph'
import { getCourse, listCourses, type SharedCourse } from '../../modules/shared-knowledge'
import './course-knowledge.css'

type TopicSource = {
  documentId: string
  filename: string
  summary: string
  segmentIds: string[]
}

function courseProjection(course: SharedCourse | null) {
  const nodes: KnowledgeGraphProjection['nodes'][number][] = []
  const edges: KnowledgeGraphProjection['edges'][number][] = []
  const topics = new Map<string, { title: string; sources: TopicSource[] }>()
  if (course) {
    const root = `course:${course.id}`
    nodes.push({ id: root, label: course.name ?? '知识库', nodeType: 'dimension' })
    for (const doc of course.documents) {
      if (doc.knowledgeStatus !== 'ready' || !doc.knowledge) continue
      const documentNode = `document:${doc.id}`
      nodes.push({ id: documentNode, label: doc.filename, nodeType: 'category' })
      edges.push({ id: `contains:${doc.id}`, source: root, target: documentNode, relationType: '资料', direction: 'directed', layer: 'structure' })
      for (const topic of doc.knowledge.topics) {
        // Group identical names for navigation; source explanations remain separate evidence.
        const key = `topic:${topic.title.normalize('NFKC').trim()}`
        const value = topics.get(key) ?? { title: topic.title, sources: [] }
        value.sources.push({ documentId: doc.id, filename: doc.filename, summary: topic.summary, segmentIds: topic.segmentIds })
        topics.set(key, value)
        edges.push({ id: `${documentNode}:${key}`, source: documentNode, target: key, relationType: '涉及', direction: 'directed', layer: 'structure' })
      }
      for (const [index, relation] of (doc.knowledge.relations ?? []).entries()) {
        edges.push({ id: `relation:${doc.id}:${index}`, source: `topic:${relation.source.normalize('NFKC').trim()}`,
          target: `topic:${relation.target.normalize('NFKC').trim()}`, relationType: relation.label, direction: 'directed', layer: 'candidate',
          evidenceSourceIds: relation.segmentIds, evidenceLocator: doc.id, sourceTitle: relation.source, targetTitle: relation.target,
          description: doc.filename,
        })
      }
    }
    for (const [id, topic] of topics) nodes.push({ id, label: topic.title, nodeType: 'entry' })
  }
  return { projection: { releaseId: course?.id ?? '', nodes, edges }, topics }
}

function sourceLink(courseId: string, documentId: string, segmentId: string) {
  return `/library?${new URLSearchParams({ kb_id: courseId, document_id: documentId, segment_id: segmentId })}`
}

export function CourseKnowledgePage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('kb_id')
  const [courses, setCourses] = useState<SharedCourse[]>([])
  const [course, setCourse] = useState<SharedCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<string>()
  const [edgeId, setEdgeId] = useState<string>()
  const [graphOpen, setGraphOpen] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true); setError(null); setCourse(null); setFocus(undefined); setEdgeId(undefined)
    void (async () => {
      const values = await listCourses()
      if (!active) return
      setCourses(values.filter(item => item.access === 'owner'))
      if (id) {
        const value = await getCourse(id)
        if (active) { if (value.access !== 'owner') throw new Error('此知识库不可访问。'); setCourse(value) }
      }
    })().catch((e: Error) => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, retry])
  useEffect(() => {
    if (!course?.documents.some((doc) => doc.status === 'ready' && ['queued', 'running'].includes(doc.knowledgeStatus))) return
    let active = true
    const timer = window.setInterval(() => {
      void getCourse(course.id).then((value) => { if (active) { if (value.access !== 'owner') throw new Error('此知识库不可访问。'); setCourse(value) } })
        .catch((e: Error) => { if (active) { setCourse(null); setError(e.message); window.clearInterval(timer) } })
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [course])
  const { projection, topics } = useMemo(() => courseProjection(course), [course])
  const selectTopic = useCallback((key: string) => { setFocus(key); setEdgeId(undefined) }, [])
  const selected = focus ? topics.get(focus) : undefined
  const selectedEdge = projection.edges.find((edge) => edge.id === edgeId)
  const search = query.trim().toLocaleLowerCase()
  const visibleTopics = [...topics].filter(([, topic]) => !search || `${topic.title} ${topic.sources.map(s => s.summary).join(' ')}`.toLocaleLowerCase().includes(search))
  const selectedDocument = course?.documents.find(document => focus === `document:${document.id}`)
  const closeDetail = () => { setFocus(undefined); setEdgeId(undefined); setQuery('') }
  const showDetail = Boolean(selected || selectedEdge?.evidenceLocator || selectedDocument || search)

  const evidence = course && <>
    {selected ? <><h2 className="qx-card__title">{selected.title}</h2>{selected.sources.map((source, index) => <article className="ep-course-graph__evidence" key={`${source.documentId}:${index}`}><p>{source.summary}</p><strong className="qx-meta">{source.filename}</strong><div>{source.segmentIds.map((segment, index) => <Link className="qx-item" key={segment} to={sourceLink(course.id, source.documentId, segment)}>阅读原文 · {source.filename}{source.segmentIds.length > 1 ? ` · ${index + 1}` : ''}<ArrowUpRightIcon size={14} /></Link>)}</div></article>)}</> : selectedEdge?.evidenceLocator ? <><h2 className="qx-card__title">{selectedEdge.sourceTitle} → {selectedEdge.targetTitle}</h2><p>{selectedEdge.relationType}</p>{selectedEdge.evidenceSourceIds?.map((segment, index) => <Link className="qx-item" key={segment} to={sourceLink(course.id, selectedEdge.evidenceLocator!, segment)}>阅读关系依据 · {selectedEdge.description} · {index + 1}<ArrowUpRightIcon size={14} /></Link>)}</> : selectedDocument ? <><h2 className="qx-card__title">{selectedDocument.filename}</h2><p>{selectedDocument.knowledge?.summary}</p><Link className="qx-btn qx-btn--primary" to={`/library?kb_id=${encodeURIComponent(course.id)}&document_id=${encodeURIComponent(selectedDocument.id)}`}>阅读原文<ArrowUpRightIcon size={15} /></Link></> : <><h2 className="qx-card__title">找到 {visibleTopics.length} 个知识点</h2>{visibleTopics.map(([key, topic]) => <button className="qx-item" type="button" key={key} aria-label={`查看知识点 ${topic.title}`} onClick={() => selectTopic(key)}>{topic.title}<span className="qx-meta">{topic.sources.length} 份来源</span></button>)}{!visibleTopics.length && <p className="qx-meta">没有找到相关知识点。</p>}</>}
  </>
  return <KnowledgePage graph>
    <KnowledgePageHead title="知识与关系" actions={<><Link className="qx-btn qx-btn--ghost" to="/library"><ArrowLeftIcon size={17} />知识库</Link>{course && <><button className="qx-btn qx-btn--secondary" type="button" aria-pressed={graphOpen} onClick={() => setGraphOpen(!graphOpen)}>{graphOpen ? <SquaresFourIcon size={17} /> : <TreeStructureIcon size={17} />}{graphOpen ? '收起知识导图' : '展开知识导图'}</button><Link className="qx-btn qx-btn--primary" to={`/library?kb_id=${encodeURIComponent(course.id)}`}>阅读资料</Link></>}</>} />
    <div className="ep-course-graph__filters"><label className="qx-search"><MagnifyingGlassIcon size={18} /><input type="search" aria-label="搜索知识" value={query} onChange={event => { setQuery(event.target.value); setFocus(undefined); setEdgeId(undefined) }} placeholder="知识点、概念或方法" /></label><nav className="ep-knowledge-filters" aria-label="知识库目录">{courses.map(item => <button className="qx-tag" type="button" key={item.id} aria-pressed={item.id === id} onClick={() => { setParams({ kb_id: item.id }); setQuery('') }}>{item.name}</button>)}</nav></div>
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => setRetry(n => n + 1)}>重试</button></p>}
    {loading ? <p className="qx-meta" role="status">正在读取知识…</p> : !course && !error ? <div className="ep-knowledge-empty"><h2 className="qx-card__title">选择一个知识库</h2><p className="qx-meta">选择上方知识库，查看知识点、关系与原文出处。</p><Link className="qx-btn qx-btn--secondary" to="/library">管理知识库</Link></div> : null}
    {course && <>
      <div className="ep-course-graph__caption"><span>{course.name}</span><span className="qx-meta">{topics.size} 个知识点 · {course.documents.length} 份资料</span></div>
      {topics.size ? <>
        {graphOpen ? <div className="ep-course-graph"><ObsidianKnowledgeGraph renderControls={controls => <KnowledgeGraphControls controls={controls} />} projection={projection} focusNodeId={focus} onSelectKnowledge={selectTopic} onExpandNode={selectTopic} onSelectEdge={key => { setEdgeId(key); setFocus(undefined) }} />{showDetail && <aside className="qx-panel ep-course-graph__detail" aria-label="知识点原文依据"><header><span className="qx-meta">原文依据</span><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="关闭知识详情" onClick={closeDetail}><XIcon size={18} /></button></header>{evidence}</aside>}</div> : <div className="ep-course-graph__cards">{visibleTopics.map(([key, topic]) => <article className="qx-card" key={key}><h2 className="qx-card__title"><button type="button" onClick={() => selectTopic(key)} aria-label={`查看知识点 ${topic.title}`}>{topic.title}</button></h2><p className="qx-card__body">{topic.sources[0]?.summary}</p><span className="qx-card__meta">{topic.sources.length} 份原文来源</span>{focus === key && <div className="ep-course-graph__card-evidence">{evidence}</div>}</article>)}</div>}
        <p className="qx-meta ep-course-graph__note">同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。</p>
      </> : <div className="ep-knowledge-empty"><TreeStructureIcon size={32} /><p className="qx-meta" role="status">{course.documents.length ? '知识尚未整理完成。资料仍可打开阅读，处理状态可在资料页中查看。' : '上传资料后，将在这里生成知识点和知识导图。'}</p></div>}
      {course.documents.filter(doc => doc.knowledgeStatus === 'failed').map(doc => <p key={doc.id} className="qx-notice qx-notice--danger">{doc.filename}：知识整理失败，可在资料页重试。</p>)}
    </>}
  </KnowledgePage>
}
