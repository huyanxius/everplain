import { apiClient } from '../../api/client'
import { ApiRequestError } from '../../api/error'
import { createWritingDocument, createWritingRevision, createWritingSample, deleteWritingSample, getWritingDocument, getWritingSummary, listWritingRevisions, listWritingSamples, previewWritingSamples, resolveWritingRevision, updateWritingDocument, uploadWritingSample } from '../../api/generated'
import type { WritingDocumentCreate, WritingDocumentUpdate, WritingRevisionCreate, WritingRevisionResolve, WritingSampleCreate } from '../../api/generated'

function data<T>(result: { data?: T; error?: unknown; response?: Response }): T {
  if (result.error || result.data === undefined) {
    const error = result.error as { error?: { message?: unknown }; detail?: unknown; message?: unknown } | undefined
    const message = error?.error?.message ?? error?.message
    throw new ApiRequestError(typeof message === 'string' ? message : result.response?.status === 409 ? '文稿已有新版本，请保留当前修改并重新读取。' : result.response?.status === 401 ? '登录已失效，请重新登录。' : '写作请求未完成，你的修改仍然保留。', result.response?.status)
  }
  return result.data
}
const options = (key: string) => ({ client: apiClient, headers: { 'Idempotency-Key': key } })
export const writingApi = {
  summary: async (signal?: AbortSignal) => data(await getWritingSummary({ client: apiClient, signal })),
  samples: async (signal?: AbortSignal) => data(await listWritingSamples({ client: apiClient, signal })),
  document: async (documentId: string, signal?: AbortSignal) => data(await getWritingDocument({ client: apiClient, path: { document_id: documentId }, signal })),
  revisions: async (documentId: string, signal?: AbortSignal) => data(await listWritingRevisions({ client: apiClient, path: { document_id: documentId }, signal })),
  create: async (body: WritingDocumentCreate, key: string) => data(await createWritingDocument({ ...options(key), body })),
  update: async (documentId: string, body: WritingDocumentUpdate, key: string) => data(await updateWritingDocument({ ...options(key), path: { document_id: documentId }, body })),
  propose: async (documentId: string, body: WritingRevisionCreate, key: string) => data(await createWritingRevision({ ...options(key), path: { document_id: documentId }, body })),
  resolve: async (documentId: string, revisionId: string, body: WritingRevisionResolve, key: string) => data(await resolveWritingRevision({ ...options(key), path: { document_id: documentId, revision_id: revisionId }, body })),
  upload: async (file: File, genre: Genre, key: string) => data(await uploadWritingSample({ ...options(key), body: { file, genre } })),
  previewSamples: async (file: File, signal?: AbortSignal) => data(await previewWritingSamples({ client: apiClient, body: { file }, signal })),
  createSample: async (body: WritingSampleCreate, key: string) => data(await createWritingSample({ ...options(key), body })),
  async deleteSample(sampleId: string) { const result = await deleteWritingSample({ client: apiClient, path: { sample_id: sampleId } }); if (result.error || !result.response.ok) throw new ApiRequestError('样文删除未完成。', result.response.status) },
}
type Genre = Parameters<typeof uploadWritingSample>[0]["body"]["genre"]
