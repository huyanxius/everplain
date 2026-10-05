import { useEffect, useRef, useState } from 'react'
import { ArrowClockwiseIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { noteDirectoryPicker, prepareNoteFolderFiles, readNoteDirectory, type NoteDirectory, type NoteFolderFiles } from '../../modules/knowledge-import'
import './note-folder.css'

type Props = { disabled: boolean; label?: string; onFiles(files: File[], summary: NoteFolderFiles): Promise<void>; onBusy(busy: boolean): void; onError(message: string): void }

/** Read permission lasts only for this mounted picker; no folder handle is persisted. */
export function NoteFolderPicker({ disabled, label = '选择整个文件夹', onFiles, onBusy, onError }: Props) {
  const directory = useRef<NoteDirectory | null>(null)
  const active = useRef(true)
  const scanning = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState('')
  const [folderName, setFolderName] = useState('')
  const picker = noteDirectoryPicker()
  useEffect(() => { active.current = true; return () => { active.current = false; abort.current?.abort() } }, [])
  async function read(reuse = false) {
    if (disabled || scanning.current || !picker) return
    scanning.current = true; onBusy(true); onError(''); setProgress('正在读取笔记文件夹…')
    abort.current = new AbortController()
    let result: NoteFolderFiles | undefined
    try {
      // Call the picker in this click's user activation, before any asynchronous work.
      const handle = reuse && directory.current ? directory.current : await picker({ mode: 'read', id: 'everplain-notes' })
      if (reuse && handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted' && await handle.requestPermission?.({ mode: 'read' }) !== 'granted') throw new Error('请允许读取所选笔记文件夹，或重新选择。')
      if (!active.current) return
      directory.current = handle; setFolderName(handle.name)
      result = await readNoteDirectory(handle, { signal: abort.current.signal, progress: value => { if (active.current) setProgress(`已读取 ${value.read} 个笔记和附件${value.skipped ? `，跳过 ${value.skipped} 项` : ''}`) } })
    } catch (error) {
      if (active.current && !(error instanceof DOMException && error.name === 'AbortError')) onError(error instanceof Error ? error.message : '无法读取笔记文件夹，请重新选择。')
    } finally {
      scanning.current = false
      if (active.current) { onBusy(false); setProgress('') }
    }
    if (active.current && result) await onFiles(result.files, result)
  }
  async function selected(files: File[]) {
    if (disabled || scanning.current || !files.length) return
    try { const result = prepareNoteFolderFiles(files); await onFiles(result.files, result) }
    catch (error) { onError(error instanceof Error ? error.message : '无法读取笔记文件夹。') }
  }
  return <div className="ep-note-folder">
    <div className="ep-note-folder__actions">
      {picker && <button type="button" className="qx-btn qx-btn--primary" disabled={disabled} onClick={() => void read()}><FolderOpenIcon size={18} />选择笔记文件夹</button>}
      <label className={`qx-btn ${picker ? 'qx-btn--ghost' : 'qx-btn--primary'} ep-note-folder__fallback`}><FolderOpenIcon size={18} />{label}<input type="file" aria-label={label} multiple {...{ webkitdirectory: '' }} disabled={disabled} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void selected(files) }} /></label>
      {folderName && <button type="button" className="qx-btn qx-btn--secondary" disabled={disabled} onClick={() => void read(true)}><ArrowClockwiseIcon size={17} />再次同步「{folderName}」</button>}
    </div>
    {progress && <p role="status" className="qx-meta">{progress}</p>}
    <p className="qx-meta">直接读取所选文件夹里的笔记和附件，无需压缩。隐藏文件、配置和插件目录会跳过。只有你能看到导入资料。</p>
  </div>
}
