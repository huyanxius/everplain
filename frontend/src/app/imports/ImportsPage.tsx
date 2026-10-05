import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, ArrowClockwiseIcon, CheckCircleIcon, FileArrowUpIcon, FolderOpenIcon, GlobeIcon, ImageIcon, NotebookIcon, PlayCircleIcon, PuzzlePieceIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { importFiles, importBilibili, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'
import { KnowledgePage, KnowledgePageHead } from '../courses/KnowledgeLayout'
import { AgentLoading } from '../ui/AgentLoading'
import { ExtensionDownloadDialog } from './ExtensionDownloadDialog'
import { ExtensionInstallGuide } from './ExtensionInstallGuide'
import { NoteFolderPicker } from './NoteFolderPicker'
import { ImportAttachments } from './ImportAttachments'
import './imports.css'
const sources = [
  { id: 'chrome', title: '浏览器收藏', description: 'Chrome、Edge 等导出的书签 HTML', accept: '.html,.htm', icon: GlobeIcon },
  { id: 'obsidian', title: 'Obsidian / Markdown', description: '直接读取笔记文件夹和附件，也支持已有 ZIP', accept: '.md,.markdown,.txt,.zip', icon: FolderOpenIcon },
  { id: 'apple_notes', title: 'Apple 备忘录', description: '上传导出的 Markdown 文件', accept: '.md,.markdown,.txt,.zip', icon: NotebookIcon },
  { id: 'enex', title: '印象笔记', description: 'Evernote / 印象笔记 ENEX 导出文件', accept: '.enex', icon: NotebookIcon },
  { id: 'notion', title: 'Notion', description: 'HTML 或 Markdown 导出包', accept: '.zip,.html,.htm,.md', icon: NotebookIcon },
  { id: 'flomo', title: 'flomo', description: '导出的 HTML 笔记文件', accept: '.html,.htm', icon: NotebookIcon },
  { id: 'keep', title: 'Google Keep', description: 'Google Takeout ZIP 或 JSON', accept: '.zip,.json,.html', icon: NotebookIcon },
  { id: 'bilibili', title: 'B 站公开收藏', description: '输入 UID，保存视频标题与简介', accept: '', icon: PlayCircleIcon },
  { id: 'image', title: '图片与截图', description: '保留图片，提取文字与内容描述', accept: 'image/png,image/jpeg,image/webp,image/gif', icon: ImageIcon },
] as const

export function ImportsPage({ userId }: { userId: string | null }) {
  return <ImportsPageContent key={userId ?? 'signed-out'} userId={userId} />
}

function ImportsPageContent({ userId }: { userId: string | null }) {
  const [selected, setSelected] = useState<typeof sources[number]['id']>('chrome')
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [readingFolder, setReadingFolder] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showExtensionGuide, setShowExtensionGuide] = useState(false)
  const [showExtensionDownload, setShowExtensionDownload] = useState(false)
  const extensionDownloadButton = useRef<HTMLButtonElement>(null)
  const extensionGuideButton = useRef<HTMLButtonElement>(null)
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: q => q.state.data?.some(b => b.status === 'processing') ? 1500 : false })
  const [params] = useSearchParams()
  const focusedBatch = params.get('batch')
  const scrolled = useRef<string | null>(null)
  useEffect(() => {
    if (focusedBatch && scrolled.current !== focusedBatch && batches.data?.some(batch => batch.id === focusedBatch)) {
      document.getElementById(`import-batch-${focusedBatch}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      scrolled.current = focusedBatch
    }
  }, [focusedBatch, batches.data])
  const source = sources.find(s => s.id === selected)!
  async function upload(files: FileList | File[] | null) {
    if (busyRef.current || !files?.length) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { const batch = await importFiles(selected as ImportSourceType, Array.from(files)); setNotice(`已接收 ${batch.total} 条资料，正在后台导入`); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '导入失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function favorites() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { await importBilibili(uid.trim()); setNotice('已开始读取公开收藏，标题与简介会在后台整理'); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '暂时无法读取收藏') }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <KnowledgePage>
    <KnowledgePageHead title="导入资料" actions={<Link className="qx-btn qx-btn--ghost" to="/library"><ArrowLeftIcon size={18} />知识库</Link>}><p className="qx-meta">选择来源，保留原文。重复导入只更新变化，失败的条目可以单独再试。</p></KnowledgePageHead>
    <div className="ep-import">
      <section aria-label="添加资料" className="ep-import__create">
        {selected === 'bilibili' ? <form className="qx-panel ep-import__bilibili" onSubmit={event => { event.preventDefault(); void favorites() }}><PlayCircleIcon size={28} /><h2 className="qx-card__title">B 站公开收藏</h2><label>公开账户 UID<input className="qx-input" value={uid} onChange={event => setUid(event.target.value)} inputMode="numeric" pattern="[0-9]{1,20}" required placeholder="例如：123456" /></label><button className="qx-btn qx-btn--primary" disabled={busy}>{busy ? '正在开始…' : '读取公开收藏'}<ArrowRightIcon size={15} /></button><p className="qx-meta">只读取匿名可见的公开收藏，保存视频标题、简介和来源链接，不需要 Cookie。</p></form> : <>
          {selected === 'obsidian' && <NoteFolderPicker disabled={busy} label="或选择整个文件夹" onFiles={files => upload(files)} onBusy={value => { busyRef.current = value; setBusy(value); setReadingFolder(value) }} onError={setError} />}
          <label className="ep-import__dropzone" data-busy={busy} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)) }}>
            <FileArrowUpIcon size={28} /><strong>{readingFolder ? '正在读取文件夹…' : busy ? '正在上传…' : '拖文件到这里，或点击选择'}</strong><span>{source.title}</span><small>{source.description}</small><input type="file" aria-label="选择文件" multiple accept={source.accept} disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = '' }} />
          </label>
          <div className="ep-import__upload-note"><p className="qx-meta">{selected === 'image' ? '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。' : '单个文件最多 16 MB，每批最多 64 MB；资料默认仅你可见。'}</p></div>
        </>}
        <div><h2 className="qx-heading">从别处导入</h2><div className="ep-import__sources" aria-label="导入来源">{sources.map(item => <button type="button" className="qx-btn qx-btn--secondary" key={item.id} aria-pressed={selected === item.id} disabled={busy} title={item.description} onClick={() => { setSelected(item.id); setError(''); setNotice('') }}><item.icon size={18} />{item.title}</button>)}</div></div>
      </section>
      {busy && <AgentLoading compact state="work" message={readingFolder ? '正在读取所选笔记文件夹…' : selected === 'bilibili' ? '正在读取公开收藏…' : '正在上传资料…'} />}
      {error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}{notice && <p role="status" className="qx-notice"><CheckCircleIcon size={17} />{notice}</p>}
      <section className="ep-import__history" aria-label="导入记录"><header><h2 className="qx-heading">导入记录</h2><button type="button" className="qx-btn qx-btn--ghost" onClick={() => void batches.refetch()}><ArrowClockwiseIcon size={16} />刷新</button></header>
        {batches.isError && <p role="alert" className="qx-notice qx-notice--danger">{batches.error.message}</p>}{batches.isPending && <AgentLoading message="正在读取记录…" />}{batches.data?.length === 0 && <p className="qx-meta">还没有导入记录。</p>}
        {!busy && batches.data?.some(batch => batch.status === 'processing') && <AgentLoading compact state="work" message="正在整理导入的资料…" />}
        <ul className="ep-import__batches">{batches.data?.map(batch => <li key={batch.id} id={`import-batch-${batch.id}`}><section className="ep-import__batch" data-current={focusedBatch === batch.id}><header>{batch.status === 'processing' ? <ArrowClockwiseIcon size={18} /> : batch.failed ? <WarningCircleIcon size={18} /> : <CheckCircleIcon size={18} />}<strong>{sources.find(item => item.id === batch.source_type)?.title ?? batch.source_type}</strong><span className="qx-meta">{batch.finished} / {batch.total}</span><Link className="qx-btn qx-btn--ghost" to={`/library?kb_id=${encodeURIComponent(batch.library_id)}`}>打开资料库<ArrowRightIcon size={14} /></Link></header><progress aria-label="导入进度" value={batch.finished} max={Math.max(batch.total, 1)} /><p className="qx-meta">{batch.imported} 条已入库 · {batch.duplicates} 条重复{batch.updated ? ` · ${batch.updated} 条已更新` : ''}{batch.attachment_count ? ` · ${batch.attachment_count} 个附件` : ''}{batch.failed ? ` · ${batch.failed} 条待重试` : ''}</p><details><summary>查看条目</summary><ul className="ep-import__items">{batch.items.map(item => <li key={item.id} data-failed={item.status === 'failed'}><span>{item.title}<small>{item.error ?? ({ imported: '已入库', updated: '已更新', duplicate: '已存在', queued: '等待处理', running: '正在处理', failed: '失败' })[item.status]}</small><ImportAttachments item={item} /></span>{item.status === 'failed' && <button type="button" className="qx-btn qx-btn--ghost" onClick={() => void retryImport(batch.id, item.id).then(() => batches.refetch()).catch(e => setError(String(e)))}>重试</button>}</li>)}</ul></details></section></li>)}</ul>
      </section>
      <section className="ep-import__extension" aria-label="Everplain 收藏助手">
        <PuzzlePieceIcon size={24} />
        <div><h2 className="qx-heading">让下一次收藏更轻松</h2><p className="qx-meta">Chrome / Edge 扩展支持一键收藏当前页、导入书签，无需复制链接。</p></div>
        <div className="ep-import__extension-actions">
          <button ref={extensionDownloadButton} type="button" className="qx-btn qx-btn--secondary" aria-haspopup="dialog" aria-expanded={showExtensionDownload} onClick={() => setShowExtensionDownload(true)}>下载扩展<ArrowRightIcon size={15} /></button>
          <button ref={extensionGuideButton} type="button" className="qx-btn qx-btn--ghost" aria-expanded={showExtensionGuide} aria-controls="clipper-install-guide" onClick={() => setShowExtensionGuide(value => !value)}>安装教程</button>
        </div>
      </section>
      {showExtensionGuide && <ExtensionInstallGuide onClose={() => { setShowExtensionGuide(false); extensionGuideButton.current?.focus() }} />}

      {showExtensionDownload && <ExtensionDownloadDialog trigger={extensionDownloadButton.current} onClose={() => setShowExtensionDownload(false)} />}
    </div>
  </KnowledgePage>
}
