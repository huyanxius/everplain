import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, FileTextIcon, GlobeIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import { PageContent, PageShell } from '../ui/PageShell'
import { ConversationComposer } from '../conversation-view/ConversationComposer'
import { ConversationContextSuggestions } from '../conversation-view/ConversationContextSuggestions'
import { ModelSelectionSettings } from '../model-selection'
import { useAppHome } from './useAppHome'
import { Pile } from './Pile'
import './personal-home.css'

type Home = ReturnType<typeof useAppHome>

export function AppHomePage() {
  const home = useAppHome()
  const [open, setOpen] = useState<'hand' | 'deck' | null>(null)
  const agent = home.profile.data
  const pending = home.graph.data?.pending_count ?? 0
  const top = home.recentConversations[0]
  return <PageShell wide><PageContent>
    <main className="hm-desk">
      <section className="hm-me" aria-label="问候">
        {agent && <AgentAvatar avatar={agent.avatar_id as AgentAvatarId} color={agent.color} size={72} state="greet" label={agent.name} />}
        <h1 className="qx-display hm-hello">{home.greeting}</h1>
        <p className="hm-sub">
          {home.profile.isError || home.graph.isError || home.history.isError
            ? <button className="qx-btn qx-btn--ghost hm-inline" type="button" disabled={home.profile.isFetching} onClick={() => void home.profile.refetch()}>重新读取伙伴设置</button>
            : home.history.isPending || home.graph.isPending ? '正在读取你的近况…'
            : top || pending ? <>{top && <>最近聊到<Link className="hm-inline" to={`/agent?conversation_id=${encodeURIComponent(top.conversation_id)}`}>《{top.title}》</Link></>}{top && pending > 0 ? '，还有 ' : ''}{pending > 0 && <><Link className="hm-inline" to="/imports">{pending} 份资料</Link>没整理。</>}</>
            : '这里还空着。丢一份资料，或者问一个你想弄清楚的问题。'}
        </p>
        <HomeComposer home={home} />
        <ConversationContextSuggestions userId={home.userId} onSelect={home.setQuestion} />
      </section>
      <div className="hm-table">
        <section aria-labelledby="home-research-title" className="hm-section">
          <header className="hm-table__label">
            <h2 id="home-research-title" className="qx-heading">接着聊</h2>
            <span className="hm-table__acts">{open === 'hand' && <button className="qx-btn qx-btn--ghost" type="button" onClick={() => setOpen(null)}>收起</button>}<Link className="qx-btn qx-btn--ghost" to="/agent" aria-label="全部对话">全部 <ArrowRightIcon /></Link></span>
          </header>
          {home.history.isPending ? <HomeLoading label="正在读取最近对话" /> : home.history.isError ? <HomeFailure message={home.history.error.message} retry={() => void home.history.refetch()} busy={home.history.isFetching} label="重新加载对话" /> : home.recentConversations.length ?
            <Pile kind="hand" label="展开对话" open={open === 'hand'} onToggle={next => setOpen(next ? 'hand' : null)} items={home.recentConversations.map(conversation => ({id: conversation.conversation_id, href: `/agent?conversation_id=${encodeURIComponent(conversation.conversation_id)}`, body: <>
              <span className="qx-tag">最近对话</span>
              <h3 className="qx-card__title hm-card__title">{conversation.title}</h3>
              <span className="hm-pc__more"><span className="hm-card__body">{conversation.excerpt}</span></span>
              <span className="qx-card__meta hm-card__foot hm-pc__more"><time dateTime={conversation.updated_at}>{updatedAt(conversation.updated_at)}</time><span>回到原对话 <ArrowRightIcon /></span></span>
            </>, label: `继续对话：${conversation.title}`}))} />
            : <div className="hm-hand"><Link className="qx-card qx-card--interactive hm-card hm-card--blank" to="/agent"><PlusIcon /><strong>开始第一次对话</strong><span>还没有最近对话</span><span>问 {agent?.name ?? 'Agent'} 一个问题，或者从一份资料出发</span></Link></div>}
        </section>
        <section aria-labelledby="home-materials-title" className="hm-section">
          <header className="hm-table__label"><h2 id="home-materials-title" className="qx-heading">我的资料</h2><span className="hm-table__acts">
            {open === 'deck' && <><Link className="qx-btn qx-btn--ghost" to="/imports">{pending} 份待整理</Link><button className="qx-btn qx-btn--ghost" type="button" onClick={() => setOpen(null)}>收起</button></>}
            <Link className="qx-btn qx-btn--ghost" to="/library" aria-label="打开知识库">知识库 <ArrowRightIcon /></Link>
          </span></header>
          {home.graph.isPending ? <HomeLoading label="正在读取资料" /> : home.graph.isError ? <HomeFailure message={home.graph.error.message} retry={() => void home.graph.refetch()} busy={home.graph.isFetching} label="重试" /> : home.documents.length || home.graph.data?.document_count ?
            <Pile kind="deck" open={open === 'deck'} onToggle={next => setOpen(next ? 'deck' : null)} cover={<>
              <span className="hm-deck__count"><span><b>{home.graph.data?.document_count}</b> 份资料</span> · <span>{home.graph.data?.topic_count ?? 0} 个主题</span></span>
              <span className="hm-deck__recent">{home.visibleDocuments.slice(0, 2).map(({node}) => <span key={node.id}>{node.label}</span>)}</span>
              {pending > 0 && <span className="hm-deck__pending">{pending} 份待整理</span>}
            </>} items={home.visibleDocuments.map(({node, source}) => ({id: node.id, href: `/library?kb_id=${encodeURIComponent(source.library_id)}&document_id=${encodeURIComponent(source.document_id)}`, body: <>
              <span className="hm-kind">{source.source_url ? <GlobeIcon /> : <FileTextIcon />}{source.source_url ? '网页收藏' : '我的笔记'}</span><h3 className="qx-card__title hm-mat__title">{node.label}</h3>{source.source_url && <span className="hm-mat__host">{sourceHost(source.source_url)}</span>}
            </>}))} />
            : <Link className="qx-card qx-card--interactive hm-deck hm-deck--empty" to="/imports" aria-label="开始导入"><UploadSimpleIcon /><span><h3 className="qx-card__title">把第一份资料，放进来。</h3><small>浏览器收藏、Obsidian、Markdown 或 PDF</small></span></Link>}
        </section>
      </div>
    </main>
  </PageContent></PageShell>
}

