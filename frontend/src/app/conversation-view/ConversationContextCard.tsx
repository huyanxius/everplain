import { XIcon } from '@phosphor-icons/react'
import type { AgentContextCard } from '../../modules/research-agent'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import './context-card.css'

export function ConversationContextCard({ card, onRemove, disabled = false }: { card: AgentContextCard; onRemove?: () => void; disabled?: boolean }) {
  const { text } = useAppLocale()
  return <section className="cv-context-card" aria-label={text(onRemove ? '已选对话卡片' : '对话卡片', onRemove ? 'Selected conversation card' : 'Conversation card')}>
    <div className="cv-context-card__content"><strong>{card.title}</strong><p>{card.description}</p></div>
    {onRemove && <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" disabled={disabled} aria-label={text('移除对话卡片', 'Remove conversation card')} onClick={onRemove}><XIcon /></button>}
  </section>
}
