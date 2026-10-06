import { createMultipartBody, type MultipartPart } from './multipart'

export type UploadProgress = { stage: 'uploading' | 'accepting'; loaded: number; total?: number }

/** Retain native File/Blob storage instead of copying an entire Vault into JS buffers. */
export async function createUploadBody(parts: MultipartPart[]): Promise<{ body: Blob; contentType: string }> {
  const boundary = `----everplain-${crypto.randomUUID()}`
  const escape = (value: string) => value.replace(/[\r\n]/g, ' ').replace(/["\\]/g, '\\$&')
  const chunks: BlobPart[] = []
  let expected = 0
  const append = (part: string | File) => { chunks.push(part); expected += typeof part === 'string' ? new TextEncoder().encode(part).byteLength : part.size }
  for (const part of parts) {
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${escape(part.name)}"`)
    if ('file' in part) { append(`; filename="${escape(part.file.name)}"\r\nContent-Type: ${part.file.type || 'application/octet-stream'}\r\n\r\n`); append(part.file) }
    else append(`\r\n\r\n${part.value}`)
    append('\r\n')
  }
  append(`--${boundary}--\r\n`)
  const body = new Blob(chunks)
  const nativeFiles = parts.every(part => !('file' in part) || part.file instanceof Blob)
  if (nativeFiles && body.size === expected) return { body, contentType: `multipart/form-data; boundary=${boundary}` }
  // A foreign File can stringify to an equal-length "[object File]". A size
  // check alone cannot detect that corruption; use the byte-safe fallback.
  const fallback = await createMultipartBody(parts)
  return { body: new Blob([fallback.body]), contentType: fallback.contentType }
}
