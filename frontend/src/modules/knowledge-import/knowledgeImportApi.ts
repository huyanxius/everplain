import { apiClient, uploadFetch } from '../../api/client'
import { createMultipartBody } from '../../api/multipart'
import { createUploadBody } from '../../api/uploadMultipart'
import type { ImportUploadOptions } from './importOptions'
import { importErrorMessage } from './importError'
import { createImportBatch, createBilibiliImport, listImportBatches, retryImportItem } from '../../api/generated'
import { prepareNoteFolderFiles } from './noteFolder'

function value<T>(response: { data?: T; error?: unknown; response?: Response }): T {
  if (response.error || !response.data) throw new Error(importErrorMessage(response.error, response.response?.status))
  return response.data
}
export async function readImportBatches() { return value(await listImportBatches({ client: apiClient })).items }
export async function importFiles(source: 'chrome' | 'markdown' | 'obsidian' | 'enex' | 'notion' | 'flomo' | 'keep' | 'apple_notes' | 'image', files: File[], libraryId?: string, options?: ImportUploadOptions) {
  const selected = source === 'obsidian' && files.some(file => file.webkitRelativePath || file.name.includes('/')) ? prepareNoteFolderFiles(files).files : files
  const named = selected.map(file => file.webkitRelativePath ? new File([file], file.webkitRelativePath, { type: file.type }) : file)
  const multipartParts = [{ name: 'source_type', value: source }, ...named.map(file => ({ name: 'files', file })), ...(libraryId ? [{ name: 'library_id', value: libraryId }] : [])]
  const parts = options ? await createUploadBody(multipartParts) : await createMultipartBody(multipartParts)
  return value(await createImportBatch({ client: apiClient, body: { source_type: source, files: named, library_id: libraryId },
    headers: { 'Idempotency-Key': options?.requestKey ?? crypto.randomUUID(), 'Content-Type': parts.contentType }, bodySerializer: () => parts.body,
    ...(options ? { signal: options.signal, fetch: uploadFetch(parts.body as Blob, options.onProgress) } : {}) }))
}
export async function retryImport(batchId: string, itemId: string) {
  return value(await retryImportItem({ client: apiClient, path: { batch_id: batchId, item_id: itemId }, headers: { 'Idempotency-Key': crypto.randomUUID() } }))
}

export async function importBilibili(uid: string, libraryId?: string) {
  return value(await createBilibiliImport({ client: apiClient, body: { uid, library_id: libraryId }, headers: { 'Idempotency-Key': crypto.randomUUID() } }))
}
