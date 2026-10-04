import * as api from './writingApi'
export const writingApi = {
  summary: (...args: Parameters<typeof api.writingApi.summary>) => api.writingApi.summary(...args),
  samples: (...args: Parameters<typeof api.writingApi.samples>) => api.writingApi.samples(...args),
  document: (...args: Parameters<typeof api.writingApi.document>) => api.writingApi.document(...args),
  revisions: (...args: Parameters<typeof api.writingApi.revisions>) => api.writingApi.revisions(...args),
  create: (...args: Parameters<typeof api.writingApi.create>) => api.writingApi.create(...args),
  update: (...args: Parameters<typeof api.writingApi.update>) => api.writingApi.update(...args),
  propose: (...args: Parameters<typeof api.writingApi.propose>) => api.writingApi.propose(...args),
  resolve: (...args: Parameters<typeof api.writingApi.resolve>) => api.writingApi.resolve(...args),
  upload: (...args: Parameters<typeof api.writingApi.upload>) => api.writingApi.upload(...args),
  deleteSample: (...args: Parameters<typeof api.writingApi.deleteSample>) => api.writingApi.deleteSample(...args),
}
export type WritingApi = typeof writingApi
export type WritingDocument = Awaited<ReturnType<WritingApi['document']>>
export type WritingRevision = Awaited<ReturnType<WritingApi['propose']>>
export type WritingSummary = Awaited<ReturnType<WritingApi['summary']>>
export type WritingSample = Awaited<ReturnType<WritingApi['upload']>>
export type Genre = WritingDocument['genre']
export const genres: { id: Genre; label: string }[] = [{ id: 'official', label: '公文' }, { id: 'report', label: '报告' }, { id: 'academic', label: '正式文体' }, { id: 'fiction', label: '小说' }, { id: 'essay', label: '随笔' }]
export function genreLabel(genre: Genre) { return genres.find(item => item.id === genre)?.label ?? genre }
