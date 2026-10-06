import { useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { ConversationContextSource } from '../../modules/research-agent'
import { selectContextCard, type SelectedContextCard } from './contextCard'
import { getStarterSuggestions } from './starterSuggestions'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { useConversationContextSummary } from './useConversationContextSummary'

export function ConversationContextSuggestions({ userId, onSelect, onStart, hasDraft = false }: {
  userId: string | null
  onSelect: (card: SelectedContextCard) => void
  onStart?: (text: string) => void
  hasDraft?: boolean
}) {
  const query = useConversationContextSummary(userId)
  const { text, locale } = useAppLocale()
  const navigate = useNavigate()
  if (!userId) return null
  const data = query.data
  const cards = data?.cards.slice(0, 3) ?? []
  const needsRefresh = Boolean(data?.cards.some(card => !selectContextCard(card)))
  const failed = query.isError || data?.status === 'failed'
  const pending = query.isPending || data?.status === 'pending'
  const hasContent = Boolean(data?.summary.trim() || data?.cards.length)
  const stale = hasContent && (data?.is_stale || failed || pending)
  // Generic actions fill open slots; they never stand in for unread history.
  // Keep the same fill with last-good real cards during a refresh/read failure.
  const confirmedEmpty = query.isSuccess && data?.status === 'empty' && !hasContent && !data.is_stale && !failed
    && !data.status_reason && !data.retry_at && data.usage_status !== 'pending'
  const freshReady = query.isSuccess && data?.status === 'ready' && !data.is_stale && !data.status_reason && !data.retry_at
  const canFill = !needsRefresh && (confirmedEmpty || freshReady || (cards.length > 0 && data?.status !== 'disabled'))
  const starters = onStart && canFill
    ? getStarterSuggestions(locale, userId, { count: 3 - cards.length, excludedTitles: cards.map(card => card.title) }) : []
  const label = starters.length
    ? cards.length ? text('建议', 'Suggestions') : text('起步建议', 'Starting suggestions')
    : text('根据你最近的对话', 'From your recent conversations')
  const waitingMessage = data?.status_reason === 'active_run' ? text('当前对话还在进行，结束后会整理建议。', 'Suggestions will be prepared after the current conversation finishes.')
    : data?.status_reason === 'idle_wait' ? text('最近对话刚刚更新，稍后会自动整理建议。', 'Your recent conversations just changed. Suggestions will update shortly.')
    : data?.status_reason === 'queued' ? text('对话建议已排队，会自动更新。', 'Conversation suggestions are queued and will update automatically.')
    : text('正在根据最近的对话整理建议…', 'Preparing suggestions from your recent conversations…')
  const failureMessage = data?.status_reason === 'retry_wait' ? text('这次整理没有成功，稍后会自动重试。', 'Suggestions could not be prepared this time. They will retry automatically.')
    : data?.status_reason === 'daily_budget' ? data.retry_at
      ? text('今天的对话建议额度已用完，额度恢复后会自动更新。', 'Today’s conversation suggestion allowance is exhausted. Suggestions will update when it renews.')
      : text('对话建议额度不足，暂时无法生成。', 'The conversation suggestion allowance is insufficient to generate suggestions.')
    : data?.status_reason === 'attempt_limit' ? text('这批对话的建议生成未成功，已暂停重试。新对话后会重新检查。', 'Suggestions failed for these conversations and retries are paused. New conversation content will allow another check.')
    : data?.status_reason === 'generator_unavailable' ? text('对话建议的生成服务暂时不可用。', 'The conversation suggestion generator is unavailable.')
    : text('暂时无法读取对话建议，请稍后重试。', 'Conversation suggestions are unavailable. Please try again later.')
  const message = failed ? failureMessage
    : pending ? waitingMessage
    : starters.length ? null
    : !hasContent && data?.status === 'disabled' ? text('对话建议暂未启用。你可以直接输入问题。', 'Conversation suggestions are not enabled. You can still enter a question.')
    : !hasContent && data?.status === 'empty' ? text('最近的对话还没有足够内容形成建议。', 'There is not enough recent conversation content for suggestions yet.')
    : !data?.cards.length ? text('暂时没有可继续讨论的建议。', 'There are no suggested continuations right now.') : null
  return <section className="cv-suggestions cv-context-suggestions" aria-label={label}>
    {Boolean(cards.length || starters.length) && <div className="cv-suggestions__cards">
      {cards.map((card, index) => <article className="cv-context-suggestions__item" data-has-sources={Boolean(card.sources.length)} key={`${userId}:context:${card.card_id ?? index}:${card.version ?? card.title}`}>
        <button className="qx-btn qx-btn--ghost cv-suggestions__card" type="button" disabled={!selectContextCard(card)} onClick={() => { const selection = selectContextCard(card); if (selection) onSelect(selection) }}><strong>{card.title}</strong><span>{card.description}</span></button>
        <CardSources sources={card.sources} />
      </article>)}
      {starters.map(card => <article className="cv-context-suggestions__item" key={`${userId}:starter:${card.id}`}>
        <button className="qx-btn qx-btn--ghost cv-suggestions__card" type="button" disabled={hasDraft}
          title={hasDraft ? text('发送或清空当前草稿后再选择建议', 'Send or clear your current draft before choosing a suggestion') : undefined}
          onClick={() => { if (hasDraft) return; if (card.kind === 'navigate') navigate(card.to); else onStart?.(card.title) }}>
          <strong>{card.title}</strong>
        </button>
      </article>)}
    </div>}
    {needsRefresh && <div role="status" className="cv-context-suggestions__state"><p className="qx-meta">{text('这些建议需要刷新后才能发送。', 'Reload these suggestions before sending.')}</p><button type="button" className="qx-btn qx-btn--ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>{text('刷新建议', 'Reload suggestions')}</button></div>}
    {(stale || message) && <div className="cv-context-suggestions__status">
      {stale && <p role={message ? undefined : 'status'} className="cv-context-suggestions__hint qx-meta">{text('保留上次整理的建议', 'Showing the last prepared suggestions')}</p>}
      {message && <div className="cv-context-suggestions__state" role={failed && !hasContent ? 'alert' : 'status'}>
        <p className="qx-meta">{message}</p>
        {failed && <button className="qx-btn qx-btn--ghost" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{text('重新读取建议', 'Reload suggestions')}</button>}
      </div>}
    </div>}
  </section>
}


function CardSources({ sources }: { sources: ConversationContextSource[] }) {
  const { text } = useAppLocale()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const evidence = [...new Map(sources.map(source => [JSON.stringify([source.conversation_id, source.message_id, source.role, source.quote]), source])).values()]
  if (!evidence.length) return null
  return <div className="cv-context-suggestions__evidence" onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }}>
    <button ref={trigger} type="button" className="qx-btn qx-btn--ghost qx-btn--icon cv-context-suggestions__source-toggle"
      aria-label={text('查看依据原文', 'View source quotes')} title={text('查看依据原文', 'View source quotes')}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false"><path d="M14 3H5v18h14V8l-5-5Z M14 3v5h5 M8 12h8 M8 16h6" /></svg>
    </button>
    {open && <ul id={panelId} className="cv-context-suggestions__sources" aria-label={text('对话依据', 'Conversation sources')}>
      {evidence.map(source => <li key={JSON.stringify([source.conversation_id, source.message_id, source.role, source.quote])} data-source-role={source.role}>
        <span className="cv-context-suggestions__source-role">{source.role === 'assistant' ? text('助手回答（需核实）', 'Assistant response (unverified)') : text('你的消息', 'Your message')}</span>
        <Link to={`/agent?conversation_id=${encodeURIComponent(source.conversation_id)}`}>{source.title}</Link>
        <p>{source.quote}</p>
      </li>)}
    </ul>}
  </div>
}
