import type { KnowledgeIndexStatus } from './model'
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function isKnowledgeIndexStatus(value: unknown): value is KnowledgeIndexStatus {
  if (!isRecord(value)) return false
  return ['ready', 'missing_index', 'unavailable'].includes(String(value.state))
    && ['total_count', 'ready_count', 'missing_count', 'processing_count', 'failed_count'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Number(value[key]) >= 0)
    && Array.isArray(value.ready_documents) && Array.isArray(value.missing_documents)
    && [...value.ready_documents, ...value.missing_documents].every(document => isRecord(document)
      && ['knowledge_base_id', 'document_id', 'parse_id', 'filename', 'index_status'].every(key => typeof document[key] === 'string'))
}