function HomeComposer({ home }: { home: Home }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  return <ConversationComposer mode="standard" value={home.question} label={`问${home.profile.data?.name ?? 'Agent'}`} placeholder={`问${home.profile.data?.name ?? 'Agent'}，或者丢一个链接进来`}
    maxLength={12000} busy={false} canSend={Boolean(home.question.trim()) && home.modelSelection.status === 'ready'} canStop={false} uploading={false} toolsOpen={toolsOpen}
    inputRef={inputRef} toolsRef={toolsRef} toolsButtonRef={toolsButtonRef} fileRef={fileRef} accept="" attachments={[]}
    tools={<Link className="qx-item" role="menuitem" to="/imports">导入资料</Link>} modelSelector={<ModelSelectionSettings state={home.modelSelection} disabled={false} />}
    onChange={home.setQuestion} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); home.ask(event.currentTarget.closest('form')?.getBoundingClientRect())} }}
    onSubmit={event => {event.preventDefault(); home.ask(event.currentTarget.getBoundingClientRect())}} onStop={() => {}} onToggleTools={() => setToolsOpen(value => !value)} onUpload={() => {}} onRemoveAttachment={() => {}} />
}
function HomeLoading({label}: {label: string}) {return <div className="qx-card hm-loading" role="status"><span className="qx-meta">{label}</span></div>}
function HomeFailure({message, retry, busy, label}: {message: string; retry(): void; busy: boolean; label: string}) {return <div className="qx-card hm-failure" role="alert"><p className="qx-meta">{message}</p><button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={retry}>{label}</button></div>}
function updatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '最近更新' : `更新于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
}
function sourceHost(value: string) {
  try { return new URL(value).hostname } catch { return value }
}
