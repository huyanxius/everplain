import { useState } from 'react'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { englishResearchTopicPresets, researchTopicPresets } from './researchPrompts'

export function ConversationSuggestions({ onSelect }: { onSelect: (question: string) => void }) {
  const { locale, text } = useAppLocale()
  const [page, setPage] = useState(0)
  const prompts = locale === 'en-US' ? englishResearchTopicPresets : researchTopicPresets
  return <details className="cv-suggestions">
    <summary className="qx-item">{text('问题示例', 'Suggested questions')}</summary>
    <div>{prompts.slice(page * 4, page * 4 + 4).map(prompt => <button className="qx-btn qx-btn--ghost" type="button" key={prompt} onClick={() => onSelect(prompt)}>{prompt}</button>)}
      <button className="qx-btn qx-btn--ghost" type="button" onClick={() => setPage(current => (current + 1) % Math.ceil(prompts.length / 4))}>{text('换一组', 'More ideas')}</button>
    </div>
  </details>
}
