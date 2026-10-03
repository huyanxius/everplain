import { Select } from '../ui/Select'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CheckIcon, CopyIcon, FileTextIcon, FolderIcon, KeyIcon, LinkIcon, MagnifyingGlassIcon, PlusIcon, ShieldCheckIcon, XIcon } from '@phosphor-icons/react'
import * as api from '../../modules/product-integrations'
import { useAccount } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState, LoadingState } from '../ui/States'
import './integrations.css'

type PageProps = { title: string; description: string; actions?: ReactNode; children: ReactNode }

/** Library's page head and Settings' field rows, backed only by live application data. */
function IntegrationPage({ title, description, actions, children }: PageProps) {
  return <PageShell wide><PageContent><main className="ep-integrations">
    <header className="ep-integrations__head">
      <div><h1 className="qx-section-title">{title}</h1><p className="qx-meta">{description}</p></div>
      {actions ? <div className="ep-integrations__actions">{actions}</div> : null}
    </header>
    {children}
  </main></PageContent></PageShell>
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ep-integration-row"><div className="ep-integration-row__label">{label}</div><div className="ep-integration-row__control">{children}</div></div>
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ep-integration-empty"><FolderIcon size={28} aria-hidden="true" /><h2 className="qx-heading">{title}</h2>{children}</div>
}

function useIdentityKey() {
  const account = useAccount()
  return account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
}
function message(error: unknown) { return error instanceof Error ? error.message : '暂时未完成，请重试' }

export function SharingPage() {
  const userKey = useIdentityKey()
  return <SharingContent key={userKey ?? 'anonymous'} />
}

