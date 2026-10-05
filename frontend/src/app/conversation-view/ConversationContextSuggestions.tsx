import { Link } from 'react-router'
import type { ConversationContextSource } from '../../modules/research-agent'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { useConversationContextSummary } from './useConversationContextSummary'

export function ConversationContextSuggestions({ userId, onSelect }: { userId: string | null; onSelect: (prompt: string) => void }) {
  const query = useConversationContextSummary(userId)
  const { text } = useAppLocale()
  if (!userId) return null
  const data = query.data
  const failed = query.isError || data?.status === 'failed'
  const pending = query.isPending || data?.status === 'pending'
  const label = text('根据你最近的对话', 'From your recent conversations')
  const message = failed ? text('暂时无法读取对话建议，请稍后重试。', 'Conversation suggestions are unavailable. Please try again later.')
    : pending ? text('正在根据最近的对话整理建议…', 'Preparing suggestions from your recent conversations…')
    : data?.status === 'disabled' ? text('对话建议暂未启用。你可以直接输入问题。', 'Conversation suggestions are not enabled. You can still enter a question.')
    : data?.status === 'empty' ? text('最近的对话还没有足够内容形成建议。', 'There is not enough recent conversation content for suggestions yet.')
    : !data?.cards.length ? text('暂时没有可继续讨论的建议。', 'There are no suggested continuations right now.') : null
  return <section className="cv-suggestions cv-context-suggestions" aria-label={label}>
    <p className="cv-suggestions__label qx-meta">{label}</p>
    {!failed && !pending && data?.status === 'ready' && data.summary && <div className="cv-context-suggestions__summary">
      <p className="qx-meta">{data.summary}</p>
      {data.summary_sources.length > 0 && <ContextSources sources={data.summary_sources} label={text('近况依据', 'Summary sources')} />}
    </div>}
    {Boolean(data?.omitted_messages) && <p className="cv-context-suggestions__hint qx-meta">{text(`这里只依据部分近期消息整理，另有 ${data!.omitted_messages} 条消息未纳入。`, `This uses part of your recent conversations; ${data!.omitted_messages} messages were omitted.`)}</p>}
    {message ? <div className="cv-context-suggestions__state" role={failed ? 'alert' : 'status'}>
      <p className="qx-meta">{message}</p>
      {failed && <button className="qx-btn qx-btn--ghost" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{text('重新读取建议', 'Reload suggestions')}</button>}
    </div> : <>
      <p className="cv-context-suggestions__hint qx-meta">{text('可继续讨论的建议 · 点击填入草稿', 'Suggested continuations · Click to fill your draft')}</p>
      <div className="cv-suggestions__cards">{data?.cards.map((card, index) => <article className="cv-context-suggestions__item" key={`${index}:${card.title}`}>
        <button className="qx-btn qx-btn--ghost cv-suggestions__card" type="button" onClick={() => onSelect(card.prompt)}><strong>{card.title}</strong><span>{card.description}</span></button>
        <ContextSources sources={card.sources} label={text('建议依据', 'Suggestion sources')} />
      </article>)}</div>
    </>}
  </section>
}

function ContextSources({ sources, label }: { sources: ConversationContextSource[]; label: string }) {
  const { text } = useAppLocale()
  const roleLabel = (source: ConversationContextSource) => source.role === 'assistant' ? text('助手回答（需核实）', 'Assistant response (unverified)') : text('你的消息', 'Your message')
  return <div className="cv-context-suggestions__evidence">
    <ul className="cv-context-suggestions__sources" aria-label={label}>{sources.map(source => <li key={`${source.conversation_id}:${source.message_id}`} data-source-role={source.role}>
      <Link to={`/agent?conversation_id=${encodeURIComponent(source.conversation_id)}`}>{text('来源：', 'Source: ')}{source.title}</Link>
      <span>{roleLabel(source)}</span>
    </li>)}</ul>
    <details className="cv-context-suggestions__quotes">
      <summary aria-label={`${label}：${text('查看依据原文', 'View source quotes')}`}>{text('查看依据原文', 'View source quotes')}</summary>
      <ul aria-label={`${label}${text('原文', ' quotes')}`}>{sources.map(source => <li key={`${source.conversation_id}:${source.message_id}`}>
        <span>{roleLabel(source)}{text('：', ': ')}{source.quote}</span>
      </li>)}</ul>
    </details>
  </div>
}
