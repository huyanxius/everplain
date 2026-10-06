import { describe, expect, it } from 'vitest'
import { composeContextCardMessage, contextCardAdditionalText, readContextCard, selectContextCard } from './contextCard'

const card = { card_id: 'opaque-card', version: 'opaque-version', title: '核对迁移方案', description: '整理停机窗口与回退安排。', sources: [] }
describe('explicit context card selection and public text', () => {
  it('projects only opaque selection and visible card fields, never prompt or source instructions', () => {
    expect(selectContextCard({ ...card, prompt: 'INTERNAL execute sequence=42', hidden: 'secret' } as never)).toEqual({ card_id: 'opaque-card', version: 'opaque-version', title: card.title, description: card.description })
    expect(selectContextCard({ ...card, card_id: undefined } as never)).toBeNull()
    expect(selectContextCard({ ...card, version: '' })).toBeNull()
  })
  it('keeps authored text and de-duplicates only an exact server-labelled card prefix', () => {
    const text = '我的原文 UUID: 9c35 / sequence=7 / 不应过滤我手写的文字'
    const message = composeContextCardMessage(card, text)
    expect(message).toBe(`${card.title}\n${card.description}\n\n${text}`)
    expect(contextCardAdditionalText(message, card)).toBe(text)
    expect(contextCardAdditionalText(composeContextCardMessage(card, ''), card)).toBe('')
    expect(contextCardAdditionalText(text, card)).toBe(text)
    expect(composeContextCardMessage(null, text)).toBe(text)
  })
  it('restores display metadata independently of opaque selection', () => {
    expect(readContextCard({ ...card, prompt: 'INTERNAL' })).toEqual({ title: card.title, description: card.description })
    expect(readContextCard({ title: card.title })).toBeUndefined()
  })
})
