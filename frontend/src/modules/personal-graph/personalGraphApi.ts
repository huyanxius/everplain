import { apiClient } from '../../api/client'
import { getPersonalGraph, refreshPersonalGraph } from '../../api/generated'
function value<T>(response: { data?: T; error?: unknown }): T {
  if (!response.data || response.error) throw new Error('暂时无法读取你的知识图谱，请重试')
  return response.data
}
export async function readPersonalGraph() { return value(await getPersonalGraph({ client: apiClient })) }
export async function rebuildPersonalGraph() { return value(await refreshPersonalGraph({ client: apiClient, headers: { 'Idempotency-Key': crypto.randomUUID() } })) }
