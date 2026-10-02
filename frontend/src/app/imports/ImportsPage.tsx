import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, FileArrowUpIcon, FolderOpenIcon, GlobeIcon, ImageIcon, NotebookIcon, PlayCircleIcon, PuzzlePieceIcon } from '@phosphor-icons/react'
import { importFiles, importBilibili, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'
import { PageContent, PageShell } from '../ui/PageShell'
import './imports.css'
const sources = [
  { id: 'chrome', title: '浏览器收藏', description: 'Chrome、Edge 等导出的书签 HTML', accept: '.html,.htm', icon: GlobeIcon },
  { id: 'obsidian', title: 'Obsidian / Markdown', description: '笔记文件夹或 ZIP，保留目录和双链', accept: '.md,.markdown,.txt,.zip', icon: FolderOpenIcon },
  { id: 'apple_notes', title: 'Apple 备忘录', description: '上传导出的 Markdown 文件', accept: '.md,.markdown,.txt,.zip', icon: NotebookIcon },
  { id: 'enex', title: '印象笔记', description: 'Evernote / 印象笔记 ENEX 导出文件', accept: '.enex', icon: NotebookIcon },
  { id: 'notion', title: 'Notion', description: 'HTML 或 Markdown 导出包', accept: '.zip,.html,.htm,.md', icon: NotebookIcon },
  { id: 'flomo', title: 'flomo', description: '导出的 HTML 笔记文件', accept: '.html,.htm', icon: NotebookIcon },
  { id: 'keep', title: 'Google Keep', description: 'Google Takeout ZIP 或 JSON', accept: '.zip,.json,.html', icon: NotebookIcon },
  { id: 'bilibili', title: 'B 站公开收藏', description: '输入 UID，先读字幕，再按配置转写', accept: '', icon: PlayCircleIcon },
  { id: 'image', title: '图片与截图', description: '保留图片，提取文字与内容描述', accept: 'image/png,image/jpeg,image/webp,image/gif', icon: ImageIcon },
] as const

export function ImportsPage({ userId }: { userId: string | null }) {
  const [selected, setSelected] = useState<typeof sources[number]['id']>('chrome')
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: q => q.state.data?.some(b => b.status === 'processing') ? 1500 : false })
  const source = sources.find(s => s.id === selected)!
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError(''); setNotice('')
    try { const batch = await importFiles(selected as ImportSourceType, Array.from(files)); setNotice(`已接收 ${batch.total} 条资料，正在后台导入`); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '导入失败，请重试') }
    finally { setBusy(false) }
  }
  async function favorites() {
    setBusy(true); setError(''); setNotice('')
    try { await importBilibili(uid.trim()); setNotice('已开始读取公开收藏，字幕提取会在后台继续'); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '暂时无法读取收藏') }
    finally { setBusy(false) }
  }
  return <PageShell wide><PageContent><main className="ep-imports">
    <Link to="/app" className="ep-imports-back"><ArrowLeftIcon size={16} />我的空间</Link>
    <header><p>BRING YOUR WORLD</p><h1>把散落的收藏，带回同一个地方。</h1><span>选择来源，保留原文。重复导入会自动去重，失败的条目可以单独再试。</span></header>
    <div className="ep-imports-layout"><section><div className="ep-imports-sources" aria-label="导入来源">{sources.map(s => <button key={s.id} aria-pressed={selected === s.id} onClick={() => { setSelected(s.id); setError(''); setNotice('') }}><s.icon size={23} weight="light" /><strong>{s.title}</strong><span>{s.description}</span></button>)}</div>
      <div className="ep-imports-upload"><source.icon size={30} weight="light" /><h2>{source.title}</h2><p>{source.description}</p>
        {selected === 'bilibili' ? <form onSubmit={e => { e.preventDefault(); void favorites() }}><label>公开账户 UID<input value={uid} onChange={e => setUid(e.target.value)} inputMode="numeric" pattern="[0-9]{1,20}" required placeholder="例如：123456" /></label><button disabled={busy}>{busy ? '正在开始…' : '读取公开收藏'}<ArrowRightIcon size={15} /></button><small>只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。</small></form> : <><label className="ep-upload-button"><FileArrowUpIcon size={16} />{busy ? '正在上传…' : '选择文件'}<input type="file" multiple accept={source.accept} disabled={busy} onChange={e => { void upload(e.target.files); e.target.value = '' }} /></label>{selected === 'obsidian' && <label className="ep-upload-folder">或选择整个文件夹<input type="file" multiple {...{ webkitdirectory: '' }} disabled={busy} onChange={e => { void upload(e.target.files); e.target.value = '' }} /></label>}<small>{selected === 'image' ? '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。' : '单个文件最多 16 MB，每批最多 64 MB；资料默认仅你可见。'}</small></>}
      </div>{error && <p role="alert" className="ep-imports-error">{error}</p>}{notice && <p role="status" className="ep-imports-notice"><CheckCircleIcon size={16} />{notice}</p>}
      <div className="ep-imports-extension"><PuzzlePieceIcon size={23} weight="light" /><div><strong>让下一次收藏更轻松</strong><p>Chrome 扩展支持一键收藏当前页、导入书签，无需复制链接。</p></div><a href="/downloads/everplain-clipper.zip" download>下载扩展 <ArrowRightIcon size={15} /></a></div>
    </section><aside className="ep-imports-history"><header><h2>导入记录</h2><button onClick={() => { void batches.refetch() }}>刷新</button></header>{batches.isError && <p role="alert">{batches.error.message}</p>}{batches.isPending && <p role="status">正在读取记录…</p>}{batches.data?.length === 0 && <p className="ep-imports-muted">带来第一份资料，这里就会留下它的旅程。</p>}{batches.data?.map(batch => <section key={batch.id} className="ep-import-batch"><div><strong>{sources.find(s => s.id === batch.source_type)?.title ?? batch.source_type}</strong><span>{batch.finished} / {batch.total}</span></div><progress value={batch.finished} max={Math.max(batch.total,1)} /><small>{batch.imported} 条已入库 · {batch.duplicates} 条重复{batch.failed ? ` · ${batch.failed} 条待重试` : ''}</small><details><summary>查看条目</summary>{batch.items.map(i => <div className="ep-import-item" key={i.id}><span>{i.title}<small>{i.error ?? ({ imported: '已入库', duplicate: '已存在', queued: '等待处理', running: '正在处理', failed: '失败' })[i.status]}</small></span>{i.status === 'failed' && <button onClick={() => { void retryImport(batch.id,i.id).then(() => batches.refetch()).catch(e => setError(String(e))) }}>重试</button>}</div>)}</details><Link to={`/library?kb_id=${encodeURIComponent(batch.library_id)}`}>打开资料库 <ArrowRightIcon size={12} /></Link></section>)}</aside></div>
  </main></PageContent></PageShell>
}
