import type { ModelSelection } from '../model-selection'

export type ComposerOrigin = { left: number; top: number; width: number; height: number }
export type HomeSubmission = {
  id: string
  owner: string
  question: string
  selection: ModelSelection
  origin?: ComposerOrigin
}

// An in-memory capability created only by an explicit Send. History/storage carry
// its opaque ID, never permission to replay a draft after reload or Back.
let pending: HomeSubmission | null = null
export function createHomeSubmission(owner: string, question: string, selection: ModelSelection, origin?: ComposerOrigin) {
  pending = { id: crypto.randomUUID(), owner, question, selection: { ...selection }, origin }
  return pending.id
}
export function readHomeSubmission(id: unknown, owner: string | null) {
  return typeof id === 'string' && pending?.id === id && pending.owner === owner ? pending : null
}
export function takeHomeSubmission(id: string, owner: string | null) {
  const intent = readHomeSubmission(id, owner)
  if (intent) pending = null
  return intent
}
