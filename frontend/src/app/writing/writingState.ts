import { useRef } from 'react'
import type { Genre } from '../../modules/writing'
export function useRequestKeys() {
  const attempts = useRef(new Map<string, string>())
  return (operation: string, payload: unknown) => {
    const signature = operation + JSON.stringify(payload)
    let key = attempts.current.get(signature)
    if (!key) { key = crypto.randomUUID(); attempts.current.set(signature, key) }
    return key
  }
}
export type Draft = { title: string; genre: Genre; markdown: string; version: number }
export function draftKey(userId: string, documentId: string) { return `everplain.writing.draft:${userId}:${documentId}` }
export function readDraft(key: string): Draft | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value.markdown === 'string' && typeof value.title === 'string' && Number.isInteger(value.version) && ['official', 'report', 'academic', 'fiction', 'essay'].includes(value.genre) ? value : null } catch { return null }
}
export function saveDraft(key: string, value: Draft | null) { try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key) } catch { /* Current editor remains the in-memory fallback. */ } }
export function message(error: unknown) { return error instanceof Error ? error.message : '请求未完成，请重试。' }
