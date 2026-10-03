import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, ArrowUpIcon, BooksIcon, CompassIcon, FileTextIcon, FolderOpenIcon, GearSixIcon, GlobeIcon, GraphIcon, MagnifyingGlassIcon, NotePencilIcon, PlusIcon, UploadSimpleIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { AgentAvatar, type AgentAvatarId } from '../../modules/agent-avatar'
import type { MyResearchItem } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { homeGreeting, useAppHome } from './useAppHome'
import './personal-home.css'

type Home = ReturnType<typeof useAppHome>

/** One greeting and a draft composer, followed by the user's actual work. */
export function AppHomePage() {
  const home = useAppHome()
  const agent = home.profile.data
  return <PageShell wide><PageContent>
    <main className="personal-start">
      <section className="personal-start__hero">
        {agent && <AgentAvatar avatar={agent.avatar_id as AgentAvatarId} color={agent.color} size={84} state="greet" label={agent.name} />}
        <h1 className="qx-display">{homeGreeting(new Date().getHours())}，今天想弄清楚什么？</h1>
        <HomeComposer home={home} />
        <div className="personal-start__chips">
          <button className="qx-tag qx-tag--outline" type="button" onClick={() => home.ask('帮我找回以前收藏过的资料')}>找回以前收藏过的资料</button>
          <button className="qx-tag qx-tag--outline" type="button" onClick={() => home.ask('帮我把资料之间的联系整理一下')}>把资料串起来</button>
          {home.projects[0] && <Link className="qx-tag qx-tag--outline" to={projectDestination(home.projects[0])}>接着研究《{projectTitle(home.projects[0])}》</Link>}
        </div>
        {home.profile.isError && <button className="qx-btn qx-btn--ghost qx-meta" type="button" disabled={home.profile.isFetching} onClick={() => void home.profile.refetch()}>重新读取伙伴设置</button>}
      </section>

      <section className="personal-start__section" aria-labelledby="home-research-title">
        <header className="personal-start__section-head">
          <h2 id="home-research-title" className="qx-heading">接着研究</h2>
          <Link className="qx-btn qx-btn--ghost" to="/research/materials" aria-label="全部研究">全部 <ArrowRightIcon /></Link>
        </header>
        {home.research.isPending ? <HomeLoading label="正在读取最近研究" /> : home.research.isError ? <HomeFailure message={home.research.error.message} retry={() => void home.research.refetch()} busy={home.research.isFetching} label="重新加载研究" /> : home.projects.length ? (
          <div className="personal-start__grid personal-start__projects" data-count={home.projects.length}>
            {home.projects.map(project => <Link className="qx-card qx-card--interactive personal-start__research" key={project.taskId} to={projectDestination(project)} aria-label={`${project.nextActionLabel || '继续研究'}：${projectTitle(project)}`}>
              <span className="qx-tag">{project.stageLabel}</span>
              <h3 className="qx-card__title">{projectTitle(project)}</h3>
              {project.phenomenonSummary !== projectTitle(project) && <p className="qx-card__body personal-start__excerpt">{project.phenomenonSummary}</p>}
              {project.blocker && <p className="qx-meta personal-start__blocker">{project.blocker.message}</p>}
              <div className="qx-card__meta"><time dateTime={project.updatedAt}>{updatedAt(project.updatedAt)}</time></div>
            </Link>)}
          </div>
        ) : <div className="personal-start__empty"><FolderOpenIcon className="personal-start__empty-icon" /><div className="personal-start__empty-copy"><p>还没有研究项目</p></div><Link className="qx-btn qx-btn--secondary" to="/research/new"><PlusIcon />开始第一项研究</Link></div>}
      </section>

      <section className="personal-start__section" aria-labelledby="home-materials-title">
        <header className="personal-start__section-head">
          <h2 id="home-materials-title" className="qx-heading">我的资料</h2>
          <Link className="qx-btn qx-btn--ghost" to="/library" aria-label="打开知识库">知识库 <ArrowRightIcon /></Link>
        </header>
        <div className="personal-start__material-tools">
          <div className="personal-start__stats qx-meta" aria-label="个人资料统计">
            {home.graph.data && <><span>{home.graph.data.document_count} 份资料</span>{typeof home.graph.data.topic_count === 'number' && <span>{home.graph.data.topic_count} 个主题</span>}{home.graph.data.pending_count > 0 && <Link to="/imports">{home.graph.data.pending_count} 份待整理</Link>}</>}
          </div>
          <label className="qx-search personal-start__search"><MagnifyingGlassIcon /><input aria-label="搜索资料标题" value={home.filter} onChange={event => home.setFilter(event.target.value)} placeholder="搜索资料标题" /></label>
        </div>
        {home.graph.isPending ? <HomeLoading label="正在读取资料" /> : home.graph.isError ? <HomeFailure message={home.graph.error.message} retry={() => void home.graph.refetch()} busy={home.graph.isFetching} label="重试" /> : home.visibleDocuments.length ? (
          <div className="personal-start__grid" aria-label="资料卡片">
            {home.visibleDocuments.map(({ node, source }) => <Link className="qx-card qx-card--interactive personal-start__material" key={node.id} to={`/library?kb_id=${encodeURIComponent(source.library_id)}&document_id=${encodeURIComponent(source.document_id)}`}>
              <div className="personal-start__material-kind">{source.source_url ? <GlobeIcon /> : <FileTextIcon />}{source.source_url ? '网页收藏' : '我的笔记'}</div>
              <h3 className="qx-card__title">{node.label}</h3>
              {source.source_url && <p className="qx-card__body personal-start__excerpt">{sourceHost(source.source_url)}</p>}

            </Link>)}
          </div>
        ) : <div className="personal-start__empty">
          {home.filter.trim() ? <MagnifyingGlassIcon className="personal-start__empty-icon" /> : <UploadSimpleIcon className="personal-start__empty-icon" />}
          <div className="personal-start__empty-copy">
            <h3 className="qx-card__title">{home.filter.trim() ? '还没找到这份资料。' : '把第一份资料，放进来。'}</h3>
            <p className="qx-meta">{home.filter.trim() ? '换一个标题关键词试试。' : '从浏览器收藏、Obsidian 或一份 Markdown 开始。'}</p>
          </div>
          {!home.filter.trim() && <Link className="qx-btn qx-btn--secondary" to="/imports"><PlusIcon />开始导入 <ArrowRightIcon /></Link>}
        </div>}
      </section>

      <footer className="personal-start__footer">
        <nav className="personal-start__destinations" aria-label="知识空间视图">
          <div className="personal-start__destination-group" role="group" aria-labelledby="home-work-links">
            <p id="home-work-links" className="qx-meta">资料与研究</p>
            <div className="personal-start__destination-actions"><Link className="qx-btn qx-btn--secondary" to="/imports"><UploadSimpleIcon />导入资料</Link><Link className="qx-btn qx-btn--secondary" to="/library"><BooksIcon />管理知识库</Link><Link className="qx-btn qx-btn--secondary" to="/my/graph"><GraphIcon />知识图谱</Link><Link className="qx-btn qx-btn--secondary" to="/research/new"><NotePencilIcon />新建研究</Link></div>
          </div>
          <div className="personal-start__destination-group" role="group" aria-labelledby="home-discover-links">
            <p id="home-discover-links" className="qx-meta">共享与发现</p>
            <div className="personal-start__destination-actions"><Link className="qx-btn qx-btn--secondary" to="/sharing"><UsersThreeIcon />共享与连接</Link><Link className="qx-btn qx-btn--secondary" to="/discover"><CompassIcon />发现主题</Link></div>
          </div>
        </nav>
        <div className="personal-start__privacy qx-meta"><span>默认仅你可见 · 每份资料保留来源</span><Link className="qx-btn qx-btn--secondary" to="/settings"><GearSixIcon />偏好与账户设置</Link></div>
      </footer>
    </main>
  </PageContent></PageShell>
}

