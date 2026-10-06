import type { UploadProgress } from './uploadMultipart'
import { client } from './generated/client.gen'
import { notifySessionRejected } from './sessionEvents'

const runtimeOrigin =
  typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? runtimeOrigin

client.setConfig({
  baseUrl,
  credentials: 'include',
  fetch: (request) => globalThis.fetch(request),
})

client.interceptors.response.use((response) => {
  if (response.status === 401) notifySessionRejected()
  return response
})

export const apiClient = client

// A cancelled session bootstrap may belong to an earlier authentication state.
// Reject late headers before response interceptors see a stale 401.
export async function fetchActiveSession(request: Request): Promise<Response> {
  const transport = client.getConfig().fetch ?? globalThis.fetch
  const response = await transport(request)
  request.signal.throwIfAborted()
  return response
}

/** Fetch-shaped transport so generated routes and session interceptors remain authoritative. */
export function uploadFetch(body: Blob, progress?: (value: UploadProgress) => void): typeof fetch {
  return (input, init) => new Promise<Response>((resolve, reject) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const xhr = new XMLHttpRequest()
    let settled = false
    const stop = () => request.signal.removeEventListener('abort', abort)
    const finish = (work: () => void) => { if (settled) return; settled = true; stop(); work() }
    const abort = () => xhr.abort()
    xhr.open(request.method, request.url)
    xhr.withCredentials = request.credentials === 'include'
    xhr.timeout = 10 * 60 * 1000
    request.headers.forEach((value, key) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = event => progress?.({ stage: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : undefined })
    xhr.upload.onload = () => progress?.({ stage: 'accepting', loaded: body.size, total: body.size })
    xhr.onload = () => finish(() => {
      const headers = new Headers()
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) { const colon = line.indexOf(':'); if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim()) }
      try {
        if (xhr.status < 200) throw new TypeError('未收到有效的服务器响应，请重试本批。')
        resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers }))
      } catch (error) { reject(error) }
    })
    xhr.onerror = () => finish(() => reject(new TypeError('上传连接中断，请检查网络后重试本批。')))
    xhr.ontimeout = () => finish(() => reject(new Error('上传或接收等待超时，可重试本批，已接收的资料不会重复创建。')))
    xhr.onabort = () => finish(() => reject(new DOMException('上传已取消', 'AbortError')))
    if (request.signal.aborted) { finish(() => reject(new DOMException('上传已取消', 'AbortError'))); return }
    request.signal.addEventListener('abort', abort, { once: true })
    progress?.({ stage: 'uploading', loaded: 0, total: body.size })
    xhr.send(body)
  })
}
