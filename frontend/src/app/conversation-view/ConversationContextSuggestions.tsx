import { Link } from 'react-router'
import { selectContextCard, type SelectedContextCard } from './contextCard'
import type { ConversationContextSource, ConversationContextSummary } from '../../modules/research-agent'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { useConversationContextSummary } from './useConversationContextSummary'

export function ConversationContextSuggestions({ userId, onSelect }: { userId: string | null; onSelect: (card: SelectedContextCard) => void }) {
  const query = useConversationContextSummary(userId)
  const { text, locale } = useAppLocale()
  if (!userId) return null
  const data = query.data
  const needsRefresh = Boolean(data?.cards.some(card => !selectContextCard(card)))
  const failed = query.isError || data?.status === 'failed'
  const pending = query.isPending || data?.status === 'pending'
  const hasContent = Boolean(data?.summary.trim() || data?.cards.length)
  const stale = hasContent && (data?.is_stale || failed || pending)
  const updatedAt = data?.updated_at ? new Date(data.updated_at) : null
  const updatedTime = updatedAt && Number.isFinite(updatedAt.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(updatedAt) : null
  const label = text('根据你最近的对话', 'From your recent conversations')
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
    : !hasContent && data?.status === 'disabled' ? text('对话建议暂未启用。你可以直接输入问题。', 'Conversation suggestions are not enabled. You can still enter a question.')
    : !hasContent && data?.status === 'empty' ? text('最近的对话还没有足够内容形成建议。', 'There is not enough recent conversation content for suggestions yet.')
    : !data?.cards.length ? text('暂时没有可继续讨论的建议。', 'There are no suggested continuations right now.') : null
  return <section className="cv-suggestions cv-context-suggestions" aria-label={label}>
    <header className="cv-context-suggestions__header">
      <h2 className="cv-context-suggestions__label">{label}</h2>
      {hasContent && updatedTime && <p className="cv-context-suggestions__updated qx-meta">
        {text('更新于 ', 'Updated ')}<time dateTime={data!.updated_at!} title={data!.updated_at!}>{updatedTime}</time>
      </p>}
    </header>
    {data?.summary && <p className="cv-context-suggestions__summary">{data.summary}</p>}
    {Boolean(data?.cards.length) && <div className="cv-context-suggestions__continuations">
      <p className="cv-context-suggestions__hint qx-meta">{text('接着聊 · 选卡后发送', 'Continue the conversation · Select a card, then send')}</p>
      <div className="cv-suggestions__cards">{data?.cards.map((card, index) => <article className="cv-context-suggestions__item" key={`${index}:${card.title}`}>
        <button className="qx-btn qx-btn--ghost cv-suggestions__card" type="button" disabled={!selectContextCard(card)} onClick={() => { const selection = selectContextCard(card); if (selection) onSelect(selection) }}><strong>{card.title}</strong><span>{card.description}</span></button>
      </article>)}</div>
    </div>}
    {needsRefresh && <div role="status" className="cv-context-suggestions__state"><p className="qx-meta">{text('这些建议需要刷新后才能发送。', 'Reload these suggestions before sending.')}</p><button type="button" className="qx-btn qx-btn--ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>{text('刷新建议', 'Reload suggestions')}</button></div>}
    {data && <ContextSources data={data} />}
    {(stale || Boolean(data?.omitted_messages) || data?.usage_status === 'pending' || message) && <div className="cv-context-suggestions__status">
      {stale && <p className="cv-context-suggestions__hint qx-meta">{text('保留上次整理的建议', 'Showing the last prepared suggestions')}</p>}
      {Boolean(data?.omitted_messages) && <p className="cv-context-suggestions__hint qx-meta">{text(`这里只依据部分近期消息整理，另有 ${data!.omitted_messages} 条消息未纳入。`, `This uses part of your recent conversations; ${data!.omitted_messages} messages were omitted.`)}</p>}
      {data?.usage_status === 'pending' && <p className="cv-context-suggestions__hint qx-meta">{text('用量尚待确认。', 'Usage is still being confirmed.')}</p>}
      {message && <div className="cv-context-suggestions__state" role={failed && !hasContent ? 'alert' : 'status'}>
        <p className="qx-meta">{message}</p>
        {failed && <button className="qx-btn qx-btn--ghost" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{text('重新读取建议', 'Reload suggestions')}</button>}
      </div>}
    </div>}
  </section>
}

function ContextSources({ data }: { data: ConversationContextSummary }) {
  const { text } = useAppLocale()
  // Share identical excerpts once, without losing which summary/card they support.
  // Different excerpts from the same message are intentionally retained.
  const evidence = new Map<string, { source: ConversationContextSource; supports: Set<string> }>()
  const add = (sources: ConversationContextSource[], support: string) => sources.forEach(source => {
    const key = JSON.stringify([source.conversation_id, source.message_id, source.role, source.quote])
    const existing = evidence.get(key)
    if (existing) existing.supports.add(support)
    else evidence.set(key, { source, supports: new Set([support]) })
  })
  add(data.summary_sources, text('近况摘要', 'Recent context'))
  data.cards.forEach(card => add(card.sources, text(`建议：${card.title}`, `Suggestion: ${card.title}`)))
  if (!evidence.size) return null
  const roleLabel = (source: ConversationContextSource) => source.role === 'assistant' ? text('助手回答（需核实）', 'Assistant response (unverified)') : text('你的消息', 'Your message')
  return <details className="cv-context-suggestions__evidence">
    <summary className="cv-context-suggestions__source-toggle" aria-label={text('查看依据原文', 'View source quotes')}>
      {text('查看依据原文', 'View source quotes')}<span className="cv-context-suggestions__source-count">{evidence.size}</span>
    </summary>
    <ul className="cv-context-suggestions__sources" aria-label={text('对话依据', 'Conversation sources')}>{[...evidence].map(([key, { source, supports }]) => <li key={key} data-source-role={source.role}>
      <div className="cv-context-suggestions__source-meta">
        <Link to={`/agent?conversation_id=${encodeURIComponent(source.conversation_id)}`}>{source.title}</Link>
        <span>{roleLabel(source)}</span>
      </div>
      <p className="cv-context-suggestions__quote">{source.quote}</p>
      <p className="cv-context-suggestions__supports">{text('用于：', 'Supports: ')}{[...supports].join(' · ')}</p>
    </li>)}</ul>
  </details>
}
