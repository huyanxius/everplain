import { Select } from '../ui/Select'
import { useState, type FormEvent } from 'react'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import './document-knowledge-editor.css'
import { saveDocumentKnowledge, type SharedDocument, type SharedSource } from '../../modules/shared-knowledge'

type Topic = { title: string; summary: string; segmentIds: string[] }
type Relation = { source: string; target: string; label: string; segmentIds: string[] }

export function DocumentKnowledgeEditor({ source, onSaved, onCancel }: {
  source: SharedSource; onSaved: (document: SharedDocument) => void; onCancel: () => void
}) {
  const [summary, setSummary] = useState(source.document.knowledge?.summary ?? '')
  const [topics, setTopics] = useState<Topic[]>(source.document.knowledge?.topics ?? [])
  const [relations, setRelations] = useState<Relation[]>(source.document.knowledge?.relations ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function sources(value: string[], onChange: (ids: string[]) => void, label: string) {
    return <div className="ep-knowledge-edit__sources"><p className="qx-meta">原文依据 · {value.length} 段</p><label>选择原文<Select multiple required aria-label={label} value={value} onChange={nextValue => onChange(nextValue)} options={source.segments.map(segment => ({ value: segment.id, label: (segment.location.page ? `第 ${segment.location.page} 页` : `第 ${segment.ordinal + 1} 段`) + " · " + (segment.text.slice(0, 60)) }))} /><small className="qx-meta">可选择多段原文，再次选择可取消。</small></label></div>
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      onSaved(await saveDocumentKnowledge(source.knowledgeBaseId, source.document.id, {
        summary: summary.trim(),
        topics: topics.map((topic) => ({ title: topic.title.trim(), summary: topic.summary.trim(), segment_ids: topic.segmentIds })),
        relations: relations.map((relation) => ({ source: relation.source, target: relation.target, label: relation.label.trim(), segment_ids: relation.segmentIds })),
      }))
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <form className="ep-knowledge-edit" onSubmit={event => void save(event)}>
    <p className="qx-meta">修改整理结果，保留每个知识点与关系的原文依据。</p>
    <label>资料摘要<textarea className="qx-textarea" required maxLength={16000} rows={4} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    <section className="ep-knowledge-edit__section"><header><h3 className="qx-heading">知识点</h3><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="添加知识点" onClick={() => setTopics([...topics, { title: '', summary: '', segmentIds: [] }])}><PlusIcon size={17} /></button></header>
      <ol className="ep-knowledge-edit__list">{topics.map((topic, index) => <li key={index}><fieldset><legend>知识点 {index + 1}</legend><label>名称<input className="qx-input" required maxLength={100} value={topic.title} onChange={event => { const title = event.target.value; setTopics(topics.map((item, n) => n === index ? { ...item, title } : item)); setRelations(relations.map(relation => ({ ...relation, source: relation.source === topic.title ? title : relation.source, target: relation.target === topic.title ? title : relation.target }))) }} /></label><label>说明<textarea className="qx-textarea" required maxLength={4000} rows={3} value={topic.summary} onChange={event => setTopics(topics.map((item, n) => n === index ? { ...item, summary: event.target.value } : item))} /></label>{sources(topic.segmentIds, segmentIds => setTopics(topics.map((item, n) => n === index ? { ...item, segmentIds } : item)), `知识点 ${index + 1} 原文依据`)}<button className="qx-btn qx-btn--ghost ep-knowledge-edit__remove" type="button" onClick={() => { setTopics(topics.filter((_, n) => n !== index)); setRelations(relations.filter(item => item.source !== topic.title && item.target !== topic.title)) }}><TrashIcon size={15} />删除知识点</button></fieldset></li>)}</ol>
    </section>
    <section className="ep-knowledge-edit__section"><header><h3 className="qx-heading">关系</h3><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="添加关系" disabled={topics.length < 2} onClick={() => setRelations([...relations, { source: '', target: '', label: '', segmentIds: [] }])}><PlusIcon size={17} /></button></header>
      <ol className="ep-knowledge-edit__list">{relations.map((relation, index) => <li key={index}><fieldset><legend>关系 {index + 1}</legend><div className="ep-knowledge-edit__endpoints">{(['source', 'target'] as const).map(key => <label key={key}>{key === 'source' ? '起点' : '终点'}<Select required value={relation[key]} onChange={nextValue => setRelations(relations.map((item, n) => n === index ? { ...item, [key]: nextValue } : item))} options={[{ value: "", label: "选择知识点" }, ...(topics.map(topic => ({ value: topic.title, label: topic.title || '未命名' })))]} /></label>)}</div><label>关系说明<input className="qx-input" required maxLength={100} value={relation.label} onChange={event => setRelations(relations.map((item, n) => n === index ? { ...item, label: event.target.value } : item))} /></label>{sources(relation.segmentIds, segmentIds => setRelations(relations.map((item, n) => n === index ? { ...item, segmentIds } : item)), `关系 ${index + 1} 原文依据`)}<button className="qx-btn qx-btn--ghost ep-knowledge-edit__remove" type="button" onClick={() => setRelations(relations.filter((_, n) => n !== index))}><TrashIcon size={15} />删除关系</button></fieldset></li>)}</ol>
    </section>
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}
    <footer><button className="qx-btn qx-btn--primary" type="submit" disabled={busy || !topics.length}>{busy ? '保存中…' : '保存知识'}</button><button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={onCancel}>取消</button></footer>
  </form>
}