function SharingContent() {
  const [params] = useSearchParams()
  const userKey = useIdentityKey()
  const list = useQuery({ queryKey: ['share-libraries', userKey], queryFn: api.libraries })
  const [invite, setInvite] = useState(params.get('invite') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [publishing, setPublishing] = useState<string>()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [topics, setTopics] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState('')
  const publishTrigger = useRef<HTMLButtonElement | null>(null)

  async function run(action: () => Promise<unknown>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try { await action(); await list.refetch() }
    catch (failure) { setError(message(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  return <IntegrationPage title="共享知识库" description="资料默认私有。只读邀请与公开发布可以分别管理。" actions={<Link className="qx-btn qx-btn--secondary" to="/discover">发现主题<ArrowUpRightIcon /></Link>}>
    <div className="ep-integrations__body" inert={Boolean(publishing)}>
      <section className="qx-card ep-invitation" aria-labelledby="invitation-title">
        <div className="ep-invitation__intro"><LinkIcon size={22} aria-hidden="true" /><div><h2 className="qx-heading" id="invitation-title">收到一份邀请？</h2><p className="qx-meta">加入后可以阅读对方共享的资料。</p></div></div>
        <form className="ep-invitation__form" onSubmit={event => {
          event.preventDefault()
          let token = invite.trim()
          try { token = new URL(token).searchParams.get('invite') ?? token } catch { /* A plain invitation token is also supported. */ }
          void run(() => api.join(token))
        }}>
          <input className="qx-input" aria-label="邀请链接或口令" value={invite} onChange={event => setInvite(event.target.value)} required placeholder="粘贴邀请链接或口令" />
          <button className="qx-btn qx-btn--primary" disabled={busy}>加入<ArrowRightIcon /></button>
        </form>
      </section>
      {error && !publishing ? <p role="alert" className="qx-notice qx-notice--danger">{error}</p> : null}
      <section aria-labelledby="sharing-libraries-title">
        <header className="ep-integration-section-head"><h2 className="qx-heading" id="sharing-libraries-title">我的共享与邀请</h2>{list.data ? <span className="qx-meta">{list.data.length} 个知识库</span> : null}</header>
        {list.isPending ? <LoadingState message="正在读取知识库" /> : list.isError ? <ErrorState detail={list.error.message} onRetry={() => { void list.refetch() }} /> : list.data?.length ? <div className="ep-integration-grid">
          {list.data.map(kb => <article className="qx-card ep-sharing-card" key={kb.id}>
            <div className="ep-sharing-card__status"><FolderIcon size={22} aria-hidden="true" /><span className="qx-tag">{kb.viewer_access === 'owner' ? '我拥有的知识库' : '加入的只读知识库'}</span></div>
            <h3 className="qx-card__title"><Link to={kb.viewer_access === 'owner' ? `/library?kb_id=${kb.id}` : `/shared/${kb.id}`}>{kb.name}</Link></h3>
            {kb.description ? <p className="qx-card__body">{kb.description}</p> : null}
            <p className="qx-meta">{kb.ready_document_count} 份可读资料</p>
            <div className="ep-sharing-card__controls">
              {kb.viewer_access === 'owner' ? <>
                <div className="ep-integration-inline"><span className="qx-meta">只读邀请{kb.sharing_enabled ? '已开启' : '未开启'}</span><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => { void run(() => api.sharing(kb.id, !kb.sharing_enabled)) }}>{kb.sharing_enabled ? '关闭邀请共享' : '开启只读邀请'}</button></div>
                {kb.sharing_enabled && kb.share_token ? <div className="ep-sharing-card__invitation">
                  <p className="qx-meta">持有此链接并登录的人可加入，只能阅读。关闭共享会撤销成员访问和旧邀请。</p>
                  <button className="qx-btn qx-btn--secondary" onClick={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}/sharing?invite=${encodeURIComponent(kb.share_token!)}`).then(() => setCopied(kb.id)).catch(() => setError('复制失败，请手动复制链接'))
                  }}>{copied === kb.id ? <CheckIcon /> : <CopyIcon />}{copied === kb.id ? '已复制邀请链接' : '复制邀请链接'}</button>
                </div> : null}
                <div className="ep-integration-inline ep-sharing-card__publication">{kb.publication ? <><span className="qx-meta">已公开 {kb.publication.document_count} 份资料</span><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => { void run(() => api.unpublish(kb.id)) }}>撤回公开</button></> : <button className="qx-btn qx-btn--ghost" disabled={busy} onClick={event => {
                  publishTrigger.current = event.currentTarget
                  setPublishing(kb.id); setTitle(kb.name ?? ''); setDescription(kb.description ?? ''); setTopics(''); setConfirm(false); setError('')
                }}>发布到公共主题<ArrowUpRightIcon /></button>}</div>
              </> : <div className="ep-integration-inline"><Link className="qx-btn qx-btn--secondary" to={`/shared/${kb.id}`}>打开<ArrowUpRightIcon /></Link><button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => { void run(() => api.leave(kb.id)) }}>退出知识库</button></div>}
            </div>
          </article>)}
        </div> : <Empty title="还没有知识库"><p className="qx-meta">导入自己的资料，或使用邀请加入知识库。</p><Link className="qx-btn qx-btn--secondary" to="/imports">导入资料<ArrowRightIcon /></Link></Empty>}
      </section>
    </div>
    {publishing ? <PublishDialog busy={busy} onClose={() => setPublishing(undefined)} trigger={publishTrigger.current}>
      <form className="ep-publish-form" onSubmit={event => {
        event.preventDefault()
        if (!confirm) return
        void run(async () => {
          await api.publish(publishing, { title, description, topics: topics.split(/[、,，]/).map(value => value.trim()).filter(Boolean), confirm_public_content: true })
          setPublishing(undefined)
        })
      }}>
        <label className="ep-integration-field">公共标题<input className="qx-input" required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="ep-integration-field">主题简介<textarea className="qx-textarea" maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label className="ep-integration-field">主题标签<input className="qx-input" value={topics} onChange={event => setTopics(event.target.value)} placeholder="用顿号分隔，最多 12 个" /></label>
        <label className="ep-integration-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /><span>我确认将当前 {list.data?.find(item => item.id === publishing)?.ready_document_count ?? 0} 份可读资料及原文公开，任何人都可阅读。以后新增的资料不会自动公开。</span></label>
        {error ? <p role="alert" className="qx-notice qx-notice--danger">{error}</p> : null}
        <footer className="ep-integrations__actions"><button className="qx-btn qx-btn--secondary" type="button" disabled={busy} onClick={() => setPublishing(undefined)}>取消</button><button className="qx-btn qx-btn--primary" disabled={busy || !confirm}>{busy ? '正在公开…' : '确认公开当前资料'}</button></footer>
      </form>
    </PublishDialog> : null}
  </IntegrationPage>
}

function PublishDialog({ busy, onClose, trigger, children }: { busy: boolean; onClose(): void; trigger: HTMLButtonElement | null; children: ReactNode }) {
  const titleId = useId()
  const surface = useRef<HTMLElement>(null)
  const interaction = useRef({ busy, onClose })
  useEffect(() => { interaction.current = { busy, onClose } }, [busy, onClose])
  useEffect(() => {
    surface.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!interaction.current.busy) interaction.current.onClose() }
      if (event.key !== 'Tab') return
      const controls = Array.from(surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? [])
      const first = controls[0]; const last = controls.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); if (trigger?.isConnected) trigger.focus() }
  }, [trigger])
  return <div className="ep-integration-dialog"><section ref={surface} role="dialog" aria-modal="true" aria-labelledby={titleId} className="qx-modal ep-integration-dialog__surface"><header><h2 className="qx-section-title" id={titleId}>发布公共主题</h2><button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭发布" disabled={busy} onClick={onClose}><XIcon /></button></header>{children}</section></div>
}

export function PublicDirectoryPage() {
  const [query, setQuery] = useState('')
  const list = useQuery({ queryKey: ['public-directory', query], queryFn: () => api.directory(query) })
  return <IntegrationPage title="发现主题" description="所有者主动公开的资料与原文，可以直接阅读。" actions={<Link className="qx-btn qx-btn--secondary" to="/sharing">管理我的分享<ArrowUpRightIcon /></Link>}>
    <label className="qx-search ep-directory-search"><MagnifyingGlassIcon size={18} aria-hidden="true" /><input type="search" aria-label="搜索公共主题" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主题、简介或标签" /></label>
    {list.isPending ? <LoadingState message="正在寻找公开主题" /> : list.isError ? <ErrorState detail={list.error.message} onRetry={() => { void list.refetch() }} /> : list.data?.length ? <div className="ep-integration-grid">
      {list.data.map(publication => <Link className="qx-card qx-card--interactive ep-directory-card" key={publication.knowledge_base_id} to={`/discover/${publication.knowledge_base_id}`}>
        <div className="ep-directory-card__mark"><FolderIcon size={28} aria-hidden="true" /><ArrowUpRightIcon size={18} aria-hidden="true" /></div>
        <h2 className="qx-card__title">{publication.title}</h2>
        {publication.description ? <p className="qx-card__body">{publication.description}</p> : null}
        <div className="ep-integration-tags">{publication.topics.map(topic => <span className="qx-tag" key={topic}>{topic}</span>)}</div>
        <footer className="qx-meta">{publication.document_count} 份公开资料</footer>
      </Link>)}
    </div> : <Empty title={query ? `没有找到“${query}”` : '还没有公开主题'}><p className="qx-meta">{query ? '换个关键词，再试一次。' : '整理自己的知识库后，你可以选择公开其中的资料。'}</p></Empty>}
  </IntegrationPage>
}

export function SharedReaderPage({ publicView = false }: { publicView?: boolean }) {
  const { libraryId = '' } = useParams()
  const userKey = useIdentityKey()
  return <SharedReaderContent key={`${publicView}:${libraryId}:${userKey ?? 'anonymous'}`} publicView={publicView} />
}

function SharedReaderContent({ publicView }: { publicView: boolean }) {
  const { libraryId = '' } = useParams()
  const userKey = useIdentityKey()
  const [selected, setSelected] = useState<string>()
  const value = useQuery({ queryKey: ['shared-reader', publicView, libraryId, publicView ? 'public' : userKey], queryFn: async () => publicView ? api.publicLibrary(libraryId) : api.library(libraryId) })
  const source = useQuery({ queryKey: ['shared-reader-source', publicView, libraryId, selected, publicView ? 'public' : userKey], queryFn: () => publicView ? api.publicSource(libraryId, selected!) : api.privateSource(libraryId, selected!), enabled: Boolean(selected) })
  const title = value.data ? ('publication' in value.data && value.data.publication ? value.data.publication.title : 'name' in value.data ? value.data.name : '公开主题') : '知识库'
  const documents = value.data?.documents ?? []
  return <IntegrationPage title={title ?? '知识库'} description="只读原文，保留出处。所有者撤销访问后，这些资料将不可继续读取。" actions={<Link className="qx-btn qx-btn--ghost" to={publicView ? '/discover' : '/sharing'}><ArrowLeftIcon />{publicView ? '全部主题' : '共享知识库'}</Link>}>
    {value.isPending ? <LoadingState message="正在读取资料" /> : value.isError ? <ErrorState detail={value.error.message} onRetry={() => { void value.refetch() }} /> : <div className="ep-shared-reader">
      <aside className="ep-shared-reader__files" aria-label="知识库资料">
        <header><h2 className="qx-heading">资料</h2><span className="qx-meta">{documents.length} 份</span></header>
        <nav aria-label="选择资料">{documents.map(document => <button className="qx-item" key={document.id} aria-pressed={selected === document.id} aria-current={selected === document.id ? 'true' : undefined} onClick={() => setSelected(document.id)}><FileTextIcon aria-hidden="true" /><span>{document.filename}</span></button>)}</nav>
        {!documents.length ? <p className="qx-meta">当前没有可读资料。</p> : null}
      </aside>
      <article className="ep-shared-reader__document" aria-label="只读原文">
        {!selected ? <div className="ep-shared-reader__placeholder"><FileTextIcon size={32} aria-hidden="true" /><p className="qx-meta">选择一份资料开始阅读。</p></div> : source.isPending ? <LoadingState message="正在打开原文" /> : source.isError ? <ErrorState detail={source.error.message} onRetry={() => { void source.refetch() }} /> : <div className="ep-shared-reader__prose"><header><span className="qx-tag">只读</span><h2 className="qx-section-title">{source.data?.document.filename}</h2></header>{source.data?.segments.map(segment => <p key={segment.segment_id}>{segment.text}</p>)}</div>}
      </article>
    </div>}
  </IntegrationPage>
}

export function ConnectionsPage() {
  const userKey = useIdentityKey()
  return <ConnectionsContent key={userKey ?? 'anonymous'} />
}

function ConnectionsContent() {
  const userKey = useIdentityKey()
  const list = useQuery({ queryKey: ['external-connections', userKey], queryFn: api.connections })
  const libs = useQuery({ queryKey: ['share-libraries', userKey], queryFn: api.libraries })
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [days, setDays] = useState(30)
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  async function create() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const result = await api.createConnection({ name, library_ids: ids, expires_at: new Date(Date.now() + days * 86400000).toISOString() })
      setSecret(result.secret); setName(''); setIds([]); await list.refetch()
    } catch (failure) { setError(message(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function revoke(id: string) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await api.revokeConnection(id); await list.refetch() }
    catch (failure) { setError(message(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <IntegrationPage title="外部连接" description="只允许读取你选定的知识库。连接有明确有效期，也可以随时撤销。">
    <div className="ep-integrations__body ep-integrations__body--settings">
      <section aria-labelledby="new-connection-title"><header className="ep-integration-section-head"><h2 className="qx-heading" id="new-connection-title">建立只读连接</h2><KeyIcon size={22} aria-hidden="true" /></header>
        <form className="qx-card ep-integration-settings" onSubmit={event => { event.preventDefault(); void create() }}>
          <SettingRow label="连接名称"><input className="qx-input" aria-label="连接名称" value={name} maxLength={80} required onChange={event => setName(event.target.value)} placeholder="例如：我的桌面 Agent" /></SettingRow>
          <SettingRow label="阅读范围"><fieldset className="ep-connection-libraries"><legend className="qx-meta">允许阅读哪些知识库？</legend>
            {libs.isPending ? <p className="qx-meta" role="status">正在读取知识库…</p> : libs.isError ? <ErrorState detail={libs.error.message} onRetry={() => { void libs.refetch() }} /> : libs.data?.filter(library => library.viewer_access === 'owner').length ? libs.data.filter(library => library.viewer_access === 'owner').map(library => <label className="ep-integration-check" key={library.id}><input type="checkbox" checked={ids.includes(library.id)} onChange={event => setIds(event.target.checked ? [...ids, library.id] : ids.filter(id => id !== library.id))} /><span>{library.name}</span></label>) : <p className="qx-meta">还没有可授权的自有知识库。</p>}
          </fieldset></SettingRow>
          <SettingRow label="有效期"><Select className="qx-input ep-connection-expiry" aria-label="有效期" value={days} onChange={nextValue => setDays(Number(nextValue))} options={[{ value: 7, label: "7 天" }, { value: 30, label: "30 天" }, { value: 90, label: "90 天" }]} /></SettingRow>
          <footer className="ep-integration-settings__footer"><p className="qx-meta">创建后请手动配置 MCP 客户端。密钥仅显示一次，不要发送给不信任的人。</p><button className="qx-btn qx-btn--primary" disabled={busy || !ids.length}>{busy ? '正在处理…' : '创建只读连接'}<PlusIcon /></button></footer>
        </form>
      </section>
      {error ? <p role="alert" className="qx-notice qx-notice--danger">{error}</p> : null}
      {secret ? <section className="qx-card ep-connection-secret" aria-labelledby="connection-secret-title"><h2 className="qx-heading" id="connection-secret-title">请现在保存，关闭后不会再次显示</h2><textarea className="qx-textarea" aria-label="一次性连接密钥" readOnly value={secret} /><dl><div><dt>MCP 地址</dt><dd>{window.location.origin}{list.data?.mcp_endpoint ?? '/api/mcp'}</dd></div><div><dt>认证方式</dt><dd>Bearer Token</dd></div></dl><button className="qx-btn qx-btn--secondary" onClick={() => setSecret('')}>我已保存，关闭密钥</button></section> : null}
      <section aria-labelledby="existing-connections-title"><header className="ep-integration-section-head"><h2 className="qx-heading" id="existing-connections-title">现有连接</h2>{list.data ? <span className="qx-meta">{list.data.connections.length} 个</span> : null}</header>
        {list.isPending ? <LoadingState message="正在读取连接" /> : list.isError ? <ErrorState detail={list.error.message} onRetry={() => { void list.refetch() }} /> : list.data?.connections.length ? <ul className="ep-connection-list">{list.data.connections.map(connection => <li key={connection.connection_id}><ShieldCheckIcon size={22} aria-hidden="true" /><div><strong>{connection.name}</strong><p className="qx-meta">{connection.library_ids.length} 个知识库 · {new Date(connection.expires_at).toLocaleDateString()} 到期</p></div><span className="qx-tag">{connection.status === 'active' ? '有效' : connection.status === 'expired' ? '已到期' : '已撤销'}</span>{connection.status === 'active' ? <button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => { void revoke(connection.connection_id) }}>撤销</button> : null}</li>)}</ul> : <p className="qx-meta">还没有外部连接。你的资料不会自动开放给其他工具。</p>}
      </section>
    </div>
  </IntegrationPage>
}

export { SubscriptionPage } from './SubscriptionPage'
