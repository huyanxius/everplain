import { apiClient } from '../../api/client'
import { getAgentProfile, updateAgentProfile, type AgentProfileUpdate } from '../../api/generated'

function result<T>(response: { data?: T; error?: unknown }): T {
  if (response.error || !response.data) {
    const error = response.error as { detail?: unknown; error?: { message?: string } } | undefined
    throw new Error(typeof error?.detail === 'string' ? error.detail : error?.error?.message ?? '档案暂时无法保存，请重试')
  }
  return response.data
}
export async function readAgentProfile() {
  return result(await getAgentProfile({ client: apiClient }))
}
export async function saveAgentProfile(body: AgentProfileUpdate) {
  return result(await updateAgentProfile({ client: apiClient, body, headers: { 'Idempotency-Key': crypto.randomUUID() } }))
}
export type PersonalAgentProfile = Awaited<ReturnType<typeof readAgentProfile>>
export type PersonalAgentProfileUpdate = Parameters<typeof saveAgentProfile>[0]
