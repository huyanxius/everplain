export type ImportUploadOptions = {
  requestKey: string
  signal?: AbortSignal
  onProgress?(value: { stage: 'uploading' | 'accepting'; loaded: number; total?: number }): void
}
