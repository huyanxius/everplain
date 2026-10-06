import { afterEach, expect, it, vi } from 'vitest'
import { importFiles } from './knowledgeImportApi'
import { parseMultipartRequest } from '../../test/multipart'

class FakeUpload {
  static requests: { request: Request; body: ArrayBuffer }[] = []
  static status = 202
  upload: { onload?: () => void } = {}
  onload?: () => void
  withCredentials = false; timeout = 0; status = FakeUpload.status; statusText = 'synthetic'
  responseText = this.status === 202 ? JSON.stringify({ id: 'batch', total: 3, items: [] }) : '<html>synthetic proxy error</html>'
  headers = new Headers(); method = ''; url = ''
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers.set(key, value) }
  getAllResponseHeaders() { return `content-type: ${this.status === 202 ? 'application/json' : 'text/html'}` }
  send(blob: Blob) {
    const reader = new FileReader()
    reader.onload = () => {
      const body = reader.result as ArrayBuffer
      FakeUpload.requests.push({ request: new Request(this.url, { method: this.method, headers: this.headers, credentials: this.withCredentials ? 'include' : 'omit', body }), body })
      this.upload.onload?.(); this.onload?.()
    }
    reader.readAsArrayBuffer(blob)
  }
  abort() {}
}
afterEach(() => { vi.unstubAllGlobals(); FakeUpload.requests = []; FakeUpload.status = 202 })
it('uses the generated import route with unchanged multipart fields, file bytes and retry identity', async () => {
  vi.stubGlobal('XMLHttpRequest', FakeUpload)
  const progress = vi.fn()
  const files = ['一.md', 'nested/two.md', 'three.md'].map((name, i) => new File([`# Synthetic ${i + 1}\n\n这是合成测试笔记 ${i + 1}。`], `Obsidian Vault/${name}`, { type: 'text/markdown' }))
  for (let attempt = 0; attempt < 2; attempt += 1) await importFiles('obsidian', files, undefined, { requestKey: 'same-synthetic-request', onProgress: progress })
  expect(FakeUpload.requests).toHaveLength(2)
  for (const { request } of FakeUpload.requests) {
    expect(new URL(request.url).pathname).toBe('/api/imports'); expect(request.credentials).toBe('include')
    expect(request.headers.get('Idempotency-Key')).toBe('same-synthetic-request')
    const form = await parseMultipartRequest(request)
    expect(form.get('source_type')).toBe('obsidian'); expect(form.getAll('files').map(file => (file as File).name)).toEqual(files.map(file => file.name)); expect(form.has('library_id')).toBe(false)
  }
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'accepting' }))
})
it('propagates a non-JSON server status through the generated client', async () => {
  FakeUpload.status = 500; vi.stubGlobal('XMLHttpRequest', FakeUpload)
  await expect(importFiles('obsidian', [new File(['# Test'], 'test.md')], undefined, { requestKey: 'synthetic' })).rejects.toThrow('HTTP 500')
})
