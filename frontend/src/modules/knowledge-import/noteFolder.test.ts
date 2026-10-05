import { describe, expect, it, vi } from 'vitest'
import { isNoteFolderPath, prepareNoteFolderFiles, readNoteDirectory, type NoteDirectory } from './noteFolder'

function file(name: string, value = '# A note') { return new File([value], name, { type: 'text/markdown' }) }
function folder(name: string, children: Record<string, NoteDirectory | { kind: 'file'; name: string; getFile(): Promise<File> }>): NoteDirectory {
  return { name, kind: 'directory', async *entries() { for (const entry of Object.entries(children)) yield entry } }
}
function entry(name: string, value?: string) { return { kind: 'file' as const, name, getFile: vi.fn(async () => file(name, value)) } }

describe('direct note folder reading', () => {
  it('preserves the vault root, nested note paths and ordinary attachments', async () => {
    const progress = vi.fn()
    const source = folder('Vault', { 'first.md': entry('first.md'), nested: folder('nested', { 'same.md': entry('same.md'), 'photo.png': entry('photo.png', 'png') }) })
    const result = await readNoteDirectory(source, { progress })
    expect(result.files.map(item => item.name)).toEqual(['Vault/first.md', 'Vault/nested/same.md', 'Vault/nested/photo.png'])
    expect(result.notes).toBe(2); expect(result.attachments).toBe(1)
    expect(progress).toHaveBeenLastCalledWith({ read: 3, skipped: 0 })
  })
  it('does not read configuration, hidden files, plugin trees or unrecognized files', async () => {
    const secret = entry('token.md'); const plugin = entry('plugin.md'); const executable = entry('run.js')
    const source = folder('Vault', { '.obsidian': folder('.obsidian', { 'token.md': secret }), node_modules: folder('node_modules', { 'plugin.md': plugin }), 'run.js': executable, 'note.md': entry('note.md') })
    const result = await readNoteDirectory(source)
    expect(result.files).toHaveLength(1); expect(result.skipped).toBe(3)
    for (const value of [secret, plugin, executable]) expect(value.getFile).not.toHaveBeenCalled()
    for (const path of ['../secret.md', '/secret.md', 'Vault/.env', 'Vault/.git/config', 'Vault/node_modules/a.md']) expect(isNoteFolderPath(path)).toBe(false)
  })
  it('filters directory-input files before measuring limits or transmitting bytes', () => {
    const note = file('note.md'); Object.defineProperty(note, 'webkitRelativePath', { value: 'Vault/note.md' })
    const hidden = file('huge.md'); Object.defineProperties(hidden, { webkitRelativePath: { value: 'Vault/.obsidian/huge.md' }, size: { value: 99 * 1024 * 1024 } })
    expect(prepareNoteFolderFiles([note, hidden])).toMatchObject({ files: [note], notes: 1, attachments: 0, skipped: 1 })
  })
  it('rejects empty folders and oversized notes, counts and totals before submission', async () => {
    expect(() => prepareNoteFolderFiles([file('photo.png')])).toThrow('没有 Markdown')
    const large = file('large.md'); Object.defineProperty(large, 'size', { value: 16 * 1024 * 1024 + 1 })
    expect(() => prepareNoteFolderFiles([large])).toThrow('16 MB')
    expect(() => prepareNoteFolderFiles(Array.from({ length: 2001 }, (_, i) => file(`${i}.md`)))).toThrow('2000')
    const big = Array.from({ length: 5 }, (_, i) => { const value = file(`${i}.md`); Object.defineProperty(value, 'size', { value: 16 * 1024 * 1024 }); return value })
    expect(() => prepareNoteFolderFiles(big)).toThrow('64 MB')
    await expect(readNoteDirectory(folder('Empty', {}))).rejects.toThrow('没有 Markdown')
  })
  it('stops scanning after cancellation and propagates unreadable-file failures', async () => {
    const controller = new AbortController(); controller.abort()
    const note = entry('note.md')
    await expect(readNoteDirectory(folder('Vault', { 'note.md': note }), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(note.getFile).not.toHaveBeenCalled()
    note.getFile.mockRejectedValue(new Error('file moved'))
    await expect(readNoteDirectory(folder('Vault', { 'note.md': note }))).rejects.toThrow('file moved')
  })
})
