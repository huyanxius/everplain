import { ArrowUpIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import './foundation.css'

export function ResearchPrompt() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  return <section className="everplain-prompt" aria-label="Everplain 研究入口">
    <form onSubmit={(event) => {
      event.preventDefault()
      const prompt = question.trim()
      navigate(prompt ? `/agent?prompt=${encodeURIComponent(prompt)}` : '/agent')
    }}>
      <textarea aria-label="输入你的研究问题" placeholder="有什么想研究的？" rows={2} maxLength={2000} value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} />
      <div className="everplain-prompt__footer"><span>从问题，或手边的资料开始</span><button type="submit" aria-label="开始研究"><ArrowUpIcon size={19} weight="bold" aria-hidden="true" /></button></div>
    </form>
  </section>
}
