import type { AgentContextCard, ConversationContextSuggestion } from '../../modules/research-agent'

// Selection is explicit, in-memory UI state. Never derive this from message text.
export type SelectedContextCard = Pick<ConversationContextSuggestion, 'card_id' | 'version' | 'title' | 'description'>
export function selectContextCard(card: ConversationContextSuggestion): SelectedContextCard | null {
  if (![card.card_id, card.version, card.title, card.description].every(value => typeof value === 'string' && value.trim())) return null
  return { card_id: card.card_id, version: card.version, title: card.title, description: card.description }
}
export function contextCardText(card: AgentContextCard) {
  return `${card.title}\n${card.description}`
}
export function composeContextCardMessage(card: AgentContextCard | null, text: string) {
  return [card ? contextCardText(card) : '', text.trim()].filter(Boolean).join('\n\n')
}
// Display-only de-duplication of a server-labelled card. It never grants context.
export function contextCardAdditionalText(message: string, card: AgentContextCard) {
  const prefix = contextCardText(card)
  if (message === prefix) return ''
  return message.startsWith(`${prefix}\n\n`) ? message.slice(prefix.length + 2) : message
}
export function readContextCard(value: unknown): AgentContextCard | undefined {
  if (!value || typeof value !== 'object') return undefined
  const card = value as Partial<AgentContextCard>
  return typeof card.title === 'string' && typeof card.description === 'string'
    ? { title: card.title, description: card.description } : undefined
}
