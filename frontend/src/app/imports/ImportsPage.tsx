import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, ArrowClockwiseIcon, CheckCircleIcon, FileArrowUpIcon, FolderOpenIcon, GlobeIcon, ImageIcon, NotebookIcon, PlayCircleIcon, PuzzlePieceIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { importFiles, importBilibili, readImportBatches, retryImport, type ImportSourceType } from '../../modules/knowledge-import'
import { KnowledgePage, KnowledgePageHead } from '../courses/KnowledgeLayout'
import { AgentLoading } from '../ui/AgentLoading'
import { ExtensionDownloadDialog } from './ExtensionDownloadDialog'
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
  const [showExtensionGuide, setShowExtensionGuide] = useState(false)
  const [showExtensionDownload, setShowExtensionDownload] = useState(false)
  const extensionDownloadButton = useRef<HTMLButtonElement>(null)
  const extensionGuideButton = useRef<HTMLButtonElement>(null)
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: q => q.state.data?.some(b => b.status === 'processing') ? 1500 : false })
  const source = sources.find(s => s.id === selected)!
  async function upload(files: FileList | File[] | null) {
    if (busy || !files?.length) return
    setBusy(true); setError(''); setNotice('')
    try { const batch = await importFiles(selected as ImportSourceType, Array.from(files)); setNotice(`已接收 ${batch.total} 条资料，正在后台导入`); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '导入失败，请重试') }
    finally { setBusy(false) }
  }
  async function favorites() {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await importBilibili(uid.trim()); setNotice('已开始读取公开收藏，字幕提取会在后台继续'); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '暂时无法读取收藏') }
    finally { setBusy(false) }
  }
  return <KnowledgePage>
    <KnowledgePageHead title="导入资料" actions={<Link className="qx-btn qx-btn--ghost" to="/library"><ArrowLeftIcon size={18} />知识库</Link>}><p className="qx-meta">选择来源，保留原文。重复导入会自动去重，失败的条目可以单独再试。</p></KnowledgePageHead>
    <div className="ep-import">
      <section aria-label="添加资料" className="ep-import__create">
        {selected === 'bilibili' ? <form className="qx-panel ep-import__bilibili" onSubmit={event => { event.preventDefault(); void favorites() }}><PlayCircleIcon size={28} /><h2 className="qx-card__title">B 站公开收藏</h2><label>公开账户 UID<input className="qx-input" value={uid} onChange={event => setUid(event.target.value)} inputMode="numeric" pattern="[0-9]{1,20}" required placeholder="例如：123456" /></label><button className="qx-btn qx-btn--primary" disabled={busy}>{busy ? '正在开始…' : '读取公开收藏'}<ArrowRightIcon size={15} /></button><p className="qx-meta">只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。</p></form> : <>
          <label className="ep-import__dropzone" data-busy={busy} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)) }}>
            <FileArrowUpIcon size={28} /><strong>{busy ? '正在上传…' : '拖文件到这里，或点击选择'}</strong><span>{source.title}</span><small>{source.description}</small><input type="file" aria-label="选择文件" multiple accept={source.accept} disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = '' }} />
          </label>
          <div className="ep-import__upload-note">{selected === 'obsidian' && <label className="qx-btn qx-btn--secondary ep-import__folder">或选择整个文件夹<input type="file" multiple {...{ webkitdirectory: '' }} disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = '' }} /></label>}<p className="qx-meta">{selected === 'image' ? '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。' : '单个文件最多 16 MB，每批最多 64 MB；资料默认仅你可见。'}</p></div>
        </>}
        <div><h2 className="qx-heading">从别处导入</h2><div className="ep-import__sources" aria-label="导入来源">{sources.map(item => <button type="button" className="qx-btn qx-btn--secondary" key={item.id} aria-pressed={selected === item.id} disabled={busy} title={item.description} onClick={() => { setSelected(item.id); setError(''); setNotice('') }}><item.icon size={18} />{item.title}</button>)}</div></div>
      </section>
      {busy && <AgentLoading compact state="work" message={selected === 'bilibili' ? '正在读取公开收藏…' : '正在上传资料…'} />}
      {error && <p role="alert" className="qx-notice qx-notice--danger">{error}</p>}{notice && <p role="status" className="qx-notice"><CheckCircleIcon size={17} />{notice}</p>}
      <section className="ep-import__history" aria-label="导入记录"><header><h2 className="qx-heading">导入记录</h2><button type="button" className="qx-btn qx-btn--ghost" onClick={() => void batches.refetch()}><ArrowClockwiseIcon size={16} />刷新</button></header>
        {batches.isError && <p role="alert" className="qx-notice qx-notice--danger">{batches.error.message}</p>}{batches.isPending && <AgentLoading message="正在读取记录…" />}{batches.data?.length === 0 && <p className="qx-meta">还没有导入记录。</p>}
        {!busy && batches.data?.some(batch => batch.status === 'processing') && <AgentLoading compact state="work" message="正在整理导入的资料…" />}
        <ul className="ep-import__batches">{batches.data?.map(batch => <li key={batch.id}><section className="ep-import__batch"><header>{batch.status === 'processing' ? <ArrowClockwiseIcon size={18} /> : batch.failed ? <WarningCircleIcon size={18} /> : <CheckCircleIcon size={18} />}<strong>{sources.find(item => item.id === batch.source_type)?.title ?? batch.source_type}</strong><span className="qx-meta">{batch.finished} / {batch.total}</span><Link className="qx-btn qx-btn--ghost" to={`/library?kb_id=${encodeURIComponent(batch.library_id)}`}>打开资料库<ArrowRightIcon size={14} /></Link></header><progress aria-label="导入进度" value={batch.finished} max={Math.max(batch.total, 1)} /><p className="qx-meta">{batch.imported} 条已入库 · {batch.duplicates} 条重复{batch.failed ? ` · ${batch.failed} 条待重试` : ''}</p><details><summary>查看条目</summary><ul className="ep-import__items">{batch.items.map(item => <li key={item.id} data-failed={item.status === 'failed'}><span>{item.title}<small>{item.error ?? ({ imported: '已入库', duplicate: '已存在', queued: '等待处理', running: '正在处理', failed: '失败' })[item.status]}</small></span>{item.status === 'failed' && <button type="button" className="qx-btn qx-btn--ghost" onClick={() => void retryImport(batch.id, item.id).then(() => batches.refetch()).catch(e => setError(String(e)))}>重试</button>}</li>)}</ul></details></section></li>)}</ul>
      </section>
      <section className="ep-import__extension" aria-label="Everplain 收藏助手">
        <PuzzlePieceIcon size={24} />
        <div><h2 className="qx-heading">让下一次收藏更轻松</h2><p className="qx-meta">Chrome / Edge 扩展支持一键收藏当前页、导入书签，无需复制链接。</p></div>
        <div className="ep-import__extension-actions">
          <button ref={extensionDownloadButton} type="button" className="qx-btn qx-btn--secondary" aria-haspopup="dialog" aria-expanded={showExtensionDownload} onClick={() => setShowExtensionDownload(true)}>下载扩展<ArrowRightIcon size={15} /></button>
          <button ref={extensionGuideButton} type="button" className="qx-btn qx-btn--ghost" aria-expanded={showExtensionGuide} aria-controls="clipper-install-guide" onClick={() => setShowExtensionGuide(value => !value)}>安装教程</button>
        </div>
      </section>
      {showExtensionGuide && <section id="clipper-install-guide" className="ep-import__extension-guide" aria-labelledby="clipper-install-title">
        <header><h2 id="clipper-install-title" className="qx-heading">安装 Everplain 收藏助手</h2><button type="button" className="qx-btn qx-btn--ghost" onClick={() => { setShowExtensionGuide(false); extensionGuideButton.current?.focus() }}>收起教程</button></header>
        <p className="qx-meta">适用于电脑上的 Chrome / Edge，尚未上架扩展商店。准备工具会下载并校验扩展、整理到固定文件夹，再打开扩展管理页。</p>
        <ol className="ep-import__extension-steps">
          <li><h3>下载并运行准备工具</h3><p>点击“下载扩展”，选择 macOS 或 Windows。全部解压后，Mac 双击 <code>everplain-clipper-macos.command</code>；Windows 双击 <code>everplain-clipper-windows.cmd</code>，保留同目录的 <code>.ps1</code> 文件。按提示选择 Chrome 或 Edge。</p></li>
          <li><h3>加载扩展</h3><p>在打开的扩展管理页启用“开发者模式”，点击“加载已解压的扩展程序”，选择脚本打开的固定文件夹。安装后请保留这个文件夹。</p></li>
          <li><h3>登录后开始收藏</h3><p>在同一个浏览器用户资料中打开 <a href="https://e.qunxue.xyz" target="_blank" rel="noreferrer">e.qunxue.xyz</a> 并登录，保留标签页。收藏助手已预填此地址；回到要保存的网页，打开助手，点击“收藏当前页面”。</p></li>
        </ol>
        <details className="ep-import__extension-details">
          <summary>手动安装、权限与常见问题</summary>
          <div>
            <h3>手动安装</h3>
            <p>系统若拦截脚本，请改用 <a href="/downloads/everplain-clipper.zip" download>手动下载 ZIP</a>，不要关闭系统保护或绕过管理限制。Mac 双击解压；Windows 右键选择“全部解压缩”。把文件夹放在固定位置，在扩展管理页加载直接包含 <code>manifest.json</code> 的那一层，不要选择 ZIP 或上一级文件夹。</p>
            <h3>首次收藏与权限</h3>
            <p>首次收藏时，确认浏览器请求的站点是 <code>https://e.qunxue.xyz</code>，再允许访问。若使用其他 Everplain 站点，请修改助手中的地址，并在同一浏览器用户资料登录该站点。地址使用 HTTPS，本机开发才可使用 localhost 或 127.0.0.1 的 HTTP 地址。</p>
            <p>收藏时读取当前网页的标题、网址和正文，提交到你的 Everplain；扩展在本机保存站点地址，不保存密码、Cookie 或访问令牌。扩展复用这个浏览器里的登录状态，没有单独的登录或配对按钮，无需填写密码、Cookie、令牌或配对码。</p>
            <p>只有点击“导入全部书签”才申请书签权限，并提交此浏览器用户资料中的全部 HTTP(S) 书签。只收藏网页无需开启书签权限，也无需允许所有网站、无痕模式或本地文件访问。</p>
            <h3>确认收藏成功</h3>
            <p>助手显示“已收藏”后，在本页“导入记录”点击“刷新”，打开资料库核对条目。书签显示“已提交”不代表全部入库；在导入记录查看进度，失败条目可查看原因并单独重试。</p>
            <dl className="ep-import__extension-help">
              <div><dt>下载失败，或文件不是 ZIP</dt><dd>请刷新本页重新下载，不要把网页另存为安装包。工具下载或校验失败时可稍后重试，或使用上方手动 ZIP；仍失败请联系站点维护者。</dd></div>
              <div><dt>提示缺少或无法读取 manifest.json</dt><dd>先完整解压，再选择直接包含 manifest.json 的文件夹。如果文件不存在，重新从本页下载。</dd></div>
              <div><dt>扩展管理页没有自动打开</dt><dd>在 Chrome 地址栏输入 <code>chrome://extensions</code>，Edge 则输入 <code>edge://extensions</code>。打开开发者模式后加载脚本打开的固定文件夹。</dd></div>
              <div><dt>没有“加载已解压的扩展程序”</dt><dd>确认使用电脑上的 Chrome / Edge 并已打开开发者模式。若浏览器由公司或学校管理且禁止安装，请联系管理员，不要绕过限制。</dd></div>
              <div><dt>提示先登录，或 Everplain 页面还没打开</dt><dd>检查助手中的站点地址，与已登录页面保持一致；用同一浏览器用户资料重新登录并等待页面打开，再回原网页重试。无需导出 Cookie 或令牌。</dd></div>
              <div><dt>权限被拒绝，或目标页面已切换</dt><dd>重新打开收藏助手并点击收藏，核对后允许目标 Everplain 站点的请求；保持 Everplain 标签页在该站点。如果不想授权，可直接在本页导入文件。</dd></div>
              <div><dt>无法读取当前网页或没有正文</dt><dd>请在普通 HTTP(S) 文章页操作；浏览器设置页、扩展商店等受保护页面不能收藏。等待原网页加载完成再试；页面过大时改用本页上传整理好的文件。</dd></div>
            </dl>
            <p className="qx-meta">更新：重新运行准备工具，在扩展管理页移除旧版本，再加载这次打开的文件夹；手动安装也可将新 ZIP 解压并替换原文件夹后点击重新加载。停用或卸载在扩展管理页操作。<a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world?hl=zh-cn" target="_blank" rel="noreferrer">查看 Chrome 官方加载说明</a></p>
          </div>
        </details>
      </section>}

      {showExtensionDownload && <ExtensionDownloadDialog trigger={extensionDownloadButton.current} onClose={() => setShowExtensionDownload(false)} />}
    </div>
  </KnowledgePage>
}
