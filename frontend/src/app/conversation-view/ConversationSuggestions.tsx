import { useAppLocale } from '../i18n/AppLocaleProvider'
import { buildConversationSuggestions, type ConversationSuggestionContext } from './conversationSuggestionsModel'

export function ConversationSuggestions({ onSelect, ...context }: ConversationSuggestionContext & { onSelect: (question: string) => void }) {
  const { locale } = useAppLocale()
  const { label, cards } = buildConversationSuggestions(context, locale)
  if (!cards.length) return null
  return <section className="cv-suggestions" aria-label={label}>
    <p className="cv-suggestions__label qx-meta">{label}</p>
    <div className="cv-suggestions__cards">{cards.map(card => <button className="qx-btn qx-btn--ghost cv-suggestions__card" type="button" key={card.title} onClick={() => onSelect(card.prompt)}>
      <strong>{card.title}</strong><span>{card.description}</span>
    </button>)}</div>
  </section>
}
