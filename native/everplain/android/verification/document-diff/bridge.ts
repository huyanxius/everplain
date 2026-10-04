import { createDocumentDiff } from './web-document-diff'
export { createDocumentDiff }
export function diffJson(input: string): string {
  const data = JSON.parse(input)
  if (!data || typeof data.base !== 'string' || typeof data.proposed !== 'string') throw Error('Invalid diff input')
  if (data.base.length > 200000 || data.proposed.length > 200000) throw Error('Document section exceeds diff bound')
  return JSON.stringify(createDocumentDiff(data.base, data.proposed))
}
