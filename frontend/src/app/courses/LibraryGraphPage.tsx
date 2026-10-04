import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRightIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import { getCourse, listCourses, readKnowledgeStorage, type SharedCourse } from '../../modules/shared-knowledge'
import { PersonalGraphPage } from '../personal-graph/PersonalGraphPage'
import { CourseKnowledgePage } from './CourseKnowledgePage'
import { KnowledgePage, KnowledgePageChromeProvider, KnowledgePageHead, KnowledgeViewSwitch } from './KnowledgeLayout'
import { LibraryScopeSwitcher } from './LibraryScopeSwitcher'
import { LibrarySkeleton } from './LibraryMaterialCard'
import './library-graph.css'

type TopicEvidence = { title: string; summary: string; documentId: string; filename: string; segmentIds: string[] }
function groupPoints(course: SharedCourse, search: string) {
  const groups = new Map<string, { title: string; sources: TopicEvidence[] }>()
  for (const document of course.documents) {
    if (document.status !== 'ready' || document.knowledgeStatus !== 'ready') continue
    for (const topic of document.knowledge?.topics ?? []) {
      const key = topic.title.normalize('NFKC').trim()
      const group = groups.get(key) ?? { title: topic.title, sources: [] }
      group.sources.push({ title: topic.title, summary: topic.summary, documentId: document.id, filename: document.filename, segmentIds: topic.segmentIds })
      groups.set(key, group)
    }
  }
  return [...groups].filter(([, group]) => !search || `${group.title} ${group.sources.map(source => `${source.summary} ${source.filename}`).join(' ')}`.toLocaleLowerCase().includes(search))
}

export function LegacyLibraryKnowledgeRoute() {
  const [params] = useSearchParams()
  const next = new URLSearchParams(params)
  next.set('view', 'points')
  return <Navigate replace to={`/my/graph?${next}`} />
}

export function LibraryGraphPage({ userId }: { userId: string | null }) {
  return <LibraryGraphContent key={userId ?? 'anonymous'} userId={userId} />
}

