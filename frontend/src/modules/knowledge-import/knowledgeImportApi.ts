import { apiClient } from '../../api/client'
import { createMultipartBody } from '../../api/multipart'
import { createImportBatch, listImportBatches, retryImportItem } from '../../api/generated'

function value<T>(response: { data?: T; error?: unknown }): T {
  if (response.error || !response.data) {
    const error = response.error as { detail?: unknown; error?: { message?: string } } | undefined
    throw new Error(typeof error?.detail === 'string' ? error.detail : error?.error?.message ?? '导入暂时未完成，请重试')
  }
  return response.data
}
export async function readImportBatches() { return value(await listImportBatches({ client: apiClient })).items }
export async function importFiles(source: 'chrome' | 'markdown' | 'obsidian', files: File[], libraryId?: string) {
  const named = files.map(file => file.webkitRelativePath ? new File([file], file.webkitRelativePath, { type: file.type }) : file)
  const parts = await createMultipartBody([{ name: 'source_type', value: source }, ...named.map(file => ({ name: 'files', file })), ...(libraryId ? [{ name: 'library_id', value: libraryId }] : [])])
  return value(await createImportBatch({ client: apiClient, body: { source_type: source, files: named, library_id: libraryId },
    headers: { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': parts.contentType }, bodySerializer: () => parts.body }))
}
export async function retryImport(batchId: string, itemId: string) {
  return value(await retryImportItem({ client: apiClient, path: { batch_id: batchId, item_id: itemId }, headers: { 'Idempotency-Key': crypto.randomUUID() } }))
}
