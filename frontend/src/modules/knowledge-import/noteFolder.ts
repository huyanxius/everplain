const MAX_FILES = 2000
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const notes = /\.(md|markdown|txt)$/i
const attachments = /\.(png|jpe?g|webp|gif|pdf|docx|pptx|csv|mp3|m4a|mp4|wav|ogg)$/i

export type NoteDirectory = {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, NoteDirectory | NoteFile]>
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>
}
type NoteFile = { kind: 'file'; name: string; getFile(): Promise<File> }
export type NoteFolderFiles = { files: File[]; notes: number; attachments: number; skipped: number; bytes: number }
export type NoteFolderProgress = { stage: 'scanning' | 'reading'; discovered: number; read: number; skipped: number; total?: number; bytes: number }

export function isNoteFolderPath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/')
  return !parts.some(part => !part || part.startsWith('.') || part === 'node_modules')
}

export function isNoteFolderFile(path: string): boolean {
  return isNoteFolderPath(path) && (notes.test(path) || attachments.test(path))
}

export function prepareNoteFolderFiles(files: File[]): NoteFolderFiles {
  const selected = files.filter(file => {
    const path = file.webkitRelativePath || file.name
    return isNoteFolderFile(path)
  })
  if (selected.length > MAX_FILES) throw new Error('每批最多 2000 个笔记和附件，请选择更小的文件夹。')
  if (selected.some(file => file.size > MAX_FILE_BYTES)) throw new Error('单个笔记或附件最多 16 MB，请缩小文件后重试。')
  const bytes = selected.reduce((total, file) => total + file.size, 0)
  if (bytes > MAX_TOTAL_BYTES) throw new Error('每批笔记和附件最多 64 MB，请选择更小的文件夹。')
  const noteCount = selected.filter(file => notes.test(file.name)).length
  if (!noteCount) throw new Error('这个文件夹里没有 Markdown 或 TXT 笔记。')
  return { files: selected, notes: noteCount, attachments: selected.length - noteCount, skipped: files.length - selected.length, bytes }
}

export async function readNoteDirectory(directory: NoteDirectory, options: { signal?: AbortSignal; progress?(value: NoteFolderProgress): void } = {}): Promise<NoteFolderFiles> {
  const pending: { path: string; entry: NoteFile }[] = []
  const files: File[] = []
  let skipped = 0
  let bytes = 0
  const update = (stage: NoteFolderProgress['stage']) => options.progress?.({ stage, discovered: pending.length, read: files.length, skipped, bytes, ...(stage === 'reading' ? { total: pending.length } : {}) })
  async function scan(folder: NoteDirectory, parent: string) {
    options.signal?.throwIfAborted()
    for await (const [name, entry] of folder.entries()) {
      options.signal?.throwIfAborted()
      const path = `${parent}/${name}`
      if (!isNoteFolderPath(path)) skipped += 1
      else if (entry.kind === 'directory') await scan(entry, path)
      else if (notes.test(name) || attachments.test(name)) {
        pending.push({ path, entry })
        if (pending.length > MAX_FILES) throw new Error('每批最多 2000 个笔记和附件，请选择更小的文件夹。')
      } else skipped += 1
      update('scanning')
    }
  }
  update('scanning')
  await scan(directory, directory.name)
  update('reading')
  for (const { path, entry } of pending) {
    options.signal?.throwIfAborted()
    const file = await entry.getFile()
    options.signal?.throwIfAborted()
    if (file.size > MAX_FILE_BYTES) throw new Error('单个笔记或附件最多 16 MB，请缩小文件后重试。')
    if (bytes + file.size > MAX_TOTAL_BYTES) throw new Error('每批笔记和附件最多 64 MB，请选择更小的文件夹。')
    bytes += file.size
    files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }))
    update('reading')
  }
  return { ...prepareNoteFolderFiles(files), skipped }
}

export function noteDirectoryPicker(): ((options: { mode: 'read'; id: string }) => Promise<NoteDirectory>) | undefined {
  return (window as Window & { showDirectoryPicker?: (options: { mode: 'read'; id: string }) => Promise<NoteDirectory> }).showDirectoryPicker?.bind(window)
}
