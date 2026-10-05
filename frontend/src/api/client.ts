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
