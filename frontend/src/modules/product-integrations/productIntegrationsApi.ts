import { apiClient } from '../../api/client'
import * as sdk from '../../api/generated'
function data<T>(r: { data?: T; error?: unknown }): T {
  if (r.error || r.data === undefined) {
    const e = r.error as { detail?: unknown; error?: { message?: string } } | undefined
    throw new Error(typeof e?.detail === 'string' ? e.detail : e?.error?.message ?? '暂时无法完成，请重试')
  }
  return r.data
}
function checked(r: { error?: unknown }) { if (r.error) data(r) }
const headers = () => ({ 'Idempotency-Key': crypto.randomUUID() })
export async function libraries() { return data(await sdk.listSharedKnowledgeBases({ client: apiClient })).items }
export async function library(id: string) { return data(await sdk.getSharedKnowledgeBase({ client: apiClient, path: { kb_id: id } })) }
export async function sharing(id: string, enabled: boolean) { return data(await sdk.updateSharedKnowledgeBase({ client: apiClient, path: { kb_id: id }, body: { sharing_enabled: enabled }, headers: headers() })) }
export async function join(token: string) { return data(await sdk.joinSharedKnowledgeBase({ client: apiClient, body: { share_token: token }, headers: headers() })) }
export async function leave(id: string) { checked(await sdk.leaveSharedKnowledgeBase({ client: apiClient, path: { kb_id: id }, headers: headers() })) }
export async function publish(id: string, body: { title: string; description: string; topics: string[]; confirm_public_content: true }) { return data(await sdk.publishKnowledgeMetadata({ client: apiClient, path: { kb_id: id }, body, headers: headers() })) }
export async function unpublish(id: string) { checked(await sdk.unpublishKnowledgeMetadata({ client: apiClient, path: { kb_id: id }, headers: headers() })) }
export async function directory(query = '') { return data(await sdk.listPublicKnowledgeDirectory({ client: apiClient, query: { query } })).items }
export async function publicLibrary(id: string) { return data(await sdk.getPublicKnowledgeLibrary({ client: apiClient, path: { kb_id: id } })) }
export async function publicSource(id: string, doc: string) { return data(await sdk.getPublicKnowledgeSource({ client: apiClient, path: { kb_id: id, document_id: doc } })) }
export async function privateSource(id: string, doc: string) { return data(await sdk.getSharedDocumentSource({ client: apiClient, path: { kb_id: id, document_id: doc } })) }
export async function connections() { return data(await sdk.listExternalAgentConnections({ client: apiClient })) }
export async function createConnection(body: { name: string; library_ids: string[]; expires_at: string }) { return data(await sdk.createExternalAgentConnection({ client: apiClient, body, headers: headers() })) }
export async function revokeConnection(id: string) { return data(await sdk.revokeExternalAgentConnection({ client: apiClient, path: { connection_id: id }, headers: headers() })) }
