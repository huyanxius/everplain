import { useEffect, useRef, useState } from 'react'
import { ArrowClockwiseIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { noteDirectoryPicker, prepareNoteFolderFiles, readNoteDirectory, type NoteDirectory, type NoteFolderFiles, type NoteFolderProgress } from '../../modules/knowledge-import'
import './note-folder.css'

function folderError(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '无法读取笔记文件夹，请重新选择。' }

type Props = { disabled: boolean; label?: string; onFiles(files: File[], summary: NoteFolderFiles): Promise<void>; onBusy(busy: boolean): void; onError(message: string): void }

/** Read permission lasts only for this mounted picker; no folder handle is persisted. */
export function NoteFolderPicker({ disabled, label = '选择整个文件夹', onFiles, onBusy, onError }: Props) {
  const directory = useRef<NoteDirectory | null>(null)
  const active = useRef(true)
  const scanning = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState('')
  const [counts, setCounts] = useState<NoteFolderProgress | null>(null)
  const [folderName, setFolderName] = useState('')
  const picker = noteDirectoryPicker()
  useEffect(() => { active.current = true; return () => { active.current = false; abort.current?.abort() } }, [])
  async function read(reuse = false) {
    if (disabled || scanning.current || !picker) return
    scanning.current = true; onBusy(true); onError(''); setProgress('正在选择笔记文件夹…'); setCounts(null)
    abort.current = new AbortController()
    let result: NoteFolderFiles | undefined
    let latest: NoteFolderProgress | undefined
    try {
      // Call the picker in this click's user activation, before any asynchronous work.
      const handle = reuse && directory.current ? directory.current : await picker({ mode: 'read', id: 'everplain-notes' })
      if (reuse && handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted' && await handle.requestPermission?.({ mode: 'read' }) !== 'granted') throw new Error('请允许读取所选笔记文件夹，或重新选择。')
      if (!active.current) return
      directory.current = handle; setFolderName(handle.name)
      result = await readNoteDirectory(handle, { signal: abort.current.signal, progress: value => { latest = value; if (active.current) { setCounts(value); setProgress(value.stage === 'scanning' ? `扫描文件夹：已找到 ${value.discovered} 个笔记和附件，跳过 ${value.skipped} 项` : `读取文件：${value.read} / ${value.total}，跳过 ${value.skipped} 项`) } } })
    } catch (error) {
      if (active.current && !(error instanceof DOMException && error.name === 'AbortError')) onError(`${latest ? latest.stage === 'scanning' ? `扫描阶段失败（已找到 ${latest.discovered} 项）` : `读取阶段失败（已读取 ${latest.read} / ${latest.total} 项）` : '选择文件夹失败'}：${folderError(error)}`)
    } finally {
      scanning.current = false
      if (active.current) { onBusy(false); if (result) setProgress(`读取完成：${result.notes} 篇笔记、${result.attachments} 个附件，跳过 ${result.skipped} 项`); else { setProgress(''); setCounts(null) } }
    }
    if (active.current && result) await onFiles(result.files, result)
  }
  async function selected(files: File[]) {
    if (disabled || scanning.current || !files.length) return
    try { const result = prepareNoteFolderFiles(files); await onFiles(result.files, result) }
    catch (error) { onError(`检查文件夹失败：${folderError(error)}`) }
  }
  return <div className="ep-note-folder">
    <div className="ep-note-folder__actions">
      {picker && <button type="button" className="qx-btn qx-btn--primary" disabled={disabled} onClick={() => void read()}><FolderOpenIcon size={18} />选择笔记文件夹</button>}
      <label className={`qx-btn ${picker ? 'qx-btn--ghost' : 'qx-btn--primary'} ep-note-folder__fallback`}><FolderOpenIcon size={18} />{label}<input type="file" aria-label={label} multiple {...{ webkitdirectory: '' }} disabled={disabled} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void selected(files) }} /></label>
      {folderName && <button type="button" className="qx-btn qx-btn--secondary" disabled={disabled} onClick={() => void read(true)}><ArrowClockwiseIcon size={17} />再次同步「{folderName}」</button>}
    </div>
    {progress && <div role="status" className="qx-meta"><p>{progress}</p>{counts && <progress aria-label={counts.stage === 'scanning' ? '扫描文件夹' : '读取文件进度'} {...(counts.total !== undefined ? { value: counts.read, max: Math.max(counts.total, 1) } : {})} />}</div>}
    <p className="qx-meta">直接读取所选文件夹里的笔记和附件，无需压缩。隐藏文件、配置和插件目录会跳过。只有你能看到导入资料。</p>
  </div>
}