function HomeComposer({ home }: { home: Home }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.min(input.current.scrollHeight, 208)}px`
  }, [home.question])
  return <form className="personal-start__composer" data-multiline={home.question.includes('\n') || home.question.length > 60} aria-label="开始 Agent 对话" onSubmit={event => { event.preventDefault(); home.ask() }}>
    <div className="personal-start__composer-row">
      <Link className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="导入资料" to="/imports"><PlusIcon /></Link>
      <textarea ref={input} rows={1} aria-label={`问${home.profile.data?.name ?? 'Agent'}`} placeholder={`问${home.profile.data?.name ?? 'Agent'}，或者丢一个链接进来`} value={home.question} onChange={event => home.setQuestion(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); home.ask() }
      }} />
      <button className="qx-btn qx-btn--primary qx-btn--icon qx-btn--lg" type="submit" aria-label="开始对话"><ArrowUpIcon weight="bold" /></button>
    </div>
  </form>
}

function HomeLoading({ label }: { label: string }) {
  return <div className="personal-start__loading" role="status"><span className="qx-meta">{label}</span><div className="personal-start__grid" aria-hidden="true">{[0, 1, 2].map(item => <div key={item} className="qx-card personal-start__skeleton"><i /><i /><i /></div>)}</div></div>
}
function HomeFailure({ message, retry, busy, label }: { message: string; retry(): void; busy: boolean; label: string }) {
  return <div className="qx-notice qx-notice--danger personal-start__failure" role="alert"><p>{message}</p><button className="qx-btn qx-btn--ghost" type="button" onClick={retry} disabled={busy}>{label}</button></div>
}
function projectTitle(project: MyResearchItem) { return project.projectTitle?.trim() || project.phenomenonSummary }
function projectDestination(project: MyResearchItem) { return project.retry?.method === 'GET' ? project.retry.href : project.entryPath }
function updatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '最近更新' : `更新于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
}
function sourceHost(value: string) {
  try { return new URL(value).hostname } catch { return value }
}