function LibraryGraphContent({ userId }: { userId: string | null }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const id = params.get('kb_id')
  const points = params.get('view') === 'points'
  const [libraries, setLibraries] = useState<SharedCourse[]>([])
  const [details, setDetails] = useState<SharedCourse[]>([])
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof readKnowledgeStorage>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => { setQuery('') }, [id, points])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setDetails([]); setPartial(false)
    void (async () => {
      const list = await listCourses()
      if (!active) return
      setLibraries(list.filter(library => library.access === 'owner' || library.access === 'reader'))
      if (!points) {
        if (id) {
          const selected = await getCourse(id)
          if (!active) return
          if (selected.access !== 'owner') throw new Error('此知识库不可访问。')
          setLibraries(current => current.map(library => library.id === id ? selected : library))
        }
        return
      }
      const owners = list.filter(library => library.access === 'owner' && (!id || library.id === id))
      if (id && !owners.length) throw new Error('此知识库不可访问。')
      const results = await Promise.allSettled(owners.map(library => getCourse(library.id)))
      if (!active) return
      const ready = results.flatMap(result => result.status === 'fulfilled' && result.value.access === 'owner' ? [result.value] : [])
      if (id && !ready.length) throw new Error('此知识库不可访问。')
      setDetails(ready); setPartial(ready.length !== owners.length)
    })().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '知识暂时无法读取') }).finally(() => { if (active) setLoading(false) })
    void readKnowledgeStorage().then(value => { if (active) setStorage(value) }).catch(() => {})
    return () => { active = false }
  }, [id, points, reload])
  useEffect(() => {
    const pending = details.filter(course => course.documents.some(document => document.status === 'processing' || ['queued', 'running'].includes(document.knowledgeStatus)))
    if (!points || !pending.length) return
    let active = true
    const timer = window.setInterval(() => {
      void Promise.all(pending.map(course => getCourse(course.id))).then(values => {
        if (!active) return
        if (id && values.some(course => course.id === id && course.access !== 'owner')) { setDetails([]); setError('此知识库不可访问。'); return }
        setDetails(current => current.flatMap(course => {
          const update = values.find(value => value.id === course.id)
          return update ? update.access === 'owner' ? [update] : [] : [course]
        }))
      }).catch(failure => { if (active) { setError(failure instanceof Error ? failure.message : '知识暂时无法读取'); window.clearInterval(timer) } })
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [details, points, id])
  const current = libraries.find(library => library.id === id)
  function libraryHref(extra?: string) {
    const query = new URLSearchParams()
    if (id) query.set('kb_id', id)
    if (extra) query.set(extra, extra === 'add' ? 'extension' : '')
    return `/library${query.size ? `?${query}` : ''}`
  }
  function setView(view: 'graph' | 'points') {
    setParams(current => { const next = new URLSearchParams(current); if (view === 'points') next.set('view', 'points'); else next.delete('view'); return next })
  }
  const toolbar = <div className="ep-library-graph__toolbar"><KnowledgeViewSwitch view="graph" /><div className="qx-segmented" aria-label="知识的呈现方式"><button type="button" aria-pressed={!points} onClick={() => setView('graph')}>关系图</button><button type="button" aria-pressed={points} onClick={() => setView('points')}>知识点</button></div>{points && <label className="qx-search ep-library-graph__search"><MagnifyingGlassIcon /><input type="search" aria-label="搜索知识" placeholder="知识点、概念或方法" value={query} onChange={event => setQuery(event.target.value)} /></label>}</div>
  const full = !!current && current.documents.length >= (storage?.max_documents_per_library ?? 100)
  const chrome = { title: <LibraryScopeSwitcher libraries={libraries} selectedId={id} view="graph" storage={storage} onCreate={() => { navigate(libraryHref('new')) }} />, actions: full ? <button className="qx-btn qx-btn--primary" disabled title={`每个知识库最多 ${storage?.max_documents_per_library ?? 100} 份资料`}><PlusIcon />添加</button> : <Link className="qx-btn qx-btn--primary" to={libraryHref('add')}><PlusIcon />添加</Link>, toolbar: <>{toolbar}{!points && error && <p className="qx-notice qx-notice--danger" role="alert">{error}<button className="qx-btn qx-btn--ghost" type="button" onClick={() => setReload(value => value + 1)}>重试读取</button></p>}</> }
  const search = query.trim().toLocaleLowerCase()
  const groups = useMemo(() => details.map(course => ({ course, points: groupPoints(course, search) })), [details, search])
  const topicCount = groups.reduce((total, group) => total + group.points.length, 0)
  const documentCount = details.reduce((total, course) => total + course.documents.length, 0)
  if (!points) return <KnowledgePageChromeProvider value={chrome}>{id ? <CourseKnowledgePage libraryChrome /> : <PersonalGraphPage userId={userId} />}</KnowledgePageChromeProvider>
  return <KnowledgePageChromeProvider value={chrome}><KnowledgePage graph>
    <KnowledgePageHead title="知识点">{current?.description && <p className="qx-meta">{current.description}</p>}</KnowledgePageHead>
    {loading ? <LibrarySkeleton /> : error ? <p className="qx-notice qx-notice--danger" role="alert">{error}<button className="qx-btn qx-btn--ghost" type="button" onClick={() => setReload(value => value + 1)}>重新读取</button></p> : <>
      <p className="qx-meta">{topicCount} 个知识点 · {documentCount} 份资料</p>
      {partial && <p className="qx-notice qx-notice--danger" role="alert">部分知识库暂时无法读取。<button className="qx-btn qx-btn--ghost" type="button" onClick={() => setReload(value => value + 1)}>重试读取</button></p>}
      <div className="ep-library-points">{groups.map(({ course, points: entries }) => <section key={course.id} aria-label={`${course.name}知识点`}>
        {!id && <h2 className="qx-heading"><Link to={`/my/graph?kb_id=${encodeURIComponent(course.id)}&view=points`}>{course.name}</Link></h2>}
        {entries.map(([key, group]) => <article className="ep-library-points__topic" key={key}><h3 className="qx-card__title">{group.title}</h3>{group.sources.map((source, index) => <div className="ep-library-points__source" key={`${source.documentId}:${index}`}><p className="qx-card__body">{source.summary}</p><span className="qx-meta">{source.filename}</span><div className="ep-knowledge-actions">{source.segmentIds.map((segmentId, index) => <Link className="qx-btn qx-btn--ghost" key={segmentId} to={`/library?${new URLSearchParams({ kb_id: course.id, document_id: source.documentId, segment_id: segmentId })}`}>阅读原文{source.segmentIds.length > 1 ? ` ${index + 1}` : ''}<ArrowUpRightIcon size={14} /></Link>)}</div></div>)}</article>)}
        {course.documents.filter(document => document.knowledgeStatus === 'failed').map(document => <p className="qx-notice qx-notice--danger" key={document.id}>{document.filename}：知识整理失败，可在资料页重试。<Link to={`/library?kb_id=${encodeURIComponent(course.id)}`}>打开资料页</Link></p>)}
      </section>)}</div>
      {!topicCount && <div className="ep-knowledge-empty"><h2 className="qx-card__title">{search ? '没有找到相关知识点' : '知识尚未整理完成'}</h2><p className="qx-meta">{search ? '换一个关键词，或清除搜索。' : documentCount ? '资料仍可打开阅读，处理状态可在资料页中查看。' : '导入资料后，在这里查看知识点和原文依据。'}</p>{search ? <button type="button" className="qx-btn qx-btn--secondary" onClick={() => setQuery('')}>清除搜索</button> : <Link className="qx-btn qx-btn--secondary" to={libraryHref('add')}>添加资料</Link>}</div>}
      <p className="qx-meta ep-library-points__note">同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。</p>
    </>}
  </KnowledgePage></KnowledgePageChromeProvider>
}
