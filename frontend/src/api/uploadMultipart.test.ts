import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { createUploadBody } from './uploadMultipart'
import { uploadFetch } from './client'
import { parseMultipartRequest } from '../test/multipart'
async function bytes(blob: Blob): Promise<ArrayBuffer> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) }) }
class UploadRequest {
  static latest: UploadRequest
  upload: { onprogress?: (value: { loaded: number; total: number; lengthComputable: boolean }) => void; onload?: () => void } = {}
  onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void
  withCredentials = false; timeout = 0; status = 202; statusText = 'Accepted'; responseText = '{"total":3}'
  headers: Record<string, string> = {}; body?: Blob; method?: string; url?: string
  constructor() { UploadRequest.latest = this }
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers[key] = value }
  getAllResponseHeaders() { return 'content-type: application/json\r\nx-request-id: synthetic' }
  send(body: Blob) { this.body = body }
  abort() { this.onabort?.() }
}
afterEach(() => vi.unstubAllGlobals())
it('retains native files without reading all bytes and preserves UTF-8 paths and bodies', async () => {
  const file = new File(['# 合成内容'], 'Vault/中文.md', { type: 'text/markdown' })
  const read = vi.fn(); Object.defineProperty(file, 'arrayBuffer', { value: read })
  const parts = await createUploadBody([{ name: 'source_type', value: 'obsidian' }, { name: 'files', file }])
  expect(read).not.toHaveBeenCalled()
  const form = await parseMultipartRequest(new Request('https://example.test/api/imports', { method: 'POST', body: await bytes(parts.body), headers: { 'Content-Type': parts.contentType } }))
  expect(form.get('source_type')).toBe('obsidian'); expect((form.get('files') as File).name).toBe('Vault/中文.md')
  expect(new TextDecoder().decode(await bytes(form.get('files') as File))).toBe('# 合成内容')
})
it('reports actual bytes then server acceptance while preserving headers and cookies', async () => {
  vi.stubGlobal('XMLHttpRequest', UploadRequest)
  const body = new Blob(['synthetic']); const progress = vi.fn()
  const response = uploadFetch(body, progress)(new Request('https://example.test/api/imports', { method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': 'same-key' } }))
  const xhr = UploadRequest.latest
  expect(xhr.withCredentials).toBe(true); expect(xhr.body).toBe(body); expect(xhr.headers['idempotency-key']).toBe('same-key')
  xhr.upload.onprogress?.({ loaded: 4, total: 9, lengthComputable: true })
  expect(progress).toHaveBeenLastCalledWith({ stage: 'uploading', loaded: 4, total: 9 })
  xhr.upload.onload?.(); expect(progress).toHaveBeenLastCalledWith({ stage: 'accepting', loaded: 9, total: 9 })
  xhr.onload?.(); expect((await response).status).toBe(202)
})
it('does not invent totals and rejects network, timeout and cancellation failures', async () => {
  vi.stubGlobal('XMLHttpRequest', UploadRequest)
  const progress = vi.fn(); const first = uploadFetch(new Blob(['x']), progress)('https://example.test/api/imports')
  UploadRequest.latest.upload.onprogress?.({ loaded: 1, total: 0, lengthComputable: false })
  expect(progress).toHaveBeenLastCalledWith({ stage: 'uploading', loaded: 1, total: undefined })
  UploadRequest.latest.onerror?.(); await expect(first).rejects.toThrow('连接中断')
  const second = uploadFetch(new Blob(['x']))('https://example.test/api/imports'); UploadRequest.latest.ontimeout?.(); await expect(second).rejects.toThrow('超时')
  const controller = new AbortController(); const third = uploadFetch(new Blob(['x']))(new Request('https://example.test/api/imports', { signal: controller.signal })); controller.abort(); await expect(third).rejects.toMatchObject({ name: 'AbortError' })
})

it('keeps equal-length foreign-realm File bytes instead of a stringified object', async () => {
  const file = new File(['# hello world'], 'note.md', { type: 'text/markdown' })
  expect(file.size).toBe('[object File]'.length)
  vi.stubGlobal('Blob', NodeBlob)
  const result = await createUploadBody([{ name: 'files', file }])
  const body = new TextDecoder().decode(await result.body.arrayBuffer())
  expect(body).toContain('# hello world'); expect(body).not.toContain('[object File]')
})
