import { apiClient } from '../../api/client'
import { createMultipartBody } from '../../api/multipart'
import {
  getKnowledgeStorage, updateDocumentKnowledge,
  organizeSharedDocument,
  listSharedKnowledgeBases, createSharedKnowledgeBase, getSharedKnowledgeBase,
  updateSharedKnowledgeBase, deleteSharedKnowledgeBase,
  uploadSharedDocument, detachSharedDocument, getSharedDocumentSource,
  type SharedKnowledgeResponse, type SharedDocumentResponse,
  type CreateSharedKnowledgeRequest, type UpdateSharedKnowledgeRequest, type UpdateDocumentKnowledgeRequest,
} from '../../api/generated'

import type { SharedCourse, SharedDocument, SharedSource } from './sharedKnowledgeModel'

function document(value: SharedDocumentResponse): SharedDocument {
  return { id: value.id, filename: value.filename, mediaType: value.media_type,
    sizeBytes: value.size_bytes, parseId: value.parse_id, status: value.status,
    knowledgeStatus: value.knowledge_status ?? 'queued', indexStatus: value.index_status ?? 'queued',
    knowledge: value.knowledge ? { summary: value.knowledge.summary,
      topics: value.knowledge.topics.map((topic) => ({ title: topic.title, summary: topic.summary, segmentIds: topic.segment_ids })),
      relations: (value.knowledge.relations ?? []).map((relation) => ({ source: relation.source, target: relation.target, label: relation.label, segmentIds: relation.segment_ids })),
    } : null, knowledgeError: value.knowledge_error ?? null,
    indexError: value.index_error ?? null,
    errorMessage: value.error_message ?? null, warnings: value.warnings ?? [], createdAt: value.created_at }
}
function course(value: SharedKnowledgeResponse): SharedCourse {
  return { id: value.id, name: value.name ?? null, description: value.description ?? null,
    access: value.viewer_access, sharingEnabled: value.sharing_enabled ?? false,
    shareToken: value.share_token ?? null, readyDocumentCount: value.ready_document_count ?? 0,
    documents: (value.documents ?? []).map(document) }
}
const headers = () => ({ 'Idempotency-Key': crypto.randomUUID() })
function data<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    const error = result.error as { error?: { message?: string }; detail?: unknown }
    throw new Error(error.error?.message ?? (typeof error.detail === 'string' ? error.detail : '知识库暂时无法访问，请重试。'))
  }
  if (result.data === undefined) throw new Error('未收到知识库数据，请重试。')
  return result.data
}
function checked(result: { error?: unknown }) {
  if (result.error) data(result)
}
// Bound read waits and cancel obsolete navigation without caching private source data.
async function readWithDeadline<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, 15000)
  try {
    const result = await read(controller.signal)
    if (controller.signal.aborted) throw new Error('知识库读取超时或已取消，请重试。')
    return result
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
export async function listCourses(signal?: AbortSignal) {
  const items = data(await readWithDeadline(signal => listSharedKnowledgeBases({ client: apiClient, signal }), signal)).items
  if (!Array.isArray(items)) throw new Error('知识库列表暂时无法读取。')
  return items.map(course)
}
export async function getCourse(id: string, signal?: AbortSignal) { return course(data(await readWithDeadline(signal => getSharedKnowledgeBase({ client: apiClient, path: { kb_id: id }, signal }), signal))) }
export async function createCourse(body: CreateSharedKnowledgeRequest) { return course(data(await createSharedKnowledgeBase({ client: apiClient, body, headers: headers() }))) }
export async function updateCourse(id: string, body: UpdateSharedKnowledgeRequest) { return course(data(await updateSharedKnowledgeBase({ client: apiClient, path: { kb_id: id }, body, headers: headers() }))) }
export async function deleteCourse(id: string) { checked(await deleteSharedKnowledgeBase({ client: apiClient, path: { kb_id: id }, headers: headers() })) }
export async function uploadCourseDocument(id: string, file: File) {
  const multipart = await createMultipartBody([{ name: 'file', file }])
  return document(data(await uploadSharedDocument({ client: apiClient, path: { kb_id: id }, body: { file },
    headers: { ...headers(), 'Content-Type': multipart.contentType }, bodySerializer: () => multipart.body })))
}
export async function detachCourseDocument(id: string, documentId: string) { checked(await detachSharedDocument({ client: apiClient, path: { kb_id: id, document_id: documentId }, headers: headers() })) }
export async function readCourseDocument(id: string, documentId: string, segmentId?: string, signal?: AbortSignal): Promise<SharedSource> {
  const value = data(await readWithDeadline(signal => getSharedDocumentSource({ client: apiClient, path: { kb_id: id, document_id: documentId }, query: { segment_id: segmentId }, signal }), signal))
  return { document: document(value.document), knowledgeBaseId: value.knowledge_base_id,
    knowledgeBaseName: value.knowledge_base_name,
    attachments: (value.attachments ?? []).map(item => ({ id: item.id, filename: item.filename, relativePath: item.relative_path, mediaType: item.media_type, sizeBytes: item.size_bytes, references: item.references, url: item.url })),
    segments: value.segments.map((item) => ({
      id: item.segment_id, parseId: item.parse_id, ordinal: item.ordinal, kind: item.kind, text: item.text,
      location: { page: item.locator.page ?? null, headingPath: item.locator.section_path ?? [],
        paragraph: item.locator.paragraph ?? null, lineStart: item.locator.line_start ?? null,
        lineEnd: item.locator.line_end ?? null, charStart: item.locator.char_start ?? null,
        charEnd: item.locator.char_end ?? null, blockIndex: item.locator.block_index ?? null },
    })) }
}

export async function retryCourseDocument(id: string, documentId: string) {
  return document(data(await organizeSharedDocument({ client: apiClient,
    path: { kb_id: id, document_id: documentId }, headers: headers() })))
}

export async function readKnowledgeStorage() {
  return data(await getKnowledgeStorage({ client: apiClient }))
}
export async function saveDocumentKnowledge(id: string, documentId: string, body: UpdateDocumentKnowledgeRequest) {
  return document(data(await updateDocumentKnowledge({ client: apiClient,
    path: { kb_id: id, document_id: documentId }, body, headers: headers() })))
}
