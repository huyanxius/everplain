import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, FileTextIcon, GlobeIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import type { MyResearchItem } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { ConversationComposer } from '../conversation-view/ConversationComposer'
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
  const top = home.projects[0]
  return <PageShell wide><PageContent>
    <main className="hm-desk">
      <section className="hm-me" aria-label="问候">
        {agent && <AgentAvatar avatar={agent.avatar_id as AgentAvatarId} color={agent.color} size={72} state="greet" label={agent.name} />}
        <h1 className="qx-display hm-hello">{home.greeting}</h1>
        <p className="hm-sub">
          {home.profile.isError || home.graph.isError || home.research.isError
            ? <button className="qx-btn qx-btn--ghost hm-inline" type="button" disabled={home.profile.isFetching} onClick={() => void home.profile.refetch()}>重新读取伙伴设置</button>
            : home.research.isPending || home.graph.isPending ? '正在读取你的近况…'
            : top || pending ? <>{top && <>上次停在<Link className="hm-inline" to={projectDestination(top)}>《{projectTitle(top)}》</Link></>}{top && pending > 0 ? '，还有 ' : ''}{pending > 0 && <><Link className="hm-inline" to="/imports">{pending} 份资料</Link>没整理。</>}</>
            : '这里还空着。丢一份资料，或者问一个你想弄清楚的问题。'}
        </p>
        <HomeComposer home={home} />
        <div className="hm-asks">
          <button className="qx-tag qx-tag--outline" type="button" onClick={() => home.choosePrompt('帮我找回以前收藏过的资料')}>找回以前收藏过的资料</button>
          <button className="qx-tag qx-tag--outline" type="button" onClick={() => home.choosePrompt('帮我把资料之间的联系整理一下')}>把资料串起来</button>
        </div>
      </section>
      <div className="hm-table">
        <section aria-labelledby="home-research-title" className="hm-section">
          <header className="hm-table__label">
            <h2 id="home-research-title" className="qx-heading">接着研究</h2>
            <span className="hm-table__acts">{open === 'hand' && <button className="qx-btn qx-btn--ghost" type="button" onClick={() => setOpen(null)}>收起</button>}<Link className="qx-btn qx-btn--ghost" to="/research/materials" aria-label="全部研究">全部 <ArrowRightIcon /></Link></span>
          </header>
          {home.research.isPending ? <HomeLoading label="正在读取最近研究" /> : home.research.isError ? <HomeFailure message={home.research.error.message} retry={() => void home.research.refetch()} busy={home.research.isFetching} label="重新加载研究" /> : home.projects.length ?
            <Pile kind="hand" open={open === 'hand'} onToggle={next => setOpen(next ? 'hand' : null)} items={home.projects.map(project => ({id: project.taskId, href: projectDestination(project), body: <>
              <span className="qx-tag">{project.stageLabel}</span>
              <h3 className="qx-card__title hm-card__title">{projectTitle(project)}</h3>
              <span className="hm-pc__more">{project.phenomenonSummary !== projectTitle(project) && <span className="hm-card__body">{project.phenomenonSummary}</span>}{project.blocker && <span className="hm-card__blocker">{project.blocker.message}</span>}</span>
              <span className="qx-card__meta hm-card__foot hm-pc__more"><time dateTime={project.updatedAt}>{updatedAt(project.updatedAt)}</time><span>{project.nextActionLabel || '继续研究'} <ArrowRightIcon /></span></span>
            </>, label: `${project.nextActionLabel || '继续研究'}：${projectTitle(project)}`}))} />
            : <div className="hm-hand"><Link className="qx-card qx-card--interactive hm-card hm-card--blank" to="/research/new"><PlusIcon /><strong>开始第一项研究</strong><span>还没有研究项目</span><span>问 {agent?.name ?? 'Agent'} 一个问题，或者从一份资料出发</span></Link></div>}
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
function projectTitle(project: MyResearchItem) { return project.projectTitle?.trim() || project.phenomenonSummary }
function projectDestination(project: MyResearchItem) { return project.retry?.method === 'GET' ? project.retry.href : project.entryPath }
function updatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '最近更新' : `更新于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
}
function sourceHost(value: string) {
  try { return new URL(value).hostname } catch { return value }
}
