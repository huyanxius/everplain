import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ArrowRightIcon, NotePencilIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { genres, genreLabel, writingApi, type Genre, type WritingSamplePreview } from '../../modules/writing'
import { PageShell } from '../ui/PageShell'
import { Select } from '../ui/Select'
import { WritingComposer } from './WritingComposer'
import { message, useRequestKeys } from './writingState'
import './reference-home.css'
import './writing-home.css'
import './writing.css'

const abilities = [
  ['按文体起稿', '公文、报告、正式文体、小说、随笔，先起一个可修改的草稿。', '帮我起草一份读书月活动的通知'],
  ['参考你的写法', '从同文体样文中提取表达特点。风格效果仍在打磨。', '参考我的随笔样文，写一段下雨天的开头'],
  ['改写与润色', '改动先给你看，再决定接受或撤回。', '帮我写一段简洁自然的开头'],
  ['接着往下写', '顺着正文续一段，原文不会被自动覆盖。', '为我的新随笔写一个开头'],
  ['检查与校对', '给出待审修改，保留你的决定权。', '为新文稿整理一份校对要点'],
  ['保留 Markdown', '源码、双链、属性与代码块可继续编辑和保存。', '起草一个用 Markdown 组织的文章提纲'],
  ['分文体管理', '样文按体裁分别保存，不混用不同文体。', '写一份报告提纲，标出需要我补充的事实'],
  ['修订可撤回', 'AI 结果保留为待定修订，接受前正文不变。', '起草一段论述，并标出不确定的事实'],
  ['文稿可导出', '将当前正文下载为 Markdown，继续在常用工具里写。', '帮我写一个适合继续展开的文章提纲'],
] as const
type ImportPiece = WritingSamplePreview['items'][number] & { id: string; genre: Genre | ''; selected: boolean; saved: boolean; splitAt: string }
const paragraphParts = (text: string) => text.split(/\n\s*\n/).filter(part => part.trim())
const importPiece = (item: WritingSamplePreview['items'][number]): ImportPiece => ({ ...item, id: crypto.randomUUID(), genre: '', selected: !item.excluded_reason && item.character_count >= 80, saved: false, splitAt: '1' })
export function WritingHomePage({ userId }: { userId: string | null }) {
  return <PageShell workspace><WritingHome key={userId} userId={userId} /></PageShell>
}
function WritingHome({ userId }: { userId: string | null }) {
  const navigate = useNavigate(), cache = useQueryClient(), keyFor = useRequestKeys()
  const summary = useQuery({ queryKey: ['writing', userId, 'summary'], queryFn: ({ signal }) => writingApi.summary(signal), enabled: Boolean(userId), retry: false })
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId), retry: false })
  const [showSamples, setShowSamples] = useState(false)
  const samples = useQuery({ queryKey: ['writing', userId, 'samples'], queryFn: ({ signal }) => writingApi.samples(signal), enabled: Boolean(userId) && showSamples, retry: false })
  const [prompt, setPrompt] = useState(''), [genre, setGenre] = useState<Genre>('essay'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState<string | null>(null), [heroVisible, setHeroVisible] = useState(true)
  const [importPieces, setImportPieces] = useState<ImportPiece[]>([]), [importWarnings, setImportWarnings] = useState<string[]>([]), [importNotice, setImportNotice] = useState(''), [parsing, setParsing] = useState(false)
  const previewRequest = useRef<AbortController | null>(null), previewSequence = useRef(0), importBoundary = useRef<HTMLElement>(null)
  const mutex = useRef(false), alive = useRef(true), hero = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null)
  useEffect(() => { alive.current = true; const requests = previewRequest, sequence = previewSequence; return () => { alive.current = false; sequence.current++; requests.current?.abort() } }, [])
  useEffect(() => { if (!hero.current || typeof IntersectionObserver === 'undefined') return; const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { root: scroller.current }); observer.observe(hero.current); return () => observer.disconnect() }, [])
  async function create(nextGenre: Genre, instruction = '') {
    if (!userId || mutex.current) return
    mutex.current = true; setBusy(true); setError('')
    const body = { title: instruction.trim().slice(0, 60) || `未命名${genreLabel(nextGenre)}`, genre: nextGenre, markdown: '' }
    try {
      const document = await writingApi.create(body, keyFor('create', body))
      if (!alive.current) return
      if (instruction.trim()) {
        const request = { action: 'continue' as const, instruction: instruction.trim(), expected_version: document.version }
        try { await writingApi.propose(document.document_id, request, keyFor(`propose:${document.document_id}`, request)) }
        catch (failure) { if (alive.current) { navigate(`/writing/${document.document_id}`, { state: { writingError: message(failure), writingInstruction: instruction } }); return } }
      }
      if (alive.current) { void cache.invalidateQueries({ queryKey: ['writing', userId] }); navigate(`/writing/${document.document_id}`) }
    } catch (failure) { if (alive.current) setError(message(failure)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  async function upload(files: File[]) {
    if (!userId || mutex.current || !files.length || importPieces.length) return
    const sequence = ++previewSequence.current, controller = new AbortController()
    previewRequest.current = controller
    mutex.current = true; setBusy(true); setParsing(true); setError(''); setImportNotice('')
    try {
      const pieces: ImportPiece[] = [], warnings = new Set<string>()
      for (const selected of files) {
        if (selected.size > 5 * 1024 * 1024) throw new Error('样文文件不能超过 5 MB。')
        const preview = await writingApi.previewSamples(selected, controller.signal)
        if (!alive.current || sequence !== previewSequence.current) return
        pieces.push(...preview.items.map(importPiece)); preview.warnings.forEach(warning => warnings.add(warning))
        if (pieces.length > 100) throw new Error('一次最多预览 100 篇样文，请分批导入。')
      }
      setImportPieces(pieces); setImportWarnings([...warnings])
    } catch (failure) { if (alive.current && sequence === previewSequence.current && !controller.signal.aborted) setError(message(failure)) }
    finally { if (sequence === previewSequence.current) { mutex.current = false; previewRequest.current = null; if (alive.current) { setBusy(false); setParsing(false) } } }
  }
  function cancelImport() {
    previewSequence.current++; previewRequest.current?.abort(); previewRequest.current = null
    mutex.current = false; setBusy(false); setParsing(false); setImportPieces([]); setImportWarnings([]); setError('')
    setImportNotice('已取消，未确认的样文没有保存。')
  }
  function editPiece(id: string, patch: Partial<ImportPiece>) {
    setImportPieces(current => current.map(piece => piece.id === id && !piece.saved ? { ...piece, ...patch } : piece))
  }
  function splitPiece(piece: ImportPiece) {
    const paragraphs = paragraphParts(piece.text), at = Number(piece.splitAt)
    if (piece.saved || at < 1 || at >= paragraphs.length) return
    const first = paragraphs.slice(0, at).join('\n\n'), second = paragraphs.slice(at).join('\n\n')
    setImportPieces(current => current.flatMap(item => item.id === piece.id ? [
      { ...item, text: first, splitAt: '1' },
      { ...importPiece({ ...item, title: `${item.title.slice(0, 190)}（另一篇）`, text: second }), selected: item.selected },
    ] : [item]))
  }
  async function confirmImport() {
    if (!userId || mutex.current) return
    const pending = importPieces.filter(piece => piece.selected && !piece.saved)
    if (!pending.length) return
    if (pending.some(piece => !piece.genre || !piece.title.trim() || piece.text.replace(/\s/g, '').length < 80)) { setError('请为每篇选中的样文确认文体、标题和至少 80 个有效字符的正文。'); return }
    mutex.current = true; setBusy(true); setError('')
    try {
      for (const piece of pending) {
        if (!alive.current) return
        const body = { title: piece.title.trim(), genre: piece.genre as Genre, text: piece.text }
        await writingApi.createSample(body, keyFor(`sample:${piece.id}`, body))
        if (!alive.current) return
        setImportPieces(current => current.map(item => item.id === piece.id ? { ...item, saved: true } : item))
        setShowSamples(true); void cache.invalidateQueries({ queryKey: ['writing', userId] })
      }
      if (alive.current) { setImportPieces([]); setImportWarnings([]); setImportNotice(`已保存 ${pending.length} 篇确认的样文。`) }
    } catch (failure) { if (alive.current) setError(`${message(failure)} 已保存的样文不会重复提交，可以重试剩余部分。`) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  async function remove(sampleId: string) {
    if (mutex.current) return; mutex.current = true; setBusy(true); setError('')
    try { await writingApi.deleteSample(sampleId); if (alive.current) { setDeleting(null); await cache.invalidateQueries({ queryKey: ['writing', userId] }) } }
    catch (failure) { if (alive.current) setError(message(failure)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  const agent = profile.data, name = agent?.name ?? 'Agent', hour = new Date().getHours(), greeting = hour < 6 ? '还没睡呀' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  useEffect(() => { if (importPieces.length) importBoundary.current?.scrollIntoView({ block: 'nearest' }) }, [importPieces.length])
  const composer = <WritingComposer value={prompt} onChange={setPrompt} onSend={() => void create(genre, prompt)} busy={busy || Boolean(importPieces.length)} onUpload={files => void upload(files)} />
  return <div className="wh-page writing-home"><div className="wh-scroll" ref={scroller}><main className="personal-start wh-main">
    <section className="personal-start__hero">
      {agent && <AgentAvatar avatar={agent.avatar_id as AgentAvatarId} color={agent.color} size={84} state={busy ? 'think' : 'greet'} label={name} />}
      <h1 className="qx-display">{greeting}，我来学你怎么写</h1>
      <div className="wh-hero-composer" ref={hero}>{heroVisible ? composer : <div className="wh-hero-composer__ghost" />}</div>
      <div className="personal-start__chips"><button type="button" className="qx-tag qx-tag--outline" onClick={() => { setGenre('official'); setPrompt('帮我起草一份读书月活动的通知') }}>起草一份通知</button><button type="button" className="qx-tag qx-tag--outline" onClick={() => { setGenre('essay'); setPrompt('参考我的随笔样文，写一段下雨天的开头') }}>照我的写法写一段</button>{summary.data?.documents[0] && <Link className="qx-tag qx-tag--outline" to={`/writing/${summary.data.documents[0].document_id}`}>接着写《{summary.data.documents[0].title}》</Link>}</div>
      <p className="qx-meta">写作试用 · 生成会按现有模型价格使用你的积分。请核对事实与表达。</p>
    </section>
    {error && <p className="qx-notice qx-notice--danger" role="alert">{error}</p>}
    {busy && <p className="qx-meta" role="status">正在处理，请稍候。原文不会自动改动。</p>}
    {parsing && <button type="button" className="qx-btn qx-btn--secondary" onClick={cancelImport}>取消解析</button>}
    {importNotice && <p role="status" className="qx-meta">{importNotice}</p>}
    {importPieces.length > 0 && <section ref={importBoundary} className="writing-samples" aria-label="样文导入预览">
      <h2 className="qx-heading">确认要学习的文章</h2>
      {importWarnings.map(warning => <p className="qx-meta" key={warning}>{warning}</p>)}
      <p className="qx-meta">逐篇确认文体。若预览把几篇连在一起，可在段落之间拆分；也可编辑正文去掉引用或他人文字。</p>
      {importPieces.map((piece, index) => <fieldset className="qx-item writing-import-piece" key={piece.id} disabled={busy || piece.saved}>
        <legend>文章 {index + 1}{piece.saved ? ' · 已保存' : ''}</legend>
        <label><input type="checkbox" checked={piece.selected} onChange={event => editPiece(piece.id, { selected: event.target.checked })} />导入文章 {index + 1}</label>
        {piece.excluded_reason && <p className="qx-notice">{piece.excluded_reason}</p>}
        <label>标题<input aria-label={`样文标题 ${index + 1}`} value={piece.title} maxLength={200} onChange={event => editPiece(piece.id, { title: event.target.value })} /></label>
        <label>文体<Select aria-label={`样文文体 ${index + 1}`} value={piece.genre} onChange={value => editPiece(piece.id, { genre: value as Genre | '' })} options={[{ value: '', label: '请选择并确认文体' }, ...genres.map(item => ({ value: item.id, label: item.label }))]} /></label>
        <label>正文<textarea aria-label={`样文正文 ${index + 1}`} value={piece.text} rows={6} maxLength={100000} onChange={event => editPiece(piece.id, { text: event.target.value })} /></label>
        <p className="qx-meta">{piece.text.replace(/\s/g, '').length} 个有效字符{piece.text.replace(/\s/g, '').length < 80 ? ' · 不足 80 字，请补全正文或不导入' : ''}</p>
        {paragraphParts(piece.text).length > 1 && <div className="writing-upload-controls"><Select aria-label={`拆分文章 ${index + 1} 的位置`} value={piece.splitAt} onChange={value => editPiece(piece.id, { splitAt: value })} options={paragraphParts(piece.text).slice(0, -1).map((part, i) => ({ value: String(i + 1), label: `第 ${i + 1} 段后 · ${part.slice(0, 24)}` }))} /><button type="button" className="qx-btn qx-btn--secondary" disabled={importPieces.length >= 100} onClick={() => splitPiece(piece)}>拆成独立文章</button></div>}
      </fieldset>)}
      <div className="writing-upload-controls"><button type="button" className="qx-btn qx-btn--primary" disabled={busy || !importPieces.some(piece => piece.selected && !piece.saved)} onClick={() => void confirmImport()}>确认导入选中文章</button><button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={cancelImport}>取消导入</button></div>
    </section>}
    {summary.isError ? <div className="qx-notice qx-notice--danger" role="alert"><p>{message(summary.error)}</p><button className="qx-btn qx-btn--secondary" onClick={() => void summary.refetch()}>重新读取写作资料</button></div> : summary.isPending ? <p role="status" className="qx-meta">正在读取你的写作资料…</p> : <>
      <section className="wh-mimic" aria-label={`${name}学过的你的文章`}><p className="wh-mimic__text">已添加你的 <b>{summary.data.sample_count}</b> 篇文章<span className="wh-mimic__genres">{summary.data.genres.map(item => `${genreLabel(item.genre)} ${item.sample_count}`).join(' · ')}</span></p><div className="writing-upload-controls"><label>文体<Select aria-label="样文与新稿文体" value={genre} onChange={value => setGenre(value as Genre)} options={genres.map(item => ({ value: item.id, label: item.label }))} /></label><button type="button" className="qx-btn qx-btn--secondary wh-mimic__upload" disabled={busy || Boolean(importPieces.length)} onClick={() => file.current?.click()}><UploadSimpleIcon />上传我的文章</button><button type="button" className="qx-btn qx-btn--ghost" onClick={() => setShowSamples(current => !current)}>{showSamples ? '收起样文' : '管理样文'}</button></div><input ref={file} hidden type="file" multiple accept=".md,.txt,.docx,.pdf" onChange={event => { void upload(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} /></section>
      {showSamples && <section aria-label="我的样文" className="writing-samples">{samples.isPending ? <p role="status">正在读取样文…</p> : samples.isError ? <button className="qx-btn qx-btn--secondary" onClick={() => void samples.refetch()}>重新读取样文</button> : samples.data.items.map(sample => <div className="writing-sample qx-item" key={sample.sample_id}><span>{sample.title} · {genreLabel(sample.genre)} · {sample.character_count} 字</span>{deleting === sample.sample_id ? <><span>删除后不再参与生成。</span><button className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => void remove(sample.sample_id)}>确认删除</button><button className="qx-btn qx-btn--ghost" onClick={() => setDeleting(null)}>取消</button></> : <button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => setDeleting(sample.sample_id)}>删除</button>}</div>)}</section>}
      <section className="personal-start__section" aria-labelledby="writing-recent"><header className="personal-start__section-head"><h2 id="writing-recent" className="qx-heading">接着写</h2><span className="qx-meta">{summary.data.documents.length} 篇文稿</span></header><div className="personal-start__grid">{summary.data.documents.map(document => <Link key={document.document_id} className="qx-card qx-card--interactive personal-start__research wh-card" to={`/writing/${document.document_id}`}><span className="qx-tag">{genreLabel(document.genre)}</span><h3 className="qx-card__title">{document.title}</h3><p className="qx-card__body personal-start__excerpt">{document.markdown.slice(0, 110) || '从第一句话开始。'}</p><span className="qx-card__meta">{new Date(document.updated_at).toLocaleDateString()}</span></Link>)}</div>{!summary.data.documents.length && <p className="qx-meta">还没有文稿。说说想写什么，或从下方新建。</p>}</section>
    </>}
    <section className="personal-start__section" aria-labelledby="writing-abilities"><header className="personal-start__section-head"><h2 id="writing-abilities" className="qx-heading">{name}能帮你写</h2></header><div className="personal-start__grid">{abilities.map(([title, note, example]) => <button key={title} type="button" className="qx-card qx-card--interactive personal-start__research wh-card" onClick={() => { setPrompt(example); hero.current?.scrollIntoView({ block: 'center' }) }}><h3 className="qx-card__title">{title}</h3><p className="qx-card__body">{note}</p><span className="qx-card__meta wh-card__try">试试：{example}</span></button>)}</div></section>
    <footer className="personal-start__footer"><nav className="personal-start__destinations" aria-label="新建"><div className="personal-start__destination-group"><p className="qx-meta">新建</p><div className="personal-start__destination-actions">{genres.map(item => <button type="button" key={item.id} className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => void create(item.id)}><NotePencilIcon />{item.label}</button>)}<button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => void create('essay')}>空白文档<ArrowRightIcon /></button></div></div></nav></footer>
  </main></div>{!heroVisible && <div className="wh-dock">{composer}</div>}</div>
}
