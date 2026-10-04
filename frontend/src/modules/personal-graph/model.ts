// Module-owned projection of the graph-readiness contract. API types stay in the adapter.
export type PersonalGraphReadinessDocument = {
  knowledge_base_id: string
  document_id: string
  parse_id: string
  filename: string
  index_status: string
  index_error?: string | null
  reason?: string | null
  stage?: 'ready' | 'index' | 'knowledge'
  knowledge_status?: string | null
  knowledge_error?: string | null
}
export type PersonalGraphReadiness = {
  state: 'ready' | 'missing_index' | 'unavailable'
  embedding_model: string | null
  total_count: number
  ready_count: number
  missing_count: number
  processing_count: number
  failed_count: number
  ready_document_ids: string[]
  ready_documents: PersonalGraphReadinessDocument[]
  missing_documents: PersonalGraphReadinessDocument[]
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export function isPersonalGraphReadiness(value: unknown): value is PersonalGraphReadiness {
  return record(value) && ['ready', 'missing_index', 'unavailable'].includes(String(value.state))
    && ['total_count', 'ready_count', 'missing_count', 'processing_count', 'failed_count'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && Number(value[k]) >= 0)
    && (value.embedding_model === null || typeof value.embedding_model === 'string')
    && Array.isArray(value.ready_document_ids) && value.ready_document_ids.every(id => typeof id === 'string')
    && Array.isArray(value.ready_documents) && Array.isArray(value.missing_documents)
    && [...value.ready_documents, ...value.missing_documents].every(d => record(d) && ['knowledge_base_id', 'document_id', 'parse_id', 'filename', 'index_status'].every(k => typeof d[k] === 'string'))
}
export class PersonalGraphReadinessError extends Error {
  readonly status: PersonalGraphReadiness
  constructor(status: PersonalGraphReadiness) { super('知识库还未整理完全，请选择现在开始或等待完成。'); this.status = status }
}
