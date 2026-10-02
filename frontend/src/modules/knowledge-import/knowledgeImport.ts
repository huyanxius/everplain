import * as api from './knowledgeImportApi'
export const readImportBatches = (...args: Parameters<typeof api.readImportBatches>) => api.readImportBatches(...args)
export const importFiles = (...args: Parameters<typeof api.importFiles>) => api.importFiles(...args)
export const retryImport = (...args: Parameters<typeof api.retryImport>) => api.retryImport(...args)
export type ImportBatch = Awaited<ReturnType<typeof readImportBatches>>[number]

export const importBilibili = (...args: Parameters<typeof api.importBilibili>) => api.importBilibili(...args)
export type ImportSourceType =
  | 'chrome'
  | 'markdown'
  | 'obsidian'
  | 'enex'
  | 'notion'
  | 'flomo'
  | 'keep'
  | 'apple_notes'
  | 'image'
