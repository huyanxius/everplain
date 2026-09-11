import { useState, type FormEvent } from 'react'
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
    return <label>原文依据<select multiple required aria-label={label} value={value} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (item) => item.value))}>
      {source.segments.map((segment) => <option value={segment.id} key={segment.id}>{segment.location.page ? `第 ${segment.location.page} 页` : `第 ${segment.ordinal + 1} 段`} · {segment.text.slice(0, 60)}</option>)}
    </select><small>可按住 ⌘ / Ctrl 选择多段原文。</small></label>
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
  return <form className="knowledge-editor" onSubmit={(event) => void save(event)}>
    <p>修改整理结果，保留每个知识点与关系的原文依据。</p>
    <label>资料摘要<textarea required maxLength={16000} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    {topics.map((topic, index) => <fieldset key={index}><legend>知识点 {index + 1}</legend>
      <label>名称<input required maxLength={100} value={topic.title} onChange={(event) => { const title = event.target.value; setTopics(topics.map((item, n) => n === index ? { ...item, title } : item)); setRelations(relations.map((relation) => ({ ...relation, source: relation.source === topic.title ? title : relation.source, target: relation.target === topic.title ? title : relation.target }))) }} /></label>
      <label>说明<textarea required maxLength={4000} rows={3} value={topic.summary} onChange={(event) => setTopics(topics.map((item, n) => n === index ? { ...item, summary: event.target.value } : item))} /></label>
      {sources(topic.segmentIds, (segmentIds) => setTopics(topics.map((item, n) => n === index ? { ...item, segmentIds } : item)), `知识点 ${index + 1} 原文依据`)}
      <button type="button" onClick={() => { setTopics(topics.filter((_, n) => n !== index)); setRelations(relations.filter((item) => item.source !== topic.title && item.target !== topic.title)) }}>删除知识点</button>
    </fieldset>)}
    <button type="button" onClick={() => setTopics([...topics, { title: '', summary: '', segmentIds: [] }])}>添加知识点</button>
    {relations.map((relation, index) => <fieldset key={index}><legend>关系 {index + 1}</legend>
      {(['source', 'target'] as const).map((key) => <label key={key}>{key === 'source' ? '起点' : '终点'}<select required value={relation[key]} onChange={(event) => setRelations(relations.map((item, n) => n === index ? { ...item, [key]: event.target.value } : item))}><option value="">选择知识点</option>{topics.map((topic, n) => <option key={n} value={topic.title}>{topic.title || '未命名'}</option>)}</select></label>)}
      <label>关系说明<input required maxLength={100} value={relation.label} onChange={(event) => setRelations(relations.map((item, n) => n === index ? { ...item, label: event.target.value } : item))} /></label>
      {sources(relation.segmentIds, (segmentIds) => setRelations(relations.map((item, n) => n === index ? { ...item, segmentIds } : item)), `关系 ${index + 1} 原文依据`)}
      <button type="button" onClick={() => setRelations(relations.filter((_, n) => n !== index))}>删除关系</button>
    </fieldset>)}
    <button type="button" disabled={topics.length < 2} onClick={() => setRelations([...relations, { source: '', target: '', label: '', segmentIds: [] }])}>添加关系</button>
    {error ? <p role="alert">{error}</p> : null}
    <div className="courses-page__actions"><button className="qx-button" type="submit" disabled={busy || !topics.length}>{busy ? '保存中…' : '保存知识'}</button><button type="button" disabled={busy} onClick={onCancel}>取消</button></div>
  </form>
}
