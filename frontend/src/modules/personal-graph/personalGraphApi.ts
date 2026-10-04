import { isPersonalGraphReadiness, PersonalGraphReadinessError } from './model'
import { apiClient } from '../../api/client'
import { getPersonalGraph, refreshPersonalGraph } from '../../api/generated'
function value<T>(response: { data?: T; error?: unknown }): T {
  if (!response.data || response.error) throw new Error('暂时无法读取你的知识图谱，请重试')
  return response.data
}
export async function readPersonalGraph() { return value(await getPersonalGraph({ client: apiClient })) }
export async function rebuildPersonalGraph(action?: 'skip_missing') {
  const response = await refreshPersonalGraph({ client: apiClient, body: { knowledge_index_action: action }, headers: { 'Idempotency-Key': crypto.randomUUID() } })
  const failure = response.error as { code?: string; status?: unknown; detail?: { code?: string; status?: unknown } } | undefined
  const detail = failure?.detail ?? failure
  if (detail?.code === 'knowledge_index_choice_required' && isPersonalGraphReadiness(detail.status)) throw new PersonalGraphReadinessError(detail.status)
  return value(response)
}
