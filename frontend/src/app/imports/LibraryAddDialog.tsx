import { useEffect, useRef, useState, type ComponentType, type DragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowClockwiseIcon, ArrowRightIcon, BooksIcon, CheckCircleIcon, FileTextIcon, FolderOpenIcon, ImageIcon, NotebookIcon, PlayCircleIcon, PuzzlePieceIcon, UploadSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { importBilibili, importFiles, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'
import { COURSE_DOCUMENT_ACCEPT, createCourse, getCourse, readKnowledgeStorage, uploadCourseDocument, type SharedCourse, type SharedDocument } from '../../modules/shared-knowledge'
import { useAnimatedDismiss } from '../../ui/usePresence'
import { AgentLoading } from '../ui/AgentLoading'
import { ExtensionInstallGuide } from './ExtensionInstallGuide'
import { ExtensionDownloadDialog } from './ExtensionDownloadDialog'
import chromeLogo from '../../assets/brand/chrome.svg'
import obsidianLogo from '../../assets/brand/obsidian.svg'
import notionLogo from '../../assets/brand/notion.svg'
import evernoteLogo from '../../assets/brand/evernote.svg'
import flomoLogo from '../../assets/brand/flomo.png'
import keepLogo from '../../assets/brand/keep.svg'
import bilibiliLogo from '../../assets/brand/bilibili.svg'
import './library-add-dialog.css'

type SourceId = 'file' | ImportSourceType | 'bilibili'
type Source = { id: SourceId; title: string; accept: string; formats: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; logo?: string; steps: string[]; note?: string }
const sources: Source[] = [
  { id: 'file', title: '文件', accept: COURSE_DOCUMENT_ACCEPT, formats: 'PDF、Word、PPT、Markdown、TXT', icon: UploadSimpleIcon, steps: ['可以一次选好几份', '上传完就能读原文', '知识点稍后自动整理好'], note: '扫描版 PDF 需先转为可选取文字的文档。' },
  { id: 'image', title: '图片与截图', accept: 'image/png,image/jpeg,image/webp,image/gif', formats: 'PNG、JPG、WebP、GIF', icon: ImageIcon, steps: ['选择截图、照片或拍下的书页', '保留原图，提取图里的文字', '之后按图里的字也能搜到'], note: '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。' },
  { id: 'chrome', title: '浏览器收藏', accept: '.html,.htm', formats: '书签 HTML', icon: FileTextIcon, logo: chromeLogo, steps: ['打开 Chrome 或 Edge 的书签管理器', '在菜单里选择「导出书签」', '把得到的 HTML 拖进来'], note: '逐个读取网页正文，需要登录的页面会显示失败原因，可单独重试。' },
  { id: 'obsidian', title: 'Obsidian / Markdown', accept: '.md,.markdown,.txt,.zip', formats: 'Markdown、TXT、文件夹或 ZIP', icon: FolderOpenIcon, logo: obsidianLogo, steps: ['找到 Vault 所在的文件夹', '选择整个文件夹，或先压成 ZIP', '保留目录结构和双链'] },
  // TODO: Replace this generic icon only when official Apple Notes artwork is supplied.
  // The reference apple-notes.svg is illustrative and must not ship as an official logo.
  { id: 'apple_notes', title: 'Apple 备忘录', accept: '.md,.markdown,.txt,.zip', formats: 'Markdown、TXT 或 ZIP', icon: NotebookIcon, steps: ['选中要带走的笔记', '导出为 Markdown 文件', '把导出的文件拖进来'] },
  { id: 'enex', title: '印象笔记', accept: '.enex', formats: 'ENEX', icon: NotebookIcon, logo: evernoteLogo, steps: ['在印象笔记里选中笔记本', '导出为 ENEX 文件', '把导出的文件拖进来'] },
  { id: 'notion', title: 'Notion', accept: '.zip,.html,.htm,.md', formats: 'HTML 或 Markdown 导出包', icon: NotebookIcon, logo: notionLogo, steps: ['在 Notion 设置里导出全部内容', '格式选择 HTML 或 Markdown', '把下载的导出包拖进来'] },
  { id: 'flomo', title: 'flomo', accept: '.html,.htm', formats: 'HTML', icon: NotebookIcon, logo: flomoLogo, steps: ['在 flomo 里导出全部笔记', '得到 HTML 文件', '把导出的文件拖进来'] },
  { id: 'keep', title: 'Google Keep', accept: '.zip,.json,.html', formats: 'Google Takeout ZIP、JSON 或 HTML', icon: NotebookIcon, logo: keepLogo, steps: ['打开 Google Takeout', '只勾选 Keep 并导出', '把下载的文件拖进来'] },
  { id: 'bilibili', title: 'B 站公开收藏', accept: '', formats: '公开账户 UID', icon: PlayCircleIcon, logo: bilibiliLogo, steps: ['填写公开账户 UID', '先读取视频字幕', '没有字幕时按配置转写'], note: '只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。' },
]
const importFileLimit = 16 * 1024 * 1024
const importBatchLimit = 64 * 1024 * 1024
const itemStatus = { imported: '已入库', duplicate: '已存在', queued: '等待处理', running: '正在处理', failed: '失败' }
type QueueEntry = { id: string; file: File; libraryId: string; state: 'queued' | 'uploading' | 'done' | 'failed'; error?: string; document?: SharedDocument }
export type LibraryAddDialogProps = { userId: string | null; libraries: SharedCourse[]; initialLibraryId?: string; initialSource?: string; onClose(): void; onChanged(): void }
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes >= 1024 ** 3 ? 1024 ** 3 : bytes >= 1024 ** 2 ? 1024 ** 2 : 1024
  return `${Number((bytes / unit).toFixed(1))} ${unit === 1024 ** 3 ? 'GB' : unit === 1024 ** 2 ? 'MB' : 'KB'}`
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作暂时未完成，请重试。' }
function accepts(source: Source, file: File) {
  return source.accept.split(',').some(pattern => pattern.startsWith('.') ? file.name.toLowerCase().endsWith(pattern) : file.type === pattern || ({ 'image/png': '.png', 'image/jpeg': '.jpg,.jpeg', 'image/webp': '.webp', 'image/gif': '.gif' }[pattern] ?? '').split(',').filter(Boolean).some(extension => file.name.toLowerCase().endsWith(extension)))
}

/** Keep account changes from retaining filenames, queue state, or an in-flight continuation. */
export function LibraryAddDialog(props: LibraryAddDialogProps) { return <LibraryAddDialogContent key={props.userId ?? 'signed-out'} {...props} /> }

function LibraryAddDialogContent({ userId, libraries, initialLibraryId, initialSource = 'extension', onClose, onChanged }: LibraryAddDialogProps) {
  const [selected, setSelected] = useState(sources.some(source => source.id === initialSource) || initialSource === 'records' ? initialSource : 'extension')
  const [created, setCreated] = useState<SharedCourse | null>(null)
  const owned = libraries.filter(library => library.access === 'owner')
  const destinations = created && !owned.some(library => library.id === created.id) ? [...owned, created] : owned
  const [target, setTarget] = useState(owned.find(library => library.id === initialLibraryId)?.id ?? owned.find(library => library.name === '我的资料')?.id ?? owned[0]?.id ?? '')
  const targetLibrary = destinations.find(library => library.id === target) ?? destinations[0]
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [over, setOver] = useState(false)
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [showGuide, setShowGuide] = useState(false)
  const [showExtensionDownload, setShowExtensionDownload] = useState(false)
  const extensionDownloadButton = useRef<HTMLButtonElement>(null)
  const boundary = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const guideButton = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const changed = useRef(onChanged)
  useEffect(() => { changed.current = onChanged }, [onChanged])
  const motion = useAnimatedDismiss(boundary, onClose)
  const storage = useQuery({ queryKey: ['knowledge-storage', userId], queryFn: readKnowledgeStorage, enabled: !!userId })
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches, enabled: !!userId,
    refetchInterval: query => query.state.data?.some(batch => batch.status === 'processing') ? 1500 : false })
  const batchVersion = batches.data?.map(batch => `${batch.id}:${batch.status}:${batch.finished}:${batch.failed}`).join('|')
  const previousVersion = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (batchVersion !== undefined && previousVersion.current !== undefined && previousVersion.current !== batchVersion) changed.current()
    previousVersion.current = batchVersion
  }, [batchVersion])
  useEffect(() => {
    alive.current = true
    const dialog = boundary.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog?.showModal(); dialog?.focus({ preventScroll: true }); document.body.style.overflow = 'hidden'
    return () => {
      alive.current = false; dialog?.close(); document.body.style.overflow = overflow
      const focusTarget = trigger?.isConnected ? trigger : document.querySelector<HTMLButtonElement>('.ep-library-scope > button[aria-controls="library-scope-menu"]')
      focusTarget?.focus()
    }
  }, [])
  const source = sources.find(item => item.id === selected)
  const destinationName = selected === 'file' ? targetLibrary?.name || '我的资料' : '我的资料'
  const processing = batches.data?.filter(batch => batch.status === 'processing').length ?? 0
  const quota = storage.data
  const full = selected === 'file' && !!quota && (targetLibrary ? targetLibrary.documents.length >= quota.max_documents_per_library : quota.library_count >= quota.max_libraries)
  const unavailable = busy || !userId || !quota || full || !!quota && quota.used_bytes >= quota.max_bytes
  function dismiss() { if (!busyRef.current) motion.dismiss() }
  function select(value: string) { if (!busyRef.current) { setSelected(value); setError(''); setNotice(''); setOver(false) } }
  function updateEntry(id: string, update: Partial<QueueEntry>) { if (alive.current) setQueue(current => current.map(entry => entry.id === id ? { ...entry, ...update } : entry)) }
  async function refresh() { await Promise.all([batches.refetch(), storage.refetch()]) }
  async function run(work: () => Promise<void>) {
    if (busyRef.current || !userId) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { await work() }
    catch (caught) { if (alive.current) setError(errorMessage(caught)) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  async function currentQuota() {
    const result = await storage.refetch()
    if (result.error || !result.data) throw new Error('暂时无法核对存储限制，请重试读取用量。')
    if (!alive.current) throw new Error('已离开添加资料')
    return result.data
  }
  async function uploadDocuments(files: File[], retryEntry?: QueueEntry) {
    await run(async () => {
      const limits = await currentQuota()
      const totalBytes = files.reduce((total, file) => total + file.size, 0)
      if (limits.used_bytes + totalBytes > limits.max_bytes) throw new Error(`存储空间不足：已用 ${size(limits.used_bytes)} / ${size(limits.max_bytes)}。`)
      let library = retryEntry ? destinations.find(item => item.id === retryEntry.libraryId) : targetLibrary
      if (retryEntry && !library) throw new Error('原知识库已不可用，请选择可写的知识库后重新选择文件。')
      if (!library) {
        if (limits.library_count >= limits.max_libraries) throw new Error(`最多可创建 ${limits.max_libraries} 个知识库，请先整理已有知识库。`)
        library = await createCourse({ name: '我的资料', description: '' })
        if (!alive.current) return
        setCreated(library); setTarget(library.id); changed.current()
      }
      const latest = await getCourse(library.id)
      if (!alive.current) return
      if (latest.access !== 'owner') throw new Error('此知识库为只读，不能上传资料。')
      if (latest.documents.length + files.length > limits.max_documents_per_library) throw new Error(`每个知识库最多 ${limits.max_documents_per_library} 份资料，当前还有 ${Math.max(0, limits.max_documents_per_library - latest.documents.length)} 个位置。`)
      const entries: QueueEntry[] = retryEntry ? [{ ...retryEntry, state: 'queued', error: undefined }] : files.map(file => ({ id: crypto.randomUUID(), file, libraryId: latest.id, state: 'queued' }))
      setQueue(current => retryEntry ? current.map(entry => entry.id === retryEntry.id ? entries[0] : entry) : [...current, ...entries])
      let failed = 0
      for (const [index, entry] of entries.entries()) {
        if (!alive.current) break
        updateEntry(entry.id, { state: 'uploading', error: undefined })
        setNotice(`正在上传 ${index + 1}/${entries.length}：${entry.file.name}`)
        try {
          if (!accepts(sources[0], entry.file)) throw new Error('请选择 PDF、DOCX、PPTX、Markdown 或 TXT 文件。')
          if (entry.file.size > limits.max_file_bytes) throw new Error(`单份资料不能超过 ${size(limits.max_file_bytes)}。`)
          const document = await uploadCourseDocument(latest.id, entry.file)
          if (!alive.current) break
          changed.current()
          if (document.status === 'failed') { failed += 1; updateEntry(entry.id, { state: 'failed', document, error: document.errorMessage ?? '解析失败，请重新上传可读取的文件。' }) }
          else updateEntry(entry.id, { state: 'done', document })
        } catch (caught) { failed += 1; updateEntry(entry.id, { state: 'failed', error: errorMessage(caught) }) }
      }
      if (!alive.current) return
      setNotice(failed ? `${failed} 份资料上传或解析失败，其余已保留。请查看逐文件原因并重试。` : '资料已上传，正在后台建立语义索引并整理知识。')
      await storage.refetch()
    })
  }
  async function upload(files: File[]) {
    if (!files.length || busyRef.current || !source || source.id === 'bilibili') return
    if (source.id === 'file') { await uploadDocuments(files); return }
    const selectedSource = source
    await run(async () => {
      const limits = await currentQuota()
      if (limits.used_bytes >= limits.max_bytes) throw new Error('存储空间已满，请先整理资料。')
      if (files.some(file => !(selectedSource.id === 'obsidian' && file.webkitRelativePath) && !accepts(selectedSource, file))) throw new Error(`请选择${selectedSource.formats}文件。`)
      if (files.some(file => file.size > importFileLimit)) throw new Error('单个导入文件最多 16 MB，请缩小文件后重试。')
      if (files.reduce((total, file) => total + file.size, 0) > importBatchLimit) throw new Error('每批导入文件最多 64 MB，请分批导入。')
      // Do not forward the file destination. knowledge_import owns its default 我的资料 library.
      const batch = await importFiles(selectedSource.id as ImportSourceType, files)
      if (!alive.current) return
      setNotice(`已接收 ${batch.total} 条资料，正在后台导入`); changed.current(); await refresh()
    })
  }
  async function favorites() {
    if (!/^\d{1,20}$/.test(uid.trim())) { setError('请填写 1 至 20 位数字的公开账户 UID。'); return }
    await run(async () => {
      const limits = await currentQuota()
      if (limits.used_bytes >= limits.max_bytes) throw new Error('存储空间已满，请先整理资料。')
      await importBilibili(uid.trim())
      if (!alive.current) return
      setNotice('已开始读取公开收藏，字幕提取会在后台继续'); changed.current(); await refresh()
    })
  }
  async function retry(batchId: string, itemId: string) {
    await run(async () => { await retryImport(batchId, itemId); if (alive.current) { changed.current(); await refresh() } })
  }
  async function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); setOver(false)
    if (unavailable) return
    const files = Array.from(event.dataTransfer.files)
    // Folder selection preserves webkitRelativePath; dropped folders are resolved before submission.
    const entries = selected === 'obsidian' ? Array.from(event.dataTransfer.items ?? []).map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry) : []
    if (!entries.some(entry => entry.isDirectory)) { await upload(files); return }
    busyRef.current = true; setBusy(true); setError(''); setNotice('正在读取文件夹…')
    let dropped: File[] | undefined
    try { dropped = (await Promise.all(entries.map(entry => readDroppedEntry(entry)))).flat() }
    catch (caught) { if (alive.current) setError(errorMessage(caught)) }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setNotice('') } }
    if (alive.current && dropped) await upload(dropped)
  }
  const sourceButton = (item: Source) => <button type="button" key={item.id} className="qx-item" aria-current={selected === item.id ? 'true' : undefined} disabled={busy} onClick={() => select(item.id)}>{item.logo ? <img className="ep-library-add__logo" src={item.logo} alt="" /> : <item.icon aria-hidden />}<span>{item.title}</span></button>
  return <dialog ref={boundary} tabIndex={-1} aria-modal="true" aria-labelledby="library-add-title" className="ep-library-add-dialog" data-motion-surface="modal" {...motion.props}
    onCancel={event => { event.preventDefault(); dismiss() }} onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss() }}>
    <div className="qx-modal ep-library-add-dialog__surface">
      <header className="ep-library-add-dialog__heading"><h2 id="library-add-title" className="qx-heading">添加资料</h2><button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="关闭添加资料" disabled={busy} onClick={dismiss}><XIcon aria-hidden /></button></header>
      <div className="ep-library-add">
        <nav className="ep-library-add__nav" aria-label="资料来源">
          <p className="qx-group-label">随手收</p><button type="button" className="qx-item" aria-current={selected === 'extension' ? 'true' : undefined} disabled={busy} onClick={() => select('extension')}><img className="ep-library-add__logo" src={chromeLogo} alt="" /><span>浏览器扩展</span><span className="qx-tag ep-library-add__recommended">推荐</span></button>
          <p className="qx-group-label">上传</p>{sources.slice(0, 2).map(sourceButton)}
          <p className="qx-group-label">从其他应用导入</p>{sources.slice(2).map(sourceButton)}
          <div className="ep-library-add__history-link"><div className="qx-menu__divider" /><button type="button" className="qx-item" aria-current={selected === 'records' ? 'true' : undefined} disabled={busy} onClick={() => select('records')}><ArrowClockwiseIcon aria-hidden /><span>导入记录</span>{processing > 0 && <span className="qx-item__trail">{processing} 进行中</span>}</button></div>
        </nav>
        <section className="ep-library-add__body" aria-label={source?.title ?? (selected === 'records' ? '导入记录' : '浏览器扩展')} aria-busy={busy}>
          {!userId && <p role="alert" className="qx-notice qx-notice--danger">请先登录，再添加资料。</p>}
          {error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}
          {notice && <p role="status" className="qx-notice">{notice}</p>}
          {source ? <>
            <div className="ep-library-ferry" data-over={over} data-disabled={unavailable} role={source.id === 'bilibili' ? undefined : 'button'} tabIndex={source.id === 'bilibili' || unavailable ? undefined : 0} aria-disabled={source.id === 'bilibili' ? undefined : unavailable} aria-label={source.id === 'bilibili' ? undefined : `选择${source.formats}，放进「${destinationName}」`}
              onClick={() => { if (!unavailable && source.id !== 'bilibili') fileInput.current?.click() }} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && source.id !== 'bilibili') { event.preventDefault(); if (!unavailable) fileInput.current?.click() } }}
              onDragEnter={event => { event.preventDefault(); if (!unavailable && source.id !== 'bilibili') setOver(true) }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false) }} onDrop={event => { if (source.id !== 'bilibili') void drop(event); else event.preventDefault() }}>
              <div className="ep-library-ferry__pile" aria-hidden="true"><span className="ep-library-ferry__sheet" /><span className="ep-library-ferry__sheet" /><span className="ep-library-ferry__sheet ep-library-ferry__sheet--top"><source.icon size={28} /><span>{source.id === 'file' && queue.length ? queue[queue.length - 1].file.name : source.formats}</span></span></div>
              <span className="ep-library-ferry__path" aria-hidden="true"><ArrowRightIcon size={22} /></span>
              <div className="ep-library-ferry__library" aria-hidden="true"><BooksIcon size={28} /><strong>{destinationName}</strong><span className="qx-meta">Everplain 知识库</span></div>
              <p className="ep-library-ferry__cta">{source.id === 'bilibili' ? <span className="qx-meta">读取公开收藏夹里的视频，转成可检索的笔记</span> : <><strong>{busy ? '正在上传…' : over ? '松手就放进来' : '把文件拖到这里'}</strong><span className="qx-meta">或点击选择 · {source.formats}</span></>}</p>
            </div>
            {source.id !== 'bilibili' && <input ref={fileInput} className="ep-library-add__file-input" type="file" tabIndex={-1} aria-label="选择文件" multiple accept={source.accept} disabled={unavailable} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files) }} />}
            {source.id === 'bilibili' && <form className="ep-library-add__uid" onSubmit={event => { event.preventDefault(); void favorites() }}><input className="qx-input" aria-label="公开账户 UID" inputMode="numeric" pattern="[0-9]{1,20}" required maxLength={20} placeholder="公开账户 UID，例如 123456" disabled={busy} value={uid} onChange={event => setUid(event.target.value)} /><button type="submit" className="qx-btn qx-btn--primary" disabled={unavailable}>{busy ? '正在读取…' : '读取公开收藏'}</button></form>}
            <div className="ep-library-add__row"><ol className="ep-library-add__steps">{source.steps.map(step => <li key={step}>{step}</li>)}</ol><div className="ep-library-add__destination">{source.id === 'file' ? destinations.length ? <label>放进<select className="qx-input" aria-label="放进哪个知识库" value={targetLibrary?.id ?? ''} disabled={busy} onChange={event => setTarget(event.target.value)}>{destinations.map(library => <option value={library.id} key={library.id}>{library.name || '未命名知识库'}</option>)}</select></label> : <p className="qx-meta">上传时将创建「我的资料」知识库</p> : <p className="qx-meta">统一放进「我的资料」，重复的自动跳过。</p>}{source.id === 'obsidian' && <><button type="button" className="qx-btn qx-btn--secondary" disabled={unavailable} onClick={() => folderInput.current?.click()}>选择整个文件夹</button><input ref={folderInput} className="ep-library-add__file-input" tabIndex={-1} type="file" multiple {...{ webkitdirectory: '' }} aria-label="选择整个文件夹" disabled={unavailable} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files) }} /></>}</div></div>
            {source.id === 'file' && queue.length > 0 && <ul className="ep-library-upload-queue" aria-label="上传队列">{queue.map(entry => <li key={entry.id} data-state={entry.state}><span className="ep-library-upload-queue__name">{entry.file.name}<small>{size(entry.file.size)}{entry.error ? ` · ${entry.error}` : ''}</small></span>{entry.state === 'uploading' && <progress aria-label={`${entry.file.name} 上传中`} />}<span className="ep-library-upload-queue__state">{entry.state === 'done' ? <><CheckCircleIcon aria-hidden />已上传</> : entry.state === 'uploading' ? '上传中' : entry.state === 'failed' ? <><WarningCircleIcon aria-hidden />失败</> : '排队中'}</span>{entry.state === 'failed' && <button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void uploadDocuments([entry.file], entry)}>{entry.document ? '重新上传' : '重试上传'}</button>}{entry.document && <Link className="qx-btn qx-btn--ghost" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={event => { if (busyRef.current) event.preventDefault() }} to={`/library?kb_id=${encodeURIComponent(entry.libraryId)}${entry.document.status === 'ready' ? `&document_id=${encodeURIComponent(entry.document.id)}` : ''}`}>{entry.document.status === 'ready' ? '打开' : '查看处理状态'}</Link>}</li>)}</ul>}
            {source.id === 'file' ? <p className="qx-meta">{quota ? `单份不超过 ${size(quota.max_file_bytes)}，每个知识库最多 ${quota.max_documents_per_library} 份。` : '正在读取上传限制。'}{source.note}</p> : <p className="qx-meta">{source.id !== 'bilibili' && '单个文件最多 16 MB，每批最多 64 MB。'}{source.note}</p>}
            {full && <p role="alert" className="qx-notice">{targetLibrary ? '当前知识库已满，请选择其他知识库。' : '知识库数量已达上限，请先整理已有知识库。'}</p>}
            {quota ? <p className="qx-meta">已用 {size(quota.used_bytes)} / {size(quota.max_bytes)} · {quota.library_count} / {quota.max_libraries} 个知识库{quota.used_bytes >= quota.max_bytes ? ' · 存储空间已满' : ''}</p> : storage.isError ? <p role="alert" className="qx-notice qx-notice--danger">无法读取存储用量。<button type="button" className="qx-btn qx-btn--ghost" onClick={() => void storage.refetch()}>重试读取用量</button></p> : null}
            <div className="ep-library-add__extension"><PuzzlePieceIcon size={24} aria-hidden /><span><strong>读到哪，收到哪</strong><span className="qx-meta">装个浏览器扩展，在网页上点一下，整篇就进了「我的资料」。</span></span><button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={() => select('extension')}>了解扩展</button></div>
          </> : selected === 'extension' ? <>
            <div className="ep-library-extension-hero" aria-hidden="true"><FileTextIcon size={48} /><span className="ep-library-ferry__path"><ArrowRightIcon size={22} /></span><BooksIcon size={48} /></div>
            <header className="ep-library-add__head"><h3 className="qx-heading">看到好网页，点一下就收进来</h3><p className="qx-meta">不用复制链接，也不用定期导出书签。收进来的网页会读取正文，和其他资料一样整理出知识点。</p></header>
            <ul className="ep-library-add__features"><li><strong>收下当前页</strong><span className="qx-meta">点工具栏上的 Everplain 按钮</span></li><li><strong>搬走全部书签</strong><span className="qx-meta">在扩展里一键导入，不用先导出文件</span></li></ul>
            <div className="ep-library-add__actions"><button ref={extensionDownloadButton} type="button" className="qx-btn qx-btn--primary" aria-haspopup="dialog" aria-expanded={showExtensionDownload} onClick={() => setShowExtensionDownload(true)}>下载扩展<ArrowRightIcon size={16} /></button><button ref={guideButton} className="qx-btn qx-btn--secondary" type="button" aria-expanded={showGuide} aria-controls="library-clipper-guide" onClick={() => setShowGuide(value => !value)}>安装教程</button></div>
            <p className="qx-meta">适用于电脑上的 Chrome。当前提供 ZIP 安装包，尚未上架 Chrome 应用商店，需要手动加载已解压的扩展程序。</p>
            {showGuide && <ExtensionInstallGuide id="library-clipper-guide" onClose={() => { setShowGuide(false); guideButton.current?.focus() }} />}
          </> : <>
            <header className="ep-library-add__head ep-library-add__head--row"><h3 className="qx-heading">导入记录</h3><button type="button" className="qx-btn qx-btn--ghost" disabled={busy || batches.isFetching || !userId} onClick={() => void refresh()}><ArrowClockwiseIcon size={16} />刷新</button></header>
            {batches.isPending && userId && <AgentLoading message="正在读取记录…" />}{batches.isError && <p role="alert" className="qx-notice qx-notice--danger">{errorMessage(batches.error)}</p>}{batches.data?.length === 0 && <p className="qx-meta">还没有导入记录。</p>}
            {processing > 0 && <AgentLoading compact state="work" message="正在整理导入的资料…" />}
            <ul className="ep-library-add__batches">{batches.data?.map(batch => <li key={batch.id}><section className="ep-library-add__batch"><header>{batch.status === 'processing' ? <ArrowClockwiseIcon aria-hidden /> : batch.failed ? <WarningCircleIcon aria-hidden /> : <CheckCircleIcon aria-hidden />}<strong>{sources.find(item => item.id === batch.source_type)?.title ?? batch.source_type}</strong><span className="qx-meta">{batch.finished} / {batch.total}</span><Link className="qx-btn qx-btn--ghost" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={event => { if (busyRef.current) event.preventDefault() }} to={`/library?kb_id=${encodeURIComponent(batch.library_id)}`}>打开资料库<ArrowRightIcon size={14} /></Link></header><progress aria-label="导入进度" value={batch.finished} max={Math.max(batch.total, 1)} /><p className="qx-meta">{batch.imported} 条已入库 · {batch.duplicates} 条重复{batch.failed ? ` · ${batch.failed} 条待重试` : ''}</p><details><summary>查看条目</summary><ul className="ep-library-add__items">{batch.items.map(item => <li key={item.id} data-failed={item.status === 'failed'}><span>{item.title}<small>{item.error ?? itemStatus[item.status]}</small></span>{item.status === 'failed' && <button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => void retry(batch.id, item.id)}>重试</button>}</li>)}</ul></details></section></li>)}</ul>
          </>}
        </section>
      </div>
    </div>
    {showExtensionDownload && <ExtensionDownloadDialog trigger={extensionDownloadButton.current} manageBodyScroll={false} onClose={() => setShowExtensionDownload(false)} />}
  </dialog>
}

async function readDroppedEntry(entry: FileSystemEntry, parent = ''): Promise<File[]> {
  const path = `${parent}${entry.name}`
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true })
    return [file]
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    children.push(...batch)
  }
  return (await Promise.all(children.map(child => readDroppedEntry(child, `${path}/`)))).flat()
}
