import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NoteFolderPicker } from './NoteFolderPicker'
import type { NoteDirectory, NoteFolderFiles } from '../../modules/knowledge-import'

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'showDirectoryPicker') })
function mount() {
  const props = { disabled: false, onFiles: vi.fn(async (_files: File[], _summary: NoteFolderFiles) => {}), onBusy: vi.fn(), onError: vi.fn() }
  render(<NoteFolderPicker {...props} />)
  return props
}
function source(): NoteDirectory {
  return { name: 'Vault', kind: 'directory', async *entries() { yield ['note.md', { kind: 'file', name: 'note.md', getFile: async () => new File(['# Note'], 'note.md') }] } }
}
it('directly reads the selected folder and reuses it only on an explicit sync click', async () => {
  const picker = vi.fn(async () => source()); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker })
  const props = mount()
  fireEvent.click(screen.getByRole('button', { name: '选择笔记文件夹' }))
  await waitFor(() => expect(props.onFiles).toHaveBeenCalledOnce())
  expect(picker).toHaveBeenCalledWith({ mode: 'read', id: 'everplain-notes' })
  expect(props.onFiles.mock.calls[0][0][0].name).toBe('Vault/note.md')
  expect(props.onBusy.mock.calls).toEqual([[true], [false]])
  fireEvent.click(screen.getByRole('button', { name: '再次同步「Vault」' }))
  await waitFor(() => expect(props.onFiles).toHaveBeenCalledTimes(2))
  expect(picker).toHaveBeenCalledOnce()
})
it('silently handles picker cancellation and never uploads a fabricated note', async () => {
  const picker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker })
  const props = mount(); fireEvent.click(screen.getByRole('button', { name: '选择笔记文件夹' }))
  await waitFor(() => expect(props.onBusy).toHaveBeenLastCalledWith(false))
  expect(props.onFiles).not.toHaveBeenCalled(); expect(props.onError).toHaveBeenCalledWith('')
})
it('keeps directory input as a working fallback and excludes hidden files', async () => {
  const props = mount(); const note = new File(['# Note'], 'note.md'); const secret = new File(['private'], 'config.md')
  Object.defineProperty(note, 'webkitRelativePath', { value: 'Vault/note.md' }); Object.defineProperty(secret, 'webkitRelativePath', { value: 'Vault/.obsidian/config.md' })
  const input = screen.getByLabelText('选择整个文件夹'); expect(input).toHaveAttribute('webkitdirectory')
  fireEvent.change(input, { target: { files: [note, secret] } })
  await waitFor(() => expect(props.onFiles).toHaveBeenCalledWith([note], expect.objectContaining({ skipped: 1 })))
  expect(input).toHaveValue('')
})
it('blocks repeated clicks while the native folder picker is pending', async () => {
  let resolve!: (folder: NoteDirectory) => void
  const picker = vi.fn(() => new Promise<NoteDirectory>(done => { resolve = done })); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker })
  const props = mount(); const button = screen.getByRole('button', { name: '选择笔记文件夹' })
  fireEvent.click(button); fireEvent.click(button); expect(picker).toHaveBeenCalledOnce()
  resolve(source()); await waitFor(() => expect(props.onFiles).toHaveBeenCalledOnce())
})

it('does not continue reading or uploading after the import surface is dismissed', async () => {
  let resolve!: (folder: NoteDirectory) => void
  const picker = vi.fn(() => new Promise<NoteDirectory>(done => { resolve = done })); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker })
  const props = mount(); fireEvent.click(screen.getByRole('button', { name: '选择笔记文件夹' }))
  cleanup()
  await act(async () => { resolve(source()) })
  expect(props.onFiles).not.toHaveBeenCalled()
})

it('requests only read access on an explicit sync and reports a revoked permission', async () => {
  const handle = source(); handle.queryPermission = vi.fn(async () => 'prompt' as const); handle.requestPermission = vi.fn(async () => 'denied' as const)
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => handle) })
  const props = mount(); fireEvent.click(screen.getByRole('button', { name: '选择笔记文件夹' }))
  await waitFor(() => expect(props.onFiles).toHaveBeenCalledOnce())
  expect(handle.requestPermission).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '再次同步「Vault」' }))
  await waitFor(() => expect(props.onError).toHaveBeenCalledWith('请允许读取所选笔记文件夹，或重新选择。'))
  expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  expect(props.onFiles).toHaveBeenCalledOnce()
})
