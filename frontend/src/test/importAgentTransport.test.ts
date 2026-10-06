import { afterEach, expect, it, vi } from 'vitest'
import { importFiles, readImportBatches } from '../modules/knowledge-import'
import { streamAgentTurn } from '../modules/research-agent'
import { apiClient } from '../api/client'
import { subscribeToSessionRejected } from '../api/sessionEvents'

class ImportUpload {
  static status = 202
  static requests: ImportUpload[] = []
  upload = {}
  onload?: () => void
  onabort?: () => void
  withCredentials = false
  timeout = 0
  status = ImportUpload.status
  statusText = 'Synthetic'
  responseText = JSON.stringify(this.status === 202 ? { id: 'batch', total: 1, items: [] } : { detail: 'unauthorized' })
  headers = new Headers()
  method = ''
  url = ''
  body?: Blob
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers.set(key, value) }
  getAllResponseHeaders() { return 'content-type: application/json' }
  send(body: Blob) { this.body = body; ImportUpload.requests.push(this); this.onload?.() }
  abort() { this.onabort?.() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  ImportUpload.requests = []
  ImportUpload.status = 202
})

it('keeps import XHR request-local while card sends and later generated reads use fetch', async () => {
  vi.stubGlobal('XMLHttpRequest', ImportUpload)
  const requests: Request[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request)
    if (new URL(request.url).pathname === '/api/agent/turns') {
      return new Response('event: turn_completed\ndata: {"conversation":{"conversation_id":"synthetic","turns":[]},"knowledge_release_id":"synthetic"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return Response.json({ items: [] })
  })
  vi.stubGlobal('fetch', fetch)
  const configuredFetch = apiClient.getConfig().fetch
  const progress = vi.fn()
  const importController = new AbortController()
  const upload = importFiles('obsidian', [new File(['# Synthetic'], 'note.md')], undefined, {
    requestKey: 'import-key', signal: importController.signal, onProgress: progress,
  })
  const card = streamAgentTurn({
    message: 'User-written addition', idempotencyKey: 'card-key',
    context_suggestion: { card_id: 'card-id', version: 'v1' },
  }, vi.fn())
  await Promise.all([upload, card])
  importController.abort()
  expect(await readImportBatches()).toEqual([])
  expect(apiClient.getConfig().fetch).toBe(configuredFetch)
  expect(ImportUpload.requests).toHaveLength(1)
  expect(new URL(ImportUpload.requests[0].url).pathname).toBe('/api/imports')
  expect(ImportUpload.requests[0].headers.get('Idempotency-Key')).toBe('import-key')
  expect(ImportUpload.requests[0].withCredentials).toBe(true)
  expect(progress).toHaveBeenCalledTimes(1)
  expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/api/agent/turns', '/api/imports'])
  const body = await requests[0].json()
  expect(body.message).toBe('User-written addition')
  expect(body.context_suggestion).toEqual({ card_id: 'card-id', version: 'v1' })
  expect(body).not.toHaveProperty('prompt')
  expect(body).not.toHaveProperty('files')
  expect(requests[0].headers.get('Idempotency-Key')).toBe('card-key')
  expect(requests.every(request => request.credentials === 'include' && !request.signal.aborted)).toBe(true)
})

it('retains the shared session rejection interceptor for import XHR responses', async () => {
  ImportUpload.status = 401
  vi.stubGlobal('XMLHttpRequest', ImportUpload)
  const rejected = vi.fn()
  const unsubscribe = subscribeToSessionRejected(rejected)
  try {
    await expect(importFiles('obsidian', [new File(['# Synthetic'], 'note.md')], undefined, { requestKey: 'import-401' })).rejects.toThrow()
    expect(rejected).toHaveBeenCalledTimes(1)
  } finally {
    unsubscribe()
  }
})
